import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Learning → Saved. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="learning"
      activeKey="saved"
      title="Saved"
      heroTitle="Read it when you have time"
      heroBody="The articles and lessons you set aside, waiting rather than forgotten."
    />
  );
}
