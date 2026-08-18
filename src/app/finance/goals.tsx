import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Finance → Savings. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="finance"
      activeKey="goals"
      title="Savings"
      heroTitle="Saving toward something specific"
      heroBody="Name the thing, set the amount, and watch the gap close."
    />
  );
}
