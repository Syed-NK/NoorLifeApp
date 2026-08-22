import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Health → Trends. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="health"
      activeKey="trends"
      title="Trends"
      heroTitle="Trends planned"
      heroBody="Not built yet. Four bad nights matter; one does not."
    />
  );
}
