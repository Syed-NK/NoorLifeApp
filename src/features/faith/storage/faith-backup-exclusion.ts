import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * Keeping the retained Arabic Qur'an out of platform backup.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the two platforms are not symmetrical ──────────────────────────────
 * The permission of 2026-08-18 allows retention in **private application storage** and forbids
 * export. A platform backup is an export — the text leaves the device and sits outside NoorLife's
 * control — so each platform has to be checked on its own terms, and they differ:
 *
 *   • **Android** needs nothing. The shipped rules declare `<include domain="sharedpref" path="."/>`
 *     and nothing else, and Android backs up only included paths once any include is present. The
 *     file domain, where the generation lives, is out of scope by construction. That is asserted by
 *     `quran-arabic-backup-scope.test.ts`, which fails if `domain="file"` is ever included.
 *
 *   • **iOS** does not. The Documents directory is backed up to iCloud by default, and
 *     `NSURLIsExcludedFromBackupKey` is a runtime resource value rather than an Info.plist entry, so
 *     no config plugin can set it. That is why a native module exists at all.
 *
 * ── Fail closed, and what that means here ──────────────────────────────────
 * On iOS an unconfirmed exclusion is a refusal, not a warning. `ensureExcludedFromBackup` reads the
 * flag back rather than trusting the write, and the publish path treats anything but `excluded` as a
 * reason not to publish Arabic. Retaining the Qur'an where it might be copied to iCloud is the exact
 * thing the licence forbids, so the honest failure is to hold no Arabic at all — the reader then says
 * Arabic is unavailable, which is true.
 *
 * On Android the same call answers `not-required`, which is a distinct outcome from `excluded`: one
 * means "the platform already guarantees this", the other means "we set it". Collapsing them would
 * make an Android pass look like evidence about iOS.
 *
 * ── What is deliberately not done ──────────────────────────────────────────
 * The dataset is **not** moved to cache storage to dodge backup. The OS may purge a cache directory
 * at any time, and a Qur'an that disappears under storage pressure is a worse answer than one that
 * is correctly excluded where it is.
 * ═══════════════════════════════════════════════════════════════════════════
 */

type NativeBackupExclusion = {
  readonly excludeFromBackup: (path: string) => boolean;
  readonly isExcludedFromBackup: (path: string) => boolean;
};

/**
 * Optional by design.
 *
 * On Android the module is not built at all — its config declares iOS only — so requiring it
 * unconditionally would throw on the platform that needs nothing. `null` on iOS is a different
 * matter entirely, and is treated as a failure below.
 */
const native = requireOptionalNativeModule<NativeBackupExclusion>('QuranBackupExclusion');

export type BackupExclusionOutcome =
  /** iOS: the flag was set and read back as set. */
  | 'excluded'
  /** Android: platform backup rules already exclude the file domain; nothing to do. */
  | 'not-required'
  /** iOS: the native boundary is absent. Treated as a failure, never as "probably fine". */
  | 'unavailable'
  /** iOS: the call ran and the flag could not be confirmed. */
  | 'failed';

export function isBackupSafe(outcome: BackupExclusionOutcome): boolean {
  return outcome === 'excluded' || outcome === 'not-required';
}

/**
 * Ensures the Qur'an generation root is excluded from platform backup.
 *
 * Idempotent, and cheap enough to call both when the root is created and again before an Arabic
 * generation publishes. Calling it twice is deliberate: a directory recreated between those points
 * would otherwise carry no flag, and the publish-time call is the one the licence actually rests on.
 */
export function ensureExcludedFromBackup(rootUri: string): BackupExclusionOutcome {
  if (Platform.OS !== 'ios') {
    /*
      Not a silent pass. Android's guarantee comes from its backup rules, which are asserted
      separately; this outcome records that the platform needs no per-directory action.
    */
    return 'not-required';
  }
  if (native === null) {
    return 'unavailable';
  }
  try {
    return native.excludeFromBackup(rootUri) ? 'excluded' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Reads the current state back, for verification rather than for the write path. */
export function isExcludedFromBackup(rootUri: string): boolean {
  if (Platform.OS !== 'ios') {
    return true;
  }
  if (native === null) {
    return false;
  }
  try {
    return native.isExcludedFromBackup(rootUri);
  } catch {
    return false;
  }
}
