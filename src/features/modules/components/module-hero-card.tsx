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
  onAction,
  testID,
}: ModuleHeroCardProps) {
  const module = useModule();
  const { dp, contentWidth } = useModuleMetrics();
  const hero = module.hero;

  const resolvedEyebrow = eyebrow ?? hero.eyebrow;
  const resolvedSupport = support ?? hero.support;
  const showAction = !hideAction && hero.actionLabel !== '';

  return (
    <View
      style={[
        styles.root,
        {
          height: dp(moduleLayout.heroHeight),
          borderRadius: dp(moduleLayout.cardRadius),
          backgroundColor: module.theme.gradientStart,
        },
      ]}
      testID={testID}
    >
      <ModuleHeroArtwork
        source={module.heroArtwork}
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
            width: contentWidth * moduleLayout.heroTextColumnRatio,
            rowGap: dp(2),
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
            token="heroDisplay"
            color={module.theme.onFill}
            numberOfLines={1}
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
          <ModuleText token="heroBody" color={module.theme.onFill} numberOfLines={2}>
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
