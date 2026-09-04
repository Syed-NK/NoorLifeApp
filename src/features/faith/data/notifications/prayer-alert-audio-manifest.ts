import type { PrayerKey } from '../prayer-times.repository';
import type { AlertPlatform, LicensedAudioLookup, PrayerAlertMode } from './prayer-alert-mode';

/**
 * **What an adhān recording must declare before anything may play it** — issues #178 and #42.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a manifest rather than a filename ──────────────────────────────────
 * Because the question "may this play?" is not a question about a file. It is a question about a
 * performer, a rights owner, a written permission, an attribution string and the platforms the
 * grant covers — and every one of those has to be answerable at the moment the app is about to make
 * a sound, not left in a document somebody read once.
 *
 * PR #177 stops an asset arriving by accident. This stops one arriving *deliberately but
 * unaccountably*: adding a `.wav` and pointing the code at it is not enough, because there is
 * nowhere to put it that does not also demand who performed it and under what permission.
 *
 * ── Fail closed, and name the asset ────────────────────────────────────────
 * `APPROVED_ADHAN_RECORDINGS` is **empty**, and every gate below returns false over an empty list
 * without a special case for it. When a recording is approved it is added here **by name and by
 * hash**; there is deliberately no wildcard, no "any file in this directory" and no
 * `if (__DEV__) return true`. An exception that does not name an asset is the thing #42 exists to
 * prevent.
 *
 * The hash is the identity. A manifest entry that names a file is a claim about *a* recording; a
 * manifest entry that names its SHA-256 is a claim about *that* recording, and it is what makes
 * "the licensed asset was swapped" a detectable event rather than an invisible one.
 *
 * ── Fajr is a separate recording, never a spliced one ──────────────────────
 * The Fajr adhān carries the tathwīb — *aṣ-ṣalātu khayrun min an-nawm* — which does not belong in
 * the other four. So `purpose` is part of the entry and a Fajr alert will only accept a Fajr entry.
 * Constructing one by editing another recording's words is a religious decision, not an
 * audio-engineering one, and this module cannot express it: there is no "derive Fajr from non-Fajr"
 * anywhere, by design.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Which adhān a recording is. A Fajr alert accepts only `fajr`, and the others only `standard`. */
export type AdhanPurpose = 'fajr' | 'standard';

/** How much of the call the recording is. Maps to the two audio modes, one each. */
export type AdhanLength = 'short' | 'full';

export type ApprovedAdhanRecording = {
  /** Stable identifier, independent of the filename. Referenced by attribution and by tests. */
  readonly id: string;
  /** The bundled filename as registered with the native config plugin, e.g. `adhan-fajr-short.wav`. */
  readonly file: string;
  readonly purpose: AdhanPurpose;
  readonly length: AdhanLength;
  /**
   * Duration in whole seconds.
   *
   * Checked against the platform ceiling rather than trusted: iOS silently replaces a custom sound
   * of 30 seconds or more with the system default, so an over-long "short" asset would fail with no
   * error at all. Better to refuse it here than to ship a mode that quietly does nothing.
   */
  readonly durationSeconds: number;
  /** Lowercase hex SHA-256 of the exact approved bytes. The asset's real identity. */
  readonly sha256: string;
  /** The muezzin, by name. "From the internet" is not provenance — #42 §6. */
  readonly performer: string;
  /**
   * Who controls the **sound-recording** rights.
   *
   * Recorded separately from the performer because they are frequently different people, and a
   * permission from one is not a permission from the other. #42 records why this distinction is the
   * one that decides the whole question.
   */
  readonly recordingRightsOwner: string;
  /** Where the signed permission or licence lives. A path or reference, never "we have one". */
  readonly licenceReference: string;
  /** The attribution string, exactly as the licence requires it to appear. */
  readonly attribution: string;
  /** The platforms the grant covers. A mode is refused on a platform not named here. */
  readonly permittedPlatforms: readonly AlertPlatform[];
};

/**
 * Every approved recording.
 *
 * **Empty, and correct.** No recording has been licensed — see #42. Adding an entry here is a
 * rights decision, not a code change, and must arrive with the evidence #42 §6 requires.
 */
export const APPROVED_ADHAN_RECORDINGS: readonly ApprovedAdhanRecording[] = [];

/** The iOS ceiling. A custom sound of 30 seconds or more is silently replaced by the default. */
export const IOS_MAX_SOUND_SECONDS = 30;

/** Lowercase hex, 64 characters. Anything else is not a SHA-256 and is not trusted to be one. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Whether an entry is internally coherent enough to be believed.
 *
 * Every field is load-bearing, so every field is checked. A manifest entry missing its performer or
 * carrying a placeholder hash is not a partially-valid entry to be used cautiously — it is an entry
 * nobody completed, and the recording it describes must not play.
 */
export function isValidRecording(entry: ApprovedAdhanRecording): boolean {
  const nonEmpty = (value: string): boolean => value.trim().length > 0;
  if (
    !nonEmpty(entry.id) ||
    !nonEmpty(entry.file) ||
    !nonEmpty(entry.performer) ||
    !nonEmpty(entry.recordingRightsOwner) ||
    !nonEmpty(entry.licenceReference) ||
    !nonEmpty(entry.attribution)
  ) {
    return false;
  }
  if (!SHA256_PATTERN.test(entry.sha256)) {
    return false;
  }
  if (!Number.isInteger(entry.durationSeconds) || entry.durationSeconds <= 0) {
    return false;
  }
  if (entry.permittedPlatforms.length === 0) {
    return false;
  }
  /*
    A "short" recording that iOS will not play is not short. Checked here so the manifest cannot
    declare an asset the platform silently ignores — the failure mode with no error message.
  */
  if (entry.length === 'short' && entry.durationSeconds >= IOS_MAX_SOUND_SECONDS) {
    return false;
  }
  return true;
}

/** The purpose a time needs. Fajr's adhān is not the others', so the mapping is explicit. */
export function purposeFor(time: PrayerKey): AdhanPurpose {
  return time === 'fajr' ? 'fajr' : 'standard';
}

/** The length an audio mode needs. `notification-only` needs none and is not asked about here. */
export function lengthFor(mode: PrayerAlertMode): AdhanLength | null {
  if (mode === 'short-adhan') {
    return 'short';
  }
  return mode === 'full-adhan' ? 'full' : null;
}

/**
 * The approved recording for a mode, a time and a platform, or `null`.
 *
 * Every condition must hold at once: a valid entry, the right purpose, the right length, and a grant
 * covering this platform. `null` is the answer for all of them, because a caller that cannot play
 * has no use for the distinction — and the sheet's reason comes from `modeAvailability`, which asks
 * a richer question.
 */
export function approvedRecordingFor(input: {
  readonly mode: PrayerAlertMode;
  readonly time: PrayerKey;
  readonly platform: AlertPlatform;
  readonly manifest?: readonly ApprovedAdhanRecording[];
}): ApprovedAdhanRecording | null {
  const length = lengthFor(input.mode);
  if (length === null) {
    return null;
  }
  const purpose = purposeFor(input.time);
  const manifest = input.manifest ?? APPROVED_ADHAN_RECORDINGS;
  return (
    manifest.find(
      (entry) =>
        entry.length === length &&
        entry.purpose === purpose &&
        entry.permittedPlatforms.includes(input.platform) &&
        isValidRecording(entry),
    ) ?? null
  );
}

/**
 * The licence lookup the mode rules consume.
 *
 * Curried over a manifest so a test can state one without a file existing, and so production has
 * exactly one source of truth. Over the real manifest it returns false for everything, which is what
 * keeps both audio modes unavailable.
 */
export function licensedAudioLookup(
  platform: AlertPlatform,
  manifest: readonly ApprovedAdhanRecording[] = APPROVED_ADHAN_RECORDINGS,
): LicensedAudioLookup {
  return (mode, time) => approvedRecordingFor({ mode, time, platform, manifest }) !== null;
}
