import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Noor AI → Sources and citations. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="ask-ai"
      title="Sources"
      heroTitle="Where an answer came from"
      heroBody="Noor AI cites what it used, so you can check it."
    />
  );
}
