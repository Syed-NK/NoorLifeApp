import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Faith → More. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="faith"
      activeKey="more"
      title="More"
      heroTitle="The rest of Faith"
      heroBody="Dhikr, Qibla and the settings that shape how this module behaves."
    />
  );
}
