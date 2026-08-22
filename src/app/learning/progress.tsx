import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Learning → Progress. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="learning"
      activeKey="progress"
      title="Progress"
      heroTitle="Progress planned"
      heroBody="Not built yet. Finished lessons will show here."
    />
  );
}
