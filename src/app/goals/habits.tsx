import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Goals → Habits. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="goals"
      activeKey="habits"
      title="Habits"
      heroTitle="Habits planned"
      heroBody="Not built yet. A goal will become a daily step here."
    />
  );
}
