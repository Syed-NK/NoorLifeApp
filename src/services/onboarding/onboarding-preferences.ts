import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Onboarding completion, as a versioned preference.
 *
 * ── Why a version ───────────────────────────────────────────────────────────
 * The old flag was a bare `'true'`. That works until onboarding is redesigned, at which point the
 * only way to show the new panels to existing users is to clear application data — which throws
 * away their session and preferences to deliver a marketing moment.
 *
 * Storing the version the user completed makes that a one-line decision instead: raise
 * `CURRENT_ONBOARDING_VERSION` and everyone who completed an older version sees the new flow once.
 * Nothing else is touched.
 */

const ONBOARDING_KEY = 'noorlife.onboarding.completed';
const ONBOARDING_VERSION_KEY = 'noorlife.onboarding.version';

/**
 * The version of the onboarding flow currently shipping.
 *
 * Raise this **only** for a deliberate re-introduction. Bumping it shows onboarding again to the
 * entire installed base, which is a product decision, not a refactor.
 */
export const CURRENT_ONBOARDING_VERSION = 1;

export type OnboardingState = {
  readonly completed: boolean;
  /** The version the user completed, or 0 if they never have. */
  readonly completedVersion: number;
};

/**
 * Reads completion for the *current* version.
 *
 * ── Why storage failures resolve to "not completed" ─────────────────────────
 * A read failure is indistinguishable from a first launch, and the two possible errors are not
 * symmetric: wrongly showing onboarding costs three taps, while wrongly skipping it leaves a new
 * user on an authentication screen with no idea what the app is. So the safe direction is to show
 * it.
 */
export async function readOnboardingState(): Promise<OnboardingState> {
  try {
    const [completed, version] = await Promise.all([
      AsyncStorage.getItem(ONBOARDING_KEY),
      AsyncStorage.getItem(ONBOARDING_VERSION_KEY),
    ]);

    if (completed !== 'true') {
      return { completed: false, completedVersion: 0 };
    }

    // A completed flag with no version is a pre-versioning install. Treat it as version 1, which
    // is the flow those users actually saw — re-showing onboarding to every existing user on
    // upgrade would be a worse bug than the one versioning exists to prevent.
    const parsed = version === null ? 1 : Number.parseInt(version, 10);
    const completedVersion = Number.isFinite(parsed) ? parsed : 0;

    return { completed: completedVersion >= CURRENT_ONBOARDING_VERSION, completedVersion };
  } catch {
    return { completed: false, completedVersion: 0 };
  }
}

/** Whether onboarding should be shown on this launch. */
export async function shouldShowOnboarding(): Promise<boolean> {
  return !(await readOnboardingState()).completed;
}

/**
 * Records completion at the current version.
 *
 * Called only from Skip and from Get Started — never on mount. Marking completion because panel 1
 * rendered would mean a user who force-quits during onboarding never sees it again.
 */
export async function markOnboardingCompleted(): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [ONBOARDING_KEY, 'true'],
      [ONBOARDING_VERSION_KEY, String(CURRENT_ONBOARDING_VERSION)],
    ]);
  } catch {
    // Swallowed deliberately: the flag is a convenience, and a storage failure must not block the
    // user from leaving onboarding. The cost is seeing it once more.
  }
}

/**
 * Clears onboarding completion. **Development builds only.**
 *
 * Guarded by `__DEV__` rather than by a caller's discipline, so a production build cannot reset a
 * user's onboarding even if a control were left on screen by mistake. Returns whether it ran, so
 * the caller can tell the difference between "reset" and "refused".
 */
export async function resetOnboarding(): Promise<boolean> {
  if (!__DEV__) {
    return false;
  }
  try {
    await AsyncStorage.multiRemove([ONBOARDING_KEY, ONBOARDING_VERSION_KEY]);
    return true;
  } catch {
    return false;
  }
}
