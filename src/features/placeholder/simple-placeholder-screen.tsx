import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppScreen, ModuleTopBar, Pill, SurfaceCard } from '@ds/components';
import { AppText } from '@ds/typography/app-text';
import { useModuleTheme } from '@application/providers/design-system-provider';

import { neutralColors, spacing } from '@ds/tokens';

export type SimplePlaceholderScreenProps = {
  readonly title: string;
  /** One line explaining what this destination will hold. */
  readonly description: string;
  /** The specification section this route comes from, e.g. "Workflow §4". */
  readonly specReference: string;
  readonly testID?: string;
};

/**
 * Phase 1 placeholder for a non-module destination — auth, onboarding, profile,
 * settings and subscription routes.
 *
 * Uses the neutral `main` theme and shared components only. Each placeholder
 * states which specification section owns the route, so the route map stays
 * traceable while the screens are unbuilt.
 *
 * Phase 1 forbids building authentication flows beyond route placeholders, so
 * these screens contain no form, no validation and no credential handling.
 */
export function SimplePlaceholderScreen({
  title,
  description,
  specReference,
  testID,
}: SimplePlaceholderScreenProps) {
  const router = useRouter();
  const theme = useModuleTheme('main');

  return (
    <AppScreen
      testID={testID}
      header={
        <ModuleTopBar
          theme={theme}
          title={title}
          onPressBack={() => router.back()}
          onPressHelp={() => router.push('/settings/help')}
        />
      }
    >
      <SurfaceCard>
        <View style={styles.body}>
          <Pill label="Phase 1 placeholder" backgroundColor={theme.soft} textColor={theme.dark} />
          <AppText variant="sectionTitle">{title}</AppText>
          <AppText variant="body" color={neutralColors.textSecondary}>
            {description}
          </AppText>
          <AppText variant="caption" color={neutralColors.textMuted}>
            {specReference}
          </AppText>
        </View>
      </SurfaceCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
});
