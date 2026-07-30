import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Goals → Habits. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="goals"
      activeKey="habits"
      title="Habits"
      heroTitle="The daily version of the goal"
      heroBody="A goal you cannot start today is a habit you have not defined yet."
    />
  );
}
