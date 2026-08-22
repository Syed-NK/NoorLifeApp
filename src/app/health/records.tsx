import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Health → Records. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="health"
      activeKey="records"
      title="Records"
      heroTitle="Records planned"
      heroBody="Not built yet. What you record will stay on your account."
    />
  );
}
