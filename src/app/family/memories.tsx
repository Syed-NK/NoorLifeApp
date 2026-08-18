import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Family → Memories. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="family"
      activeKey="memories"
      title="Memories"
      heroTitle="The moments worth keeping"
      heroBody="Photos and notes from the days your family will want to look back on."
    />
  );
}
