import { SimplePlaceholderScreen } from '@features/placeholder/simple-placeholder-screen';

export default function Screen() {
  return (
    <SimplePlaceholderScreen
      title="Manage Subscription"
      description="Current plan, renewal date, payment method, billing history, switch plan and cancel."
      specReference="Design spec §18"
    />
  );
}
