import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { minimumHitSlop } from '@shared/utils/a11y';

import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleProgressBar } from './module-chart';
import { ModuleHeroArtwork } from './module-hero-artwork';
import { ModuleText } from './module-text';

export type ModuleHeroCardProps = {
  /** Overrides the registry copy — used on sub-screens. */
  readonly eyebrow?: string;
  readonly headline?: string;
  readonly support?: string;
  /** Suppresses the call to action on screens that should not repeat it. */
  readonly hideAction?: boolean;
  /**
   * Which presentation this card is in. `'hero'` — the default — is the module home’s card,
   * unchanged in every respect.
   *
   * ── Why `'section'` exists (issue #37) ─────────────────────────────────
   * A module home hero holds an approved short phrase beside its artwork, and the copy column is
   * sized for exactly that: 52% of the content width, one line of display type. A placeholder
   * section screen has a different job — it has to *explain* that a destination is not built — and
   * that explanation does not fit in half a card at display size. Measured on a physical device, the
   * honest copy clipped to “Controls pl…” and “…before each mo…” **at font scale 1.0**, and on Noor AI
   * it also ran across the robot, because this card puts copy on the left and that module’s artwork
   * is on the left.
   *
   * So the section presentation drops the decorative artwork, gives the copy the whole card, sets the
   * headline at heading rather than display size, and lets the card grow if the type does. Palette,
   * radius, padding and starting height are the same card.
   */
  readonly layout?: 'hero' | 'section';
  readonly onAction?: () => void;
  readonly testID?: string;
};

/**
 * The shared hero: locked artwork behind, approved concise copy in front.
 *
 * Used by every module except Faith, whose reference centres its copy, and Noor AI, whose
 * reference puts copy on the right beside the robot. Both have their own hero for that
 * reason; everything else — Health, Planner, Finance, Learning, Family, Goals — is this one
 * component reading different data.
 *
 * ── The three corrections this component carries ────────────────────────────
 * **Copy is short and approved.** The eyebrow / headline / support fields hold the
 * reference's own wording. The framework used to invent sentences here, and they were long
 * enough to run across the artwork and ellipsise.
 *
 * **Nothing truncates.** Not by keeping the copy to one line — that claim was wrong, and issue #50
 * measured it wrong on a device: the headline was `numberOfLines={1}` "by design because every
 * approved headline is short", and five of the eight approved headlines are not short enough for a
 * 52% column at display size. Planner rendered `Make toda…` and Finance `Know wher…` at font scale
 * **1.0**, on an ordinary phone.
 *
 * So the copy is allowed to wrap and the card is allowed to grow, which is the same trade the
 * section presentation and Faith's own hero already made. `adjustsFontSizeToFit` is still not used —
 * it is unreliable on Android, and shrinking type below an approved token trades a visible defect for
 * a subtler one.
 *
 * **Explicit vertical padding.** The copy group is centred in the card with real padding at
 * both ends, so the button can never sit against the bottom edge, on any device.
 */
export function ModuleHeroCard({
  eyebrow,
  headline,
  support,
  hideAction = false,
  layout = 'hero',
  onAction,
  testID,
}: ModuleHeroCardProps) {
  const module = useModule();
  const { dp, contentWidth } = useModuleMetrics();
  const hero = module.hero;

  const resolvedEyebrow = eyebrow ?? hero.eyebrow;
  const resolvedSupport = support ?? hero.support;
  const section = layout === 'section';
  const showAction = !hideAction && hero.actionLabel !== '';

  return (
    <View
      style={[
        styles.root,
        {
          /*
            ── `minHeight` in **both** presentations ────────────────────────────
            Section mode already grew rather than cutting a sentence off. The hero was a fixed
            `height`, which is what turned "the headline needs a second line" into "the headline gets
            an ellipsis" — a fixed box cannot honour wrapping, so allowing more lines without this
            would change nothing.

            It is a floor, not a new height: with copy that fits, the card measures exactly what it
            always did, which is why the section tests and the geometry expectations still hold.
          */
          minHeight: dp(moduleLayout.heroHeight),
          borderRadius: dp(moduleLayout.cardRadius),
          backgroundColor: module.theme.gradientStart,
        },
      ]}
      testID={testID}
    >
      {/*
        No source in section mode, so `ModuleHeroArtwork` renders nothing — the same optional-source
        path Health uses. Omitted rather than repositioned: the copy needs the whole width, and artwork
        left underneath it would be the overlap this fix exists to remove.
      */}
      <ModuleHeroArtwork
        source={section ? undefined : module.heroArtwork}
        scrim={module.heroScrim}
        copySide={module.heroCopySide}
        testID={`${testID ?? 'module-hero'}-artwork`}
      />

      <View
        style={[
          styles.copy,
          {
            paddingHorizontal: dp(moduleLayout.heroPadding),
            paddingVertical: dp(moduleLayout.heroCopyPaddingV),
            ...(section
              ? { alignSelf: 'stretch' as const }
              : { width: contentWidth * moduleLayout.heroTextColumnRatio }),
            rowGap: dp(section ? 3 : 2),
          },
        ]}
      >
        {resolvedEyebrow === '' ? null : (
          <ModuleText token="eyebrow" color={module.theme.onFill} numberOfLines={1}>
            {resolvedEyebrow}
          </ModuleText>
        )}

        <View style={[styles.headlineRow, { columnGap: dp(5) }]}>
          <ModuleText
            token={section ? 'cardHeading' : 'heroDisplay'}
            color={module.theme.onFill}
            /*
              ── Three, and why not two ──────────────────────────────────────
              Two is enough for every approved headline at font scale 1.0 — measured, in
              `module-hero-copy-fit.test.ts`, against the real tokens and the real rounding. It is not
              enough at the accessibility end: at a 320 dp width and OS scale 1.5, the widest headline
              ("Name one thing to change") wraps to three lines even with the headline's own 1.1
              multiplier cap holding the type down.

              A third line costs nothing when the copy only needs two, because the card is now
              `minHeight`-driven and sizes to its content. The alternative — widening the copy column
              at large scales — would move text over the busy part of the locked artwork and need the
              scrim to follow it, which is a change to artwork appearance to solve a text problem.

              ── What three lines still cannot fix ────────────────────────────
              Measured on a 384 dp phone: "manageable" is about 160 dp wide on its own at this token
              and the column is 155 dp, so Android breaks that one word between letters rather than
              ellipsising it. The full string renders, which is what this issue asked for, but the
              break is ugly.

              Hyphenation was tried and is worse, not better: 'full' made Android lay the word out on
              a line of its own and ellipsise it again ("Make / today / managea…"). Everything else
              that would fix it changes something this issue may not — the approved copy, the approved
              column ratio, or the type token — so it is reported rather than decided here.
            */
            numberOfLines={section ? 2 : 3}
            maxFontSizeMultiplier={1.1}
          >
            {headline ?? hero.headline}
          </ModuleText>
          {hero.headlineSuffix === undefined ? null : (
            <ModuleText
              token="heroBody"
              color={module.theme.onFill}
              numberOfLines={1}
              style={styles.suffix}
            >
              {hero.headlineSuffix}
            </ModuleText>
          )}
        </View>

        {/*
          ── Four, in both presentations ──────────────────────────────────────
          The support line carries no multiplier cap — unlike the headline — so it scales with the OS
          setting without limit. Measured against the real tokens, "Nothing enters your plan until you
          add it." needs **four** lines at 320 dp and scale 1.5, where two are enough at 1.0.

          So the home limit and the section limit converge here, and that is not a loss of distinction:
          the two presentations still differ in type token, in artwork, and in how many lines the
          headline may take. A sentence needs the same room whichever card it is in.
        */}
        {resolvedSupport === undefined ? null : (
          <ModuleText token="heroBody" color={module.theme.onFill} numberOfLines={4}>
            {resolvedSupport}
          </ModuleText>
        )}
        {hero.supportSecondary === undefined ? null : (
          <ModuleText token="heroBody" color={module.theme.onFill} numberOfLines={2}>
            {hero.supportSecondary}
          </ModuleText>
        )}

        {hero.progress === undefined ? null : (
          <View style={{ marginTop: dp(4), alignSelf: 'stretch' }}>
            {/* Reads the same value as the "62% spent" line above, so the two cannot disagree. */}
            <ModuleProgressBar
              value={hero.progress}
              onFillSurface
              accessibilityLabel={`${resolvedSupport ?? 'Budget'} of your budget`}
              testID={`${testID ?? 'module-hero'}-progress`}
            />
          </View>
        )}

        {showAction ? (
          <PressableScale
            onPress={onAction ?? (() => undefined)}
            accessibilityRole="button"
            accessibilityLabel={hero.actionLabel}
            /*
              ── The pill stays 34 dp; the target reaches 44 ──────────────────
              `heroButtonHeight` is 34, and `dp()` scales it *down* on a narrow phone — so the touch
              target was 34 dp at best and 28 at 320 dp, against a 44 dp minimum. The visual geometry
              is approved and unchanged; the slop is what makes the control reachable, which is the
              same correction the prayer sheet's day circles carry.

              Computed from the scaled height rather than the token, because the deficit is larger on
              exactly the devices where the pill is smallest.
            */
            hitSlop={minimumHitSlop(dp(moduleLayout.heroButtonHeight))}
            style={[
              styles.button,
              {
                marginTop: dp(6),
                minHeight: dp(moduleLayout.heroButtonHeight),
                borderRadius: dp(moduleLayout.radiusSmall),
                paddingHorizontal: dp(11),
                columnGap: dp(5),
              },
            ]}
            testID={`${testID ?? 'module-hero'}-action`}
          >
            <ModuleText token="cardAction" color={module.theme.ink} numberOfLines={1}>
              {hero.actionLabel}
            </ModuleText>
            <AppIcon name="chevron-forward" size={dp(13)} color={module.theme.ink} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // The card owns the radius and does the clipping; the artwork carries neither.
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  suffix: {
    opacity: 0.92,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: moduleNeutrals.surface,
  },
});
