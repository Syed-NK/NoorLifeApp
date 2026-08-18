import { Directory, File, FileMode, Paths } from 'expo-file-system';

import {
  audioFileName,
  isPartialName,
  isPlausibleAudio,
  MIN_AUDIO_BYTES,
  partialFileName,
  type AudioDownloadRequest,
  type AudioStore,
  type StoredAudioFile,
} from './audio-store.port';

/**
 * The `expo-file-system` implementation of the audio store.
 *
 * ── Two stores, and the platform distinction that separates them ────────────
 * `Paths.cache` is storage the operating system may reclaim under pressure; `Paths.document` is
 * storage it will not. Recitation audio needs **both**, because NoorLife holds two different things
 * that happen to be the same file format:
 *
 *   • **prepared** — fetched to play a surah now, or prefetched a few ayat ahead. A bounded,
 *     expiring copy of vendor content, subject to `MAX_PREPARED_BYTES`. The OS reclaiming it costs
 *     a re-fetch and nothing else, so it belongs in the cache directory and asks for no protection.
 *
 *   • **downloaded** — a surah the user deliberately chose to keep, under the express permission
 *     that allows retention beyond one week. The OS silently deleting *that* is a broken promise to
 *     the user, so it belongs in the document directory. It is still private application storage —
 *     `Paths.document` on Android is the app-internal files directory, not a shared media store —
 *     so licence condition C1 holds for both.
 *
 * The two directories are siblings by name and must never resolve to the same path. That is
 * asserted by `quran-audio-store-boundary.test.ts` rather than left to the reading of a constant:
 * a single-character edit could otherwise put deliberate downloads back in purgeable storage, and
 * nothing would fail until a user lost a surah they had downloaded.
 *
 * ── Nothing here logs ───────────────────────────────────────────────────────
 * Not a URL, not a filename, not a byte count, not a failure. This module holds the one value in the
 * app that must never reach a log line — an audio URL, which for some hosts carries a signed path —
 * and the simplest way to guarantee it does not is for the module that holds it to have no logger
 * and no `console` call. Failures are returned to the caller as rejections carrying no message from
 * the transport.
 */

/**
 * Which of the two stores a file belongs to.
 *
 * Not a boolean. `prepared` and `downloaded` differ in lifetime, in eviction, in which licence
 * clause governs them and in what a user is owed when one disappears; a parameter named `persist`
 * would carry the storage decision and lose all of that.
 */
export type AudioStoreKind = 'prepared' | 'downloaded';

/** The prepared cache. Evictable, budgeted, cache directory. */
const PREPARED_DIRECTORY = 'faith-recitations';

/**
 * The deliberate-download store. Persistent, private, document directory.
 *
 * A different leaf name as well as a different parent, so that even a mistaken parent would not
 * make the two collide, and so a path seen in a crash report says which store it came from.
 */
const DOWNLOAD_DIRECTORY = 'faith-recitations-downloaded';

/** How much of the file is read to decide whether it is plausibly audio. */
const HEADER_BYTES = 16;

/**
 * The directory for one store kind.
 *
 * Exported so the boundary test can assert the two are distinct without reaching into a private
 * constant, and so nothing else in the app has to know which parent belongs to which kind.
 */
export function audioDirectoryFor(kind: AudioStoreKind): Directory {
  return kind === 'downloaded'
    ? new Directory(Paths.document, DOWNLOAD_DIRECTORY)
    : new Directory(Paths.cache, PREPARED_DIRECTORY);
}

/**
 * The directory, created if it is not there.
 *
 * `idempotent` rather than a check-then-create: the check and the create are two calls with a gap
 * between them, and two prepared ayat starting in the same tick would both see "absent" and both
 * create. `intermediates` covers a cache directory the OS has emptied down to nothing.
 */
function ensureDirectory(kind: AudioStoreKind): Directory {
  const directory = audioDirectoryFor(kind);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

/**
 * A file's metadata, or `null` when it is not something this store may serve.
 *
 * The size floor is applied here rather than only at download time, because a file can become
 * unusable after it was promoted: the OS can truncate a cache file under storage pressure, and a
 * crash between two writes can leave a short one. A read that returned it would hand the player a
 * file that fails to decode, and the retry would find the same short file again.
 */
function describe(file: File, name: string): StoredAudioFile | null {
  try {
    if (!file.exists) {
      return null;
    }
    const bytes = file.size;
    if (bytes < MIN_AUDIO_BYTES) {
      return null;
    }
    return {
      name,
      uri: file.uri,
      bytes,
      /**
       * `lastModified` is when the bytes were written, which is what the licence window is measured
       * from. `creationTime` is unavailable below Android API 26 and is not what expiry means
       * anyway. A file whose time cannot be read is treated as having been written now rather than
       * being dropped: it is a complete, validated file, and the ceiling will catch it a week later.
       */
      storedAt: file.lastModified ?? Date.now(),
    };
  } catch {
    // An unreadable file is operationally identical to an absent one for every caller here.
    return null;
  }
}

/**
 * Reads the first bytes of a file without loading it.
 *
 * `open`/`readBytes`/`close` rather than `bytes()`, which reads the whole file into JS memory. These
 * are 20–200 KB each and the check needs three of them, so reading the lot would move megabytes
 * across the bridge over a surah for a decision made on the first two bytes.
 */
function readHeader(file: File): Uint8Array {
  const handle = file.open(FileMode.ReadOnly);
  try {
    return handle.readBytes(HEADER_BYTES);
  } finally {
    handle.close();
  }
}

/** Removes a file, swallowing the failure. A file that will not delete is not actionable here. */
function discard(file: File): void {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort by design — see `AudioStore.remove`.
  }
}

/**
 * Builds a store over one of the two directories.
 *
 * The kind is taken at construction rather than per call: a store is handed to a preparation
 * engine or to a download manager and used many times, and a per-call parameter would let one
 * caller write a prepared file and read a downloaded one under the same name. Defaulted to
 * `'prepared'` so every existing construction keeps its present behaviour unchanged.
 */
export function createExpoAudioStore(kind: AudioStoreKind = 'prepared'): AudioStore {
  return {
    list(): readonly StoredAudioFile[] {
      try {
        const directory = audioDirectoryFor(kind);
        if (!directory.exists) {
          return [];
        }
        const files: StoredAudioFile[] = [];
        for (const entry of directory.list()) {
          if (entry instanceof Directory || isPartialName(entry.name)) {
            continue;
          }
          const described = describe(entry, entry.name);
          if (described !== null) {
            files.push(described);
          }
        }
        return files;
      } catch {
        return [];
      }
    },

    read(name: string): StoredAudioFile | null {
      try {
        return describe(new File(audioDirectoryFor(kind), name), name);
      } catch {
        return null;
      }
    },

    remove(name: string): void {
      try {
        discard(new File(audioDirectoryFor(kind), name));
      } catch {
        // Best-effort by design.
      }
    },

    /**
     * Download, validate, promote — in that order, and never in any other.
     *
     * ── Why the transfer never writes to the final name ─────────────────────────
     * `File.downloadFileAsync` streams the response body straight into the destination on Android,
     * and its own documentation says a failure part-way through can leave a partially written file
     * behind. If that destination were the name the player looks for, an interrupted download would
     * leave a truncated file that the next read finds, validates by existence alone, and hands to
     * the player as a recitation — silently replacing an ayah with two seconds of it.
     *
     * So the transfer writes to `<name>.part`, the completed bytes are validated, and only then is
     * the file moved onto the name the player uses. `move` within one directory is a rename, which
     * is atomic on both platforms' filesystems: at no instant does the final name refer to an
     * incomplete file.
     */
    async download(request: AudioDownloadRequest): Promise<StoredAudioFile> {
      const directory = ensureDirectory(kind);
      const partial = new File(directory, partialFileName(request.name));
      const target = new File(directory, request.name);

      // A partial from a previous, interrupted attempt. Resuming it is not attempted: the two
      // transfers may be different ranges of different CDN responses, and appending one to the
      // other produces a file that passes every check and plays as noise.
      discard(partial);

      try {
        await File.downloadFileAsync(request.url, partial, {
          idempotent: true,
          signal: request.signal,
          ...(request.onProgress === undefined
            ? {}
            : {
                onProgress: ({ bytesWritten, totalBytes }) => {
                  request.onProgress?.(
                    // `-1` is the documented value for "the server sent no Content-Length".
                    totalBytes > 0 ? Math.min(bytesWritten / totalBytes, 1) : null,
                  );
                },
              }),
        });
      } catch (error) {
        discard(partial);
        throw error;
      }

      /**
       * Aborted after the bytes landed but before promotion.
       *
       * The signal can fire in the window between the transfer resolving and this line, and honouring
       * it here rather than promoting anyway is what makes "changing surah cancels obsolete
       * preparation" true of the *disk* and not only of the request.
       */
      if (request.signal.aborted) {
        discard(partial);
        throw new Error('cancelled');
      }

      let valid = false;
      try {
        valid = isPlausibleAudio(readHeader(partial), partial.size);
        /*
          ── The publisher's size, where the publisher gave one ──────────────────
          Checked here rather than after the rename, so a transfer that produced the right kind of
          bytes in the wrong quantity never occupies the name a player reads. A truncated response
          that happens to begin with a valid MPEG frame header passes the signature check and would
          otherwise be promoted as a recitation that stops part-way through the verse.

          Only an exact match is accepted. A tolerance would have to be a number invented here, and
          the honest alternative to inventing one is to compare against nothing when the publisher
          supplied nothing — which is what `undefined` and `null` already mean.
        */
        if (valid && request.expectedBytes != null && partial.size !== request.expectedBytes) {
          valid = false;
        }
      } catch {
        valid = false;
      }
      if (!valid) {
        discard(partial);
        throw new Error('invalid');
      }

      try {
        // Overwrite, because a concurrent preparation of the same ayah may have promoted first.
        // Both wrote the same validated content, so the last rename winning is correct.
        discard(target);
        partial.moveSync(target);
      } catch (error) {
        discard(partial);
        throw error;
      }

      const promoted = describe(new File(directory, request.name), request.name);
      if (promoted === null) {
        throw new Error('invalid');
      }
      return promoted;
    },

    /**
     * Clears partials.
     *
     * Run at startup rather than only on failure, because the case this exists for is the one no
     * `catch` can reach: the process was killed mid-transfer. Those files are otherwise invisible —
     * `list` skips them — so they would occupy the cache until the OS reclaimed the directory.
     */
    sweepIncomplete(): void {
      try {
        const directory = audioDirectoryFor(kind);
        if (!directory.exists) {
          return;
        }
        for (const entry of directory.list()) {
          if (!(entry instanceof Directory) && isPartialName(entry.name)) {
            discard(entry);
          }
        }
      } catch {
        // Best-effort by design.
      }
    },

    availableBytes(): number | null {
      try {
        const free = Paths.availableDiskSpace;
        return Number.isFinite(free) && free >= 0 ? free : null;
      } catch {
        return null;
      }
    },

    validate(name: string): boolean {
      try {
        const file = new File(audioDirectoryFor(kind), name);
        if (!file.exists) {
          return false;
        }
        return isPlausibleAudio(readHeader(file), file.size);
      } catch {
        /* Unreadable is not "probably fine". A file that cannot be checked may not be played. */
        return false;
      }
    },

    /**
     * Moves a file in from another private directory, validating before it is promoted.
     *
     * The same order every write in this module follows — land, check, then rename onto the name a
     * player reads. The difference is only that the bytes arrived earlier and by another route, which
     * is a reason to check them more carefully rather than less: a cache file may have been truncated
     * by the OS at any point since it was written.
     */
    adopt(request): StoredAudioFile | null {
      try {
        const source = new File(request.from);
        if (!source.exists) {
          return null;
        }
        if (!isPlausibleAudio(readHeader(source), source.size)) {
          /*
            Left where it is rather than deleted. This method's job is adoption; deciding the fate of
            a file it declined belongs to the caller, which knows whether the source directory is
            about to be swept anyway.
          */
          return null;
        }
        const directory = ensureDirectory(kind);
        const target = new File(directory, request.name);
        discard(target);
        source.moveSync(target);
        return describe(new File(directory, request.name), request.name);
      } catch {
        return null;
      }
    },
  };
}

/** Re-exported so callers name one module for the store and the names it keys on. */
export { audioFileName };
