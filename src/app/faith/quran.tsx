import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Faith → Qur’an. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="faith"
      activeKey="quran"
      title="Qur’an"
      heroTitle="Read a little, every day"
      heroBody="Your place is kept, so you can pick up mid-page without hunting for it."
    />
  );
}
