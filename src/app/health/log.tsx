import { ModuleSectionScreen } from '@features/modules/screens/module-section-screen';

/** Health → Track. */
export default function Screen() {
  return (
    <ModuleSectionScreen
      moduleId="health"
      activeKey="track"
      title="Track"
      heroTitle="Log it in a few seconds"
      heroBody="A walk, a glass of water, how you slept — short entries are the ones you keep making."
    />
  );
}
