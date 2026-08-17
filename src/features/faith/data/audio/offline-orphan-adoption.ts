import { PERMITTED_RESOURCE_ID, type OfflineFileRow } from '../../storage/faith-offline-recitation';
import type { PublishedRow } from './offline-reconcile';

/**
 * Final audio files the manifest does not know about.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The crash this exists for, observed on a real device ───────────────────
 * A download promotes files one at a time and rewrites the manifest atomically in batches. Force-stop
 * the app between a batch of promotions and the manifest write, and the bytes are on disk under their
 * final names while the manifest still describes the world before them.
 *
 * Measured: **3,490 files against 3,483 manifest rows.** Seven files, valid, playable-looking, and
 * invisible to every count the app makes. The existing reconciliation compares the manifest against
 * the *generation* and never enumerates the directory, so it swept the leftover `.part` files and
 * walked straight past these.
 *
 * ── Why adoption is hostile by default ─────────────────────────────────────
 * The tempting fix is "the file exists and the name parses, so add a row". That is the whole class of
 * defect this module refuses to be. A filename is an *assertion by whatever wrote the file*, and the
 * writer might have been an interrupted transfer, a partially-flushed rename, an error body saved
 * under a plausible name, or — on a rooted device — anything at all. Adopting on the strength of a
 * name would let a file NoorLife never validated become recitation the user hears as scripture.
 *
 * So a candidate is adopted only when the device can corroborate it **independently of the name**:
 * the verse identity must exist in the active validated generation, the generation's own row must
 * agree, and the bytes must pass the same content validation a fresh download passes. Anything that
 * cannot clear that bar is never adopted — it is reported, and the downloader may fetch it again.
 *
 * Nothing here writes. It classifies, and the caller applies the result through the existing
 * serialised manifest boundary.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The only filename shape this feature has ever written: `r<resource>-s<surah>-a<ayah>.mp3`. */
const FILE_NAME = /^r(\d+)-s(\d+)-a(\d+)\.mp3$/;

/**
 * The smallest a real ayah recitation can be.
 *
 * Shared with the download path's own floor rather than re-chosen here: a second threshold would
 * drift from the first, and the two answer the same question.
 */
export const MIN_ADOPTABLE_BYTES = 2048;

/** A file found in the private recitation directory, described without reading it twice. */
export type DiscoveredFile = {
  readonly fileName: string;
  readonly bytes: number;
  /** True only for a regular final file. Directories, links and `.part` names are false. */
  readonly isRegularFinalFile: boolean;
  /** Leading bytes, for content validation. Absent when the file could not be opened. */
  readonly header: Uint8Array | null;
};

export type OrphanClassification =
  /** The manifest already owns this file. Nothing to do. */
  | { readonly kind: 'manifest-owned'; readonly fileName: string }
  /** Corroborated against the active generation and validated. Safe to adopt. */
  | { readonly kind: 'adoptable'; readonly row: OfflineFileRow }
  /**
   * A final file this device cannot vouch for. Never adopted, never playable.
   *
   * `reason` is a closed enum so a caller can report counts without echoing a filename.
   */
  | { readonly kind: 'unverifiable'; readonly fileName: string; readonly reason: OrphanRejection }
  /** Not ours, or not a final audio file. Left strictly alone. */
  | { readonly kind: 'unexpected'; readonly fileName: string };

export type OrphanRejection =
  | 'not-regular-file'
  | 'malformed-name'
  | 'wrong-reciter'
  | 'identity-mismatch'
  | 'absent-from-generation'
  | 'generation-disagrees'
  | 'too-small'
  | 'not-audio'
  | 'duplicate-identity'
  | 'conflicting-manifest-row';

export type OrphanAudit = {
  readonly generationId: string;
  readonly classifications: readonly OrphanClassification[];
  readonly adoptable: readonly OfflineFileRow[];
  readonly unverifiable: readonly { readonly fileName: string; readonly reason: OrphanRejection }[];
  readonly unexpected: readonly string[];
};

/**
 * Classifies every discovered file against the manifest and one validated generation.
 *
 * ── Why the generation is passed in rather than read ───────────────────────
 * The caller has already bound to one publication. Reading it here would let a long classification
 * span two generations and adopt a row corroborated by a publication that is no longer active —
 * exactly the mixing the generation model exists to prevent.
 */
export function classifyOrphans(input: {
  readonly discovered: readonly DiscoveredFile[];
  readonly manifest: { readonly rows: readonly OfflineFileRow[] };
  readonly generationId: string;
  readonly published: readonly PublishedRow[];
  readonly at: number;
  /** The same content check a fresh download passes. Injected so the rule cannot diverge. */
  readonly isAudio: (header: Uint8Array, bytes: number) => boolean;
}): OrphanAudit {
  const { discovered, manifest, generationId, published, at, isAudio } = input;

  const ownedNames = new Set(manifest.rows.map((row) => row.fileName));
  const ownedKeys = new Set(manifest.rows.map((row) => row.verseKey));
  const publishedByKey = new Map(published.map((row) => [row.verseKey, row]));

  /*
    Identities seen among the candidates themselves. Two files claiming one verse cannot both be that
    verse, and picking either would make the choice depend on directory ordering.
  */
  const candidateKeyCounts = new Map<string, number>();
  for (const file of discovered) {
    const parsed = FILE_NAME.exec(file.fileName);
    if (parsed !== null) {
      const key = `${Number(parsed[2])}:${Number(parsed[3])}`;
      candidateKeyCounts.set(key, (candidateKeyCounts.get(key) ?? 0) + 1);
    }
  }

  const classifications: OrphanClassification[] = [];

  for (const file of discovered) {
    if (ownedNames.has(file.fileName)) {
      classifications.push({ kind: 'manifest-owned', fileName: file.fileName });
      continue;
    }

    const reject = (reason: OrphanRejection): void => {
      classifications.push({ kind: 'unverifiable', fileName: file.fileName, reason });
    };

    const parsed = FILE_NAME.exec(file.fileName);
    if (parsed === null) {
      /*
        Not our shape at all — a stray file, a `.part` leftover, a directory, a traversal attempt.
        `unexpected` rather than `unverifiable`: this module makes no claim about what it is, and the
        caller may only remove it after proving the manifest does not reference it.
      */
      classifications.push({ kind: 'unexpected', fileName: file.fileName });
      continue;
    }
    if (!file.isRegularFinalFile) {
      reject('not-regular-file');
      continue;
    }

    const resourceId = Number(parsed[1]);
    const surah = Number(parsed[2]);
    const ayah = Number(parsed[3]);
    const verseKey = `${surah}:${ayah}`;

    if (resourceId !== PERMITTED_RESOURCE_ID) {
      /* Another reciter's audio is not this reciter's, whatever the directory it landed in. */
      reject('wrong-reciter');
      continue;
    }
    if (
      !Number.isInteger(surah) ||
      surah < 1 ||
      surah > 114 ||
      !Number.isInteger(ayah) ||
      ayah < 1
    ) {
      reject('identity-mismatch');
      continue;
    }
    if ((candidateKeyCounts.get(verseKey) ?? 0) > 1) {
      reject('duplicate-identity');
      continue;
    }
    if (ownedKeys.has(verseKey)) {
      /*
        The manifest already has a row for this verse under a *different* file name. Adopting would
        give one verse two files and make which one plays depend on lookup order.
      */
      reject('conflicting-manifest-row');
      continue;
    }

    const publishedRow = publishedByKey.get(verseKey);
    if (publishedRow === undefined) {
      /* The active generation does not publish this verse, so nothing corroborates it. */
      reject('absent-from-generation');
      continue;
    }
    if (publishedRow.surah !== surah || publishedRow.ayah !== ayah) {
      reject('generation-disagrees');
      continue;
    }

    if (file.bytes < MIN_ADOPTABLE_BYTES) {
      reject('too-small');
      continue;
    }
    if (file.header === null || !isAudio(file.header, file.bytes)) {
      /* HTML, JSON, an error body, a truncated header — anything that is not audio. */
      reject('not-audio');
      continue;
    }

    classifications.push({
      kind: 'adoptable',
      row: {
        resourceId: PERMITTED_RESOURCE_ID,
        surah,
        ayah,
        verseKey,
        fileName: file.fileName,
        state: 'available',
        bytes: file.bytes,
        expectedBytes: publishedRow.bytes,
        validation: 'signature-ok',
        /*
          Stamped with the generation that corroborated it, not left null. A null generation is what
          `faith-offline-recitation.ts` reserves for adopted *legacy* files, and these are not legacy —
          they were downloaded under this publication and their identity was checked against it.
        */
        generationId,
        sequence: publishedRow.sequence,
        completedAt: at,
        verifiedAt: at,
      },
    });
  }

  return {
    generationId,
    classifications,
    adoptable: classifications.flatMap((entry) => (entry.kind === 'adoptable' ? [entry.row] : [])),
    unverifiable: classifications.flatMap((entry) =>
      entry.kind === 'unverifiable' ? [{ fileName: entry.fileName, reason: entry.reason }] : [],
    ),
    unexpected: classifications.flatMap((entry) =>
      entry.kind === 'unexpected' ? [entry.fileName] : [],
    ),
  };
}

/**
 * Whether a private file may be deleted as an unreferenced orphan.
 *
 * Separated from classification because deletion is the one irreversible act here. The manifest is
 * consulted by **name**, and a file the manifest mentions is never removed however it was classified —
 * a mis-parse must cost a wasted file, never a working one.
 */
export function isSafeToRemoveOrphan(
  fileName: string,
  manifest: { readonly rows: readonly OfflineFileRow[] },
): boolean {
  return !manifest.rows.some((row) => row.fileName === fileName);
}
