import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals, readerAyahColors } from '@features/modules/module-tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import type { AyahText, AyahTranslation } from '../../data/quran-content.repository';
import { ArabicText } from '../faith-list';
import type { AyahFocusRegistry } from './ayah-focus';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * One ayah, in a continuous reader.
 *
 * ── What this replaces, and why the card had to go ──────────────────────────
 * Every verse used to be a `ModuleCard`: a white rounded rectangle with its own padding, shadow and
 * radius. On a 286-ayah surah that produces 286 boxes, and the effect is a *list of records* rather
 * than a page of scripture — the eye stops at every boundary, and the chrome occupies more vertical
 * space than the translation does. A mushaf is a continuous column of text with the verses separated
 * by the thinnest mark that will do the job, and that is what this is: no card, no radius, no
 * shadow, and a hairline between one ayah and the next.
 *
 * ── There is nothing to press *beside* an ayah, because the ayah is the control ─
 * The margin used to carry two glyphs on every verse — a bookmark and an overflow — repeated 286
 * times down a reading column, and a third control ("Save my place here") at the foot of each one.
 * All three are gone. The whole verse is now one press target and it opens one sheet, which is
 * where every action lives: see `AyahActionSheet`. Two consequences follow and both are the point.
 * The reading column got its width back, and there is exactly one implementation of "bookmark this
 * verse" in the reader rather than an icon and a menu item that could disagree.
 *
 * ── The state is a ground, never a mark ─────────────────────────────────────
 * `state` is drawn as a fill behind the **Arabic block and nothing else**. There is no left border,
 * no right border, no vertical marker, no progress stripe and no decorative rail — the reciting
 * verse used to carry a 3 dp bar down its leading edge and the deep-linked verse another around the
 * whole block, and two rules in the same column in the same hue meaning two different things is
 * what the correction removes.
 *
 * The translation is never tinted. That is what answers the standing objection to tinting scripture
 * at all: the translation's contrast does not change in any state, because it is never on the fill,
 * and the Arabic keeps its own ink, size and measured contrast on every one of the three grounds —
 * see `readerAyahColors` for the ratios.
 */

/**
 * Which of the three verse states this block is in, in the order they take precedence.
 *
 * `active` beats `selected` beats `focused`, and the ordering is a statement rather than a
 * convenience: the darker green means *this verse is being recited now*, and a verse whose sheet
 * happens to be open while it plays is still being recited. `idle` is the ordinary case — the great
 * majority of a page — and draws nothing at all.
 */
export type AyahBlockState = 'active' | 'selected' | 'focused' | 'idle';

const STATE_FILL: Readonly<Record<Exclude<AyahBlockState, 'idle'>, string>> = {
  active: readerAyahColors.active,
  selected: readerAyahColors.selected,
  focused: readerAyahColors.focused,
};

/** What a screen reader is told each state means. Never carried by colour alone. */
const STATE_SPOKEN: Readonly<Record<Exclude<AyahBlockState, 'idle'>, string>> = {
  active: 'Now reciting',
  selected: 'Actions open',
  focused: 'Ready to play',
};

function AyahBlockRow({
  surahName,
  text,
  translation,
  state,
  bookmarked,
  read,
  hasNote,
  focusRegistry,
  onOpenActions,
}: {
  readonly surahName: string;
  readonly text: AyahText;
  readonly translation: AyahTranslation | null;
  readonly state: AyahBlockState;
  /** Announced, not drawn: there is no permanent icon beside an ayah in any state. */
  readonly bookmarked: boolean;
  readonly read: boolean;
  readonly hasNote: boolean;
  /**
   * Where this verse records its pill, so the reader can return the screen reader here when the
   * action sheet closes. See `ayah-focus.ts` for why a registry and not a ref.
   */
  readonly focusRegistry: AyahFocusRegistry;
  /**
   * Takes the verse it is opening, so one handler can serve every row.
   *
   * A per-row closure would be rebuilt on each of the parent renders and defeat the `memo` below
   * — which is exactly what it used to be, and what made a deep link render 286 rows three times.
   */
  readonly onOpenActions: (ayah: number) => void;
}) {
  const openActions = useCallback(() => onOpenActions(text.ayah), [onOpenActions, text.ayah]);
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const fill = state === 'idle' ? null : STATE_FILL[state];

  /**
   * Everything a screen reader needs about this verse, in one sentence.
   *
   * Bookmarked, read and annotated are all announced here because none of them is drawn any more.
   * A sighted user learns them by opening the sheet; this is the equivalent, and omitting them
   * would make the three states reachable only by opening a sheet to find out.
   */
  const spokenState = [
    bookmarked ? 'bookmarked' : null,
    read ? 'read' : null,
    hasNote ? 'has a note' : null,
    state === 'idle' ? null : STATE_SPOKEN[state],
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return (
    /*
      A plain `Pressable` rather than `PressableScale`, and both halves of that are deliberate.

      `PressableScale` draws its touch surface as an absolutely-positioned overlay *above* its
      children, which is right for a button and wrong for a paragraph: the overlay would sit over
      the scripture and the reader would lose the ability to select or scroll from it. And the
      press feedback it provides — scaling the whole view to 0.98 — is feedback for a control, not
      for a column of text; a verse that shrank when touched would make scrolling feel like
      pressing. The pressed state here is a ground shift instead, which is the same language the
      three verse states already speak.

      `accessible` is left unset on purpose, so this container does **not** merge its children into
      one node. Merging is the usual way to make a region one press target, and it would cost the
      Arabic its `accessibilityLanguage`, which is what stops TalkBack reading Uthmani script
      through the interface language. The pill below is the labelled button in the region; the
      region itself still answers a tap anywhere in it, including a TalkBack double-tap landing on
      the scripture.
    */
    <View
      style={{
        paddingVertical: dp(14),
        borderTopWidth: dp(1),
        borderTopColor: moduleNeutrals.divider,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/*
          The verse reference, and the only piece of furniture left in the margin.

          It reads `Aya 4:1` and not `4:1`. A bare pair of numbers beside a paragraph of Arabic is
          ambiguous in a way the standard citation is not — it could be a range, a page, a juz — and
          the product's own word for a verse is "Aya", so that is the word the label uses.

          No `minWidth` and no `numberOfLines`: the pill sizes to its text. A fixed width was what
          truncated the longer references, and a compact pill that clips its own citation is worse
          than a pill four points wider.
        */}
        <PillTarget
          ayah={text.ayah}
          label={`Aya ${text.surah} verse ${text.ayah}${spokenState === '' ? '' : `, ${spokenState}`}`}
          focusRegistry={focusRegistry}
          onPress={openActions}
          testID={`faith-reader-ayah-number-${text.surah}-${text.ayah}`}
        >
          <View
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: dp(8),
              paddingVertical: dp(2),
              borderRadius: dp(moduleLayout.radiusPill),
              borderWidth: dp(1),
              borderColor: theme.border,
            }}
          >
            <ModuleText token="caption" color={theme.ink}>
              {`Aya ${text.surah}:${text.ayah}`}
            </ModuleText>
          </View>
        </PillTarget>

        <View style={{ flex: 1 }} />
      </View>

      {/*
        ── The verse body carries the row press, beside the pill rather than around it — #120 ──
        The block used to be one `Pressable` **containing** the pill, so an interactive container
        held an interactive descendant and the two announced near-identical labels: exactly the shape
        `faith-accessibility-interaction` refuses, and the one corrected for the Bookmarks row in
        #119. On device the accessibility tree showed it plainly —
        `ViewGroup faith-reader-ayah-1-1 clickable=true` wrapping
        `Button faith-reader-ayah-number-1-1 clickable=true`.

        Making them siblings keeps both behaviours the old structure was written for. A tap anywhere
        on the scripture or the translation still opens the actions, which is what the container was
        for; the pill is still the region's one labelled button, which is what it was for. What is
        gone is one being inside the other.

        `accessible` stays unset, for the reason the old container gave: merging would cost the
        Arabic its `accessibilityLanguage`, which is what stops TalkBack reading Uthmani script
        through the interface language.
      */}
      <Pressable
        onPress={openActions}
        accessibilityLabel={`Aya ${text.surah} verse ${text.ayah}`}
        style={({ pressed }) => ({
          /* Always far taller than the floor in practice; stated so it is provable, not argued. */
          minHeight: minimumTouchTargetSize(),
          backgroundColor: pressed ? moduleNeutrals.surfaceMuted : 'transparent',
        })}
        testID={`faith-reader-ayah-${text.surah}-${text.ayah}`}
      >
        <View
          style={{
            marginTop: dp(10),
            ...(fill === null
              ? {}
              : {
                  backgroundColor: fill,
                  borderRadius: dp(moduleLayout.radiusSmall),
                  paddingHorizontal: dp(12),
                  paddingVertical: dp(10),
                  marginHorizontal: dp(-2),
                }),
          }}
          testID={
            state === 'idle' ? undefined : `faith-reader-ayah-${state}-${text.surah}-${text.ayah}`
          }
        >
          <ArabicText size="scripture" testID={`faith-reader-arabic-${text.surah}-${text.ayah}`}>
            {text.arabic}
          </ArabicText>
        </View>

        {/*
        On the ordinary surface in every state, and with no `numberOfLines` here or anywhere on this
        path. The limit was 6, which ellipsised any translation longer than six lines — silently
        abridging the meaning of an ayah, which is the one thing on this screen that must never be
        shortened. A long verse makes the page taller, which is right.
      */}
        {translation === null ? null : (
          <ModuleText
            token="body"
            style={{ marginTop: dp(10) }}
            testID={`faith-reader-translation-${text.surah}-${text.ayah}`}
          >
            {translation.text}
          </ModuleText>
        )}
      </Pressable>
    </View>
  );
}

/**
 * The pill, as the region's one labelled button.
 *
 * It exists as a separate component only so the ref callback that registers it can be written
 * without turning `AyahBlock` into a closure factory per verse. The hit area is deliberately the
 * pill and not the whole row: the row's remaining width belongs to the verse, which is pressable
 * anyway through its container.
 */
function PillTarget({
  ayah,
  label,
  focusRegistry,
  onPress,
  children,
  testID,
}: {
  readonly ayah: number;
  readonly label: string;
  readonly focusRegistry: AyahFocusRegistry;
  readonly onPress: () => void;
  readonly children: React.ReactNode;
  readonly testID: string;
}) {
  return (
    <Pressable
      ref={(node) => focusRegistry.register(ayah, node)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the actions for this aya"
      /*
        The floor on the node that carries the role, the label and the press — issue #120.

        The drawn pill is a caption with 2 dp of vertical padding, so the labelled node measured
        **146 x 59 px / 51.911 x 20.978 dp** on a 450 dpi handset at font scale 1.0, and
        **28.444 dp** at 1.5 — under half the minimum at the default scale, and never reaching it.
        This is the class #115 did not close: a plain `Pressable` carrying neither a bound nor a
        `hitSlop`, so there was nothing in the source to notice.

        The pill itself is unchanged. `minWidth` is a *minimum*, so the citation still sizes to its
        text and a longer reference is still not truncated — the property the comment at the call
        site protects. Only the box around it grew, which is what makes the block a little taller.
      */
      style={{
        minWidth: minimumTouchTargetSize(),
        minHeight: minimumTouchTargetSize(),
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

/**
 * Memoised, because the reader re-renders the whole surah for things no verse displays — issue #55.
 *
 * Opening a deep link into Al-Baqarah committed three passes over a 286-row list: the mount, then two
 * more as the transport settled and pointed itself at the target verse. Nothing a row draws changed
 * in the second or third pass, and every prop here is a primitive, a value out of the page `useMemo`,
 * or now a stable callback — so a comparison is cheap and skips the two passes outright. Measured on
 * the deep-link suite's heaviest case: rendering the rows is over 80% of it (about 815 ms of 1000).
 */
export const AyahBlock = memo(AyahBlockRow);
