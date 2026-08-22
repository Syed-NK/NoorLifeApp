import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Finance → Budgets. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="finance"
      activeKey="budgets"
      title="Budgets"
      heroTitle="Budgets planned"
      heroBody="Not built yet. You will set an amount per category."
    />
  );
}
