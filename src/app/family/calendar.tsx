import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Family → Calendar. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="family"
      activeKey="calendar"
      title="Calendar"
      heroTitle="One calendar, everyone on it"
      heroBody="Shared plans your family can see and add to, without a group chat."
    />
  );
}
