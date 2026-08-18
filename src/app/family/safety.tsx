import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Family → Safety. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="family"
      activeKey="safety"
      title="Safety"
      heroTitle="Shared carefully, by choice"
      heroBody="Who can see what, and what stays private — set per person, changeable any time."
    />
  );
}
