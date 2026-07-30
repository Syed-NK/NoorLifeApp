import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Planner → Tasks. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="planner"
      activeKey="tasks"
      title="Tasks"
      heroTitle="What actually needs doing"
      heroBody="A short list you can finish beats a long one you avoid."
    />
  );
}
