import {
  type AudioManifest,
  type AudioManifestRow,
  EMPTY_MANIFEST,
  planLegacyMigration,
  readAudioManifest,
  upsertRows,
  writeAudioManifest,
} from '../../storage/faith-audio-manifest';
import { MIN_AUDIO_BYTES, parseAudioFileName, type AudioStore } from './audio-store.port';
import { readActiveGeneration } from '../../storage/faith-sync-generation';

/**
 * The one-time move from Generation 1 to the manifest, run to completion or not at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What is being replaced, and why both cannot coexist ────────────────────
 * Generation 1 decided what was on the device by **building a filename and asking whether it
 * existed**, and decided how long it lived by counting seven days from *download*. Both are wrong in
 * ways that matter:
 *
 *   • A filename is a guess about identity. It cannot say which vendor row the bytes came from,
 *     whether they were ever validated, or when they last agreed with the publisher.
 *   • Download age is the wrong clock. It deletes permitted audio from a user who has been offline —
 *     exactly the user condition C9 protects — while saying nothing about whether a check succeeded.
 *
 * Two authorities disagreeing about what is playable is worse than either alone, so this runs once
 * and the manifest becomes the only authority afterwards.
 *
 * ── Why identity is *proved* rather than parsed ────────────────────────────
 * Files already on disk were written before a manifest existed, so their identity is recoverable only
 * from their names. `planLegacyMigration` is the one boundary where a name may be parsed — and it is
 * also where the guess is checked against a synchronised recitation row. A file nothing corroborates
 * is **not adopted**: a mis-bound recitation plays one verse in another's place and nothing
 * downstream can notice.
 *
 * ── Resumable and idempotent, and what that costs ──────────────────────────
 * The plan is computed from the filesystem and the synchronised rows every time, so an interrupted
 * run simply recomputes. `migratedLegacyFiles` records that a complete pass finished, which is stored
 * rather than inferred from a non-empty manifest — a user with no downloads and a user whose files
 * were all unprovable both produce zero rows, and only one of them still needs the sweep.
 *
 * A second run over an already-migrated device re-derives the same rows and writes the same manifest.
 * It does not re-download, because adoption never fetches, and it does not duplicate, because rows
 * are keyed by identity through `upsertRows`.
 *
 * ── Nothing here deletes a valid file ──────────────────────────────────────
 * Unprovable files are reported to the caller and left on disk. Invalid legacy state fails closed:
 * the manifest is not published, the legacy index is untouched, and the next launch tries again.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Why a file on disk could not be adopted. A closed set — no message, no path, no name. */
export type MigrationRejection =
  /** The name could not be parsed into a reciter, surah and ayah. */
  | 'unreadable-name'
  /** Parsed, but no synchronised row corroborates that identity. */
  | 'unproved-identity'
  /** Present but too small to be a recitation of an ayah. */
  | 'too-small'
  /** Listed by the store and then unreadable — removed or reclaimed between the two calls. */
  | 'missing';

export type MigrationOutcome =
  | {
      readonly kind: 'migrated';
      /** Files adopted into the manifest, needing verification before they become playable. */
      readonly adopted: number;
      /** Files left on disk that could not be proved. Never deleted by this module. */
      readonly rejected: number;
      readonly rejections: Readonly<Record<MigrationRejection, number>>;
    }
  /** Already done. Nothing was read and nothing was written. */
  | { readonly kind: 'already-migrated' }
  /**
   * The synchronised recitation rows are not present yet, so no identity can be proved.
   *
   * Not a failure: a device that has never completed a sync has nothing to prove identities against,
   * and adopting on the strength of filenames alone is the exact practice being retired. The
   * migration simply waits for the first successful sync.
   */
  | { readonly kind: 'deferred'; readonly reason: 'no-synced-rows' }
  /** The manifest could not be written. Nothing was published; the legacy index is untouched. */
  | { readonly kind: 'failed'; readonly reason: 'write-failed' };

export type MigrationDependencies = {
  readonly store: AudioStore;
  readonly now: () => number;
};

/**
 * Runs the migration if it is owed.
 *
 * The caller supplies the store rather than this module reaching for one, so a test can drive an
 * in-memory filesystem with exactly the awkward combinations that matter — a file listed and then
 * unreadable, a name that parses to a reciter nobody synchronised, a byte count below the floor.
 */
export async function migrateLegacyAudio(deps: MigrationDependencies): Promise<MigrationOutcome> {
  const existing = await readAudioManifest();
  if (existing.migratedLegacyFiles) {
    return { kind: 'already-migrated' };
  }

  /*
    Identities are proved against the **active generation**, resolved through the pointer, so the
    migration can never run against half-published rows: a generation is visible only once it has
    been written, reopened and validated in full, and a publication that failed is not visible at all.
  */
  const generation = await readActiveGeneration();
  const synced = generation?.recitations ?? null;
  if (synced === null || synced.rows.length === 0) {
    /*
      Nothing to prove identities against. Deliberately not treated as "adopt what is there": the
      whole point of the manifest is that presence is not identity.
    */
    return { kind: 'deferred', reason: 'no-synced-rows' };
  }

  const files = deps.store.list();
  const rejections: Record<MigrationRejection, number> = {
    'unreadable-name': 0,
    'unproved-identity': 0,
    'too-small': 0,
    missing: 0,
  };

  /**
   * Sizes read from the store, and the first place a listed-then-missing file is caught.
   *
   * `list()` and `read()` are two calls against a filesystem the OS may reclaim between them, so a
   * name can be listed and then answer `null`. That file is `missing` rather than adopted with an
   * invented size.
   */
  const bytesByName = new Map<string, number | null>();
  for (const file of files) {
    const found = deps.store.read(file.name);
    if (found === null) {
      bytesByName.set(file.name, null);
      rejections.missing += 1;
      continue;
    }
    if (found.bytes < MIN_AUDIO_BYTES) {
      /*
        A truncated transfer that the old generation would have served: large enough to exist, too
        small to decode. Rejected here rather than handed to a player that would report a playback
        error against a verse that is perfectly fine.
      */
      bytesByName.set(file.name, null);
      rejections['too-small'] += 1;
      continue;
    }
    bytesByName.set(file.name, found.bytes);
  }

  const plan = planLegacyMigration({
    fileNames: files.map((file) => file.name),
    parse: (fileName) => {
      const identity = parseAudioFileName(fileName);
      if (identity === null) {
        rejections['unreadable-name'] += 1;
      }
      return identity;
    },
    bytesFor: (fileName) => bytesByName.get(fileName) ?? null,
    knownRows: synced.rows.map((row) => ({
      resourceId: row.resourceId,
      surah: row.surah,
      ayah: row.ayah,
      verseKey: row.verseKey,
      sequence: row.sequence,
    })),
    at: deps.now(),
  });

  /*
    Whatever the planner rejected that was not already counted is an unproved identity: the name read
    correctly and the bytes were fine, and nothing the vendor sent agrees that the file is what it
    says it is.
  */
  const accountedFor = rejections['unreadable-name'] + rejections['too-small'] + rejections.missing;
  rejections['unproved-identity'] = Math.max(0, plan.unprovable.length - accountedFor);

  /**
   * Published in one write.
   *
   * `upsertRows` onto the existing manifest rather than replacing it: a device that already holds
   * manifest rows from a newer download must not lose them to a migration pass, and keying by
   * identity makes a second run produce the same manifest rather than duplicate entries.
   */
  const next: AudioManifest = {
    ...upsertRows(existing.rows.length === 0 ? EMPTY_MANIFEST : existing, plan.rows),
    migratedLegacyFiles: true,
  };

  if (!(await writeAudioManifest(next))) {
    /*
      Fail closed. The manifest is not published, `migratedLegacyFiles` stays false, the legacy index
      is untouched, and no valid file was deleted — so the next launch simply tries again.
    */
    return { kind: 'failed', reason: 'write-failed' };
  }

  return {
    kind: 'migrated',
    adopted: plan.rows.length,
    rejected: plan.unprovable.length,
    rejections,
  };
}

/**
 * Whether the manifest is the runtime authority yet.
 *
 * Read by the playback and download paths so that neither has to know how migration works — only
 * whether it has finished. Before it has, those paths must not treat an empty manifest as "nothing is
 * downloaded", because the files may be there and simply not yet adopted.
 */
export function manifestIsAuthoritative(manifest: AudioManifest): boolean {
  return manifest.migratedLegacyFiles;
}

/**
 * Rows that need attention before they can be played, without deleting anything.
 *
 * `downloaded` rows are adopted-but-unverified; `failed` and `removal-required` are exactly what they
 * say. None of these is a reason to remove bytes — the repair path re-fetches only what it must.
 */
export function rowsNeedingRepair(manifest: AudioManifest): readonly AudioManifestRow[] {
  return manifest.rows.filter((row) => row.state === 'failed' || row.state === 'removal-required');
}
