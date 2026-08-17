import {
  offlineFileName,
  verseKeyOf,
  type OfflineFileRow,
  type OfflineManifest,
} from '../../storage/faith-offline-recitation';

/**
 * Comparing what the device holds with what a published generation says, and deciding nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is pure, and what that buys ───────────────────────────────────
 * Reconciliation is the operation with the worst failure mode in this feature: getting it wrong
 * either deletes recitation the user is entitled to keep, or leaves a superseded file playing as
 * though it were current. Both are silent. So the decision is separated from the doing — this module
 * returns a plan, the engine executes it — which makes every branch reachable from a test with
 * ordinary data instead of a filesystem, a network and a race.
 *
 * ── The one ordering rule everything else follows from ─────────────────────
 * **A playable file is never deleted before its replacement is validated.** A row whose publisher
 * data changed is marked `update-required` and *stays playable*; the replacement is fetched to
 * `.part`, validated, and promoted by an atomic rename that replaces the old bytes in one step.
 * There is no instant at which the ayah is unavailable, and a failed replacement leaves the previous
 * recitation exactly where it was.
 *
 * The single exception is withdrawal: a verse the publisher no longer publishes has no replacement to
 * wait for, and the obligation is to apply removals promptly. Those files are removed — which is why
 * `withdrawn` is a separate list from `updated` and why the engine stops playback that is sourcing
 * one of them before it deletes.
 *
 * ── What "changed" means, and the honesty limit on it ──────────────────────
 * Identity is the verse key, which is stable and vendor-supplied. Change is detected from the safe
 * metadata a recitation row carries — `sequence`, `bytes`, `durationSeconds` — because those are the
 * only fields the publisher gives that could distinguish two recordings of the same verse. None of
 * them is a content hash, and this module does not pretend otherwise: a re-recording published at the
 * same length and size would not be detected here.
 *
 * That limit is not a gap being papered over. It is the consequence of assumption **A1** recorded in
 * `docs/QURAN_FOUNDATION_AUDIO_PERMISSION.md` §8.4: the change feed has **never** emitted a
 * recitation mutation on any device to date, so reconciliation happens by re-fetching the snapshot
 * and comparing it. Nothing here may be described as a proven mutation mechanism, and
 * `faith-recitation-check.ts` keeps `mutationEverObserved` false until one is actually read off the
 * wire.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** One ayah as a published generation states it. */
export type PublishedRow = {
  readonly surah: number;
  readonly ayah: number;
  readonly verseKey: string;
  readonly bytes: number | null;
  readonly durationSeconds: number | null;
  readonly sequence: number | null;
};

export type ReconciliationPlan = {
  /** The generation this plan was computed against. Carried so the engine cannot apply it elsewhere. */
  readonly generationId: string;
  /**
   * Rows whose publisher metadata changed. Marked `update-required`; files stay playable until
   * a validated replacement is promoted over them.
   */
  readonly updated: readonly OfflineFileRow[];
  /**
   * Rows the generation no longer publishes. Their files are removed, and playback sourcing one of
   * them is stopped first.
   */
  readonly withdrawn: readonly OfflineFileRow[];
  /** Rows that still agree with the publisher. Their `verifiedAt` advances; nothing else changes. */
  readonly unchanged: readonly OfflineFileRow[];
  /**
   * Verses the generation publishes that this device has no row for at all.
   *
   * Reported rather than acted on: whether they are fetched depends on the user's scope, which this
   * module deliberately does not know. A device that downloaded three surahs is not missing 6,000
   * files — it is missing nothing.
   */
  readonly absentVerseKeys: readonly string[];
};

/** Whether a published row differs from what the device recorded when it downloaded the file. */
function differs(row: OfflineFileRow, published: PublishedRow): boolean {
  /*
    Sequence first: it is the publisher's own ordering value, and a change to it is the closest thing
    to an explicit statement that the row was rewritten. A row that never carried one compares null to
    null and falls through to the size comparison.
  */
  if (row.sequence !== published.sequence) {
    return true;
  }
  /*
    Expected bytes, not downloaded bytes. Comparing what is on disk against the publisher would flag
    every file whose transfer legitimately differs from a stated size — and would flag every file at
    all on a feed that publishes no sizes, marking the whole Qur'an `update-required` on first sync.
  */
  if (
    published.bytes !== null &&
    row.expectedBytes !== null &&
    published.bytes !== row.expectedBytes
  ) {
    return true;
  }
  return false;
}

/**
 * Compares the manifest with one generation's rows.
 *
 * Takes the rows rather than reading them, so the caller has already bound to one generation and this
 * cannot silently mix two publications — the failure the whole generation model exists to prevent.
 */
export function planReconciliation(input: {
  readonly manifest: OfflineManifest;
  readonly generationId: string;
  readonly published: readonly PublishedRow[];
  readonly at: number;
}): ReconciliationPlan {
  const { manifest, generationId, published, at } = input;

  const publishedByKey = new Map(published.map((row) => [row.verseKey, row]));

  const updated: OfflineFileRow[] = [];
  const withdrawn: OfflineFileRow[] = [];
  const unchanged: OfflineFileRow[] = [];

  for (const row of manifest.rows) {
    const match = publishedByKey.get(row.verseKey);
    if (match === undefined) {
      withdrawn.push(row);
      continue;
    }
    if (differs(row, match)) {
      updated.push({
        ...row,
        state: 'update-required',
        /*
          `expectedBytes` takes the publisher's new figure so the replacement is validated against
          what was actually published, not against what the superseded file was.
        */
        expectedBytes: match.bytes,
        sequence: match.sequence,
        verifiedAt: at,
      });
      continue;
    }
    unchanged.push({ ...row, verifiedAt: at, generationId });
  }

  const held = new Set(manifest.rows.map((row) => row.verseKey));
  const absentVerseKeys = published
    .filter((row) => !held.has(row.verseKey))
    .map((row) => row.verseKey);

  return { generationId, updated, withdrawn, unchanged, absentVerseKeys };
}

/**
 * The verses a run still has to fetch, in playback order.
 *
 * ── Why the order is surah then ayah and not "whatever is fastest" ──────────
 * Because a download that is interrupted at 60% should have left the *first* 60% of the Qur'an on the
 * device, not a scatter across all 114 surahs of which no surah is complete. A user who stops a
 * download and opens the reader should find whole surahs playable; the alternative — every surah
 * partly present — is the arrangement in which nothing at all can be played end to end.
 */
export function pendingWork(input: {
  readonly manifest: OfflineManifest;
  readonly published: readonly PublishedRow[];
  /** The surahs the user asked for. Empty means every surah the generation publishes. */
  readonly surahs: readonly number[];
}): readonly PublishedRow[] {
  const { manifest, published } = input;
  const wanted = input.surahs.length === 0 ? null : new Set(input.surahs);

  const byKey = new Map(manifest.rows.map((row) => [row.verseKey, row]));

  return published
    .filter((row) => {
      if (wanted !== null && !wanted.has(row.surah)) {
        return false;
      }
      const held = byKey.get(row.verseKey);
      if (held === undefined) {
        return true;
      }
      /*
        `available` with a good signature is the only state that needs nothing. `update-required` is
        deliberately included: the file is still playable, and it is also owed a replacement.
      */
      return !(held.state === 'available' && held.validation === 'signature-ok' && held.bytes > 0);
    })
    .sort((left, right) =>
      left.surah === right.surah ? left.ayah - right.ayah : left.surah - right.surah,
    );
}

/**
 * A fresh row for a verse about to be queued.
 *
 * Constructed here rather than at the transfer site so that every row entering the manifest has its
 * identity built the same way — the verse key and the file name are both functions of the surah and
 * ayah, and deriving them in two places is how the two come to disagree.
 */
export function queuedRowFor(input: {
  readonly resourceId: number;
  readonly published: PublishedRow;
  readonly generationId: string;
  /** Preserved when re-queuing a file that already exists, so a replacement keeps its history. */
  readonly previous?: OfflineFileRow | null;
}): OfflineFileRow {
  const { resourceId, published, generationId } = input;
  const previous = input.previous ?? null;
  return {
    resourceId,
    surah: published.surah,
    ayah: published.ayah,
    verseKey: verseKeyOf(published.surah, published.ayah),
    fileName: offlineFileName(resourceId, published.surah, published.ayah),
    /*
      A replacement stays in `update-required` while it is queued rather than dropping to `queued`.
      The distinction is what keeps the existing bytes playable: `queued` describes a verse with
      nothing on disk, and a player that saw one would correctly refuse to source it.
    */
    state: previous !== null && previous.state === 'update-required' ? 'update-required' : 'queued',
    bytes: previous?.bytes ?? 0,
    expectedBytes: published.bytes,
    validation: previous?.validation ?? 'unverified',
    generationId,
    sequence: published.sequence,
    completedAt: previous?.completedAt ?? null,
    verifiedAt: previous?.verifiedAt ?? null,
  };
}

/**
 * The ayah counts a generation publishes, per surah.
 *
 * The one source for "how many verses does this surah have", derived from the publication the
 * download is bound to rather than from a table compiled into the app. A bundled table would be a
 * second, unsourced copy of the structure of the Qur'an, and the first time it disagreed with the
 * publisher the disagreement would be invisible.
 */
export function ayatBySurah(published: readonly PublishedRow[]): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const row of published) {
    counts.set(row.surah, (counts.get(row.surah) ?? 0) + 1);
  }
  return counts;
}
