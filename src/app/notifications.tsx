import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { SimplePlaceholderScreen } from '@features/placeholder/simple-placeholder-screen';

export default function Screen() {
  return (
    <ProtectedRouteBoundary>
      <SimplePlaceholderScreen
        title="Notifications"
        description="Notification centre grouped by module, honouring quiet hours."
        specReference="Workflow §3.1"
      />
    </ProtectedRouteBoundary>
  );
}
