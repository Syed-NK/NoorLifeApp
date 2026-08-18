import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Finance → Budgets. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="finance"
      activeKey="budgets"
      title="Budgets"
      heroTitle="A limit you chose yourself"
      heroBody="Set an amount per category and see where you stand before the month ends."
    />
  );
}
