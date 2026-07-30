import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Faith → Prayer Times. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="faith"
      activeKey="worship"
      title="Prayer Times"
      heroTitle="Every prayer, in your day’s order"
      heroBody="Times for where you are, with a reminder before each one if you want it."
    />
  );
}
