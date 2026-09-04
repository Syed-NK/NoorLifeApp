import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  currentPrayerAlertSound,
  fullAdhanAvailability,
  prayerAlertChannelId,
  prayerAlertSoundFile,
  prayerAlertSoundLabel,
  PRAYER_ALERT_SILENT_CHANNEL_ID,
} from '../data/notifications/prayer-alert-sound';
import { canEverPlayFullAdhan } from '../data/notifications/prayer-alert-preferences';

/**
 * **No adhān audio enters this package until one is licensed** — issue #42.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why an asset scan, when a unit test already covers the seam ────────────
 * `prayer-alert-settings.test.ts` proves the *decision*: `currentPrayerAlertSound()` returns the
 * platform default, so the full-adhān row stays disabled. That is a test over a pure function, and
 * it stays green no matter what is sitting in the repository.
 *
 * The thing #42 actually guards is not a function's return value — it is that **no recording is
 * shipped**. Today that is true, and nothing enforced it: dropping `azan.wav` into `assets/` and
 * naming it in the `expo-notifications` plugin's `sounds` array would have bundled an unlicensed
 * recording into the binary with every existing test still passing. The licence control was a
 * convention held up by review.
 *
 * So this file scans the surfaces an asset can actually arrive through, verified against the
 * installed plugin rather than guessed:
 *
 *   • `sounds` in the `expo-notifications` config — the supported route on both platforms. On
 *     Android `withNotificationsAndroid` copies each entry into `android/app/src/main/res/raw`; on
 *     iOS `withNotificationsIOS` adds them as bundle resources.
 *   • `android/app/src/main/res/raw` itself, which is that copy's destination and can also be
 *     committed directly.
 *   • every tracked file, by extension **and by magic bytes**, because a recording committed as
 *     `tone.bin` is still a recording.
 *
 * ── What this file deliberately does not do ────────────────────────────────
 * It makes no claim about whether any particular recording *could* be licensed, and it is not a
 * substitute for the evidence #42 §6 requires. It fails closed on audio arriving; a licensed asset
 * is admitted by changing this file deliberately, alongside the licence record — which is the point,
 * because that edit is the review.
 *
 * It also asserts nothing about Qur'an recitation, which is a different licence, a different
 * storage root and downloaded at runtime rather than bundled. Recitation is covered by
 * `QURAN_FOUNDATION_AUDIO_PERMISSION.md` and must never be reused as an adhān.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ROOT = process.cwd();

/** Container extensions that carry audio. Matched case-insensitively on the tracked file list. */
const AUDIO_EXTENSIONS = [
  '.wav',
  '.mp3',
  '.caf',
  '.aiff',
  '.aif',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
  '.amr',
  '.mid',
  '.midi',
  '.wma',
  '.3gp',
] as const;

/**
 * Leading bytes that identify an audio container regardless of its name.
 *
 * The extension list alone is a name check, and a name is the easiest thing to change. These are the
 * signatures for the formats either platform will actually play as a notification tone.
 */
const AUDIO_MAGIC: readonly { readonly label: string; readonly bytes: readonly number[] }[] = [
  { label: 'RIFF/WAV', bytes: [0x52, 0x49, 0x46, 0x46] },
  { label: 'MP3 (ID3)', bytes: [0x49, 0x44, 0x33] },
  { label: 'MP3 (frame sync)', bytes: [0xff, 0xfb] },
  { label: 'OGG', bytes: [0x4f, 0x67, 0x67, 0x53] },
  { label: 'FLAC', bytes: [0x66, 0x4c, 0x61, 0x43] },
  { label: 'AIFF/FORM', bytes: [0x46, 0x4f, 0x52, 0x4d] },
  { label: 'AMR', bytes: [0x23, 0x21, 0x41, 0x4d] },
  { label: 'CAF', bytes: [0x63, 0x61, 0x66, 0x66] },
];

/** Whether the head of a file looks like an audio container. Pure, so it is unit-testable below. */
export function audioSignature(head: Uint8Array): string | null {
  for (const { label, bytes } of AUDIO_MAGIC) {
    if (bytes.every((byte, index) => head[index] === byte)) {
      return label;
    }
  }
  /* ISO base media (m4a, mp4, 3gp) carries `ftyp` at offset four rather than at the start. */
  const ftyp = [0x66, 0x74, 0x79, 0x70];
  if (ftyp.every((byte, index) => head[index + 4] === byte)) {
    return 'ISO-BMFF (ftyp)';
  }
  return null;
}

/**
 * Whether a source file *builds* a bundled-azan sound, as opposed to declaring or comparing one.
 *
 * The distinction is the whole value of the check. `prayer-alert-sound.ts` legitimately declares the
 * variant — `readonly kind: 'bundled-azan';` — and legitimately compares against it, and a naive
 * search for the literal flags its own type definition. What must not exist is a *construction*:
 * an object literal that hands the rest of the app a sound naming a file.
 *
 * So type members are dropped first, then the literal is looked for in a value position.
 */
export function constructsBundledAzan(source: string): boolean {
  return source
    .split(/\r?\n/)
    .filter((line) => !/readonly\s+kind\s*:/.test(line))
    .some((line) => /kind\s*:\s*['"]bundled-azan['"]/.test(line));
}

/** Whether a path ends in a known audio container extension. */
export function hasAudioExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Every file git tracks.
 *
 * The tracked list rather than a directory walk: an untracked working-tree file is not in anybody's
 * build, and walking would drag in `node_modules` and gigabytes of Gradle output. `-z` so a path
 * containing a space or a quote is not re-split.
 */
function trackedFiles(): readonly string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return out
    .toString('utf8')
    .split('\0')
    .filter((path) => path.length > 0);
}

function readHead(path: string, bytes = 16): Uint8Array {
  const buffer = Buffer.alloc(bytes);
  const handle = readFileSync(join(ROOT, path));
  handle.copy(buffer, 0, 0, Math.min(bytes, handle.length));
  return new Uint8Array(buffer);
}

function notificationsPluginOptions(): Record<string, unknown> {
  const config = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
    expo: { plugins: unknown[]; notification?: unknown };
  };
  const entry = config.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
  );
  return Array.isArray(entry) && typeof entry[1] === 'object' && entry[1] !== null
    ? (entry[1] as Record<string, unknown>)
    : {};
}

// ─────────────────────────────────────────────────────────────────────────────
// The scanner itself, against stated bytes
// ─────────────────────────────────────────────────────────────────────────────

describe('the audio scanner recognises what it claims to', () => {
  const head = (...bytes: number[]): Uint8Array => {
    const buffer = new Uint8Array(16);
    bytes.forEach((byte, index) => {
      buffer[index] = byte;
    });
    return buffer;
  };

  it.each([
    ['RIFF/WAV', [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]],
    ['MP3 (ID3)', [0x49, 0x44, 0x33, 0x03]],
    ['MP3 (frame sync)', [0xff, 0xfb, 0x90]],
    ['OGG', [0x4f, 0x67, 0x67, 0x53]],
    ['FLAC', [0x66, 0x4c, 0x61, 0x43]],
    ['AIFF/FORM', [0x46, 0x4f, 0x52, 0x4d]],
    ['AMR', [0x23, 0x21, 0x41, 0x4d]],
    ['CAF', [0x63, 0x61, 0x66, 0x66]],
  ])('detects %s however the file is named', (label, bytes) => {
    /*
      Stated bytes, not a fixture file. Committing even a synthetic recording to exercise this would
      put an audio file in the repository the scan below then has to be taught to ignore — an
      exception that is exactly the shape of the thing being guarded against.
    */
    expect(audioSignature(head(...bytes))).toBe(label);
  });

  it('detects an ISO container from its ftyp box at offset four', () => {
    expect(
      audioSignature(head(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41)),
    ).toBe('ISO-BMFF (ftyp)');
  });

  it('passes text, PNG and TTF, so the scan below is not vacuous', () => {
    /* PNG magic, a TTF/OTF version tag, and ordinary source text. */
    expect(audioSignature(head(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(audioSignature(head(0x00, 0x01, 0x00, 0x00))).toBeNull();
    expect(audioSignature(head(0x69, 0x6d, 0x70, 0x6f, 0x72, 0x74))).toBeNull();
  });

  it('recognises audio extensions, and does not over-match', () => {
    expect(hasAudioExtension('assets/azan.wav')).toBe(true);
    expect(hasAudioExtension('assets/AZAN.MP3')).toBe(true);
    expect(hasAudioExtension('src/waveform.ts')).toBe(false);
    expect(hasAudioExtension('docs/midinotes.md')).toBe(false);
  });

  it('separates constructing a bundled recording from declaring or comparing one', () => {
    /*
      Stated inputs, because the real assertion below reads the tree and would otherwise be proving
      only that today's tree happens to be clean. These four lines are the cases that matter.
    */
    const declaration = "  readonly kind: 'bundled-azan';";
    const comparison = "  return sound.kind === 'bundled-azan' ? a : b;";
    const construction = "  return { kind: 'bundled-azan', file: 'azan.wav', label: 'Makkah' };";
    const spaced = '  return { kind :  "bundled-azan" };';

    expect(constructsBundledAzan(declaration)).toBe(false);
    expect(constructsBundledAzan(comparison)).toBe(false);
    expect(constructsBundledAzan(construction)).toBe(true);
    expect(constructsBundledAzan(spaced)).toBe(true);
    /* And the real declaring module is not itself an offender. */
    expect(
      constructsBundledAzan(
        readFileSync(
          join(ROOT, 'src/features/faith/data/notifications/prayer-alert-sound.ts'),
          'utf8',
        ),
      ),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing is tracked, configured or committed
// ─────────────────────────────────────────────────────────────────────────────

describe('no audio is tracked in this repository', () => {
  it('tracks no file with an audio extension', () => {
    const offenders = trackedFiles().filter(hasAudioExtension);
    expect(offenders).toEqual([]);
  });

  it('tracks no file whose bytes are an audio container, whatever it is called', () => {
    /*
      The rename case. Scoped to files small enough to be a notification tone and to the directories
      an asset would plausibly land in, so this stays a fast check rather than reading the tree.
    */
    const candidates = trackedFiles().filter(
      (path) =>
        (path.startsWith('assets/') ||
          path.startsWith('android/app/src/') ||
          path.startsWith('src/features/faith/')) &&
        !path.endsWith('.ts') &&
        !path.endsWith('.tsx') &&
        !path.endsWith('.md'),
    );
    const offenders = candidates
      .map((path) => ({ path, signature: audioSignature(readHead(path)) }))
      .filter((entry) => entry.signature !== null);
    expect(offenders).toEqual([]);
  });
});

describe('the notification configuration registers no sound', () => {
  it('declares no sounds array for expo-notifications', () => {
    /*
      The supported bundling route on both platforms. An entry here is copied into
      `android/app/src/main/res/raw` and added to the iOS bundle at prebuild, so it is the one line
      that turns an asset in the tree into an asset in the binary.
    */
    const options = notificationsPluginOptions();
    expect(options.sounds).toBeUndefined();
  });

  it('declares no top-level notification sound', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
      expo: { notification?: { sound?: unknown } };
    };
    expect(config.expo.notification?.sound).toBeUndefined();
  });

  it('commits no Android raw resource directory holding audio', () => {
    /*
      Checked even though the directory is absent today: this is where the plugin writes, and it is
      also the one place an asset can be committed without touching `app.json` at all.
    */
    const raw = join(ROOT, 'android', 'app', 'src', 'main', 'res', 'raw');
    if (!existsSync(raw)) {
      expect(existsSync(raw)).toBe(false);
      return;
    }
    const offenders = readdirSync(raw).filter((name) => {
      const path = join(raw, name);
      if (!statSync(path).isFile()) {
        return false;
      }
      const buffer = readFileSync(path);
      const head = new Uint8Array(buffer.subarray(0, 16));
      return hasAudioExtension(name) || audioSignature(head) !== null;
    });
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The seam stays dormant, and the documents stay truthful
// ─────────────────────────────────────────────────────────────────────────────

describe('the prayer alert sound is still the platform default', () => {
  it('resolves to the platform default, so no channel names a file', () => {
    expect(currentPrayerAlertSound()).toEqual({ kind: 'platform-default' });
    expect(prayerAlertSoundFile()).toBeNull();
    expect(prayerAlertChannelId()).toBe('prayer-alerts-v1-default');
    /* The silent channel is unrelated to licensing and must survive this guard unchanged. */
    expect(PRAYER_ALERT_SILENT_CHANNEL_ID).toBe('prayer-alerts-v1-silent');
  });

  it('never calls the system sound an adhān', () => {
    expect(prayerAlertSoundLabel()).toBe('Default notification sound');
    expect(prayerAlertSoundLabel()).not.toMatch(/adh|azan|athan/i);
  });

  it('reports the full adhān as unavailable, and says why without promising a date', () => {
    const availability = fullAdhanAvailability();
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/no licensed adh/i);
    expect(availability.reason).not.toMatch(/soon|shortly|next release|coming/i);
  });

  it('constructs a bundled recording nowhere in production code', () => {
    /*
      The variant exists on the type so the channel id and the label already account for it. Nothing
      may build one until an asset is licensed — this is what makes "unreachable" a property of the
      code rather than of the current absence of a file.
    */
    const sources = trackedFiles().filter(
      (path) =>
        path.startsWith('src/') &&
        (path.endsWith('.ts') || path.endsWith('.tsx')) &&
        !path.includes('__tests__'),
    );
    const offenders = sources.filter((path) =>
      constructsBundledAzan(readFileSync(join(ROOT, path), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps sunrise permanently incapable of an adhān', () => {
    /* #42 §3: not "not yet". Sunrise is a clock reading, so it may never announce a prayer. */
    expect(canEverPlayFullAdhan('sunrise')).toBe(false);
  });
});

describe('the licence record claims no adhān recording', () => {
  it('records no adhān audio licence, because none is held', () => {
    const licences = readFileSync(join(ROOT, 'docs', 'THIRD_PARTY_LICENCES.md'), 'utf8');
    /*
      The only `adhan` in this document is the MIT prayer-time calculation library. A line claiming a
      licensed recording, without the evidence #42 §6 requires, is the misleading-attribution failure
      this case exists to catch — so an added audio row has to arrive with a deliberate edit here.
    */
    const claimsRecording =
      /adh[aā]n[^|\n]*\|[^|\n]*\|[^|\n]*(recording|audio|muezzin|\.wav|\.mp3)/i;
    expect(licences).not.toMatch(claimsRecording);
    /* And the calculation library is still recorded, so this is not passing by an empty document. */
    expect(licences).toMatch(/`adhan`\s*\|\s*4\.\d+\.\d+\s*\|\s*MIT/);
  });
});
