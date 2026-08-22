import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Noor AI → Saved answers. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="saved"
      title="Saved"
      heroTitle="Saving planned"
      heroBody="Not built yet. Answers you keep will stay here."
    />
  );
}
