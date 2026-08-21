import { PlannerProvider } from '@features/planner/di/planner-provider';
import { PlannerCalendarScreen } from '@features/planner/screens/planner-calendar-screen';

/** Planner → Calendar. */
export default function Screen() {
  return (
    <PlannerProvider>
      <PlannerCalendarScreen />
    </PlannerProvider>
  );
}
