import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Family → Calendar. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="family"
      activeKey="calendar"
      title="Calendar"
      heroTitle="Calendar planned"
      heroBody="Not built yet. Family plans will sit in one place."
    />
  );
}
