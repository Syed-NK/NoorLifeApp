import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Finance → Spending. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="finance"
      activeKey="transactions"
      title="Spending"
      heroTitle="Entries planned"
      heroBody="Not built yet. What you record will appear in order."
    />
  );
}
