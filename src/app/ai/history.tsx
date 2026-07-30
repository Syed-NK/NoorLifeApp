import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Noor AI → Conversation History. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="history"
      title="History"
      heroTitle="Every question you have asked"
      heroBody="Reopen a conversation, or pick up where one left off."
    />
  );
}
