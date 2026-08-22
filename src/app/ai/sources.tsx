import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Noor AI → Sources and citations. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="ask-ai"
      title="Sources"
      heroTitle="Citations planned"
      heroBody="Not built yet. Answers will cite what they used."
    />
  );
}
