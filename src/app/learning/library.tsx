import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Learning → Library. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="learning"
      activeKey="library"
      title="Library"
      heroTitle="Library planned"
      heroBody="Not built yet. Courses you begin will collect here."
    />
  );
}
