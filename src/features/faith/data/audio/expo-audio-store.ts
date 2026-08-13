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
 * ── Where the files live, and why it is the cache directory ─────────────────
 * `Paths.cache`, not `Paths.document`. The distinction is the platform's own and it is exactly the
 * distinction the Quran Foundation licence draws: the cache directory is storage the OS may reclaim
 * when the device runs low, and these files are a **cache of vendor content with a one-week
 * ceiling**, not user data. Putting them in the document directory would tell the OS to preserve
 * them across low-storage pressure, which is the opposite of what a bounded, expiring copy of
 * someone else's content should ask for.
 *
 * ── Nothing here logs ───────────────────────────────────────────────────────
 * Not a URL, not a filename, not a byte count, not a failure. This module holds the one value in the
 * app that must never reach a log line — an audio URL, which for some hosts carries a signed path —
 * and the simplest way to guarantee it does not is for the module that holds it to have no logger
 * and no `console` call. Failures are returned to the caller as rejections carrying no message from
 * the transport.
 */

/** The single directory every prepared and downloaded recitation lives in. */
const AUDIO_DIRECTORY = 'faith-recitations';

/** How much of the file is read to decide whether it is plausibly audio. */
const HEADER_BYTES = 16;

function audioDirectory(): Directory {
  return new Directory(Paths.cache, AUDIO_DIRECTORY);
}

/**
 * The directory, created if it is not there.
 *
 * `idempotent` rather than a check-then-create: the check and the create are two calls with a gap
 * between them, and two prepared ayat starting in the same tick would both see "absent" and both
 * create. `intermediates` covers a cache directory the OS has emptied down to nothing.
 */
function ensureDirectory(): Directory {
  const directory = audioDirectory();
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

export function createExpoAudioStore(): AudioStore {
  return {
    list(): readonly StoredAudioFile[] {
      try {
        const directory = audioDirectory();
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
        return describe(new File(audioDirectory(), name), name);
      } catch {
        return null;
      }
    },

    remove(name: string): void {
      try {
        discard(new File(audioDirectory(), name));
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
      const directory = ensureDirectory();
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
        const directory = audioDirectory();
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
  };
}

/** Re-exported so callers name one module for the store and the names it keys on. */
export { audioFileName };
