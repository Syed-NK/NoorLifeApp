import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Family → Memories. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="family"
      activeKey="memories"
      title="Memories"
      heroTitle="Album planned"
      heroBody="Not built yet. Shared photos and notes will collect here."
    />
  );
}
