import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { SimplePlaceholderScreen } from '@features/placeholder/simple-placeholder-screen';

export default function Screen() {
  return (
    <ProtectedRouteBoundary>
      <SimplePlaceholderScreen
        title="All Modules"
        description="The full module directory. Every card opens the module default home route."
        specReference="Workflow §3.1, §3.2"
      />
    </ProtectedRouteBoundary>
  );
}
