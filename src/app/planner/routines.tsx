import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Planner → Routines. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="planner"
      activeKey="routines"
      title="Routines"
      heroTitle="The parts of the day you repeat"
      heroBody="Set a routine once and it lays itself out every day without asking."
    />
  );
}
