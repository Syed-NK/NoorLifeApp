import { useRouter } from 'expo-router';

import { AppScreen, StateView } from '@ds/components';
import { useModuleTheme } from '@application/providers/design-system-provider';

/**
 * Unmatched-route fallback.
 *
 * Uses the shared StateView rather than a bespoke screen, per workflow §15.
 */
export default function NotFound() {
  const router = useRouter();
  const theme = useModuleTheme('main');

  return (
    <AppScreen testID="not-found-screen">
      <StateView
        kind="no-results"
        theme={theme}
        title="We couldn't find that screen"
        message="The link may be out of date. Let's get you back to your day."
        primaryActionLabel="Go to Home"
        onPrimaryAction={() => router.replace('/home')}
        variant="full"
        testID="not-found-state"
      />
    </AppScreen>
  );
}
