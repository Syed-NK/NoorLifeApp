import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Planner → Calendar. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="planner"
      activeKey="calendar"
      title="Calendar"
      heroTitle="The month at a glance"
      heroBody="Your events and NoorLife plans on one grid, so nothing gets double-booked."
    />
  );
}
