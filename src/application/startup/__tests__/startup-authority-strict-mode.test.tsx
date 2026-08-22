import { act, render } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Text } from 'react-native';

import { AuthProvider, useAuth } from '@application/providers/auth-provider';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * The launch under Strict Mode's double mount.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Strict Mode mounts, tears down and remounts, so `resolveLaunch` runs twice and the first run's
 * work completes into a tree that no longer exists. That is the case issue #34 made reachable: with
 * the profile read off the critical path and the session lookup bounded, a launch can be *partly*
 * done when its tree is discarded, where before every await sat inside the one function that wrote
 * state.
 *
 * Nothing in the provider counts mounts. It does not need to: each mount has its own state, so the
 * discarded run's publications go nowhere, and the mount effect's own `cancelled` flag — now shared
 * with `resolveLaunch` — stops the discarded run from writing a receipt or issuing a profile read.
 *
 * ── Why this is the only test in its own file ──────────────────────────────
 * A double mount overlaps `act`, and with no act environment in this project that leaves every later
 * render in the same file unable to resolve — which presents as a missing element and reads as a
 * provider defect. It is the harness, so it is kept alone.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'a@example.com',
  fullName: 'Signup Name',
  avatarUrl: null,
  emailConfirmed: true,
};

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();

jest.mock('@services/auth/auth.service', () => ({
  resolveSession: (...args: unknown[]) => mockResolveSession(...args),
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  subscribeToAuthChanges: () => () => undefined,
  signOut: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn(),
  signInWithEmail: jest.fn(),
  signUpWithEmail: jest.fn(),
  verifyOtp: jest.fn(),
  resendVerificationEmail: jest.fn(),
  sendPasswordReset: jest.fn(),
  updatePassword: jest.fn(),
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
  setOnboardingCompleted: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

function Probe() {
  const state = useAuth();
  return <Text testID="probe">{`${state.status}:${state.authority ?? 'none'}`}</Text>;
}

it('reaches exactly one authority under a Strict Mode double mount', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
  mockGetProfile.mockResolvedValue({
    id: USER.id,
    full_name: 'Durable Name',
    avatar_url: null,
    onboarding_completed: true,
  });

  const view = await render(
    <StrictMode>
      <AuthProvider connectivity={createFakeConnectivity(WIFI_ONLINE)}>
        <Probe />
      </AuthProvider>
    </StrictMode>,
  );
  await act(async () => {
    for (let i = 0; i < 40; i += 1) {
      await Promise.resolve();
    }
  });

  /* One authority, online, and no half-resolved state left behind by the discarded first run. */
  expect(view.getByTestId('probe').props.children).toBe('signed-in:online');
  jest.useRealTimers();
});
