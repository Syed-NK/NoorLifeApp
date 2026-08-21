import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { MainHomeScreen } from '@features/home/screens/main-home-screen';

/** `/home` — Main Home (design spec §05, workflow §5). */
export default function Home() {
  return (
    <ProtectedRouteBoundary>
      <MainHomeScreen />
    </ProtectedRouteBoundary>
  );
}
