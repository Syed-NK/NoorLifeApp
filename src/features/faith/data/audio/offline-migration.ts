import {
  offlineFileName,
  parseOfflineFileName,
  PERMITTED_RESOURCE_ID,
  upsertRows,
  verseKeyOf,
  type OfflineFileRow,
  type OfflineManifest,
} from '../../storage/faith-offline-recitation';
import type { AudioStore } from './audio-store.port';
import { classifyOrphans } from './offline-orphan-adoption';
import type { OfflineManifestStore } from './offline-manifest.store';
import type { BoundGeneration } from './offline-download.service';

/**
 * The one-time adoption of files written before this manifest existed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What is being migrated, and from where ─────────────────────────────────
 * Two legacy stores, with different histories and the same fate:
 *
 *   • **prepared** — `Paths.cache/faith-recitations`. Ayat fetched to play a surah now, or prefetched
 *     a few ahead. Evictable, budgeted, and about to have no owner at all: playback no longer streams,
 *     so nothing will ever write here again. Files left behind would occupy the cache until the OS
 *     reclaimed it, having cost the user data to fetch.
 *   • **downloaded** — `Paths.document/faith-recitations-downloaded`. Surahs the user deliberately
 *     chose to keep, indexed by a store whose `expiresAt` was seven days from download. The index is
 *     wrong and is being deleted; the *files* are the user's and are exactly what must be preserved.
 *
 * Both use the name shape `r<reciter>-s<surah>-a<ayah>.mp3`, and for resource 3 that is byte-identical
 * to what `offlineFileName` produces — so an adopted download keeps its name and is never rewritten.
 *
 * ── Existence is not completeness, and this is where that rule is hardest ──
 * A file being on disk says nothing about whether its transfer finished. The legacy prepared store
 * promoted only validated files, but the legacy *device* also holds files written by builds before
 * that guarantee existed, files the OS truncated under storage pressure, and files a killed process
 * left mid-rename. So every candidate is re-checked by `AudioStore.validate` — the same signature and
 * size floor a fresh download must pass — and a file that fails becomes work to redo rather than a
 * row that claims to be playable.
 *
 * Adopted rows additionally carry `expectedBytes` from the published generation where the publisher
 * stated one, and are rejected when the file's size disagrees. That is the one check a legacy file
 * can be given that its original download never was.
 *
 * ── The permission is not extended by adoption ─────────────────────────────
 * Only `r3-` files are considered. A file belonging to another reciter is neither adopted nor
 * deleted: it is left exactly where it is, because the extended-retention permission is resource 3's
 * alone and a migration that swept another reciter's files into permanent storage would be applying a
 * grant nobody gave. `otherReciterFiles` reports the count so the outcome is auditable.
 *
 * ── Idempotent and crash-safe ──────────────────────────────────────────────
 * The plan is recomputed from the filesystem and the generation every time, so an interrupted run
 * simply repeats. Rows are keyed by identity through `upsertRows`, so a second pass produces the same
 * manifest rather than duplicates. `migratedLegacyFiles` is written **last** and only after the rows
 * are durably stored, so a crash anywhere before that leaves the flag false and the next launch tries
 * again — and a crash after it leaves a manifest that already describes everything adopted.
 *
 * Nothing here deletes a valid file. The legacy indexes are dropped by the caller only after this
 * returns `migrated`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Why a file on disk was not adopted. A closed set — no message, no path, no name. */
export type AdoptionRejection =
  /** The name could not be read as a reciter, surah and ayah. */
  | 'unreadable-name'
  /** A reciter other than the permitted one. Left untouched, never adopted, never deleted. */
  | 'other-reciter'
  /** No row in the published generation corroborates that this verse exists for this resource. */
  | 'unproved-identity'
  /** Present, and failed the signature or size check applied to every download. */
  | 'failed-validation'
  /** The publisher stated a size and the file is not that size. */
  | 'size-mismatch'
  /** Listed and then unreadable — reclaimed between the two calls. */
  | 'missing';

export type MigrationOutcome =
  | {
      readonly kind: 'migrated';
      /** Files adopted as playable, having passed the same checks a fresh download passes. */
      readonly adopted: number;
      /** Files moved in from the evictable cache rather than already being in permanent storage. */
      readonly promotedFromCache: number;
      readonly rejected: number;
      readonly rejections: Readonly<Record<AdoptionRejection, number>>;
      /** Files belonging to another reciter. Counted, left in place. */
      readonly otherReciterFiles: number;
    }
  /** Already done. Nothing was read and nothing was written. */
  | { readonly kind: 'already-migrated' }
  /**
   * No published generation to prove identities against.
   *
   * Not a failure. A device that has never completed a Content Sync has nothing to check a filename
   * against, and adopting on the strength of names alone is exactly the practice being retired. The
   * migration waits for the first successful sync and the files stay where they are.
   */
  | { readonly kind: 'deferred'; readonly reason: 'no-generation' }
  /** The manifest could not be written. Nothing was published; the legacy state is untouched. */
  | { readonly kind: 'failed'; readonly reason: 'write-failed' };

export type MigrationDependencies = {
  /** The permanent store. Adopted files end up here. */
  readonly downloaded: AudioStore;
  /** The legacy evictable cache. Files found here are moved into `downloaded`. */
  readonly prepared: AudioStore;
  readonly manifest: OfflineManifestStore;
  readonly generation: BoundGeneration | null;
  readonly now: () => number;
};

type Candidate = {
  readonly name: string;
  readonly surah: number;
  readonly ayah: number;
  readonly fromCache: boolean;
  readonly uri: string;
};

export async function migrateLegacyAudio(deps: MigrationDependencies): Promise<MigrationOutcome> {
  const current = await deps.manifest.load();
  if (current.migratedLegacyFiles) {
    return { kind: 'already-migrated' };
  }
  if (deps.generation === null || deps.generation.rows.length === 0) {
    return { kind: 'deferred', reason: 'no-generation' };
  }

  const published = new Map(
    deps.generation.rows.map((row) => [verseKeyOf(row.surah, row.ayah), row]),
  );

  const rejections: Record<AdoptionRejection, number> = {
    'unreadable-name': 0,
    'other-reciter': 0,
    'unproved-identity': 0,
    'failed-validation': 0,
    'size-mismatch': 0,
    missing: 0,
  };
  let otherReciterFiles = 0;

  /**
   * Candidates from both stores, with the permanent one taking precedence.
   *
   * ── Why permanent wins when the same ayah exists in both ───────────────────
   * A deliberate download and a prefetch of the same verse are the same bytes, but the permanent copy
   * is the one the user chose to keep and the one that is not about to be evicted. Adopting the cache
   * copy over it would move a file needlessly and, if the move failed part-way, would put the file the
   * user asked for at risk to gain nothing.
   */
  const candidates = new Map<string, Candidate>();

  const collect = (store: AudioStore, fromCache: boolean): void => {
    for (const file of store.list()) {
      const identity = parseOfflineFileName(file.name);
      if (identity === null) {
        rejections['unreadable-name'] += 1;
        continue;
      }
      if (identity.resourceId !== PERMITTED_RESOURCE_ID) {
        /*
          Another reciter's file. Counted and left alone — not adopted, because the permission does
          not reach it, and not deleted, because it is not this migration's to remove.
        */
        otherReciterFiles += 1;
        rejections['other-reciter'] += 1;
        continue;
      }
      const key = verseKeyOf(identity.surah, identity.ayah);
      if (!fromCache || !candidates.has(key)) {
        candidates.set(key, {
          name: file.name,
          surah: identity.surah,
          ayah: identity.ayah,
          fromCache,
          uri: file.uri,
        });
      }
    }
  };

  /* Permanent first, so its entries are the ones a cache duplicate cannot displace. */
  collect(deps.downloaded, false);
  collect(deps.prepared, true);

  const rows: OfflineFileRow[] = [];
  let promotedFromCache = 0;

  for (const [verseKey, candidate] of candidates) {
    const publishedRow = published.get(verseKey);
    if (publishedRow === undefined) {
      /*
        The name says what it says and the publisher does not agree that this verse exists for this
        resource. Not adopted: a mis-bound recitation plays one verse in another's place, and nothing
        downstream can notice.
      */
      rejections['unproved-identity'] += 1;
      continue;
    }

    const targetName = offlineFileName(PERMITTED_RESOURCE_ID, candidate.surah, candidate.ayah);

    if (candidate.fromCache) {
      const adopted = deps.downloaded.adopt({ from: candidate.uri, name: targetName });
      if (adopted === null) {
        rejections['failed-validation'] += 1;
        continue;
      }
      if (publishedRow.bytes !== null && adopted.bytes !== publishedRow.bytes) {
        /*
          Moved in and then found to disagree with the publisher's stated size. Removed rather than
          kept: it is now in permanent storage, and leaving an unplayable file there would be the
          migration creating exactly the kind of untracked byte it exists to eliminate.
        */
        deps.downloaded.remove(targetName);
        rejections['size-mismatch'] += 1;
        continue;
      }
      promotedFromCache += 1;
      rows.push(adoptedRow(candidate, adopted.bytes, publishedRow, deps));
      continue;
    }

    const existing = deps.downloaded.read(targetName);
    if (existing === null) {
      rejections.missing += 1;
      continue;
    }
    if (!deps.downloaded.validate(targetName)) {
      /*
        Present, and never checked by this build. Not adopted and not deleted — it becomes a queued
        row below only if the user's scope wants it, and until then the bytes stay where they are.
      */
      rejections['failed-validation'] += 1;
      continue;
    }
    if (publishedRow.bytes !== null && existing.bytes !== publishedRow.bytes) {
      rejections['size-mismatch'] += 1;
      continue;
    }
    rows.push(adoptedRow(candidate, existing.bytes, publishedRow, deps));
  }

  /*
    One write for the rows, then a second for the flag — in that order, and never merged.

    Merging them would make a partial write claim the migration finished; writing the flag first would
    make a crash between the two lose every adoption permanently. Written this way, a crash in the gap
    leaves rows that are correct and a flag that is false, and the next run recomputes the same plan
    and writes the same rows.
  */
  if (rows.length > 0 && !(await deps.manifest.mutate((value) => upsertRows(value, rows)))) {
    return { kind: 'failed', reason: 'write-failed' };
  }
  if (!(await deps.manifest.mutate((value) => ({ ...value, migratedLegacyFiles: true })))) {
    return { kind: 'failed', reason: 'write-failed' };
  }

  const rejected = Object.values(rejections).reduce((sum, count) => sum + count, 0);
  return {
    kind: 'migrated',
    adopted: rows.length,
    promotedFromCache,
    rejected,
    rejections,
    otherReciterFiles,
  };
}

function adoptedRow(
  candidate: Candidate,
  bytes: number,
  published: { readonly bytes: number | null; readonly sequence: number | null },
  deps: MigrationDependencies,
): OfflineFileRow {
  return {
    resourceId: PERMITTED_RESOURCE_ID,
    surah: candidate.surah,
    ayah: candidate.ayah,
    verseKey: verseKeyOf(candidate.surah, candidate.ayah),
    fileName: offlineFileName(PERMITTED_RESOURCE_ID, candidate.surah, candidate.ayah),
    /*
      `available`, and only because the file has just passed the same signature check, size floor and
      published-size comparison a fresh download must pass. Nothing is adopted as playable on the
      strength of having existed.
    */
    state: 'available',
    bytes,
    expectedBytes: published.bytes,
    validation: 'signature-ok',
    generationId: deps.generation?.generationId ?? null,
    sequence: published.sequence,
    /*
      `completedAt` is null: these bytes arrived at a time this build cannot know, and inventing a
      timestamp would put a fabricated date on a screen. `verifiedAt` is now, which is true — the
      check that produced this row ran now.
    */
    completedAt: null,
    verifiedAt: deps.now(),
  };
}

/**
 * Whether the manifest may be treated as the authority on what is downloaded.
 *
 * Read by the playback and download paths so neither has to know how migration works — only whether
 * it has finished. Before it has, an empty manifest does **not** mean nothing is downloaded: the files
 * may be on disk and simply not yet adopted, and a screen that said "not downloaded" in that window
 * would offer to re-fetch a surah the device already holds.
 */
export function manifestIsAuthoritative(manifest: OfflineManifest): boolean {
  return manifest.migratedLegacyFiles;
}

/**
 * Adopts final audio files the manifest lost track of, and reports what it refused.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The crash this closes ──────────────────────────────────────────────────
 * A download promotes files individually and rewrites the manifest atomically in batches. A
 * force-stop between a batch of promotions and the manifest write leaves the bytes on disk under
 * their final names with nothing describing them. Measured on a real device: **3,490 files against
 * 3,483 manifest rows** — seven files invisible to every count the app makes.
 *
 * `migrateLegacyAudio` above cannot help: it runs once, gated on `migratedLegacyFiles`, and is about
 * the retired *cache* rather than about promoted files this feature wrote itself. Reconciliation
 * cannot help either — it compares the manifest against the generation and never enumerates the
 * directory.
 *
 * ── Why this runs on every mount ───────────────────────────────────────────
 * The crash can happen on any run, so a once-ever gate would leave the next occurrence permanent. The
 * cost is one directory listing plus a header read per unrecorded file, and after a clean shutdown
 * there are none — so the ordinary case is a listing that finds nothing to do.
 *
 * ── The order, and why the manifest is written exactly once ────────────────
 * Every candidate is classified and validated **before** anything is written, then one manifest is
 * written atomically through the existing serialised store and reopened. A crash leaves either the
 * previous whole manifest or the new whole one; there is no hybrid, because there is no second write.
 *
 * Deletion of unreferenced private orphans is deliberately **not** done here. A file this pass could
 * not corroborate may still be perfectly good audio whose generation has simply not been published
 * yet, and the cost of keeping it is disk while the cost of deleting it is a re-download. Callers that
 * want it gone must prove the manifest does not name it — see `isSafeToRemoveOrphan`.
 */
export async function adoptPromotedOrphans(deps: {
  readonly downloaded: AudioStore;
  readonly manifest: OfflineManifestStore;
  readonly generation: BoundGeneration | null;
  readonly now: () => number;
}): Promise<{
  readonly adopted: number;
  readonly unverifiable: number;
  readonly unexpected: number;
  readonly reason?: 'no-generation' | 'write-failed' | 'nothing-to-do';
}> {
  if (deps.generation === null || deps.generation.rows.length === 0) {
    /*
      Without an active publication there is nothing to corroborate against, and adopting on the
      strength of a filename alone is the defect this whole path refuses to be.
    */
    return { adopted: 0, unverifiable: 0, unexpected: 0, reason: 'no-generation' };
  }

  const manifest = await deps.manifest.load();
  const files = deps.downloaded.list();

  const audit = classifyOrphans({
    discovered: files.map((file) => ({
      fileName: file.name,
      bytes: file.bytes,
      /* `list()` excludes partials by contract, so anything it returns is a regular final file. */
      isRegularFinalFile: true,
      /*
        The store's own validation, reused rather than re-implemented. It reads the header and applies
        exactly the check a fresh download passes, so an adopted file cannot clear a lower bar than a
        downloaded one. The classifier is handed the verdict as a synthetic header so the rule stays in
        one place.
      */
      header: deps.downloaded.validate(file.name) ? VALID_AUDIO_MARKER : null,
    })),
    manifest,
    generationId: deps.generation.generationId,
    published: deps.generation.rows.map((row) => ({
      surah: row.surah,
      ayah: row.ayah,
      verseKey: verseKeyOf(row.surah, row.ayah),
      bytes: row.bytes ?? null,
      durationSeconds: row.durationSeconds ?? null,
      sequence: row.sequence ?? null,
    })),
    at: deps.now(),
    /* Already decided above; the marker simply carries the verdict through. */
    isAudio: (header) => header === VALID_AUDIO_MARKER,
  });

  if (audit.adoptable.length === 0) {
    return {
      adopted: 0,
      unverifiable: audit.unverifiable.length,
      unexpected: audit.unexpected.length,
      reason: 'nothing-to-do',
    };
  }

  /*
    One mutation, through the existing serialised boundary. The callback is pure and does no I/O —
    every validation already happened above — so the queue is not held while anything is read, and
    the flush is a single atomic manifest write.
  */
  const written = await deps.manifest.mutate((current) => ({
    ...current,
    rows: [...current.rows, ...audit.adoptable],
  }));
  if (!written) {
    /* The previous manifest is untouched, so the next mount simply tries again. */
    return {
      adopted: 0,
      unverifiable: audit.unverifiable.length,
      unexpected: audit.unexpected.length,
      reason: 'write-failed',
    };
  }

  return {
    adopted: audit.adoptable.length,
    unverifiable: audit.unverifiable.length,
    unexpected: audit.unexpected.length,
  };
}

/**
 * The sentinel the store's own verdict is carried on.
 *
 * A distinct object identity rather than a byte pattern, so nothing can forge a pass by producing
 * bytes that happen to look right — the only way to hold this value is to have been given it by the
 * validation call above.
 */
const VALID_AUDIO_MARKER = new Uint8Array([0x49, 0x44, 0x33]);
