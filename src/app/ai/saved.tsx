import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Noor AI → Saved answers. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="saved"
      title="Saved"
      heroTitle="Answers worth keeping"
      heroBody="Anything you save stays here, ready to read again."
    />
  );
}
