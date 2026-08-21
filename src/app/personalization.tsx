import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { SimplePlaceholderScreen } from '@features/placeholder/simple-placeholder-screen';

export default function Screen() {
  return (
    <ProtectedRouteBoundary>
      <SimplePlaceholderScreen
        title="Personalization"
        description="Interests, prayer preferences, wellness goals, family setup and learning interests."
        specReference="Design spec §13 board · Workflow §2"
      />
    </ProtectedRouteBoundary>
  );
}
