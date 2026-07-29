import { SimplePlaceholderScreen } from '@features/placeholder/simple-placeholder-screen';

export default function Screen() {
  return (
    <SimplePlaceholderScreen
      title="AI Permissions"
      description="Which modules Noor AI may access. Access is opt-in per module and revocable."
      specReference="Workflow §14 · Design spec §06"
    />
  );
}
