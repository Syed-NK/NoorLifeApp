import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Properties of the offline audio feature that live in the *shape* of the code, not in a behaviour.
 *
 * ── Why a scan and not a test ───────────────────────────────────────────────
 * Each rule below can be broken by an edit that every behavioural test still passes, because the
 * damage is invisible in Jest and lands on a device or in a log file: a vendor URL written to a
 * manifest that survives reboots, a file promoted into shared storage, a `console.log` beside a
 * signed CDN path, a second download authority quietly reintroduced. A scan is the only thing that
 * fails at the moment the shape changes.
 */

const FAITH = join(__dirname, '..');

function sourceFiles(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__') {
        found.push(...sourceFiles(path));
      }
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

const FAITH_SOURCE = sourceFiles(FAITH);
const show = (path: string): string => relative(FAITH, path).replace(/\\/g, '/');

/** Source with comments removed, so prose explaining a rule cannot violate it. */
function code(...segments: string[]): string {
  return readFileSync(join(FAITH, ...segments), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Every offline-audio module, as code. The set the strict rules apply to. */
const OFFLINE_MODULES: readonly (readonly string[])[] = [
  ['storage', 'faith-offline-recitation.ts'],
  ['data', 'audio', 'offline-manifest.store.ts'],
  ['data', 'audio', 'expo-manifest-file.ts'],
  ['data', 'audio', 'offline-download.service.ts'],
  ['data', 'audio', 'offline-estimate.ts'],
  ['data', 'audio', 'offline-reconcile.ts'],
  ['data', 'audio', 'offline-migration.ts'],
  ['data', 'audio', 'offline-adapters.ts'],
  ['data', 'audio', 'expo-audio-store.ts'],
  ['data', 'audio', 'audio-store.port.ts'],
  ['data', 'audio', 'recitation-playlist.ts'],
];

describe('there is exactly one download authority', () => {
  it('has retired the surah-level index and its manifest entirely', () => {
    /*
      ── Why both had to go, not one ───────────────────────────────────────────
      `faith-audio-downloads.ts` computed expiry as seven days from **download**, which deletes
      permitted recitation from a user who has been offline — precisely the user the extended-retention
      permission protects. `faith-audio-manifest.ts` was the per-ayah replacement that nothing at
      runtime ever read. Two authorities disagreeing about which bytes are playable is worse than
      either alone: a screen offers "Remove" for files that are gone, or a player refuses a file that
      is present and permitted.
    */
    for (const retired of [
      'faith-audio-downloads',
      'faith-audio-manifest',
      'manifest-migration',
      'recitation-audio',
      'recitation-preparation',
      'surah-preparation',
      'use-surah-downloads',
      'recitation-audio-context',
    ]) {
      const offenders = FAITH_SOURCE.filter(
        (path) =>
          readFileSync(path, 'utf8').includes(`from '${'.'}`) &&
          new RegExp(`from '[^']*${retired}'`).test(readFileSync(path, 'utf8')),
      ).map(show);
      expect(offenders).toEqual([]);
    }
  });

  it('reads recitation availability through the offline service and nowhere else', () => {
    /*
      A second place that decided "is this ayah on the device" would be a second authority by another
      name. `localUriFor` and `playableAyat` are the only accessors, and the playlist builder takes
      them as parameters rather than reaching for a store.
    */
    const playlist = code('data', 'audio', 'recitation-playlist.ts');
    expect(playlist).not.toMatch(/expo-file-system/);
    expect(playlist).not.toMatch(/AsyncStorage/);
  });
});

describe('no vendor URL is persisted, logged or named', () => {
  it('keeps every URL out of the durable manifest', () => {
    /*
      A CDN address can be rotated, re-signed or retired, so binding a downloaded file's durable
      identity to one would make that identity depend on a value the vendor may change without telling
      anybody — and would put a signed path fragment into a document that survives reboots and app
      upgrades.
    */
    const schema = code('storage', 'faith-offline-recitation.ts');
    expect(schema).not.toMatch(/\burl\b/i);
    expect(schema).not.toMatch(/\bhost\b/i);
    expect(schema).not.toMatch(/https?:/);
  });

  it('has no logging call anywhere on the offline audio path', () => {
    /*
      The download service and the adapters hold resolved vendor URLs in memory for the duration of one
      surah. The simplest way to guarantee a module never writes one to a log is for it to have no
      logger and no `console` call at all.
    */
    const offenders: string[] = [];
    for (const segments of OFFLINE_MODULES) {
      if (/\bconsole\s*\.|\bLogger\b|\breportError\b/.test(code(...segments))) {
        offenders.push(segments.join('/'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('carries no free-text field on any failure it surfaces', () => {
    /*
      Every failure this feature reports is a member of a closed set — `OfflineFailure`,
      `PlaybackBlock`, `AdoptionRejection`, `PlaylistBuildFailure`. None has a member capable of
      holding a URL, a host, a path or a transport message, so nothing from the CDN can reach a screen
      even if a future edit tried to pass it along.
    */
    const service = code('data', 'audio', 'offline-download.service.ts');
    expect(service).not.toMatch(/readonly message\s*:/);
    /*
      The engine does read `error.message`, and that is deliberate: the store throws two sentinels of
      its own — `invalid` and `cancelled` — and telling them apart is how a body that was not audio is
      distinguished from a deliberate abort. What must never happen is that value *travelling*, so the
      rule is that it may be compared and may not be interpolated, returned or stored.
    */
    expect(service).not.toMatch(/\$\{[^}]*message/);
    /* Never returned as a value, never carried on an object, never interpolated. */
    expect(service).not.toMatch(/return\s+message\b/);
    expect(service).not.toMatch(/:\s*message\b/);
    expect(service).not.toMatch(/\bmessage\s*[,}]/);
  });
});

describe('private application storage only', () => {
  it('names no shared, external or exported storage anywhere in the feature', () => {
    /*
      Licence condition C1. `Paths.document` on Android is the app-internal files directory; every
      other destination below either exposes the file to other applications or puts it somewhere the
      user or another app can copy it out of.
    */
    const forbidden = [
      /MediaStore/,
      /getExternalStorage/i,
      /ExternalDirectory/,
      /\bDownloads?Directory\b/,
      /Sharing\./,
      /shareAsync/,
      /expo-sharing/,
      /createDownloadResumable/,
      /content:\/\//,
    ];
    const offenders: string[] = [];
    for (const path of FAITH_SOURCE) {
      const text = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (forbidden.some((pattern) => pattern.test(text))) {
        offenders.push(show(path));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('writes audio through exactly one directory helper', () => {
    /*
      One helper, one review. A second `new Directory(...)` for audio would be a second place the
      storage decision is made, and the two would drift.
    */
    const store = code('data', 'audio', 'expo-audio-store.ts');
    expect(store.match(/new Directory\(/g) ?? []).toHaveLength(2);
    expect(store).toMatch(/Paths\.document/);
    expect(store).toMatch(/Paths\.cache/);
  });
});

describe('nothing spends the user’s storage or data by itself', () => {
  it('never calls start, resume or prepare from an effect', () => {
    /*
      ── Locked decision 4, as a property of the code ──────────────────────────
      A complete recitation is a decision about somebody's storage and their data allowance. There is
      no effect, no timer and no sign-in hook that begins one — the only callers of `start` are a
      control the user pressed, and `resume` continues a scope they already chose.
    */
    const provider = code('di', 'offline-recitation-context.tsx');
    expect(provider).not.toMatch(/\.start\(/);
    expect(provider).not.toMatch(/\.resume\(/);
    expect(provider).not.toMatch(/\.prepare\(/);
  });

  it('starts a download only from a screen', () => {
    const callers = FAITH_SOURCE.filter((path) => {
      const text = code(...relative(FAITH, path).split(/[\\/]/));
      return /\bservice\.start\(|\bofflineservice\.start\(/i.test(text);
    }).map(show);

    /* Screens only — never a hook, a provider, a repository or a data module. */
    for (const caller of callers) {
      expect(caller.startsWith('screens/')).toBe(true);
    }
  });
});

describe('the permission is never widened', () => {
  it('decides permanent retention in exactly one place', () => {
    const deciders = FAITH_SOURCE.filter((path) =>
      /permanentDownloadPermitted\s*\(\s*resourceId/.test(readFileSync(path, 'utf8')),
    ).map(show);
    expect(deciders).toEqual(['storage/faith-offline-recitation.ts']);
  });

  it('binds the manifest to resource 3 as a constant, not a parameter', () => {
    const schema = code('storage', 'faith-offline-recitation.ts');
    expect(schema).toMatch(/PERMITTED_RESOURCE_ID = 3/);
    /*
      The stop gate: no permanent-download behaviour may apply to another reciter. There is no
      configuration value, flag or argument on this service through which one could acquire it.
    */
    const service = code('data', 'audio', 'offline-download.service.ts');
    expect(service).not.toMatch(/resourceId\s*:\s*number\s*[,)]/);
  });

  it('states the required attribution in exactly one place', () => {
    const holders = FAITH_SOURCE.filter((path) =>
      readFileSync(path, 'utf8').includes('Audio provided by Quran Foundation'),
    ).map(show);
    expect(holders).toEqual(['data/quran-foundation/recitation-attribution.ts']);
  });
});

describe('no fabricated measurement reaches a screen', () => {
  it('claims nothing about how playback sounds, anywhere in the feature', () => {
    /*
      "Gapless" and "seamless" are measurements, not architectures. What can be claimed is that
      playback is sourced from local files; how a transition is *heard* is a device measurement, and it
      belongs in a verification record rather than in a caption.
    */
    /*
      Comments stripped, so a note explaining *why* the word is banned does not itself trip the ban.
      The same treatment the architecture scan gives its own rule, and for the same reason: forcing
      the explanation out of the file that most needs it is a worse outcome than the rule being
      slightly harder to write.
    */
    const offenders = FAITH_SOURCE.filter((path) => {
      const text = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return /\bgapless\b|\bseamless\b/i.test(text);
    }).map(show);
    expect(offenders).toEqual([]);
  });

  it('derives every size bound from published data rather than from a constant', () => {
    /*
      The estimator may hold thresholds — a safety margin, a floor — but never a per-ayah or total
      size. A constant like `AVERAGE_AYAH_BYTES` is how "estimated 562 MB" becomes an invention with
      the typography of a measurement.
    */
    const estimate = code('data', 'audio', 'offline-estimate.ts');
    expect(estimate).not.toMatch(/AVERAGE|TYPICAL|APPROX/i);
    expect(estimate).not.toMatch(/6236|6,236/);
  });

  it('keeps the test-only ayah-count table out of the shipped feature', () => {
    /*
      Production derives every ayah count from the published generation, because the one thing that
      can say how many verses resource 3 publishes for a surah is the publication itself. The table in
      `test-support` is an independent witness for the suites; a feature that imported it would be
      checking the publisher against a copy of the answer.
    */
    const offenders = FAITH_SOURCE.filter((path) =>
      /quran-ayah-counts/.test(readFileSync(path, 'utf8')),
    ).map(show);
    expect(offenders).toEqual([]);
  });
});

describe('the docked player is playback-only', () => {
  it('holds no download, remove or storage control', () => {
    const player = code('components', 'reader', 'quran-audio-player.tsx');
    /*
      Locked decision 5. The control this replaced cycled Download / Cancel / Remove / Retry / Finish
      across a six-state union — five of those are about storage rather than listening, and none
      belongs on the surface somebody reaches for mid-recitation.
    */
    expect(player).not.toMatch(/onDownload|onRemove|onCancelDownload/);
    expect(player).not.toMatch(/formatDate\s*\(/);
  });

  it('reaches offline management by navigation and nothing else', () => {
    const player = code('components', 'reader', 'quran-audio-player.tsx');
    expect(player).toMatch(/onManageOfflineAudio/);
    /* It navigates; it does not touch the service. */
    expect(player).not.toMatch(/useOfflineRecitation/);
  });
});
