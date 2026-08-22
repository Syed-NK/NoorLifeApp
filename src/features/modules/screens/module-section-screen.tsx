import { useRouter } from 'expo-router';
import { View } from 'react-native';

import {
  ModuleEmptyState,
  ModuleFeatureGrid,
  ModuleHeroCard,
  ModuleScaffold,
  ModuleSection,
  ModuleStatusBanner,
} from '../components';
import { getModuleDefinition } from '../module-registry';
import { moduleLayout, type FrameworkModuleId } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

export type ModuleSectionScreenProps = {
  readonly moduleId: FrameworkModuleId;
  /** `key` of the active bottom-navigation item. */
  readonly activeKey: string;
  /** The screen's own title, e.g. "Prayer Times". */
  readonly title: string;
  /** Replaces the hero headline, so the screen is not a copy of the module home. */
  readonly heroTitle: string;
  readonly heroBody: string;
  readonly testID?: string;
};

/**
 * A module sub-screen, before its own content exists.
 *
 * ── Why this is not a placeholder ───────────────────────────────────────────
 * It is the real framework: real header, real hero, real navigation, real theming —
 * everything the module's own screens will be built on. What it does not do is invent
 * content. The banner says plainly that this destination arrives with the module's full
 * release, and the empty state offers the module AI, which is a real destination.
 *
 * That distinction matters for validation. A screen that fabricated a prayer table
 * would prove nothing about the framework and would have to be deleted later; this
 * proves the shell holds together on all five destinations of all seven modules, and
 * the module team replaces only the body.
 */
export function ModuleSectionScreen({
  moduleId,
  activeKey,
  title,
  heroTitle,
  heroBody,
  testID,
}: ModuleSectionScreenProps) {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const definition = getModuleDefinition(moduleId);

  return (
    <ModuleScaffold
      moduleId={moduleId}
      activeKey={activeKey}
      title={title}
      banner={
        <ModuleStatusBanner
          tone="info"
          message={`${title} arrives with the ${definition.name} module’s full release. The screen below is the shared framework.`}
          testID={`${moduleId}-${activeKey}-banner`}
        />
      }
      testID={testID ?? `${moduleId}-${activeKey}`}
    >
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <ModuleHeroCard
          /*
            The placeholder presentation: no decorative artwork, copy across the whole card, room to
            wrap. See `module-hero-card.tsx` for what it measured at on a device.
          */
          layout="section"
          eyebrow={title}
          headline={heroTitle}
          support={heroBody}
          // A sub-screen must not repeat the module home's call to action.
          hideAction
          testID={`${moduleId}-${activeKey}-hero`}
        />

        <ModuleEmptyState
          title="Nothing here yet"
          body={`When ${title} is built, your ${definition.name.toLowerCase()} activity will appear here.`}
          actionLabel={`Ask ${definition.ai.label}`}
          onAction={() => router.push(definition.routes.ai)}
          testID={`${moduleId}-${activeKey}-empty`}
        />

        <ModuleSection
          title={`Elsewhere in ${definition.name}`}
          testID={`${moduleId}-${activeKey}-elsewhere`}
        >
          <ModuleFeatureGrid testID={`${moduleId}-${activeKey}-features`} />
        </ModuleSection>
      </View>
    </ModuleScaffold>
  );
}
