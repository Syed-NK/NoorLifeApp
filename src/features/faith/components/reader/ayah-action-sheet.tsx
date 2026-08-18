import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@ds/components';
import { fontFamilies, neutralColors } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import type { IconName } from '@shared/models/icon';
import { minimumHitSlop } from '@shared/utils/a11y';

import { useAyahNote } from '../../hooks/use-ayah-note';
import { usePlaylists } from '../../hooks/use-playlists';
import { containsVerse, MAX_PLAYLIST_NAME } from '../../storage/faith-playlists';
import { moveAccessibilityFocus } from './ayah-focus';

/**
 * Everything one ayah can be done to, in one modal sheet over the reading column.
 *
 * ── Why a sheet, and why it is the only route ───────────────────────────────
 * The reader used to answer this question in three places at once: a bookmark glyph in every
 * verse's margin, an overflow menu beside it, and a "Save my place here" link under the
 * translation — three controls per verse, 858 of them in Al-Baqarah, and two of them duplicating
 * an action the third also offered. All three are gone. A verse is pressed; a sheet opens; the
 * sheet is the one implementation of each of the seven things a verse can be.
 *
 * That also fixes something the icons could not. There is no room in a 24 dp margin for "add a
 * note", "add to a playlist" or "ask about this verse", so those actions could not exist while the
 * margin was the interface. The sheet has room for exactly as many actions as there are.
 *
 * ── Opening it does nothing ─────────────────────────────────────────────────
 * The single most important rule in this file. Opening the sheet does not start playback, does not
 * mark the verse read and does not move the player. `selected` — the verse whose sheet is open — is
 * a third state alongside `focused` and `active` precisely so that it can mean *nothing has
 * happened yet*. Only pressing **Play** starts recitation, and only pressing **Read** records
 * reading. A sheet that autoplayed would make every attempt to bookmark a verse into a recitation
 * the user did not ask for.
 *
 * ── Why the animation is hand-rolled and not `Modal`'s own ──────────────────
 * `animationType="slide"` translates the *whole* modal, scrim included, so the dimming appears to
 * slide up from the bottom edge rather than settling over the page. Two `Animated.Value`s — one for
 * the entrance, one for the drag — give the ordinary shape instead: the scrim fades while the panel
 * rises, and the same pair is what makes a swipe down track the finger rather than snapping.
 */

/**
 * The seven actions, in the one order they may appear in.
 *
 * Exported because "exactly these, in this sequence" is a product requirement rather than a layout
 * detail, and a requirement stated as an array can be asserted. Learn and Memorize are deliberately
 * absent: neither has an implementation behind it, and a row that opened nothing would be the
 * placeholder this sheet exists to avoid.
 */
export const AYAH_ACTION_KEYS = [
  'play',
  'read',
  'bookmark',
  'note',
  'playlist',
  'ask-noor-ai',
  'share',
] as const;

export type AyahActionKey = (typeof AYAH_ACTION_KEYS)[number];

/** The modal dim, from the locked scrim token. */
const SHEET_SCRIM = neutralColors.scrim;

/** How far a drag must travel before releasing dismisses rather than springs back. */
const DISMISS_DISTANCE = 90;
/** …or how fast it must be moving, for a short flick. */
const DISMISS_VELOCITY = 0.7;

/**
 * Whether releasing a downward drag here dismisses the sheet or lets it spring back.
 *
 * ── Why the rule is a function and not four lines inside the responder ──────
 * Because it is the only part of the gesture worth asserting, and it is the only part a test can
 * reach. `PanResponder` computes its `gestureState` from the platform's touch history, so a test
 * cannot hand it a synthetic 140 dp swipe without reimplementing that history — what it would end
 * up asserting is its own arithmetic. Pulled out here, the decision is checkable directly and the
 * responder below is left with nothing in it but plumbing.
 *
 * Two ways to dismiss, because two gestures mean it: a deliberate drag past the threshold, and a
 * short fast flick that never travels far. Requiring both would ignore the flick, which is what
 * most people actually do.
 */
export function dismissesOnRelease(gesture: { readonly dy: number; readonly vy: number }): boolean {
  return gesture.dy > DISMISS_DISTANCE || (gesture.dy > 0 && gesture.vy > DISMISS_VELOCITY);
}

const ENTER_MS = 220;
const EXIT_MS = 160;

export type AyahActionSheetProps = {
  readonly surahName: string;
  readonly surah: number;
  readonly ayah: number;
  /** False when this reciter published no recording of this verse. Play then states why. */
  readonly canPlay: boolean;
  readonly bookmarked: boolean;
  /** True when the reading log's furthest position in this surah already covers this verse. */
  readonly read: boolean;
  /** Travels into a playlist entry, so a later change of default reciter cannot rewrite the list. */
  readonly reciterId: string;
  readonly onPlay: () => void;
  readonly onRead: () => void;
  readonly onToggleBookmark: () => void;
  readonly onAskNoorAI: () => void;
  readonly onShare: () => void;
  /** Called after the exit animation, so the reader can restore focus to the verse. */
  readonly onDismiss: () => void;
  /** Called when a note was created, edited or deleted, so the reader can re-read its index. */
  readonly onNotesChanged: () => void;
};

/** Which face of the sheet is showing. Sub-panels replace the list rather than stacking a modal. */
type Panel = 'actions' | 'note' | 'playlist';

export function AyahActionSheet({
  surahName,
  surah,
  ayah,
  canPlay,
  bookmarked,
  read,
  reciterId,
  onPlay,
  onRead,
  onToggleBookmark,
  onAskNoorAI,
  onShare,
  onDismiss,
  onNotesChanged,
}: AyahActionSheetProps) {
  const { dp } = useModuleMetrics();
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState<Panel>('actions');
  const note = useAyahNote(surah, ayah);
  const title = `Aya ${surah}:${ayah}`;

  const [enter] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  /**
   * The panel's own height, measured rather than assumed.
   *
   * The entrance translates by exactly this, so the sheet starts flush with the bottom edge
   * whatever it contains — and it contains different amounts at every font scale, which is why a
   * constant here would either overshoot into a visible delay or undershoot into a pop.
   */
  const [height, setHeight] = useState(0);

  const titleRef = useRef<View | null>(null);

  /**
   * The entrance, held until the panel has been measured.
   *
   * Starting it on mount looked right and was not: the travel distance is the panel's own height,
   * so until `onLayout` reports one the interpolation runs against a guess. Replacing the guess
   * mid-flight moves the output range under an animation already part-way through it, which reads
   * as a jolt a third of the way up. One frame of the sheet sitting below the fold costs nothing;
   * the jolt is visible.
   */
  useEffect(() => {
    if (height === 0) {
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: ENTER_MS,
      useNativeDriver: true,
    }).start();
  }, [enter, height]);

  /**
   * The screen reader follows the sheet in.
   *
   * Without this, TalkBack stays on the verse behind a modal it cannot see the boundaries of, and
   * the first swipe goes to whatever the reader happens to have above it. The title is the target
   * because it names the verse the actions belong to, which is the one fact a user arriving here
   * needs before any of the rows make sense.
   */
  useEffect(() => {
    const timer = setTimeout(() => moveAccessibilityFocus(titleRef.current), 0);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Runs the exit, then hands back.
   *
   * ── Why there is no "already closing" guard ─────────────────────────────────
   * There was one, held in a ref, and it made this callback read a ref during render once the pan
   * responder below closed over it — which this project's lint rules reject, and correctly: a value
   * read during render that React does not track is how a component stops re-rendering when it
   * should. It is not needed either. Dismissal is idempotent all the way down: a second `close`
   * animates an already-zero value to zero, and the reader's `onDismiss` clears a selection that is
   * already null and re-focuses a verse that is already focused. There is nothing for a guard to
   * protect.
   */
  const close = useCallback(() => {
    Animated.timing(enter, {
      toValue: 0,
      duration: EXIT_MS,
      useNativeDriver: true,
    }).start(() => onDismiss());
  }, [enter, onDismiss]);

  /**
   * Swipe down to dismiss, from the grabber and the header only.
   *
   * Deliberately not from the whole panel: the action list scrolls on a short screen or at a large
   * font scale, and a pan responder over the list would steal every attempt to scroll it. The
   * header is the part of a sheet users already drag.
   */
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          // Downward only. Dragging up would lift the sheet off the bottom edge and reveal the page
          // beneath it, which is not a state this sheet has.
          drag.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (dismissesOnRelease(gesture)) {
            close();
            return;
          }
          Animated.timing(drag, { toValue: 0, duration: 140, useNativeDriver: true }).start();
        },
      }),
    [drag, close],
  );

  const translateY = Animated.add(
    enter.interpolate({
      inputRange: [0, 1],
      outputRange: [height === 0 ? 400 : height, 0],
    }),
    drag,
  );

  /** Android Back, and the header's back arrow inside a sub-panel, are the same gesture. */
  const requestBack = useCallback(() => {
    if (panel === 'actions') {
      close();
      return;
    }
    setPanel('actions');
  }, [panel, close]);

  return (
    <Modal
      visible
      transparent
      /*
        `none`, because the entrance above is this component's. See the note at the head of the file
        for why `slide` is the wrong shape for a sheet with its own scrim.
      */
      animationType="none"
      onRequestClose={requestBack}
      statusBarTranslucent
      testID="faith-reader-ayah-actions-modal"
    >
      <View style={styles.fill}>
        {/*
          The scrim dims the reader and dismisses it. It is a separate sibling from the panel rather
          than the panel's parent, so a press that lands on the sheet cannot bubble out to it —
          which is what used to close the sheet when a user pressed a row and missed by two points.
        */}
        <Animated.View style={[styles.scrim, { opacity: enter }]}>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={`Close the actions for aya ${surah} verse ${ayah}`}
            style={styles.fill}
            testID="faith-reader-ayah-actions-scrim"
          />
        </Animated.View>

        <Animated.View
          onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            {
              backgroundColor: moduleNeutrals.surface,
              borderTopLeftRadius: dp(moduleLayout.cardRadius),
              borderTopRightRadius: dp(moduleLayout.cardRadius),
              /* The device's own gesture bar, so the last row is never under it. */
              paddingBottom: insets.bottom + dp(10),
              transform: [{ translateY }],
            },
          ]}
          testID="faith-reader-ayah-actions"
        >
          <View {...pan.panHandlers}>
            <View
              style={[
                styles.grabber,
                {
                  width: dp(36),
                  height: dp(4),
                  borderRadius: dp(2),
                  backgroundColor: moduleNeutrals.border,
                  marginTop: dp(8),
                },
              ]}
              accessible={false}
            />

            <View
              style={[
                styles.header,
                { paddingHorizontal: dp(moduleLayout.pagePadding), paddingVertical: dp(10) },
              ]}
            >
              {panel === 'actions' ? null : (
                <Pressable
                  onPress={() => setPanel('actions')}
                  accessibilityRole="button"
                  accessibilityLabel="Back to the aya actions"
                  hitSlop={minimumHitSlop(dp(24))}
                  style={{ marginRight: dp(8) }}
                  testID="faith-reader-sheet-back"
                >
                  <AppIcon name="back" size={dp(20)} color={moduleNeutrals.textPrimary} />
                </Pressable>
              )}

              <View ref={titleRef} accessible accessibilityRole="header" style={styles.flex}>
                <ModuleText token="cardTitle">
                  {panel === 'note'
                    ? `Note on ${title}`
                    : panel === 'playlist'
                      ? `Add ${title} to a playlist`
                      : title}
                </ModuleText>
                <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                  {surahName}
                </ModuleText>
              </View>

              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={minimumHitSlop(dp(24))}
                testID="faith-reader-sheet-close"
              >
                <AppIcon name="close" size={dp(20)} color={moduleNeutrals.textSecondary} />
              </Pressable>
            </View>
          </View>

          {/*
            Scrollable, and bounded to most of the screen rather than to a fixed height. At Android's
            largest font scale the seven rows are taller than a short handset, and a sheet that
            clipped them would hide the last two actions with nothing to say they were there.
          */}
          <ScrollView
            style={{ maxHeight: dp(430) }}
            contentContainerStyle={{
              paddingHorizontal: dp(moduleLayout.pagePadding),
              paddingBottom: dp(8),
            }}
            keyboardShouldPersistTaps="handled"
            testID="faith-reader-sheet-scroll"
          >
            {panel === 'actions' ? (
              <ActionList
                surah={surah}
                ayah={ayah}
                canPlay={canPlay}
                bookmarked={bookmarked}
                read={read}
                hasNote={note.note !== null}
                onPlay={() => {
                  onPlay();
                  close();
                }}
                onRead={onRead}
                onToggleBookmark={onToggleBookmark}
                onOpenNote={() => setPanel('note')}
                onOpenPlaylist={() => setPanel('playlist')}
                onAskNoorAI={() => {
                  onAskNoorAI();
                  close();
                }}
                onShare={onShare}
              />
            ) : null}

            {panel === 'note' ? (
              <NotePanel
                surah={surah}
                ayah={ayah}
                note={note}
                onChanged={() => {
                  onNotesChanged();
                  setPanel('actions');
                }}
              />
            ) : null}

            {panel === 'playlist' ? (
              <PlaylistPanel surah={surah} ayah={ayah} reciterId={reciterId} />
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * The seven rows.
 *
 * Every one of them does something. Play is the one row that can be *unavailable*, and it says so
 * in words rather than being drawn and inert: a reciter with no recording of a verse is a fact
 * about that reciter, and hiding the row instead would make the sheet a different length on
 * different verses for a reason the user cannot see.
 */
function ActionList({
  surah,
  ayah,
  canPlay,
  bookmarked,
  read,
  hasNote,
  onPlay,
  onRead,
  onToggleBookmark,
  onOpenNote,
  onOpenPlaylist,
  onAskNoorAI,
  onShare,
}: {
  readonly surah: number;
  readonly ayah: number;
  readonly canPlay: boolean;
  readonly bookmarked: boolean;
  readonly read: boolean;
  readonly hasNote: boolean;
  readonly onPlay: () => void;
  readonly onRead: () => void;
  readonly onToggleBookmark: () => void;
  readonly onOpenNote: () => void;
  readonly onOpenPlaylist: () => void;
  readonly onAskNoorAI: () => void;
  readonly onShare: () => void;
}) {
  const reference = `aya ${surah} verse ${ayah}`;

  return (
    <View testID="faith-reader-sheet-actions">
      <ActionRow
        actionKey="play"
        icon="play"
        label="Play"
        detail={canPlay ? null : 'This reciter has no recording of this aya'}
        disabled={!canPlay}
        spoken={`Play ${reference}`}
        hint="Starts the recitation in the player at the bottom of the reader"
        onPress={onPlay}
      />
      <ActionRow
        actionKey="read"
        icon="check-circle"
        label="Read"
        detail={read ? 'Already recorded as read' : null}
        checked={read}
        spoken={read ? `${reference} is already recorded as read` : `Mark ${reference} as read`}
        hint="Records your reading progress up to this aya"
        onPress={onRead}
      />
      <ActionRow
        actionKey="bookmark"
        icon="bookmark"
        label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
        checked={bookmarked}
        spoken={bookmarked ? `Remove the bookmark on ${reference}` : `Bookmark ${reference}`}
        onPress={onToggleBookmark}
      />
      <ActionRow
        actionKey="note"
        icon="note"
        label="Add note"
        detail={hasNote ? 'You have a note on this aya' : null}
        spoken={hasNote ? `Edit your note on ${reference}` : `Add a note to ${reference}`}
        onPress={onOpenNote}
      />
      <ActionRow
        actionKey="playlist"
        icon="playlist"
        label="Add to playlist"
        spoken={`Add ${reference} to a playlist`}
        onPress={onOpenPlaylist}
      />
      <ActionRow
        actionKey="ask-noor-ai"
        icon="robot"
        label="Ask Noor AI"
        spoken={`Ask Noor AI about ${reference}`}
        hint="Opens Noor AI with this aya as its context"
        onPress={onAskNoorAI}
      />
      <ActionRow
        actionKey="share"
        icon="share"
        label="Share"
        spoken={`Share ${reference}`}
        hint="Opens your device's share sheet"
        onPress={onShare}
      />
    </View>
  );
}

/**
 * One action.
 *
 * 48 dp tall and never shorter, which is above the 44 dp both platforms require and is what the
 * brief asks a sheet row to be. The pressed state is drawn rather than animated, for the same
 * reason the verse block's is: this is a list, and a row that scaled would move its neighbours.
 *
 * ── Why the pressed state is held here instead of taken from `style`'s argument ─
 * `Pressable` will hand a style function a `pressed` flag, which is the shorter way to write this
 * and is the way the verse block does write it. It is unreachable from a test: the flag lives
 * inside `Pressability`, the resolved style is all that reaches the host node, and there is no
 * prop a test can fire to move it. A requirement that says "visible pressed state" and cannot be
 * checked is a requirement that quietly stops being true, so the flag is ordinary state driven by
 * ordinary handlers — the same pixels, reachable from a test.
 */
function ActionRow({
  actionKey,
  icon,
  label,
  detail,
  disabled,
  checked,
  spoken,
  hint,
  onPress,
}: {
  readonly actionKey: AyahActionKey;
  readonly icon: IconName;
  readonly label: string;
  readonly detail?: string | null;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly spoken: string;
  readonly hint?: string;
  readonly onPress: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const [pressed, setPressed] = useState(false);
  const tint = disabled === true ? moduleNeutrals.textTertiary : theme.ink;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled === true}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
      accessibilityState={{
        ...(disabled === true ? { disabled: true } : {}),
        ...(checked === undefined ? {} : { checked }),
      }}
      style={[
        styles.actionRow,
        {
          minHeight: dp(48),
          columnGap: dp(12),
          paddingVertical: dp(6),
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(6),
          marginHorizontal: dp(-6),
          backgroundColor: pressed ? moduleNeutrals.surfaceMuted : 'transparent',
        },
      ]}
      testID={`faith-reader-action-${actionKey}`}
    >
      <AppIcon name={icon} size={dp(20)} color={tint} />
      <View style={styles.flex}>
        <ModuleText token="cardAction" color={tint}>
          {label}
        </ModuleText>
        {detail === undefined || detail === null ? null : (
          <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
            {detail}
          </ModuleText>
        )}
      </View>
    </Pressable>
  );
}

/**
 * The note editor for one verse.
 *
 * ── It edits the verse, not the row that opened it ──────────────────────────
 * `surah` and `ayah` are passed down and used as the storage identity all the way through — see
 * `faith-notes.ts` for why an index would silently re-attach the note to a different verse once the
 * reader loaded a second page.
 *
 * Create, edit and delete are one screen rather than three: the field is pre-filled when a note
 * exists, Save writes it, and Delete is offered only when there is something to delete. Saving an
 * empty field is also a delete, which is what a user who selects all and clears expects.
 */
function NotePanel({
  surah,
  ayah,
  note,
  onChanged,
}: {
  readonly surah: number;
  readonly ayah: number;
  readonly note: ReturnType<typeof useAyahNote>;
  readonly onChanged: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const [draft, setDraft] = useState(note.note?.text ?? '');
  const existing = note.note;

  /** The stored note arrives asynchronously; the draft follows it until the user types. */
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) {
      setDraft(existing?.text ?? '');
    }
  }, [existing]);

  return (
    <View style={{ rowGap: dp(10), paddingTop: dp(4) }} testID="faith-reader-note-panel">
      <TextInput
        value={draft}
        onChangeText={(value) => {
          touched.current = true;
          setDraft(value);
        }}
        multiline
        placeholder="What do you want to remember about this aya?"
        placeholderTextColor={moduleNeutrals.textSecondary}
        accessibilityLabel={`Your note on aya ${surah} verse ${ayah}`}
        style={[
          styles.noteInput,
          {
            minHeight: dp(96),
            borderRadius: dp(moduleLayout.radiusSmall),
            borderColor: theme.border,
            padding: dp(12),
            fontSize: dp(13),
            color: moduleNeutrals.textPrimary,
          },
        ]}
        testID="faith-reader-note-input"
      />

      <View style={[styles.noteActions, { columnGap: dp(10) }]}>
        <Pressable
          onPress={() => {
            void note.save(draft).then(onChanged);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Save your note on aya ${surah} verse ${ayah}`}
          style={({ pressed }) => [
            styles.noteButton,
            {
              minHeight: dp(moduleLayout.minTouchTarget),
              borderRadius: dp(moduleLayout.radiusSmall),
              paddingHorizontal: dp(18),
              backgroundColor: theme.fill,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          testID="faith-reader-note-save"
        >
          <ModuleText token="button" color={theme.onFill}>
            Save note
          </ModuleText>
        </Pressable>

        {existing === null ? null : (
          <Pressable
            onPress={() => {
              void note.remove().then(onChanged);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Delete your note on aya ${surah} verse ${ayah}`}
            style={({ pressed }) => [
              styles.noteButton,
              {
                minHeight: dp(moduleLayout.minTouchTarget),
                borderRadius: dp(moduleLayout.radiusSmall),
                paddingHorizontal: dp(18),
                borderWidth: dp(1),
                borderColor: moduleNeutrals.border,
                backgroundColor: pressed ? moduleNeutrals.surfaceMuted : 'transparent',
              },
            ]}
            testID="faith-reader-note-delete"
          >
            <ModuleText token="button" color={moduleNeutrals.error}>
              Delete
            </ModuleText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * The playlist selector: choose an existing list, or name a new one.
 *
 * ── A duplicate is reported, never silently absorbed ────────────────────────
 * Adding a verse a list already holds writes nothing and says so. The alternative — appending it
 * again — produces a list that recites the same verse twice with no way for the user to see why,
 * and silently doing nothing produces a tap that appears not to have worked. The third option is
 * the honest one, so it is the one the storage layer returns and this panel prints.
 */
function PlaylistPanel({
  surah,
  ayah,
  reciterId,
}: {
  readonly surah: number;
  readonly ayah: number;
  readonly reciterId: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const { playlists, ready, create, add } = usePlaylists();
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const addTo = useCallback(
    (playlistId: string, playlistName: string) => {
      void add(playlistId, { surah, ayah, reciterId }).then((outcome) => {
        setStatus(
          outcome === 'added'
            ? `Added aya ${surah}:${ayah} to ${playlistName}.`
            : outcome === 'duplicate'
              ? `Aya ${surah}:${ayah} is already in ${playlistName}.`
              : `${playlistName} is no longer available.`,
        );
      });
    },
    [add, surah, ayah, reciterId],
  );

  return (
    <View style={{ rowGap: dp(8), paddingTop: dp(4) }} testID="faith-reader-playlist-panel">
      {status === null ? null : (
        <ModuleText
          token="caption"
          color={moduleNeutrals.textSecondary}
          testID="faith-reader-playlist-status"
        >
          {status}
        </ModuleText>
      )}

      {ready && playlists.length === 0 ? (
        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
          You have no playlists yet. Name one below to start.
        </ModuleText>
      ) : null}

      {playlists.map((playlist) => {
        const already = containsVerse(playlist, surah, ayah);
        return (
          <Pressable
            key={playlist.id}
            onPress={() => addTo(playlist.id, playlist.name)}
            accessibilityRole="button"
            accessibilityLabel={
              already
                ? `${playlist.name}. Aya ${surah} verse ${ayah} is already in this playlist.`
                : `Add aya ${surah} verse ${ayah} to ${playlist.name}`
            }
            accessibilityState={{ checked: already }}
            style={({ pressed }) => [
              styles.actionRow,
              {
                minHeight: dp(48),
                columnGap: dp(12),
                borderRadius: dp(moduleLayout.radiusSmall),
                paddingHorizontal: dp(6),
                marginHorizontal: dp(-6),
                backgroundColor: pressed ? moduleNeutrals.surfaceMuted : 'transparent',
              },
            ]}
            testID={`faith-reader-playlist-${playlist.id}`}
          >
            <AppIcon name={already ? 'check-circle' : 'playlist'} size={dp(20)} color={theme.ink} />
            <View style={styles.flex}>
              <ModuleText token="cardAction" color={theme.ink}>
                {playlist.name}
              </ModuleText>
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                {already
                  ? 'Already in this playlist'
                  : `${playlist.entries.length} ${playlist.entries.length === 1 ? 'aya' : 'ayat'}`}
              </ModuleText>
            </View>
          </Pressable>
        );
      })}

      <View style={[styles.newRow, { columnGap: dp(8), marginTop: dp(4) }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={MAX_PLAYLIST_NAME}
          placeholder="New playlist name"
          placeholderTextColor={moduleNeutrals.textSecondary}
          accessibilityLabel="Name for a new playlist"
          style={[
            styles.nameInput,
            {
              minHeight: dp(moduleLayout.minTouchTarget),
              borderRadius: dp(moduleLayout.radiusSmall),
              borderColor: theme.border,
              paddingHorizontal: dp(12),
              fontSize: dp(13),
              color: moduleNeutrals.textPrimary,
            },
          ]}
          testID="faith-reader-playlist-name"
        />
        <Pressable
          onPress={() => {
            const trimmed = name.trim();
            if (trimmed === '') {
              setStatus('Give the playlist a name first.');
              return;
            }
            void create(trimmed).then((playlist) => {
              setName('');
              addTo(playlist.id, playlist.name);
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={`Create a playlist and add aya ${surah} verse ${ayah} to it`}
          style={({ pressed }) => [
            styles.noteButton,
            {
              minHeight: dp(moduleLayout.minTouchTarget),
              borderRadius: dp(moduleLayout.radiusSmall),
              paddingHorizontal: dp(16),
              backgroundColor: theme.fill,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          testID="faith-reader-playlist-create"
        >
          <ModuleText token="button" color={theme.onFill}>
            Create
          </ModuleText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SHEET_SCRIM,
  },
  sheet: {
    marginTop: 'auto',
  },
  grabber: {
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  noteInput: {
    borderWidth: 1,
    fontFamily: fontFamilies.regular,
    textAlignVertical: 'top',
  },
  noteActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  noteButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    fontFamily: fontFamilies.regular,
  },
});
