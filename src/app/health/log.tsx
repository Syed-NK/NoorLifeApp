import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Health → Track. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="health"
      activeKey="track"
      title="Track"
      heroTitle="Logging planned"
      heroBody="Not built yet. A walk or a glass of water, in seconds."
    />
  );
}
