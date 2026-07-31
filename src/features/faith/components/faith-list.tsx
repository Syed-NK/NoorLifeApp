import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { fontFamilies } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

/**
 * List primitives shared by the Faith sub-screens.
 *
 * Keeping the row here rather than in each screen is what makes fourteen screens look
 * like one module: identical touch target, identical chevron, identical disclosure
 * semantics, one place to fix a spacing bug.
 */

export type FaithRowProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly meta?: string;
  readonly icon?: IconName;
  readonly iconColor?: string;
  /** Arabic shown right-aligned above the title, e.g. a surah's name. */
  readonly arabic?: string;
  readonly onPress?: () => void;
  /** Replaces the trailing chevron — a bookmark toggle, a checkbox. */
  readonly trailing?: ReactNode;
  readonly accessibilityLabel?: string;
  readonly testID: string;
};

export function FaithRow({
  title,
  subtitle,
  meta,
  icon,
  iconColor,
  arabic,
  onPress,
  trailing,
  accessibilityLabel,
  testID,
}: FaithRowProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const body = (
    <View
      style={[
        styles.row,
        { columnGap: dp(10), minHeight: dp(moduleLayout.minTouchTarget), paddingVertical: dp(6) },
      ]}
    >
      {icon === undefined ? null : (
        <AppIcon name={icon} size={dp(22)} color={iconColor ?? theme.ink} />
      )}
      <View style={styles.flex}>
        <ModuleText token="rowLabel" numberOfLines={2}>
          {title}
        </ModuleText>
        {subtitle === undefined ? null : (
          <ModuleText token="rowMeta" numberOfLines={2}>
            {subtitle}
          </ModuleText>
        )}
      </View>
      {arabic === undefined ? null : (
        <ModuleText token="arabic" numberOfLines={1} style={styles.arabic}>
          {arabic}
        </ModuleText>
      )}
      {meta === undefined ? null : (
        <ModuleText token="rowMeta" numberOfLines={1}>
          {meta}
        </ModuleText>
      )}
      {trailing ??
        (onPress === undefined ? null : (
          <AppIcon name="chevron-forward" size={dp(16)} color={moduleNeutrals.textSecondary} />
        ))}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View
        accessible
        accessibilityLabel={
          accessibilityLabel ?? `${title}${subtitle === undefined ? '' : `, ${subtitle}`}`
        }
        testID={testID}
      >
        {body}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? `${title}${subtitle === undefined ? '' : `, ${subtitle}`}`
      }
      testID={testID}
    >
      {body}
    </PressableScale>
  );
}

/** A card wrapping a set of rows, with hairlines between them. */
export function FaithRowGroup({
  title,
  action,
  children,
  testID,
}: {
  readonly title?: string;
  readonly action?: ReactNode;
  readonly children: readonly ReactNode[];
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID={testID}>
      {title === undefined ? null : (
        <View style={[styles.groupHeader, { marginBottom: dp(4) }]}>
          <ModuleText
            token="cardTitle"
            numberOfLines={1}
            accessibilityRole="header"
            style={styles.flex}
          >
            {title}
          </ModuleText>
          {action}
        </View>
      )}
      {children.map((child, index) => (
        <View key={index}>
          {index === 0 ? null : <View style={styles.divider} accessible={false} />}
          {child}
        </View>
      ))}
    </ModuleCard>
  );
}

/**
 * Arabic scripture, rendered right-to-left.
 *
 * ── The font question ───────────────────────────────────────────────────────
 * `fontFamily` is deliberately **not** set. Poppins carries no Arabic glyphs, and the
 * project's own rule in `design-system/typography/fonts.ts` is that Arabic must not fall
 * back to it. Leaving the family unset lets the platform pick a system Arabic face, which
 * renders the harakat correctly; naming Poppins here would rely on per-glyph fallback
 * that varies by OS version and vendor.
 *
 * When a licensed Uthmani face is approved it is set here, in one place.
 */
export function ArabicText({
  children,
  size = 'body',
  testID,
}: {
  readonly children: string;
  readonly size?: 'body' | 'display';
  readonly testID?: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleText
      token="arabic"
      align="right"
      accessibilityLanguage="ar"
      style={[
        styles.scripture,
        size === 'display' ? { fontSize: dp(22), lineHeight: dp(40) } : null,
      ]}
      testID={testID}
    >
      {children}
    </ModuleText>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: moduleNeutrals.divider,
    marginVertical: 6,
  },
  arabic: {
    writingDirection: 'rtl',
  },
  scripture: {
    writingDirection: 'rtl',
    // No fontFamily — see the note on ArabicText.
  },
});

/** Re-exported so screens import one module for text and rows. */
export { fontFamilies };
