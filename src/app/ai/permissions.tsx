import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Noor AI → AI permissions, reached from the privacy card. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="ask-ai"
      title="AI Permissions"
      heroTitle="You decide what Noor AI can read"
      heroBody="Grant a module, or withdraw it, at any time."
    />
  );
}
