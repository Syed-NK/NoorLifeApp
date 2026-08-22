import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Goals → Wins. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="goals"
      activeKey="wins"
      title="Wins"
      heroTitle="Wins planned"
      heroBody="Not built yet. Closed goals will collect here."
    />
  );
}
