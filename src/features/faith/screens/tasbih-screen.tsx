import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import {
  moduleColorThemes,
  moduleLayout,
  moduleNeutrals,
  tasbihStageSurface,
} from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop, useReducedMotion, minimumTouchTargetSize } from '@shared/utils/a11y';

import { FaithScreen } from '../components/faith-screen';
import { QuranSelectionView, SelectionOriginBadge } from '../components/quran-selection-view';
import { hasTravelled, TAP_SLOP_DP } from '../components/tap-travel';
import {
  MAX_TASBIH_TARGET,
  MIN_TASBIH_TARGET,
  type TasbihSession,
} from '../data/tasbih.repository';
import { DEFAULT_COUNTER } from '../data/tasbih/local-tasbih.repository';
import {
  materialThumbnail,
  stagePlate,
  STAGE_ASPECT_RATIO,
  TASBIH_MATERIALS,
  type TasbihMaterialId,
} from '../data/tasbih/tasbih-materials';
import { faithNavKeys, faithRoutes } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import {
  counterSpokenName,
  counterSummaryLine,
  useActiveCounter,
  type ActiveCounterView,
} from '../hooks/use-active-counter';
import { useHaptics } from '../hooks/use-haptics';
import { useTasbih } from '../hooks/use-tasbih';

/**
 * Tasbih — the locked design, `tasbih-locked-c-with-compact-controls.png`.
 *
 * ── The three regions, top to bottom ────────────────────────────────────────
 * A large **counting stage** that fills the upper screen and is one tap target end to end; a compact
 * **bead material** card; and a compact **Dhikr/control** card carrying the current dhikr, the
 * active counter, and the three controls the design allows — Undo, Target, Haptics. No Reset, no
 * ±10 steps, no third card.
 *
 * ── The strand is artwork, and only artwork ─────────────────────────────────
 * `faith-tasbih-strand-layer` draws the approved close-up plate behind the count. It is opaque warm
 * ivory by design — a photograph, not a cutout — and it bleeds past the page padding so the beads
 * run off the left edge as the design shows. It holds no state, intercepts no touch and is hidden
 * from assistive technology: everything a user reads or presses is drawn over it.
 *
 * ── Why the whole stage counts ──────────────────────────────────────────────
 * Counting happens a hundred times in a row, usually one-handed and often with the eyes shut. A
 * small target turns every repetition into a precision task and every miss loses a bead. So the
 * whole stage registers a count — and only a *tap* does: `tap-travel` rejects a gesture that
 * travelled, because a swipe over a screen with nothing to scroll would otherwise arrive as a
 * completed press and invent a repetition that never happened.
 *
 * ── The content boundary, and why it moved ──────────────────────────────────
 * This screen used to render no scripture at all, in any state, and the row read "Not selected"
 * because the only thing it could name was a reviewed catalogue that is still empty. That was the
 * honest state of a screen with nothing to show.
 *
 * It now shows the **current selection**: its Arabic, its surah and ayah reference, and the
 * translator credited for the meaning. Three things had to be true first, and all three are:
 *
 *   • the text is Quran Foundation's own, resolved from the retained generation this device
 *     validated in full — not a string in the bundle and not a copy in user storage;
 *   • it is resolved **offline**, through a seam that cannot issue a request, so the counter does
 *     not spend a round trip to draw a verse;
 *   • what it is called is honest. A user's own selection is badged as theirs and never as a dhikr,
 *     a dua, or something recommended. A reviewed entry is badged as reviewed, and there are none.
 *
 * The empty state is unchanged and still real: with nothing selected the row says so and offers the
 * selector. No default dhikr is invented to fill it. See `data/quran-selection/` for the resolver
 * and `docs/QURAN_FOUNDATION_DHIKR_PERMISSION.md` for what was granted.
 */

const TARGET_STEP = 1;

const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;
const GOLD = modulePalettes.faith.supporting;
/** Faith ink read from the token: this screen renders outside the `ModuleProvider`. */
const FAITH_INK = moduleColorThemes.faith.ink;

export function TasbihScreen() {
  const { dp } = useModuleMetrics();
  const router = useRouter();
  const { session, labels, error, increment, decrement, adjustTarget } = useTasbih();
  const haptics = useHaptics();
  const { preferences, update } = useFaithPreferences();

  /*
    ── The screen no longer waits for a *label* ──────────────────────────────
    It used to resolve `labels.find(id === session.counterId)` and render "Preparing your counter…"
    until that found something. A Quran selection has no label — it is a reference, not a private
    note — so that lookup would never succeed and the counter would sit on its loading state forever
    while a perfectly good session was in storage. What the stage actually needs is a *name*, and
    every kind of counter can produce one.
  */

  /**
   * A completed round is the one moment the feedback differs.
   *
   * The strand coming round feels unmistakably different from a bead, which is what lets somebody
   * count with their eyes shut. It is detected by comparing the rounds this screen was rendering
   * against the rounds the write produced — both ordinary values, so a rapid burst of taps cannot
   * bank the same round twice.
   */
  const roundsSoFar = session?.rounds ?? 0;
  const count = useCallback(async () => {
    const next = await increment();
    if (next !== null && next.rounds > roundsSoFar) {
      haptics.completeRound();
    } else {
      haptics.count();
    }
  }, [increment, haptics, roundsSoFar]);

  const openSelector = useCallback(() => router.push(faithRoutes.dhikr), [router]);
  /*
    Resolved from the stored counter id against the user's selections, the reviewed manifest and the
    retained generation. Two storage reads and no request — opening the counter costs nothing on the
    network, which is the property that lets this render in aeroplane mode.
  */
  const active = useActiveCounter(session?.counterId ?? null, labels);
  const counterName = counterSpokenName(active.view);

  return (
    <FaithScreen
      title="Tasbih"
      activeKey={faithNavKeys.more}
      background={tasbihStageSurface}
      testID="faith-tasbih"
    >
      <View style={{ rowGap: dp(12) }}>
        {error === null ? null : (
          <ModuleStatusBanner
            tone="error"
            message="Your count could not be saved to this device. It may not survive a restart."
            testID="faith-tasbih-write-error"
          />
        )}

        {session === null ? (
          <ModuleCard testID="faith-tasbih-loading">
            <ModuleText token="body">Preparing your counter…</ModuleText>
          </ModuleCard>
        ) : (
          <>
            <CountingStage
              session={session}
              counterName={counterName}
              material={preferences.tasbihMaterialId}
              onCount={() => void count()}
            />
            <BeadMaterialCard
              selected={preferences.tasbihMaterialId}
              onSelect={(material) => void update({ tasbihMaterialId: material })}
            />
            <DhikrControlCard
              target={session.target}
              hapticsEnabled={preferences.hapticsEnabled}
              onToggleHaptics={(next) => void update({ hapticsEnabled: next })}
              active={active.view}
              onOpenSelector={openSelector}
              onUndo={() => {
                haptics.undo();
                void decrement();
              }}
              onAdjustTarget={(delta) => void adjustTarget(delta)}
            />
          </>
        )}
      </View>
    </FaithScreen>
  );
}

/**
 * The counting stage: the count, the round, the tap affordance, and the reserved strand layer.
 *
 * It is the largest region on the screen by a wide margin, which the design requires and which also
 * makes it the easiest thing on the screen to hit without looking.
 */
function CountingStage({
  session,
  counterName,
  material,
  onCount,
}: {
  readonly session: TasbihSession;
  /**
   * What is being counted, in one line.
   *
   * A name rather than a `CounterLabel`, because three different things can be counted and only one
   * of them has a label. It is spoken by the counting button, so it is the user's own words for a
   * personal counter and a reference for a selection — never the Arabic, which a screen reader
   * announcing "3 of 33" alongside would render at the wrong moment and out of context.
   */
  readonly counterName: string;
  readonly material: TasbihMaterialId;
  readonly onCount: () => void;
}) {
  const { dp, screenWidth, pagePadding } = useModuleMetrics();
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);

  /**
   * Where the finger went down, and whether it then travelled.
   *
   * A `Pressable` fires on release however far the touch moved, and with nothing to scroll nothing
   * steals the gesture — measured on device, one 400 px drag added a count. A tap is therefore a
   * touch that went down and came up in roughly the same place. Refs rather than state: read inside
   * the handler, and they must never schedule a render mid-gesture on a surface tapped this often.
   */
  const travelled = useRef(false);
  const origin = useRef({ x: 0, y: 0 });

  /*
    ── The stage is sized by the artwork, not by a height ────────────────────
    `aspectRatio` against the full screen width, so the plate's own 1:1 composition survives every
    device: the beads enter at the same place, the focal bead lands in the same place, and the gold
    terminal stays in frame. The previous pass used a fixed height, which changed the crop on every
    different screen and cropped the terminal away entirely.

    The numeral is capped against the width with shrink-to-fit as the floor, so a 1.5x text setting
    enlarges it to the space available and no further — shrink-to-fit on a display numeral is not a
    loss of accessibility; clipping it would be.
  */
  /*
    Sized so the whole count block clears the bead arc. The V4 plates carry the strand higher in the
    frame than the plate they replaced, and at the previous size "Round {n}" printed across the beads
    — measured on the green-jade plate, which has the shallowest arc.
  */
  const numeral = Math.min(dp(94), screenWidth * 0.29);

  return (
    <Pressable
      onPress={() => {
        if (travelled.current) {
          return;
        }
        onCount();
      }}
      onTouchStart={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        origin.current = { x: pageX, y: pageY };
        travelled.current = false;
      }}
      onTouchMove={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        // Latches: once a gesture has become a drag, coming back does not make it a tap again.
        travelled.current =
          travelled.current ||
          hasTravelled(origin.current, { x: pageX, y: pageY }, dp(TAP_SLOP_DP));
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${counterName}. ${session.count} of ${session.target}. ${
        session.rounds === 0
          ? 'No completed rounds yet'
          : `${session.rounds} round${session.rounds === 1 ? '' : 's'} completed`
      }.`}
      accessibilityHint="Activates to add one to the count."
      style={[
        styles.stage,
        {
          aspectRatio: STAGE_ASPECT_RATIO,
          /*
              Bled past the page's own padding so the strand runs off both screen edges, as the
              design shows — the beads are cut by the frame rather than floating inside a margin. The
              text is padded back to the safe column so only the artwork reaches the edge.
            */
          marginHorizontal: -pagePadding,
          paddingHorizontal: pagePadding,
          paddingTop: dp(4),
          paddingBottom: dp(6),
          // The only press feedback, and a fade rather than a movement: nothing on a counting
          // surface should shift under a thumb that is about to tap it again.
          opacity: pressed && !reduceMotion ? 0.9 : 1,
        },
      ]}
      testID="faith-tasbih-count"
    >
      {/*
        The approved stage plate for the selected material. Absolute so it contributes no height,
        `pointerEvents="none"` so it can never take a tap meant for the count, and hidden from
        assistive technology because it carries no information a screen reader could use — the
        counting button announces the count, target and rounds.
      */}
      <View
        style={styles.strandLayer}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        testID="faith-tasbih-strand-layer"
      >
        {/*
          Wrapped rather than styled directly: `Image` takes no `pointerEvents`, and "the artwork
          never intercepts a tap" is a guarantee worth expressing in the tree rather than relying on
          an image happening to be non-interactive.
        */}
        <Image
          source={stagePlate(material)}
          style={styles.strandImage}
          resizeMode="contain"
          fadeDuration={0}
          testID="faith-tasbih-strand-image"
        />
      </View>

      <ModuleText
        token="heroScore"
        color={moduleNeutrals.textPrimary}
        align="center"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        accessibilityLiveRegion="polite"
        style={{
          alignSelf: 'center',
          maxWidth: '64%',
          fontSize: numeral,
          lineHeight: numeral * 1.1,
        }}
        testID="faith-tasbih-count-value"
      >
        {String(session.count)}
      </ModuleText>

      <ModuleText
        token="cardTitle"
        color={moduleNeutrals.textSecondary}
        align="center"
        numberOfLines={1}
        testID="faith-tasbih-of-target"
      >
        {`of ${session.target}`}
      </ModuleText>

      {/* The gold hairline and its centre diamond, as the design draws them. */}
      <View style={[styles.flourish, { marginVertical: dp(3), columnGap: dp(6) }]}>
        <View style={[styles.hairline, { width: dp(60) }]} />
        <View style={[styles.diamond, { width: dp(5), height: dp(5) }]} />
        <View style={[styles.hairline, { width: dp(60) }]} />
      </View>

      <ModuleText
        token="cardTitle"
        color={FAITH_INK}
        align="center"
        numberOfLines={1}
        testID="faith-tasbih-rounds"
      >
        {session.rounds === 0 ? 'Round 1' : `Round ${session.rounds + 1}`}
      </ModuleText>

      <View style={styles.flex} />

      <View style={[styles.tapHint, { rowGap: dp(4) }]}>
        <AppIcon name="tap" size={dp(26)} color={EMERALD_DEEP} />
        <ModuleText
          token="body"
          color={moduleNeutrals.textPrimary}
          align="center"
          numberOfLines={2}
        >
          Tap anywhere to count
        </ModuleText>
      </View>
    </Pressable>
  );
}

/**
 * The bead-material card: six approved thumbnails, all of them working.
 *
 * ── Why there is no trailing chevron ────────────────────────────────────────
 * The approved mock draws one at the end of this row, and it was built — as a `pointerEvents="none"`
 * glyph with no handler behind it, because there are exactly six materials and all six are already
 * on screen. There is nothing for it to open. It also collided with the sixth swatch: the group
 * centred across the full card width, which is precisely the width the chevron was sitting in.
 *
 * A control that cannot be pressed and leads nowhere is worse than an absent one, so it is gone
 * rather than reserved. If a material *library* is ever specified, this is where its affordance
 * belongs — with a destination attached.
 *
 * ── How the row is centred ──────────────────────────────────────────────────
 * Six circles and five equal gaps, centred in the card's own content box. The circle diameter is
 * derived from the space available so the row never has to wrap or clip at 320 dp, and `hitSlop`
 * makes up whatever the circle gives away — the press target stays at or above 44 dp even when the
 * drawn bead is smaller.
 */
function BeadMaterialCard({
  selected,
  onSelect,
}: {
  readonly selected: TasbihMaterialId;
  readonly onSelect: (material: TasbihMaterialId) => void;
}) {
  const { dp, contentWidth } = useModuleMetrics();

  const gap = dp(8);
  const inner = contentWidth - dp(moduleLayout.cardPadding) * 2;
  /*
    Derived, not fixed. At 320 dp a 46 dp circle six times over plus its gaps overflows the card,
    and the row would either wrap or push its last member under the card's edge.
  */
  const swatch = Math.max(dp(30), Math.min(dp(46), (inner - gap * 5) / 6));

  return (
    <ModuleCard testID="faith-tasbih-materials">
      <View style={{ rowGap: dp(8) }}>
        <ModuleText token="cardTitle" numberOfLines={1}>
          Bead material
        </ModuleText>

        <View style={[styles.swatches, { columnGap: gap }]} testID="faith-tasbih-material-row">
          {TASBIH_MATERIALS.map((material) => {
            const active = material.id === selected;

            /*
              A plain `Pressable`, not `PressableScale`. That wrapper lays an absolutely-positioned
              overlay inside the styled view, and inside a rounded, clipped circle the overlay never
              received the touch on device — the swatch looked interactive and was inert. Found by
              tapping the measured centre and watching nothing happen.
            */
            return (
              <Pressable
                key={material.id}
                onPress={() => onSelect(material.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={material.label}
                hitSlop={minimumHitSlop(swatch)}
                style={[
                  styles.swatch,
                  {
                    width: swatch,
                    height: swatch,
                    borderRadius: swatch / 2,
                    /*
                      The border is drawn inside the box in React Native, so the selected ring
                      changes no width and shifts nothing along the row.
                    */
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? EMERALD_DEEP : moduleNeutrals.divider,
                  },
                ]}
                testID={`faith-tasbih-material-${material.id}`}
              >
                <Image
                  source={materialThumbnail(material.id)}
                  style={{ width: swatch, height: swatch }}
                  resizeMode="cover"
                  fadeDuration={0}
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                />
              </Pressable>
            );
          })}
        </View>
      </View>
    </ModuleCard>
  );
}

/**
 * What kind of thing the active counter is, in one word the design has room for.
 *
 * The distinction between "Selection" and "Reviewed" is the only one on this screen that carries a
 * claim, and it is why the two are never collapsed into one word: a verse somebody chose for
 * themselves and a verse a named scholar approved look identical on a counter otherwise.
 */
function counterKindLabel(active: ActiveCounterView): string {
  switch (active.kind) {
    case 'selection':
      return 'Selection';
    case 'reviewed':
      return 'Reviewed';
    case 'personal':
      return active.label.id === DEFAULT_COUNTER.id ? 'Default' : 'Personal';
    case 'none':
      return 'None';
  }
}

/**
 * The compact control card: the current selection, the active counter, and the three allowed
 * controls.
 *
 * ── What changed inside the locked composition, and what did not ───────────
 * The card is the same card: same order, same divider, same three controls, same `Change` affordance
 * in the same place. What the first region *contains* has changed — it used to be a label and the
 * word "Not selected", because there was nothing to put there, and it now carries the selection's
 * Arabic, its reference and the translator credited for its meaning.
 *
 * The scripture block is clamped to two lines per verse. A selection can be ten verses long, and a
 * counting screen that scrolls is a counting screen where the tap target moves under a thumb that is
 * not looking — so the card shows the opening of the passage and the selector shows it whole.
 */
function DhikrControlCard({
  active,
  target,
  hapticsEnabled,
  onToggleHaptics,
  onOpenSelector,
  onUndo,
  onAdjustTarget,
}: {
  /**
   * What is being counted, already resolved.
   *
   * Carries the reference, the retained scripture and the credit together, so this card cannot draw
   * a translation without its translator — see `QuranSelectionView`, which is where both are
   * rendered and where they are deliberately inseparable.
   */
  readonly active: ActiveCounterView;
  readonly target: number;
  readonly hapticsEnabled: boolean;
  readonly onToggleHaptics: (next: boolean) => void;
  readonly onOpenSelector: () => void;
  readonly onUndo: () => void;
  readonly onAdjustTarget: (delta: number) => void;
}) {
  const { dp } = useModuleMetrics();
  const summary = counterSummaryLine(active);

  return (
    <ModuleCard testID="faith-tasbih-current">
      <View style={{ rowGap: dp(10) }}>
        <View style={[styles.row, { columnGap: dp(10) }]}>
          <Emblem icon="octagram" filled />
          {/*
            ── The label and the value share one shrinkable box ───────────────
            Measured at 320 dp with a 1.5x text size, the flat arrangement pushed `Change` clean off
            the right edge of the card: the label took its full intrinsic width, the spacer flexed,
            and the button was the last thing in line. Confining the two texts to a bounded box lets
            them truncate instead, and the button never moves.
          */}
          <View style={[styles.row, styles.flex, { columnGap: dp(8) }]}>
            <ModuleText
              token="body"
              color={moduleNeutrals.textPrimary}
              numberOfLines={1}
              style={styles.shrink}
            >
              Current
            </ModuleText>
            <View style={styles.flex} />
            {/*
              A reference, the user's own note, or a reviewer-supplied title — never the Arabic. A
              verse truncated to fit a caption slot is a verse rendered wrongly, and the scripture
              has its own block below where it is given the room the script needs.

              "Not selected" is a real state and stays one: no default dhikr is invented to fill it.
            */}
            <ModuleText
              token="body"
              color={moduleNeutrals.textSecondary}
              numberOfLines={1}
              style={styles.shrink}
              testID="faith-tasbih-dhikr-value"
            >
              {summary ?? 'Not selected'}
            </ModuleText>
          </View>
          <PressableScale
            onPress={onOpenSelector}
            accessibilityRole="button"
            accessibilityLabel={summary === null ? 'Choose what to count' : 'Change what you count'}
            hitSlop={minimumHitSlop(minimumTouchTargetSize())}
            style={[
              styles.outlined,
              {
                flexShrink: 0,
                borderRadius: dp(moduleLayout.radiusSmall),
                minHeight: minimumTouchTargetSize(),
                paddingHorizontal: dp(10),
                columnGap: dp(5),
              },
            ]}
            testID="faith-tasbih-change"
          >
            <AppIcon name="edit" size={dp(15)} color={FAITH_INK} />
            <ModuleText token="caption" color={FAITH_INK} numberOfLines={1}>
              {summary === null ? 'Choose' : 'Change'}
            </ModuleText>
          </PressableScale>
        </View>

        {/*
          The scripture, when there is any. Absent for a personal counter and for nothing selected —
          those two have no verse behind them, and drawing an empty block for them would suggest one
          failed to load.
        */}
        {active.kind === 'selection' || active.kind === 'reviewed' ? (
          <View style={{ rowGap: dp(6) }} testID="faith-tasbih-selection">
            <SelectionOriginBadge
              origin={active.kind === 'selection' ? 'personal' : 'reviewed'}
              testID="faith-tasbih-selection-origin"
            />
            <QuranSelectionView
              resolution={active.resolution}
              reference={active.reference}
              arabicLines={2}
              translationLines={2}
              testID="faith-tasbih-selection-body"
            />
          </View>
        ) : null}

        <View style={styles.divider} />

        <PressableScale
          onPress={onOpenSelector}
          accessibilityRole="button"
          accessibilityLabel={`${counterSpokenName(active)}. ${counterKindLabel(active)}.`}
          style={[styles.row, { columnGap: dp(10), minHeight: minimumTouchTargetSize() }]}
          testID="faith-tasbih-counter-row"
        >
          <Emblem icon="profile" />
          <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={1}>
            My counter
          </ModuleText>
          <View style={styles.flex} />
          {/*
            The *kind*, not the name. The design shows `Personal` here, and the neutral counter every
            install starts with is itself called "My counter" — echoing it into the value slot would
            print the row's own label twice. The name is carried in the row's spoken label and is the
            heading of the selector this row opens.

            The kind now also distinguishes a Quran selection from a private label, which is the one
            distinction on this screen that carries a claim: a private note must never read as
            something NoorLife stands behind.
          */}
          <ModuleText
            token="body"
            color={FAITH_INK}
            numberOfLines={1}
            style={{ maxWidth: '46%' }}
            testID="faith-tasbih-counter-kind"
          >
            {counterKindLabel(active)}
          </ModuleText>
          <AppIcon name="chevron-forward" size={dp(20)} color={FAITH_INK} />
        </PressableScale>

        <View style={[styles.controls, { columnGap: dp(8) }]}>
          <PressableScale
            onPress={onUndo}
            accessibilityRole="button"
            accessibilityLabel="Undo"
            hitSlop={minimumHitSlop(minimumTouchTargetSize())}
            style={[
              styles.group,
              styles.flex,
              {
                minHeight: dp(56),
                borderRadius: dp(moduleLayout.radiusSmall),
                columnGap: dp(6),
              },
            ]}
            testID="faith-tasbih-undo"
          >
            <AppIcon name="undo" size={dp(20)} color={moduleNeutrals.textPrimary} />
            <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={1}>
              Undo
            </ModuleText>
          </PressableScale>

          <View
            style={[
              styles.group,
              styles.flex,
              { minHeight: dp(56), borderRadius: dp(moduleLayout.radiusSmall), columnGap: dp(6) },
            ]}
            testID="faith-tasbih-target"
          >
            <Step
              glyph="minus"
              label="Decrease the target by one"
              disabled={target <= MIN_TASBIH_TARGET}
              onPress={() => onAdjustTarget(-TARGET_STEP)}
              testID="faith-tasbih-target-down"
            />
            <View style={styles.centre}>
              <ModuleText token="caption" numberOfLines={1}>
                Target
              </ModuleText>
              <ModuleText
                token="cardTitle"
                numberOfLines={1}
                accessibilityLiveRegion="polite"
                testID="faith-tasbih-target-value"
              >
                {String(target)}
              </ModuleText>
            </View>
            <Step
              glyph="add"
              label="Increase the target by one"
              disabled={target >= MAX_TASBIH_TARGET}
              onPress={() => onAdjustTarget(TARGET_STEP)}
              testID="faith-tasbih-target-up"
            />
          </View>

          <View
            style={[
              styles.group,
              styles.flex,
              {
                minHeight: dp(56),
                borderRadius: dp(moduleLayout.radiusSmall),
                columnGap: dp(6),
                paddingHorizontal: dp(8),
              },
            ]}
          >
            <AppIcon name="tap" size={dp(18)} color={moduleNeutrals.textPrimary} />
            <View style={styles.centre}>
              <ModuleText token="caption" numberOfLines={1}>
                Haptics
              </ModuleText>
              <Switch
                value={hapticsEnabled}
                onValueChange={onToggleHaptics}
                accessibilityLabel="Vibrate on each count"
                trackColor={{ true: EMERALD_DEEP, false: moduleNeutrals.border }}
                testID="faith-tasbih-haptics-switch"
              />
            </View>
          </View>
        </View>
      </View>
    </ModuleCard>
  );
}

/** The circular emblem each row of the control card opens with. */
function Emblem({
  icon,
  filled = false,
}: {
  readonly icon: 'octagram' | 'profile';
  readonly filled?: boolean;
}) {
  const { dp } = useModuleMetrics();
  const size = dp(34);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? EMERALD_DEEP : 'transparent',
        borderWidth: filled ? 0 : 1.5,
        borderColor: EMERALD,
      }}
    >
      <AppIcon name={icon} size={dp(18)} color={filled ? moduleNeutrals.surface : EMERALD_DEEP} />
    </View>
  );
}

function Step({
  glyph,
  label,
  disabled,
  onPress,
  testID,
}: {
  readonly glyph: 'add' | 'minus';
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const size = dp(32);

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={minimumHitSlop(size)}
      style={[
        styles.step,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: disabled ? moduleNeutrals.border : moduleNeutrals.divider,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      testID={testID}
    >
      <AppIcon
        name={glyph}
        size={dp(16)}
        color={disabled ? moduleNeutrals.textTertiary : moduleNeutrals.textPrimary}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  centre: {
    alignItems: 'center',
  },
  /* Text that yields before a control does. */
  shrink: {
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stage: {
    alignItems: 'stretch',
    // The count sits high and the tap hint falls to the foot of the stage, leaving the sweep of the
    // strand between them — the arrangement the approved design draws.
    justifyContent: 'flex-start',
  },
  /* Absolute: the decorative layer must contribute no height and take no touches. */
  strandLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  strandImage: {
    width: '100%',
    height: '100%',
  },
  flourish: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairline: {
    height: 1,
    backgroundColor: `${GOLD}AA`,
  },
  diamond: {
    backgroundColor: GOLD,
    transform: [{ rotate: '45deg' }],
  },
  tapHint: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    width: '74%',
  },
  outlined: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
    backgroundColor: moduleNeutrals.surface,
  },
  divider: {
    height: 1,
    backgroundColor: moduleNeutrals.divider,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: moduleNeutrals.divider,
    backgroundColor: moduleNeutrals.surface,
  },
  step: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: moduleNeutrals.surface,
  },
  swatches: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  /* `overflow: hidden` is what makes a square thumbnail render as a bead. */
  swatch: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: moduleNeutrals.surface,
  },
});
