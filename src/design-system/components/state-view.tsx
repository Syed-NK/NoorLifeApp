import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { RobotMascot } from '@ds/illustrations/robot-mascot';
import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';
import { PrimaryButton } from './primary-button';
import { SecondaryButton } from './secondary-button';

import { iconSize, neutralColors, radius, semanticColors, spacing } from '@ds/tokens';
import type { ModuleTheme } from '@shared/models/module-theme';
import type { AppStateKind, StateTone } from '@shared/states/app-state';
import { getStatePreset } from '@shared/states/state-presets';

export type StateViewProps = {
  readonly kind: AppStateKind;
  /**
   * Injected module theme (§15). When present, `module`-toned states use the
   * module's colours so a state opened inside a module inherits its accent (§19–28
   * preamble). Global states omit it and fall back to the neutral foundation.
   */
  readonly theme?: ModuleTheme;
  /** Overrides the preset title. */
  readonly title?: string;
  /** Overrides the preset message — use for context-specific explanations. */
  readonly message?: string;
  readonly onPrimaryAction?: () => void;
  readonly primaryActionLabel?: string;
  readonly onSecondaryAction?: () => void;
  readonly secondaryActionLabel?: string;
  /** Small error reference shown beneath the actions (§21). */
  readonly reference?: string;
  /** `inline` fits inside a section; `full` fills the screen area. */
  readonly variant?: 'inline' | 'full';
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * The single shared state component.
 *
 * §15 forbids per-module state components: every loading, empty, error, offline,
 * permission, success and AI-boundary surface in NoorLife renders this, with copy
 * from `statePresets` and colour from the injected ModuleTheme.
 *
 * Each state pairs the mascot with an icon *and* text, so no state is
 * communicated by colour alone (§8).
 */
export function StateView({
  kind,
  theme,
  title,
  message,
  onPrimaryAction,
  primaryActionLabel,
  onSecondaryAction,
  secondaryActionLabel,
  reference,
  variant = 'inline',
  style,
  testID,
}: StateViewProps) {
  const preset = getStatePreset(kind);
  const accent = resolveToneColor(preset.tone, theme);
  const mascotSize = variant === 'full' ? 132 : 96;

  const resolvedPrimaryLabel = primaryActionLabel ?? preset.primaryActionLabel;
  const resolvedSecondaryLabel = secondaryActionLabel ?? preset.secondaryActionLabel;

  return (
    <View
      style={[styles.root, variant === 'full' ? styles.full : styles.inline, style]}
      accessibilityRole="summary"
      testID={testID}
    >
      <RobotMascot size={mascotSize} outlined />

      <View style={[styles.iconBadge, { backgroundColor: withSoftTone(preset.tone, theme) }]}>
        <AppIcon name={preset.icon} size={iconSize.md} color={accent} />
      </View>

      <View style={styles.textColumn}>
        <AppText variant="sectionTitle" style={styles.centred}>
          {title ?? preset.title}
        </AppText>
        <AppText variant="body" color={neutralColors.textSecondary} style={styles.centred}>
          {message ?? preset.message}
        </AppText>
      </View>

      {onPrimaryAction === undefined || resolvedPrimaryLabel === undefined ? null : (
        <View style={styles.actions}>
          <PrimaryButton
            label={resolvedPrimaryLabel}
            onPress={onPrimaryAction}
            color={accent}
            testID={`${testID ?? 'state-view'}-primary-action`}
          />
          {onSecondaryAction === undefined || resolvedSecondaryLabel === undefined ? null : (
            <SecondaryButton
              label={resolvedSecondaryLabel}
              onPress={onSecondaryAction}
              color={accent}
              testID={`${testID ?? 'state-view'}-secondary-action`}
            />
          )}
        </View>
      )}

      {reference === undefined ? null : (
        <AppText variant="caption" color={neutralColors.textMuted} style={styles.centred}>
          {reference}
        </AppText>
      )}
    </View>
  );
}

function resolveToneColor(tone: StateTone, theme?: ModuleTheme): string {
  switch (tone) {
    case 'success':
      return semanticColors.success;
    case 'warning':
      return semanticColors.warning;
    case 'error':
      return semanticColors.error;
    case 'ai':
      return theme?.primary ?? semanticColors.primary;
    case 'module':
      return theme?.primary ?? semanticColors.primary;
    case 'neutral':
      return theme?.primary ?? semanticColors.primary;
  }
}

function withSoftTone(tone: StateTone, theme?: ModuleTheme): string {
  if (tone === 'module' || tone === 'ai' || tone === 'neutral') {
    return theme?.soft ?? neutralColors.surfaceSoft;
  }
  return neutralColors.surfaceSoft;
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: spacing.md,
  },
  inline: {
    paddingVertical: spacing.xl,
  },
  full: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    gap: spacing.xs,
    alignItems: 'center',
  },
  centred: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
});
