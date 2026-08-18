import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Learning → Progress. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="learning"
      activeKey="progress"
      title="Progress"
      heroTitle="What has actually stuck"
      heroBody="Lessons finished, streaks kept, and the topics that need another pass."
    />
  );
}
