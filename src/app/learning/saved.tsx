import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Learning → Saved. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="learning"
      activeKey="saved"
      title="Saved"
      heroTitle="Saved reading planned"
      heroBody="Not built yet. Reading you set aside will wait here."
    />
  );
}
