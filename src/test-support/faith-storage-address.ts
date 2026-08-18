import {
  faithStorageKeys,
  resolveFaithAddress,
  type FaithStorageKeyName,
} from '@features/faith/storage/faith-storage';

/**
 * The account every suite runs as unless it says otherwise.
 *
 * ── Why it lives here and not beside the derivation ────────────────────────
 * It is a fixture, not a production constant, and production has no business naming a test user.
 * It has to match the id the Supabase double's session carries, because a suite that mounts the
 * real providers and one that calls the storage functions directly must address the same namespace
 * — otherwise half the suite writes somewhere the other half cannot read.
 *
 * `jest.setup.ts` sets it before every test. Suites that switch accounts restore it themselves.
 */
export const TEST_FAITH_USER_ID = 'test-user-id';

/**
 * Where a Faith key actually lives for the account the current test is running as.
 *
 * ── Why the tests are not allowed to write the address down ────────────────
 * A suite that asserts against the literal `'noorlife.faith.bookmarks'` is asserting that bookmarks
 * are *unpartitioned* — which was true, was the release blocker, and is exactly the thing that must
 * not silently come back. Resolving through the production boundary means those suites now assert
 * "the value the app wrote is readable at the address the app uses", which is what they were
 * always trying to say, and they keep saying it if the derivation changes again.
 *
 * The one thing this helper deliberately cannot do is hide a regression: if a key stopped being
 * scoped, `resolveFaithAddress` would return the bare key and the dedicated ownership tests in
 * `faith-account-isolation.test.ts` would fail. This is a convenience for suites that are about
 * something else, not a substitute for those.
 */
export function faithAddress(name: FaithStorageKeyName): string {
  const address = resolveFaithAddress(faithStorageKeys[name]);
  if (address === null) {
    throw new Error(
      `No address for "${name}": it is user-scoped and no account is active. ` +
        'Set one with setActiveFaithScope() before reading or writing it.',
    );
  }
  return address;
}
