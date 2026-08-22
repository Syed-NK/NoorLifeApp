import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Finance → Savings. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="finance"
      activeKey="goals"
      title="Savings"
      heroTitle="Goals planned"
      heroBody="Not built yet. Name a goal and watch the gap close."
    />
  );
}
