import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Family → Safety. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="family"
      activeKey="safety"
      title="Safety"
      heroTitle="Controls planned"
      heroBody="Not built yet. Sharing will be set per person."
    />
  );
}
