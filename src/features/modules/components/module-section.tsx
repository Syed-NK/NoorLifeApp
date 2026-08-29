import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';

import { useModuleTheme } from '../module-context';
import { useOptionalModuleSurfaces } from '../module-surfaces';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleSectionProps = {
  readonly title: string;
  /** Optional supporting line under the heading. */
  readonly subtitle?: string;
  /** Trailing action label, e.g. "See all". Renders only with `onAction`. */
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  /**
   * Fills the section with the module's light surface.
   *
   * Use sparingly — one tinted section per screen at most. Tinting everything
   * removes the contrast that makes the tint mean anything.
   */
  readonly tinted?: boolean;
  readonly children: ReactNode;
  readonly testID?: string;
};

/**
 * A titled group of content on a module screen.
 *
 * Every module screen is a stack of these, which is what makes the seven modules
 * structurally identical while their content differs. The heading is a real
 * `accessibilityRole="header"`, so a screen-reader user can jump between sections
 * rather than reading the screen top to bottom.
 *
 * The trailing action is a text button, not a bare chevron: "See all" states what it
 * does, and its 44 dp target comes from hit-slop rather than from padding that would
 * push the heading row taller than the design allows.
 */
export function ModuleSection({
  title,
  subtitle,
  actionLabel,
  onAction,
  tinted = false,
  children,
  testID,
}: ModuleSectionProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const showAction = actionLabel !== undefined && onAction !== undefined;

  return (
    <View
      style={[
        tinted
          ? {
              backgroundColor: theme.wellSurface,
              borderRadius: dp(moduleLayout.cardRadius),
              padding: dp(moduleLayout.cardPadding),
              borderWidth: 1,
              borderColor: theme.wellSurface,
            }
          : null,
      ]}
      testID={testID}
    >
      <View style={[styles.headingRow, { marginBottom: dp(moduleLayout.headingGap) }]}>
        <View style={styles.headingText}>
          <ModuleText token="sectionTitle" accessibilityRole="header" numberOfLines={2}>
            {title}
          </ModuleText>
          {subtitle === undefined ? null : (
            <ModuleText token="caption" numberOfLines={2} style={{ marginTop: dp(2) }}>
              {subtitle}
            </ModuleText>
          )}
        </View>

        {showAction ? (
          <PressableScale
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel}, ${title}`}
            hitSlop={minimumHitSlop(dp(24))}
            style={[
              styles.action,
              {
                minWidth: minimumTouchTargetSize(),
                minHeight: minimumTouchTargetSize(),
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
            testID={`${testID ?? 'module-section'}-action`}
          >
            <ModuleText token="sectionAction" color={theme.ink} numberOfLines={1}>
              {actionLabel}
            </ModuleText>
            <AppIcon name="chevron-forward" size={dp(14)} color={theme.ink} />
          </PressableScale>
        ) : null}
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headingText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 2,
  },
});

/** Hairline used between rows inside a card. Exported so cards stay visually consistent. */
export function ModuleDivider() {
  const surfaces = useOptionalModuleSurfaces();
  return (
    <View style={[dividerStyles.line, { backgroundColor: surfaces.divider }]} accessible={false} />
  );
}

const dividerStyles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    /* Overridden per module — issue #91. */
  },
});
