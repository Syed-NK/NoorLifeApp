import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

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
 * **Nothing truncates.** The headline is one line by design because every approved headline
 * is short; the support lines allow two and shrink rather than clip. `adjustsFontSizeToFit`
 * is deliberately not used — it is unreliable on Android — so the type ramp is sized to fit
 * the widest approved string instead.
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
            `minHeight` in section mode, so a larger font scale lengthens the card instead of cutting
            the sentence off. At scale 1.0 it renders at exactly the height it always did.
          */
          ...(section
            ? { minHeight: dp(moduleLayout.heroHeight) }
            : { height: dp(moduleLayout.heroHeight) }),
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
            numberOfLines={section ? 2 : 1}
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

        {resolvedSupport === undefined ? null : (
          <ModuleText token="heroBody" color={module.theme.onFill} numberOfLines={section ? 4 : 2}>
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
