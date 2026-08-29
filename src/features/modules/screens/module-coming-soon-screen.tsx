import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ModuleScaffold } from '../components/module-scaffold';
import { ModuleCard } from '../components/module-card';
import { ModuleText } from '../components/module-text';
import { AppIcon, PressableScale } from '@ds/components';
import { getModuleDefinition } from '../module-registry';
import { moduleNeutrals, type FrameworkModuleId } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

export type ModuleComingSoonScreenProps = {
  readonly moduleId: FrameworkModuleId;
  /** The control the user tapped, e.g. "Tasbih". */
  readonly feature: string;
};

/**
 * The destination for a control whose screen is not built yet.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The approved references show more controls than there are screens. The options were an
 * inert tap, a disabled-looking control, or an honest destination. An inert tap reads as a
 * bug; disabling half of Faith would misrepresent the approved design. So every control
 * leads somewhere, and where the feature does not exist yet this screen says so by name,
 * in the module's own colour, with a way back.
 *
 * It names the specific feature rather than apologising generically, because "Tasbih is
 * coming" is information and "Coming soon" is not.
 */
export function ModuleComingSoonScreen({ moduleId, feature }: ModuleComingSoonScreenProps) {
  const definition = getModuleDefinition(moduleId);

  return (
    <ModuleScaffold
      moduleId={moduleId}
      // The home slot stays highlighted: this is a detour from the module home, not one of
      // the five destinations.
      activeKey={definition.navigation[0].key}
      title={feature}
      scrollable={false}
      testID="module-coming-soon"
    >
      <ComingSoonBody feature={feature} moduleName={definition.name} />
    </ModuleScaffold>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function ComingSoonBody({
  feature,
  moduleName,
}: {
  readonly feature: string;
  readonly moduleName: string;
}) {
  const router = useRouter();
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard tinted accentBorder padding={18} testID="module-coming-soon-card">
      <View style={{ rowGap: dp(8), alignItems: 'center' }}>
        <AppIcon name="sparkle" size={dp(30)} color={moduleNeutrals.textSecondary} />
        <ModuleText token="stateTitle" align="center" numberOfLines={2}>
          {feature} is on the way
        </ModuleText>
        <ModuleText token="stateBody" align="center" numberOfLines={3}>
          It arrives with the {moduleName} module’s full release. Everything else in {moduleName}{' '}
          works now.
        </ModuleText>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${moduleName}`}
          style={{
            minHeight: minimumTouchTargetSize(),
            paddingHorizontal: dp(18),
            justifyContent: 'center',
          }}
          testID="module-coming-soon-back"
        >
          <ModuleText token="button" color={moduleNeutrals.info}>
            Back to {moduleName}
          </ModuleText>
        </PressableScale>
      </View>
    </ModuleCard>
  );
}
