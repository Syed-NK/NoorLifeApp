import AsyncStorage from '@react-native-async-storage/async-storage';
import { withAsyncStorageFailing } from '@/test-support/async-storage-failure';

import {
  CURRENT_ONBOARDING_VERSION,
  markOnboardingCompleted,
  readOnboardingState,
  resetOnboarding,
  shouldShowOnboarding,
} from '../onboarding-preferences';

/**
 * Onboarding persistence.
 *
 * The behaviour that matters: completion is recorded only when the user actually finishes or
 * skips, it survives a restart, and it is versioned so a future redesign does not require wiping
 * application data to show.
 */

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('a first launch', () => {
  it('reports onboarding as not completed', async () => {
    expect(await readOnboardingState()).toEqual({ completed: false, completedVersion: 0 });
    expect(await shouldShowOnboarding()).toBe(true);
  });

  it('is not recorded as complete merely by reading', async () => {
    await readOnboardingState();
    // Reading must have no side effect: mounting panel 1 would otherwise complete onboarding.
    expect(await shouldShowOnboarding()).toBe(true);
  });
});

describe('completing onboarding', () => {
  it('records completion at the current version', async () => {
    await markOnboardingCompleted();

    expect(await readOnboardingState()).toEqual({
      completed: true,
      completedVersion: CURRENT_ONBOARDING_VERSION,
    });
    expect(await shouldShowOnboarding()).toBe(false);
  });

  it('survives a restart', async () => {
    await markOnboardingCompleted();
    // A fresh read is exactly what a cold launch does.
    expect(await shouldShowOnboarding()).toBe(false);
  });

  it('is idempotent', async () => {
    await markOnboardingCompleted();
    await markOnboardingCompleted();

    expect((await readOnboardingState()).completedVersion).toBe(CURRENT_ONBOARDING_VERSION);
  });
});

describe('versioning', () => {
  it('does not replay onboarding for a user on the current version', async () => {
    await markOnboardingCompleted();
    expect(await shouldShowOnboarding()).toBe(false);
  });

  it('replays onboarding for a user who only completed an older version', async () => {
    // Simulates a future CURRENT_ONBOARDING_VERSION bump.
    await AsyncStorage.multiSet([
      ['noorlife.onboarding.completed', 'true'],
      ['noorlife.onboarding.version', '0'],
    ]);

    const state = await readOnboardingState();
    expect(state.completedVersion).toBe(0);
    expect(state.completed).toBe(false);
    expect(await shouldShowOnboarding()).toBe(true);
  });

  it('treats a pre-versioning install as version 1 rather than replaying it', async () => {
    // Users who completed onboarding before versioning existed have a flag and no version. Showing
    // them onboarding again on upgrade would be a worse bug than the one versioning prevents.
    await AsyncStorage.setItem('noorlife.onboarding.completed', 'true');

    expect(await readOnboardingState()).toEqual({ completed: true, completedVersion: 1 });
    expect(await shouldShowOnboarding()).toBe(false);
  });

  it('treats an unparseable version as not completed', async () => {
    await AsyncStorage.multiSet([
      ['noorlife.onboarding.completed', 'true'],
      ['noorlife.onboarding.version', 'banana'],
    ]);

    expect(await shouldShowOnboarding()).toBe(true);
  });
});

describe('the development-only reset', () => {
  it('clears completion in a development build', async () => {
    await markOnboardingCompleted();
    expect(await shouldShowOnboarding()).toBe(false);

    // Jest runs with __DEV__ true, which is the development build case.
    expect(await resetOnboarding()).toBe(true);
    expect(await shouldShowOnboarding()).toBe(true);
  });

  it('refuses to run in a production build', async () => {
    await markOnboardingCompleted();

    // `__DEV__` is a compile-time global rather than a declared property of globalThis, so it is
    // reached through an indexed cast rather than a direct member access.
    const globals = globalThis as unknown as { __DEV__: boolean };
    const dev = globals.__DEV__;
    globals.__DEV__ = false;
    try {
      // Guarded inside the service rather than at the call site, so a control left on screen by
      // mistake still cannot reset a real user's onboarding.
      expect(await resetOnboarding()).toBe(false);
      expect(await shouldShowOnboarding()).toBe(false);
    } finally {
      globals.__DEV__ = dev;
    }
  });
});

describe('storage failure', () => {
  it('falls back to showing onboarding rather than skipping it', async () => {
    await withAsyncStorageFailing('getItem', new Error('storage unavailable'), async () => {
      // Wrongly showing onboarding costs three taps; wrongly skipping it leaves a new user on an
      // authentication screen with no idea what the app is.
      expect(await shouldShowOnboarding()).toBe(true);
    });
  });

  it('does not throw when completion cannot be written', async () => {
    await withAsyncStorageFailing('multiSet', new Error('storage unavailable'), async () => {
      await expect(markOnboardingCompleted()).resolves.toBeUndefined();
    });
  });
});
