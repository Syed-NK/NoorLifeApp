import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Health → Trends. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="health"
      activeKey="trends"
      title="Trends"
      heroTitle="The pattern, not the day"
      heroBody="One bad night means nothing. Four in a row is worth knowing about."
    />
  );
}
