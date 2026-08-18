import {
  deserialiseManifest,
  EMPTY_MANIFEST,
  envelopeFor,
  serialiseManifest,
  type OfflineManifest,
} from '../../storage/faith-offline-recitation';

/**
 * The one place the offline recitation manifest is read and written.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a mutation boundary exists at all ──────────────────────────────────
 * Four things mutate this manifest and at least two of them are usually alive at once: the download
 * engine promoting files, the user pausing or removing, the reconciler applying a new generation, and
 * the startup repair pass comparing the manifest with the disk. Every one of them is asynchronous, so
 * the naive shape —
 *
 * ```ts
 * const manifest = await read();
 * await write(mutate(manifest));
 * ```
 *
 * — is a read-modify-write with an `await` in the middle. Two of those interleaved lose one of the
 * two mutations entirely, and the one that is lost is whichever finished first. In practice that is a
 * promoted file silently reverting to not-downloaded, which the repair pass then re-downloads: the
 * user pays for the same bytes twice and nothing anywhere reports a fault.
 *
 * So there is exactly one queue. `mutate` appends to it, and the next mutation does not begin until
 * the previous one's write has settled. Concurrent pause, resume, remove and reconcile therefore
 * serialise rather than race, which is the property Phase 1 asks for and the one a lock-free design
 * cannot offer here.
 *
 * ── Why writes are batched and what a crash costs ──────────────────────────
 * A complete download promotes 6,236 files. Writing a ~600 KB manifest after each one is 3.7 GB of
 * filesystem traffic to record 6,236 facts, and on a phone that is not a micro-optimisation but the
 * difference between a download that finishes and one that cooks the device.
 *
 * So promotions accumulate in memory and are flushed on a bounded schedule — see `flushEvery` — and
 * unconditionally at every point where the answer matters: a state transition, a pause, a removal, a
 * reconciliation, and teardown. What a crash between flushes costs is therefore **only** the index
 * entries for at most `flushEvery` files.
 *
 * Those files are re-downloaded, not adopted. `reconcileAgainstDisk` repairs rows whose file has
 * vanished; it deliberately does **not** adopt a file that no row describes, because presence is not
 * identity and adopting on that basis is the practice the manifest exists to retire — only
 * `migrateLegacyAudio` may do it, and only after proving the identity against a published generation.
 * A force-stop mid-run therefore costs a re-fetch of at most `flushEvery` files, which on a device
 * measured at 479 KB per ayah is a few megabytes. Observed on the emulator: 628 files on disk, 625
 * rows in the manifest, and the three-file difference re-fetched on resume.
 *
 * The inverse — a manifest row for a file that is not on disk — is the dangerous direction, and it
 * cannot happen: a row is only ever added *after* the file has been promoted under an atomic rename.
 *
 * ── The in-memory manifest is the live one ─────────────────────────────────
 * Readers get the in-memory value, not a re-read of the file. Re-reading would mean a caller could
 * observe state older than a mutation it had already awaited, and would parse 600 KB on every query
 * from a screen that re-renders. The file is the durable copy; this object is the current one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The filesystem seam, so the store can be driven by an in-memory double in Jest.
 *
 * Deliberately three methods. A port that exposed a directory or a path would let a caller construct
 * its own file name, and the whole point of this boundary is that exactly one document exists.
 */
export type ManifestFilePort = {
  /** The serialised document, or `null` when absent or unreadable. */
  read(): string | null;
  /**
   * Writes atomically: to a sibling `.part`, reopened and compared, then renamed over the live name.
   *
   * Returns whether the document is durably stored. A caller that treated a failed write as success
   * would leave the in-memory manifest ahead of the disk, and the next launch would silently disagree
   * with everything the user was told.
   */
  write(text: string): boolean;
  remove(): void;
};

export type OfflineManifestStore = {
  /** Loads from disk once. Safe to call repeatedly; the second call resolves to the same value. */
  load(): Promise<OfflineManifest>;
  /** The live manifest. Throws nothing and never touches the filesystem. */
  current(): OfflineManifest;
  /**
   * Applies one mutation under the serialisation guarantee, and flushes.
   *
   * The mutation is pure: it receives the current manifest and returns the next one. It must not
   * perform I/O — the queue holds every other mutation while it runs, so work inside it is work the
   * rest of the system is blocked on.
   */
  mutate(apply: (manifest: OfflineManifest) => OfflineManifest): Promise<boolean>;
  /**
   * Applies a mutation without forcing a write, flushing only when the batch is full.
   *
   * The path a promoted file takes. Still serialised — the in-memory manifest is never mutated
   * concurrently — but durability is deferred to the next flush.
   */
  record(apply: (manifest: OfflineManifest) => OfflineManifest): Promise<void>;
  /** Writes pending changes now. Idempotent; a no-op when nothing is pending. */
  flush(): Promise<boolean>;
  /** Drops the document and resets to the empty manifest. Used by the Faith data reset. */
  clear(): Promise<void>;
  /** Encoded size of the document as it would be written now, for storage reporting. */
  documentBytes(): number;
};

export const DEFAULT_FLUSH_EVERY = 25;

export function createOfflineManifestStore(config: {
  readonly file: ManifestFilePort;
  /** How many recorded mutations may accumulate before a write is forced. */
  readonly flushEvery?: number;
}): OfflineManifestStore {
  const { file } = config;
  const flushEvery = config.flushEvery ?? DEFAULT_FLUSH_EVERY;

  let manifest: OfflineManifest = EMPTY_MANIFEST;
  let loaded = false;
  let pending = 0;

  /**
   * The tail of the mutation queue.
   *
   * Every mutation chains onto it, so ordering is the order `mutate` was called in and there is never
   * more than one in flight. The chain is kept resolved rather than rejected — a mutation that threw
   * would otherwise poison every mutation queued behind it, which turns one recoverable fault into a
   * manifest that can never be written again.
   */
  let tail: Promise<void> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function writeNow(): boolean {
    const stored = file.write(serialiseManifest(manifest));
    if (stored) {
      pending = 0;
    }
    return stored;
  }

  return {
    async load(): Promise<OfflineManifest> {
      return await enqueue(() => {
        if (loaded) {
          return manifest;
        }
        const text = file.read();
        /*
          An unreadable or undecodable document becomes the empty manifest rather than an error: a
          screen that cannot render is worse than one that reports nothing downloaded, and the bytes
          themselves are untouched either way.

          What that costs is stated precisely rather than optimistically. The files are **not**
          re-adopted from disk — `reconcileAgainstDisk` repairs rows whose file vanished and never the
          reverse, because presence is not identity. A lost manifest therefore costs a re-download of
          whatever the user had, and the only thing that can rescue those bytes is
          `migrateLegacyAudio`, which proves each identity against a published generation first. That
          is why the write path is atomic, checksummed and reopened before the rename: this branch is
          the fallback, not a safety net anybody should be relying on.
        */
        manifest = (text === null ? null : deserialiseManifest(text)) ?? EMPTY_MANIFEST;
        loaded = true;
        return manifest;
      });
    },

    current(): OfflineManifest {
      return manifest;
    },

    async mutate(apply): Promise<boolean> {
      return await enqueue(() => {
        manifest = apply(manifest);
        return writeNow();
      });
    },

    async record(apply): Promise<void> {
      await enqueue(() => {
        manifest = apply(manifest);
        pending += 1;
        if (pending >= flushEvery) {
          writeNow();
        }
      });
    },

    async flush(): Promise<boolean> {
      return await enqueue(() => (pending === 0 ? true : writeNow()));
    },

    async clear(): Promise<void> {
      await enqueue(() => {
        file.remove();
        manifest = EMPTY_MANIFEST;
        pending = 0;
        loaded = true;
      });
    },

    documentBytes(): number {
      return envelopeFor(manifest).byteLength;
    },
  };
}
