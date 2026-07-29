import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  AppScreen,
  HeroCard,
  ModuleBottomNavigation,
  ModuleTopBar,
  Pill,
  SurfaceCard,
} from '@ds/components';
import { AppText } from '@ds/typography/app-text';
import { useAuth } from '@application/providers/auth-provider';
import { useModuleTheme } from '@application/providers/design-system-provider';

import { neutralColors, spacing, type ModuleId } from '@ds/tokens';
import type { NavItem } from '@shared/models/module-theme';

export type ModulePlaceholderScreenProps = {
  readonly moduleId: ModuleId;
  /** `key` of the active bottom-navigation item. */
  readonly activeKey: string;
  /** Sub-screen title. Omit on a module home to use the module name. */
  readonly title?: string;
  /** Hero eyebrow. Defaults to the module name. */
  readonly eyebrow?: string;
  /** Hero title. Defaults to a Phase 2 notice. */
  readonly heroTitle?: string;
  readonly testID?: string;
};

/**
 * Phase 1 placeholder for a module destination.
 *
 * It renders the *shell* — ModuleTopBar, the shared HeroCard and the five-item
 * ModuleBottomNavigation with its centre AI control — driven entirely by the
 * module's ModuleTheme. That proves the shared shell and the module theming work
 * for all nine modules without implementing any module functionality, which
 * Phase 1 explicitly excludes.
 *
 * There is deliberately no module data, no records and no module logic here.
 */
export function ModulePlaceholderScreen({
  moduleId,
  activeKey,
  title,
  eyebrow,
  heroTitle,
  testID,
}: ModulePlaceholderScreenProps) {
  const router = useRouter();
  const theme = useModuleTheme(moduleId);
  const { user } = useAuth();

  const navigate = (item: NavItem): void => {
    router.push(item.href);
  };

  return (
    <AppScreen
      testID={testID ?? `${moduleId}-placeholder`}
      header={
        <ModuleTopBar
          theme={theme}
          {...(title === undefined ? {} : { title })}
          {...(user?.avatarUri === undefined ? {} : { avatarUri: user.avatarUri })}
          onPressBack={() => router.back()}
          onPressHelp={() => router.push('/settings/help')}
          onPressAvatar={() => router.push('/profile')}
        />
      }
      bottomNavigation={
        <ModuleBottomNavigation
          theme={theme}
          activeKey={activeKey}
          onNavigate={navigate}
          testID={`${moduleId}-nav`}
        />
      }
    >
      <HeroCard
        theme={theme}
        eyebrow={eyebrow ?? theme.name}
        title={heroTitle ?? `${theme.name} arrives in Phase 2`}
        supportingLine="The shared shell, theme and navigation are wired. Module content is not built yet."
      />

      <SurfaceCard>
        <View style={styles.notice}>
          <Pill label="Phase 1 placeholder" backgroundColor={theme.soft} textColor={theme.dark} />
          <AppText variant="cardTitle">{title ?? theme.name}</AppText>
          <AppText variant="body" color={neutralColors.textSecondary}>
            This destination exists so the route contract and the {theme.aiLabel} navigation slot
            are verifiable now. It is built from shared components only — no module-specific layout
            has been hard-coded.
          </AppText>
        </View>
      </SurfaceCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  notice: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
});
