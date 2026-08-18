import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Learning → Library. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="learning"
      activeKey="library"
      title="Library"
      heroTitle="Everything worth coming back to"
      heroBody="Courses and reading you have started, saved or finished."
    />
  );
}
