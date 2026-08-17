import { Directory, File, Paths } from 'expo-file-system';

import type { ManifestFilePort } from './offline-manifest.store';

/**
 * The offline recitation manifest, as one private file written atomically.
 *
 * ── Why the manifest sits beside the audio and not inside it ────────────────
 * `Paths.document/faith-offline-recitation/` holds the manifest; the audio files live in
 * `faith-recitations-downloaded/`. Separate directories so that "remove every downloaded file" is a
 * sweep of one directory that cannot accidentally take the index with it, and so a directory listing
 * used to reconcile against the manifest never has to skip the manifest itself.
 *
 * Both are under `Paths.document`, which on Android is the app-internal files directory. Not
 * `MediaStore`, not shared storage, not external storage, not a cache the OS may reclaim. Licence
 * condition C1 — audio remains in private application storage — is a property of that path, and
 * `offline-audio-native-boundary.test.ts` asserts no other path constructor appears in this feature.
 *
 * ── The write is the same shape a generation uses, for the same reason ──────
 * Write to `.part`, reopen it and compare what came back, then rename over the live name. A rename
 * within one directory is atomic on both platforms' filesystems, so a reader sees the previous whole
 * document or the next whole document. Comparing after the write is what catches a filesystem that
 * reported success and stored nothing — which is not hypothetical on a device that has just run out
 * of space, and which would otherwise leave the in-memory manifest permanently ahead of the disk.
 *
 * ── Nothing here logs ───────────────────────────────────────────────────────
 * Not a path, not a byte count, not a failure. The same rule `expo-audio-store.ts` follows: the
 * simplest way to guarantee a module never writes something sensitive to a log is for it to have no
 * logger and no `console` call.
 */

const MANIFEST_DIRECTORY = 'faith-offline-recitation';
const MANIFEST_FILE = 'manifest.json';
const PART_SUFFIX = '.part';

/** Exported so the boundary test can assert the path without reaching into a private constant. */
export function offlineManifestDirectory(): Directory {
  return new Directory(Paths.document, MANIFEST_DIRECTORY);
}

function ensureDirectory(): Directory {
  const directory = offlineManifestDirectory();
  /*
    `idempotent` rather than check-then-create: the check and the create are two calls with a gap
    between them, and the store's queue does not serialise against a *different* process — an app
    upgrade's first launch can race its own restore.
  */
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

export function createExpoManifestFile(): ManifestFilePort {
  return {
    read(): string | null {
      try {
        const file = new File(offlineManifestDirectory(), MANIFEST_FILE);
        return file.exists ? file.textSync() : null;
      } catch {
        /* Unreadable is indistinguishable from absent for the store's purpose. */
        return null;
      }
    },

    write(text: string): boolean {
      try {
        const directory = ensureDirectory();
        const partial = new File(directory, `${MANIFEST_FILE}${PART_SUFFIX}`);
        if (partial.exists) {
          partial.delete();
        }
        partial.create();
        partial.write(text);
        if (partial.textSync() !== text) {
          /* Reported success, stored something else. Discarded rather than promoted. */
          partial.delete();
          return false;
        }
        const target = new File(directory, MANIFEST_FILE);
        if (target.exists) {
          /*
            `moveSync` onto an existing name is not defined to overwrite on every platform, so the
            previous document is removed first. The window this opens is between two synchronous
            filesystem calls and is covered by the same recovery every other loss of the manifest is:
            the bytes on disk are the durable fact, and the disk reconciliation rebuilds the index.
          */
          target.delete();
        }
        partial.moveSync(target);
        return true;
      } catch {
        return false;
      }
    },

    remove(): void {
      try {
        const directory = offlineManifestDirectory();
        if (!directory.exists) {
          return;
        }
        for (const entry of directory.list()) {
          if (!(entry instanceof Directory)) {
            entry.delete();
          }
        }
      } catch {
        /* Best-effort. A manifest that will not delete is not actionable here. */
      }
    },
  };
}
