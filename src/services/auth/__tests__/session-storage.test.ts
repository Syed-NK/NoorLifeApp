import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  clearAccessToken,
  hasCompletedOnboarding,
  readAccessToken,
  readRememberedEmail,
  setOnboardingCompleted,
  writeAccessToken,
  writeRememberedEmail,
} from '../session-storage';

/**
 * These tests exist for one reason: to make "never store tokens in AsyncStorage" a checked
 * property rather than a comment. The assertion that matters is the last one.
 */

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearAccessToken();
});

describe('onboarding flag', () => {
  it('reports false until onboarding is completed', async () => {
    await expect(hasCompletedOnboarding()).resolves.toBe(false);
  });

  it('persists completion', async () => {
    await setOnboardingCompleted();
    await expect(hasCompletedOnboarding()).resolves.toBe(true);
  });
});

describe('remembered email', () => {
  it('round-trips a non-sensitive address', async () => {
    await writeRememberedEmail('ahmed@example.com');
    await expect(readRememberedEmail()).resolves.toBe('ahmed@example.com');
  });

  it('clears on null, so unchecking Remember me actually forgets', async () => {
    await writeRememberedEmail('ahmed@example.com');
    await writeRememberedEmail(null);
    await expect(readRememberedEmail()).resolves.toBeNull();
  });
});

describe('access token', () => {
  it('round-trips through secure storage', async () => {
    await writeAccessToken('token-abc');
    await expect(readAccessToken()).resolves.toBe('token-abc');
  });

  it('is removed on clear', async () => {
    await writeAccessToken('token-abc');
    await clearAccessToken();
    await expect(readAccessToken()).resolves.toBeNull();
  });

  it('goes only to secure storage, never to AsyncStorage', async () => {
    await writeAccessToken('token-abc');

    // The token must be in the keystore...
    await expect(SecureStore.getItemAsync('noorlife.auth.accessToken')).resolves.toBe('token-abc');

    // ...and nowhere in plain storage, under any key.
    const keys = await AsyncStorage.getAllKeys();
    const entries = await AsyncStorage.multiGet([...keys]);
    for (const [, value] of entries) {
      expect(value).not.toContain('token-abc');
    }
  });
});
