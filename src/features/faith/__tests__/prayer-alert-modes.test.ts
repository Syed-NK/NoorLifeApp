import {
  APPROVED_ADHAN_RECORDINGS,
  approvedRecordingFor,
  IOS_MAX_SOUND_SECONDS,
  isValidRecording,
  lengthFor,
  licensedAudioLookup,
  purposeFor,
  type ApprovedAdhanRecording,
} from '../data/notifications/prayer-alert-audio-manifest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_PRAYER_ALERT_MODE,
  effectiveMode,
  fullAdhanPlatformNote,
  isModeSelectable,
  isPrayerAlertMode,
  modeAvailability,
  nextStoredMode,
  platformSupportsMode,
  prayerAlertModeLabel,
  PRAYER_ALERT_MODES,
  type AlertPlatform,
} from '../data/notifications/prayer-alert-mode';
import {
  defaultAlertSettings,
  normaliseAlertSettings,
  NOTIFIABLE_TIMES,
} from '../data/notifications/prayer-alert-preferences';

/**
 * **The four alert modes, and why three of them cannot be chosen today** — issue #178.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this suite is protecting ──────────────────────────────────────────
 * One sentence: *the app must never say an adhān is playing when a chime is*. Every case below is a
 * way that could happen — a mode stored that nothing can honour, a manifest entry believed without
 * a hash, an iOS build offering a full adhān it cannot deliver, a licence lookup that answers "yes"
 * over an empty list, a decoder that trusts an unknown string.
 *
 * ── The two axes are tested apart, because they fail apart ─────────────────
 * "Is there a licence?" (#42) and "could this platform honour it?" are independent. A test that
 * only ever asked the combined question would pass while both were false and tell us nothing about
 * which one closes when the other changes. So platform capability is asserted against a stated
 * platform, and licence state against a stated manifest.
 *
 * Nothing here commits audio. Manifest doubles are metadata only — no bytes, no file, no fixture —
 * which is also what keeps PR #177's absence guard true.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PLATFORMS: readonly AlertPlatform[] = ['ios', 'android'];

/** A metadata-only manifest entry. No file exists and none is needed: nothing reads bytes. */
function recordingDouble(over: Partial<ApprovedAdhanRecording> = {}): ApprovedAdhanRecording {
  return {
    id: 'double-standard-short',
    file: 'adhan-standard-short.wav',
    purpose: 'standard',
    length: 'short',
    durationSeconds: 25,
    sha256: 'a'.repeat(64),
    performer: 'Test Muezzin',
    recordingRightsOwner: 'Test Rights Holder',
    licenceReference: 'docs/TEST_PERMISSION.md',
    attribution: 'Adhān by Test Muezzin.',
    permittedPlatforms: ['ios', 'android'],
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nothing is licensed, and the empty manifest is the reason
// ─────────────────────────────────────────────────────────────────────────────

describe('no recording is approved', () => {
  it('ships an empty manifest', () => {
    /* The whole basis of both audio modes being unavailable. #42 owns changing this. */
    expect(APPROVED_ADHAN_RECORDINGS).toEqual([]);
  });

  it('finds no recording for any mode, time or platform', () => {
    for (const platform of PLATFORMS) {
      for (const time of NOTIFIABLE_TIMES) {
        for (const mode of PRAYER_ALERT_MODES) {
          expect(approvedRecordingFor({ mode, time, platform })).toBeNull();
        }
      }
    }
  });

  it('answers no to every licence question over the real manifest', () => {
    for (const platform of PLATFORMS) {
      const lookup = licensedAudioLookup(platform);
      for (const time of NOTIFIABLE_TIMES) {
        expect(lookup('short-adhan', time)).toBe(false);
        expect(lookup('full-adhan', time)).toBe(false);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A manifest entry is believed only when it is complete
// ─────────────────────────────────────────────────────────────────────────────

describe('a manifest entry must be complete to be believed', () => {
  it('accepts a fully specified entry', () => {
    expect(isValidRecording(recordingDouble())).toBe(true);
  });

  it.each([
    ['no id', { id: '' }],
    ['no file', { file: '' }],
    ['no performer', { performer: '  ' }],
    ['no rights owner', { recordingRightsOwner: '' }],
    ['no licence reference', { licenceReference: '' }],
    ['no attribution', { attribution: '' }],
    ['no permitted platform', { permittedPlatforms: [] as AlertPlatform[] }],
  ])('refuses an entry with %s', (_label, over) => {
    /*
      Every field is load-bearing. An entry missing its performer is not a partially-valid entry to
      be used cautiously — it is one nobody completed, and #42 §6 is explicit that "from the
      internet" is not provenance.
    */
    expect(isValidRecording(recordingDouble(over as Partial<ApprovedAdhanRecording>))).toBe(false);
  });

  it.each([
    ['a short hash', 'abc'],
    ['uppercase hex', 'A'.repeat(64)],
    ['non-hex characters', 'z'.repeat(64)],
    ['an empty hash', ''],
  ])('refuses %s as a SHA-256', (_label, sha256) => {
    /* The hash is the asset's identity. Without a real one, "the approved asset" names nothing. */
    expect(isValidRecording(recordingDouble({ sha256 }))).toBe(false);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 12.5],
  ])('refuses a %s duration', (_label, durationSeconds) => {
    expect(isValidRecording(recordingDouble({ durationSeconds }))).toBe(false);
  });

  it('refuses a short recording iOS would silently ignore', () => {
    /*
      The invisible failure. A custom sound at or beyond 30 seconds is replaced by the system default
      with no error, so a "short" asset that long would ship a mode that quietly does nothing.
    */
    expect(isValidRecording(recordingDouble({ durationSeconds: IOS_MAX_SOUND_SECONDS }))).toBe(
      false,
    );
    expect(isValidRecording(recordingDouble({ durationSeconds: IOS_MAX_SOUND_SECONDS - 1 }))).toBe(
      true,
    );
  });

  it('does not apply the short ceiling to a full recording', () => {
    /* A full adhān is minutes long by definition; the ceiling is a statement about excerpts. */
    expect(isValidRecording(recordingDouble({ length: 'full', durationSeconds: 180 }))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fajr is a different recording, and is never derived
// ─────────────────────────────────────────────────────────────────────────────

describe('Fajr takes its own recording', () => {
  it('maps Fajr to the fajr purpose and every other time to standard', () => {
    expect(purposeFor('fajr')).toBe('fajr');
    for (const time of NOTIFIABLE_TIMES.filter((key) => key !== 'fajr')) {
      expect(purposeFor(time)).toBe('standard');
    }
  });

  it('will not serve a standard recording to Fajr', () => {
    /*
      The tathwīb — aṣ-ṣalātu khayrun min an-nawm — belongs to Fajr and to no other time. A standard
      recording is not a Fajr recording with something missing; it is a different recording.
    */
    const manifest = [recordingDouble({ purpose: 'standard' })];
    expect(
      approvedRecordingFor({ mode: 'short-adhan', time: 'fajr', platform: 'ios', manifest }),
    ).toBeNull();
    expect(
      approvedRecordingFor({ mode: 'short-adhan', time: 'dhuhr', platform: 'ios', manifest }),
    ).not.toBeNull();
  });

  it('will not serve a Fajr recording to another prayer', () => {
    const manifest = [recordingDouble({ purpose: 'fajr', id: 'double-fajr-short' })];
    expect(
      approvedRecordingFor({ mode: 'short-adhan', time: 'fajr', platform: 'ios', manifest }),
    ).not.toBeNull();
    expect(
      approvedRecordingFor({ mode: 'short-adhan', time: 'asr', platform: 'ios', manifest }),
    ).toBeNull();
  });

  it('never derives one purpose from the other', () => {
    /* There is no such function, and this is the assertion that keeps it that way. */
    const manifest = [recordingDouble({ purpose: 'standard' })];
    for (const platform of PLATFORMS) {
      expect(
        approvedRecordingFor({ mode: 'short-adhan', time: 'fajr', platform, manifest }),
      ).toBeNull();
    }
  });
});

describe('length and platform must both match', () => {
  it('maps each audio mode to one length, and notification-only to none', () => {
    expect(lengthFor('short-adhan')).toBe('short');
    expect(lengthFor('full-adhan')).toBe('full');
    expect(lengthFor('notification-only')).toBeNull();
  });

  it('will not serve a full recording to the short mode', () => {
    const manifest = [recordingDouble({ length: 'full', durationSeconds: 200 })];
    expect(
      approvedRecordingFor({ mode: 'short-adhan', time: 'asr', platform: 'ios', manifest }),
    ).toBeNull();
  });

  it('refuses a platform the grant does not name', () => {
    /* A permission for Android is not a permission for iOS. The manifest says which, and it binds. */
    const manifest = [recordingDouble({ permittedPlatforms: ['android'] })];
    expect(
      approvedRecordingFor({ mode: 'short-adhan', time: 'asr', platform: 'ios', manifest }),
    ).toBeNull();
    expect(
      approvedRecordingFor({ mode: 'short-adhan', time: 'asr', platform: 'android', manifest }),
    ).not.toBeNull();
  });

  it('refuses an incomplete entry even when everything else matches', () => {
    const manifest = [recordingDouble({ sha256: 'not-a-hash' })];
    expect(
      approvedRecordingFor({ mode: 'short-adhan', time: 'asr', platform: 'ios', manifest }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Platform capability, asked separately from the licence
// ─────────────────────────────────────────────────────────────────────────────

describe('platform capability is independent of the licence', () => {
  it('supports notification-only and short adhān on both platforms', () => {
    for (const platform of PLATFORMS) {
      expect(platformSupportsMode(platform, 'notification-only')).toBe(true);
      expect(platformSupportsMode(platform, 'short-adhan')).toBe(true);
    }
  });

  it('supports full adhān on neither platform in this build', () => {
    /*
      iOS: never through a notification — the sound is capped under 30 seconds and no code runs for a
      notification delivered to a terminated app. Android: possible via an exact alarm starting a
      mediaPlayback foreground service, and deliberately not implemented, because that costs a
      persistent notification the user cannot dismiss. Both false, for different reasons.
    */
    for (const platform of PLATFORMS) {
      expect(platformSupportsMode(platform, 'full-adhan')).toBe(false);
    }
  });

  it('gives each platform its own reason, and neither mentions a licence', () => {
    const ios = fullAdhanPlatformNote('ios');
    const android = fullAdhanPlatformNote('android');
    expect(ios).not.toBe(android);
    for (const note of [ios, android]) {
      /* These reasons outlive #42, so a licence must not be what they blame. */
      expect(note).not.toMatch(/licen/i);
    }
    expect(ios).toMatch(/30 seconds/);
  });

  it('stays unavailable on iOS even with a licensed short-and-full manifest', () => {
    /*
      The case that matters most. A licence arriving must not make iOS claim a capability it does not
      have — which is exactly what a single combined predicate would eventually do.
    */
    const manifest = [
      recordingDouble({ length: 'full', durationSeconds: 200, id: 'double-full' }),
      recordingDouble(),
    ];
    const hasLicensedAudio = licensedAudioLookup('ios', manifest);
    expect(
      modeAvailability({ mode: 'full-adhan', time: 'dhuhr', platform: 'ios', hasLicensedAudio }),
    ).toMatchObject({ available: false, unavailableBecause: 'unsupported-platform' });
    /* And short adhān becomes genuinely available, which proves the manifest double works. */
    expect(
      modeAvailability({ mode: 'short-adhan', time: 'dhuhr', platform: 'ios', hasLicensedAudio }),
    ).toMatchObject({ available: true, unavailableBecause: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the sheet is told, and in what order
// ─────────────────────────────────────────────────────────────────────────────

describe('availability reports the right kind of no', () => {
  it('always offers notification-only', () => {
    for (const platform of PLATFORMS) {
      for (const time of NOTIFIABLE_TIMES) {
        expect(modeAvailability({ mode: 'notification-only', time, platform })).toMatchObject({
          available: true,
          unavailableBecause: null,
        });
      }
    }
  });

  it('refuses sunrise before it considers the platform or the licence', () => {
    /*
      Order matters: sunrise is permanent and has nothing to do with audio, so a user reading its
      reason should learn that rather than being told to wait for a recording.
    */
    const manifest = [recordingDouble(), recordingDouble({ length: 'full', id: 'f' })];
    for (const platform of PLATFORMS) {
      for (const mode of ['short-adhan', 'full-adhan'] as const) {
        const availability = modeAvailability({
          mode,
          time: 'sunrise',
          platform,
          hasLicensedAudio: licensedAudioLookup(platform, manifest),
        });
        expect(availability).toMatchObject({
          available: false,
          unavailableBecause: 'never-for-this-time',
        });
        expect(availability.reason).toMatch(/time marker, not a prayer/i);
      }
    }
  });

  it('blames the licence for short adhān, on both platforms', () => {
    for (const platform of PLATFORMS) {
      const availability = modeAvailability({ mode: 'short-adhan', time: 'fajr', platform });
      expect(availability).toMatchObject({
        available: false,
        unavailableBecause: 'unlicensed',
      });
      expect(availability.reason).toMatch(/no licensed adh/i);
      expect(availability.reason).not.toMatch(/soon|shortly|next release|coming/i);
    }
  });

  it('blames the platform for full adhān, not the licence', () => {
    for (const platform of PLATFORMS) {
      const availability = modeAvailability({ mode: 'full-adhan', time: 'fajr', platform });
      expect(availability.unavailableBecause).toBe('unsupported-platform');
      expect(availability.reason).not.toMatch(/licen/i);
    }
  });

  it('names every mode without ever calling a chime an adhān', () => {
    expect(prayerAlertModeLabel('notification-only')).toBe('Notification only');
    expect(prayerAlertModeLabel('notification-only')).not.toMatch(/adh|azan/i);
    expect(prayerAlertModeLabel('short-adhan')).toMatch(/adh/i);
    expect(prayerAlertModeLabel('full-adhan')).toMatch(/adh/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Selection and the effective mode
// ─────────────────────────────────────────────────────────────────────────────

describe('only an available mode may be selected', () => {
  it('permits notification-only everywhere and refuses both audio modes', () => {
    for (const platform of PLATFORMS) {
      for (const time of NOTIFIABLE_TIMES) {
        expect(isModeSelectable({ mode: 'notification-only', time, platform })).toBe(true);
        expect(isModeSelectable({ mode: 'short-adhan', time, platform })).toBe(false);
        expect(isModeSelectable({ mode: 'full-adhan', time, platform })).toBe(false);
      }
    }
  });
});

describe('a stored mode is re-checked rather than trusted', () => {
  it('degrades an unplayable stored mode to a notification', () => {
    /*
      The disguise this feature must not perform. A stored `full-adhan` — from a restored backup, a
      downgrade, or a platform that cannot honour it — must run as a notification, not as silence and
      not as a chime the screen calls an adhān.
    */
    for (const platform of PLATFORMS) {
      expect(effectiveMode({ stored: 'full-adhan', time: 'fajr', platform })).toBe(
        DEFAULT_PRAYER_ALERT_MODE,
      );
      expect(effectiveMode({ stored: 'short-adhan', time: 'fajr', platform })).toBe(
        DEFAULT_PRAYER_ALERT_MODE,
      );
    }
  });

  it('keeps a stored mode that is genuinely available', () => {
    const manifest = [recordingDouble({ purpose: 'fajr', id: 'double-fajr' })];
    expect(
      effectiveMode({
        stored: 'short-adhan',
        time: 'fajr',
        platform: 'android',
        hasLicensedAudio: licensedAudioLookup('android', manifest),
      }),
    ).toBe('short-adhan');
  });

  it('degrades rather than switching the alert off', () => {
    /* The user asked to be told about this prayer. Silence would answer a question nobody asked. */
    expect(effectiveMode({ stored: 'full-adhan', time: 'isha', platform: 'android' })).toBe(
      'notification-only',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage: the upgrade is inaudible
// ─────────────────────────────────────────────────────────────────────────────

describe('stored settings carry a mode without changing behaviour', () => {
  it('defaults to notification-only, which is what shipped before', () => {
    expect(DEFAULT_PRAYER_ALERT_MODE).toBe('notification-only');
    for (const time of NOTIFIABLE_TIMES) {
      expect(defaultAlertSettings(time).mode).toBe('notification-only');
    }
  });

  it('reads a record written before modes existed as the default', () => {
    /* No `mode` key: the pre-#178 record, which behaved exactly as notification-only. */
    const decoded = normaliseAlertSettings({
      time: 'maghrib',
      notify: true,
      repeatDays: [1, 2],
      preReminderMinutes: 10,
      sound: 'silent',
    });
    expect(decoded).toMatchObject({ mode: 'notification-only', sound: 'silent', notify: true });
  });

  it('refuses to trust an unrecognised stored mode', () => {
    /* A mode this build cannot name is one it certainly cannot play. */
    for (const mode of ['adhan', 'full', 'FULL_ADHAN', 42, null, {}]) {
      expect(normaliseAlertSettings({ time: 'asr', notify: true, mode })?.mode).toBe(
        'notification-only',
      );
    }
  });

  it('preserves a stored mode this build does recognise', () => {
    /*
      Kept as a *preference* even though it cannot run today — `effectiveMode` decides what plays. A
      user who chose short adhān before a licence lapsed should get it back when one returns, rather
      than silently reverting.
    */
    expect(normaliseAlertSettings({ time: 'asr', notify: true, mode: 'short-adhan' })?.mode).toBe(
      'short-adhan',
    );
  });

  it('recognises exactly the three modes', () => {
    expect(PRAYER_ALERT_MODES).toEqual(['notification-only', 'short-adhan', 'full-adhan']);
    for (const mode of PRAYER_ALERT_MODES) {
      expect(isPrayerAlertMode(mode)).toBe(true);
    }
    /* `off` is `notify: false` and deliberately not a mode — two spellings of one fact. */
    expect(isPrayerAlertMode('off')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The write decision, and that the hook routes through it
// ─────────────────────────────────────────────────────────────────────────────

describe('the stored mode is decided by nextStoredMode', () => {
  it('accepts an available request', () => {
    expect(
      nextStoredMode({
        current: 'notification-only',
        requested: 'notification-only',
        time: 'fajr',
        platform: 'android',
      }),
    ).toBe('notification-only');
  });

  it.each(['short-adhan', 'full-adhan'] as const)(
    'refuses %s and keeps the current mode',
    (requested) => {
      for (const platform of PLATFORMS) {
        expect(
          nextStoredMode({ current: 'notification-only', requested, time: 'fajr', platform }),
        ).toBe('notification-only');
      }
    },
  );

  it('keeps a working preference rather than resetting it on a refused tap', () => {
    /*
      A refused request is not a request to change to the default. Somebody with a working short
      adhān who taps the unavailable full adhān must not lose what they had.
    */
    const manifest = [recordingDouble({ purpose: 'fajr', id: 'double-fajr' })];
    expect(
      nextStoredMode({
        current: 'short-adhan',
        requested: 'full-adhan',
        time: 'fajr',
        platform: 'android',
        hasLicensedAudio: licensedAudioLookup('android', manifest),
      }),
    ).toBe('short-adhan');
  });

  it('accepts a request that a manifest genuinely licenses', () => {
    const manifest = [recordingDouble({ purpose: 'fajr', id: 'double-fajr' })];
    expect(
      nextStoredMode({
        current: 'notification-only',
        requested: 'short-adhan',
        time: 'fajr',
        platform: 'android',
        hasLicensedAudio: licensedAudioLookup('android', manifest),
      }),
    ).toBe('short-adhan');
  });

  it('is what the settings hook writes through', () => {
    /*
      A source assertion, and an unusual one — justified because the behaviour it protects was
      provably invisible to every rendering test. `setMode` must not assign a mode directly; it must
      route through the decision above. Verified to bite by deleting the call, which fails this.
    */
    const hook = readFileSync(
      join(process.cwd(), 'src/features/faith/hooks/use-prayer-notifications.ts'),
      'utf8',
    );
    expect(hook).toMatch(/mode:\s*nextStoredMode\(\{/);
    /* And nowhere assigns the requested mode straight into the settings. */
    expect(hook).not.toMatch(/\.\.\.settings,\s*mode\s*\}/);
  });
});
