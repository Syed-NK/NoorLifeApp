import { act, render } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Text } from 'react-native';

import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { AppProviders } from '@application/providers/app-providers';

/**
 * The shared harness for issue #58's launch cases, and why they live in several files.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Each case mounts the whole provider stack under fake timers and advances a launch clock through a
 * ten-second ceiling. This project has no React act environment, so after roughly three such renders
 * in one file React's queue is left in a state where the next `render` yields an empty tree and the
 * remaining cases fail on elements that are rendered unconditionally — the failure mode documented in
 * `settle-until-loaded.ts`, and the reason #52's render tests were split the same way.
 *
 * So the matrix is spread across files by subject, with the harness here rather than copied. The auth
 * service double stays in each file: `jest.mock` factories are hoisted per module and cannot be
 * shared, which is also what lets each file steer authority independently.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The account the Supabase double signs in as.
 *
 * `test-user-id` matches the id the rest of the test environment simulates, so a launch that resolves
 * here lands in the same Faith namespace a suite calling storage directly would use.
 */
export const LAUNCH_USER = {
  id: 'test-user-id',
  email: 'a@example.com',
  fullName: 'Signup Name',
  avatarUrl: null,
  emailConfirmed: true,
};

export function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolveIt) => {
    settle = resolveIt;
  });
  return { promise, settle };
}

/** A stand-in for whatever the deep link named. Its presence is the exposure being guarded. */
export function ProtectedChild() {
  return <Text testID="protected-child">protected</Text>;
}

/** A cold deep link: the boundary is the outermost thing in the tree, with no entry gate above it. */
export async function launchDeepLink(strict = false) {
  const tree = (
    <AppProviders>
      <ProtectedRouteBoundary>
        <ProtectedChild />
      </ProtectedRouteBoundary>
    </AppProviders>
  );
  return await render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** Advances the launch clock, draining the work each tick releases. */
export async function advanceLaunch(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
  });
}
