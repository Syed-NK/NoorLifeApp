import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Persistence boundary for the entry flow.
 *
 * ── The split, and why it is enforced here rather than by convention ─────────
 * Tokens go to `expo-secure-store` (Keystore/Keychain backed). Everything else — the
 * onboarding flag, the remembered email — goes to AsyncStorage, which is plain unencrypted
 * storage on device.
 *
 * Keeping both behind one module means the rule "never store passwords or tokens in
 * AsyncStorage" is checkable by reading one file, instead of auditing every call site. The
 * AsyncStorage functions below physically cannot be handed a token: they are named for the
 * single non-sensitive value each one holds.
 *
 * Passwords are never persisted anywhere, in any form.
 */

const ONBOARDING_KEY = 'noorlife.onboarding.completed';
const REMEMBERED_EMAIL_KEY = 'noorlife.auth.rememberedEmail';
const ACCESS_TOKEN_KEY = 'noorlife.auth.accessToken';

/**
 * Whether onboarding has ever been completed on this device.
 *
 * This is the flag that distinguishes a first-time launch (→ Onboarding) from a returning
 * signed-out launch (→ Authentication Options), so it has to outlive the process.
 */
export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === 'true';
  } catch {
    // A read failure must not block launch; treating it as "not yet onboarded" shows the
    // onboarding again, which is recoverable, whereas throwing here is not.
    return false;
  }
}

export async function setOnboardingCompleted(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  } catch {
    // Non-fatal: the user simply sees onboarding again next launch.
  }
}

/** The address to prefill on the sign-in form when "Remember me" was used. */
export async function readRememberedEmail(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(REMEMBERED_EMAIL_KEY);
  } catch {
    return null;
  }
}

export async function writeRememberedEmail(email: string | null): Promise<void> {
  try {
    if (email === null) {
      await AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY);
      return;
    }
    await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, email);
  } catch {
    // Non-fatal: the field simply starts empty.
  }
}

/**
 * Reads the stored access token.
 *
 * Secure storage is unavailable on web and can be unavailable on a device without a
 * configured keystore, so every path here degrades to "no session" rather than throwing.
 */
export async function readAccessToken(): Promise<string | null> {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return null;
    }
    return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function writeAccessToken(token: string): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    // Deliberately silent, and deliberately *not* falling back to AsyncStorage: a token in
    // plain storage is worse than an un-persisted session.
    return;
  }
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
}

export async function clearAccessToken(): Promise<void> {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      return;
    }
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  } catch {
    // Nothing to recover: the session is being discarded either way.
  }
}
