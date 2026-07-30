import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Goals → Progress. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="goals"
      activeKey="progress"
      title="Progress"
      heroTitle="Honest, not flattering"
      heroBody="What you have kept and what you have missed, without a guilt trip about either."
    />
  );
}
