import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The rejected playback architecture may not come back.
 *
 * ── What it was ─────────────────────────────────────────────────────────────
 * Recitation played through **one player whose source was replaced per ayah**:
 *
 * ```ts
 * const player = useAudioPlayer(uri === null ? null : { uri });
 * ```
 *
 * `useAudioPlayer` keys on `JSON.stringify(source)`, so each verse constructed a new native player.
 * Every boundary cost a JavaScript decision, sometimes a network fetch, a native teardown, a native
 * construction and a load — between two verses of the Qur'an, audibly.
 *
 * It is replaced by one surah-scoped `AudioPlaylist` advanced natively. That is a property of the
 * *shape* of the code, not of any single behaviour, which is why it is guarded by a scan: a future
 * change could reintroduce per-ayah sources without failing a behavioural test, because the audible
 * cost lives on a device and not in Jest.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * The Faith recitation path only. Nothing here restricts `useAudioPlayer` elsewhere in the app —
 * it is the right API for a single sound, and the Tasbih and notification surfaces are free to use
 * it. The rule is about *ayah progression*.
 */

const FAITH_ROOT = join(__dirname, '..');

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

const FAITH_SOURCE = sourceFiles(FAITH_ROOT);
const show = (path: string): string => relative(FAITH_ROOT, path).replace(/\\/g, '/');

describe('the reader plays from a playlist, not from a swapped source', () => {
  it('creates no per-ayah audio player anywhere in Faith', () => {
    /*
      `useAudioPlayer` is the API whose source key *is* the identity of the native object. One call
      per ayah is the defect; there is no correct use of it on the recitation path, so the rule is a
      flat absence rather than a count.

      Matched on the **import** rather than on the name: the transport's own header quotes the old
      call to explain what it replaced, and a scan that could not tell prose from code would force
      the explanation out of the file that most needs it. Nothing can call the hook without importing
      it, so this is the same guarantee with none of that cost.
    */
    const imports = /import\s*\{[^}]*\buseAudioPlayer\b[^}]*\}\s*from\s*['"]expo-audio['"]/;
    const offenders = FAITH_SOURCE.filter((path) => imports.test(readFileSync(path, 'utf8')));
    expect(offenders.map(show)).toEqual([]);
  });

  it('replaces no player source for progression', () => {
    /*
      `player.replace(...)` is the other route to the same defect: same native object, new source,
      same load between two verses. `AudioPlaylist` has no `replace`, so any appearance of one here
      would be a hand-rolled progression.
    */
    const offenders = FAITH_SOURCE.filter((path) =>
      /\.replace\(\s*\{\s*uri/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders.map(show)).toEqual([]);
  });

  it('keeps exactly one playlist hook call on the recitation path', () => {
    const users = FAITH_SOURCE.filter((path) =>
      /\buseAudioPlaylist\b/.test(readFileSync(path, 'utf8')),
    );
    /* One transport owns the queue. Two would be two native players competing for the same audio. */
    expect(users.map(show)).toEqual(['hooks/use-recitation-player.ts']);
  });

  it('advances only from trackChanged', () => {
    const transport = readFileSync(join(FAITH_ROOT, 'hooks', 'use-recitation-player.ts'), 'utf8');

    /*
      `didJustFinish` is still read — for the terminal "the surah ended" state — so its presence is
      not the test. What must not exist is a *second* advancement: the old build moved the transport
      from the finished flag, and needed a minted token per selection to stop one completion being
      honoured twice.
    */
    expect(transport).toContain("addListener('trackChanged'");
    expect(transport).not.toMatch(/setCurrentIndex\(\s*currentIndex\s*\+\s*1\s*\)/);
    expect(transport).not.toMatch(/didJustFinish[\s\S]{0,200}?\bplay\(/);
  });

  it('queues only local files', () => {
    const playlist = readFileSync(
      join(FAITH_ROOT, 'data', 'audio', 'recitation-playlist.ts'),
      'utf8',
    );
    /*
      The build refuses a source without a validated local URI. A queue holding a remote URL would
      stall the native player at a verse boundary — the exact cost this architecture removes — and
      would also put a CDN address into a native object this app does not control.
    */
    expect(playlist).toContain('no-local-audio');
    expect(playlist).not.toMatch(/https?:/);
  });

  it('logs no audio URL and no verse content from the audio path', () => {
    const audioPath = FAITH_SOURCE.filter((path) => /[/\\]audio[/\\]/.test(path));
    for (const path of audioPath) {
      const text = readFileSync(path, 'utf8');
      /* Nothing on this path may print — a URL here is a signed CDN address. */
      expect({ file: show(path), logs: /console\.(log|warn|error|info)/.test(text) }).toEqual({
        file: show(path),
        logs: false,
      });
    }
  });
});
