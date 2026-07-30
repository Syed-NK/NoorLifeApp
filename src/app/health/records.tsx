import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Health → Records. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="health"
      activeKey="records"
      title="Records"
      heroTitle="Your history, kept private"
      heroBody="Everything you have logged, in one place, stored against your account only."
    />
  );
}
