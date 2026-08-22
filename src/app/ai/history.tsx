import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Noor AI → Conversation History. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="history"
      title="History"
      heroTitle="History planned"
      heroBody="Not built yet. You will be able to reopen a past chat."
    />
  );
}
