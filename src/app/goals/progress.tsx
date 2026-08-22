import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Goals → Progress. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="goals"
      activeKey="progress"
      title="Progress"
      heroTitle="Progress planned"
      heroBody="Not built yet. It will show what you kept and missed."
    />
  );
}
