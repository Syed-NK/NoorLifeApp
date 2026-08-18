import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Finance → Spending. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="finance"
      activeKey="transactions"
      title="Spending"
      heroTitle="Every entry, in order"
      heroBody="What you spent and when, so a surprising month has an explanation."
    />
  );
}
