import { Paths } from 'expo-file-system';

import {
  audioDirectoryFor,
  createExpoAudioStore,
  type AudioStoreKind,
} from '../data/audio/expo-audio-store';
import { audioFileName } from '../data/audio/audio-store.port';

/**
 * A deliberate download and a prepared file must never share a directory.
 *
 * ── What this protects ──────────────────────────────────────────────────────
 * NoorLife holds two kinds of recitation audio that are byte-identical and mean entirely different
 * things. A **prepared** file is a bounded, expiring copy fetched to play a surah now; the operating
 * system reclaiming it under storage pressure costs a re-fetch. A **downloaded** file is a surah the
 * user deliberately chose to keep, under the express permission that allows retention beyond one
 * week; the OS silently deleting that is a broken promise, and the user has no way to tell it
 * happened until they are offline and the audio is gone.
 *
 * The whole distinction rests on which parent directory a path is built from — one constant, one
 * character of difference between `Paths.cache` and `Paths.document`. That is far too quiet a thing
 * to leave to review, so it is asserted here: if a future edit points both stores at the same place,
 * this file fails rather than a user losing a download some weeks later.
 *
 * ── Why the same *name* on both sides is the interesting case ───────────────
 * `audioFileName` is deterministic — one reciter, surah and ayah always produce `r3-s93-a1.mp3`. So
 * the file name is guaranteed to collide; only the directory keeps the two apart. Every case below
 * uses the same name on purpose.
 */

const KINDS: readonly AudioStoreKind[] = ['prepared', 'downloaded'];

describe('the prepared cache and the download store are different places', () => {
  it('resolves the two kinds to different directories', () => {
    const prepared = audioDirectoryFor('prepared').uri;
    const downloaded = audioDirectoryFor('downloaded').uri;

    expect(prepared).not.toBe(downloaded);
  });

  it('puts only the prepared cache under the reclaimable cache directory', () => {
    /*
      Asserted against `Paths` itself rather than against a literal, so the case still means
      something if the platform changes what those directories are.
    */
    expect(audioDirectoryFor('prepared').uri.startsWith(Paths.cache.uri)).toBe(true);
    expect(audioDirectoryFor('downloaded').uri.startsWith(Paths.cache.uri)).toBe(false);
  });

  it('puts the download store under the persistent document directory', () => {
    expect(audioDirectoryFor('downloaded').uri.startsWith(Paths.document.uri)).toBe(true);
    expect(audioDirectoryFor('prepared').uri.startsWith(Paths.document.uri)).toBe(false);
  });

  it('gives neither store a path that contains the other', () => {
    /*
      Not the same assertion as "the URIs differ". `…/faith-recitations` and
      `…/faith-recitations/downloaded` are different strings, and an eviction sweep over the first
      would still delete everything in the second. Containment, in either direction, is the failure.
    */
    const prepared = audioDirectoryFor('prepared').uri;
    const downloaded = audioDirectoryFor('downloaded').uri;

    expect(downloaded.startsWith(`${prepared}/`)).toBe(false);
    expect(prepared.startsWith(`${downloaded}/`)).toBe(false);
  });

  it('keeps the same ayah in two separate files, one per store', () => {
    const name = audioFileName('3', 93, 1);
    const paths = KINDS.map((kind) => `${audioDirectoryFor(kind).uri}/${name}`);

    expect(name).toBe('r3-s93-a1.mp3');
    expect(new Set(paths).size).toBe(2);
  });

  it('builds a store for each kind, over its own directory', () => {
    /*
      The factory defaults to `prepared`, so every existing construction in the app keeps the
      behaviour it had before the split. A download manager has to ask for the other one explicitly,
      which is the right way round: persistence is the deliberate choice.
    */
    expect(createExpoAudioStore()).toBeTruthy();
    expect(createExpoAudioStore('downloaded')).toBeTruthy();
  });
});
