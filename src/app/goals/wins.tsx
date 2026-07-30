import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Goals → Wins. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="goals"
      activeKey="wins"
      title="Wins"
      heroTitle="Proof it is working"
      heroBody="The streaks you kept and the goals you closed, worth re-reading on a hard week."
    />
  );
}
