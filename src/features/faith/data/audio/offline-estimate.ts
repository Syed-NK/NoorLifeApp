/**
 * How large a complete offline recitation will be, stated only as far as it is actually known.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The rule this module exists to hold ────────────────────────────────────
 * **Do not fabricate a total.** Quran Foundation's recitation rows carry `bytes` only where the
 * publisher supplied it — the field is nullable on `RecitationRow` precisely because it is sometimes
 * absent — so an implementation that multiplied "average ayah size" by 6,236 and printed
 * "562 MB" would be presenting an invention with the typography of a measurement. A user decides
 * whether to spend half a gigabyte on the strength of that number.
 *
 * So there are three outcomes and they are genuinely different:
 *
 *   • `exact` — every ayah in scope has a known size. The total is a sum, not an estimate.
 *   • `partial` — some do. The known bytes are stated exactly, and the remainder is given as a
 *     **range derived from those known sizes themselves**, never from a constant in this file.
 *   • `unknown` — none do. Nothing is claimed about bytes.
 *
 * ── What the live feed actually publishes, measured on device ──────────────
 * All **6,236** rows of the active resource-3 generation carry `bytes: null`. Quran Foundation
 * publishes a `durationSeconds` per ayah and no file size at all. So `unknown` is not a defensive
 * branch for an unlikely feed — it is the branch that runs, and the other two would be dead code if
 * the publisher were the only source of sizes.
 *
 * Two consequences, and both are what makes this module honest rather than merely cautious:
 *
 *   1. **A size is projected only from files this device has actually downloaded.** Once ayat have
 *      landed, their byte counts are measurements — real files, this reciter, the bitrate the CDN
 *      actually served — so feeding them back in as known sizes turns `unknown` into `partial` as the
 *      download proceeds. `sizeSource` records where the numbers came from so the screen can say
 *      "from your downloads so far" rather than implying the publisher stated them.
 *
 *   2. **Duration is reported instead, because duration *is* published.** "About 20 hours of
 *      recitation" is a figure the vendor supplied and a real basis for judging a download; a byte
 *      total derived from it would need a bitrate nobody published, which is precisely the invention
 *      this module exists to refuse.
 *
 * ── Where the range comes from ─────────────────────────────────────────────
 * From between-surah variation in the published data, because that is the variation that actually
 * exists: ayah length correlates strongly with surah, so the mean ayah size of Al-Baqarah and of
 * An-Nas are far apart, and a range built from the spread of *per-surah means* reflects a real
 * property of the recitation rather than a confidence interval this module is in no position to
 * compute.
 *
 * The bounds are the smallest and largest per-surah mean among surahs whose sizes are fully
 * published. With fewer than two such surahs there is no spread to measure, and the fallback is the
 * smallest and largest individual published ayah — wider, cruder, and honestly labelled by the
 * `basis` field so the screen can say which one it is showing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * One ayah, with whatever is known about it.
 *
 * `bytes` is null where nothing knows the size — which, against the live feed, is every row until
 * this device downloads it. `measured` says which of the two a non-null size is, because "the
 * publisher states this is 91 KB" and "this device downloaded 91 KB" are different claims and the
 * screen must not present the second as the first.
 */
export type SizedRow = {
  readonly surah: number;
  readonly ayah: number;
  readonly bytes: number | null;
  /** True when `bytes` came from a file on this device rather than from the publisher. */
  readonly measured?: boolean;
  /** Seconds of recitation, as published. Present on every live row; never estimated. */
  readonly durationSeconds?: number | null;
};

/** Which known data the range was derived from, so the screen can qualify it truthfully. */
export type EstimateBasis =
  /** Spread of per-surah mean sizes across fully-known surahs. The good case. */
  | 'surah-means'
  /** Spread of individual ayah sizes. Used when fewer than two surahs are fully known. */
  | 'ayah-extremes';

/**
 * Where the byte figures came from.
 *
 * The distinction the screen's wording turns on. Against the live feed this is always `measured`
 * once anything is known at all, because the publisher supplies no sizes — so a caption that said
 * "as published" would be crediting the vendor with a number this device worked out itself.
 */
export type SizeSource = 'published' | 'measured' | 'mixed';

export type SizeEstimate =
  /**
   * No byte figure exists yet, from either source.
   *
   * Carries the published *duration* instead, which is a real vendor-supplied quantity and the only
   * honest basis a user has for judging a download before it starts.
   */
  | {
      readonly kind: 'unknown';
      readonly totalAyat: number;
      readonly totalDurationSeconds: number | null;
    }
  | {
      readonly kind: 'partial';
      readonly totalAyat: number;
      /** Ayat whose size is known, from either source. */
      readonly knownAyat: number;
      /** Exact bytes for those ayat. Not an estimate. */
      readonly knownBytes: number;
      /** Lower and upper bytes for the whole scope, inclusive of `knownBytes`. */
      readonly lowBytes: number;
      readonly highBytes: number;
      readonly basis: EstimateBasis;
      readonly sizeSource: SizeSource;
      readonly totalDurationSeconds: number | null;
    }
  | {
      readonly kind: 'exact';
      readonly totalAyat: number;
      readonly bytes: number;
      readonly sizeSource: SizeSource;
      readonly totalDurationSeconds: number | null;
    };

/** How many surahs must be fully published before per-surah means are used. */
const MIN_SURAHS_FOR_SPREAD = 2;

/**
 * Estimates the size of a set of rows.
 *
 * Pure and total. Takes the rows in scope — the whole generation for a complete download, one
 * surah's rows for a selected one — so the same function answers both questions and there is no
 * second code path in which a complete download could be estimated differently from a partial one.
 */
export function estimateSize(rows: readonly SizedRow[]): SizeEstimate {
  const totalAyat = rows.length;
  /**
   * The published total duration, summed over whatever rows carry one.
   *
   * `null` when the feed supplies none at all — the same refusal-to-invent that governs bytes. On the
   * live feed every row carries one, so this is the figure the screen leads with before a download
   * has produced any bytes to measure.
   */
  const durations = rows
    .map((row) => row.durationSeconds)
    .filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
    );
  const totalDurationSeconds =
    durations.length === 0 ? null : durations.reduce((sum, value) => sum + value, 0);

  if (totalAyat === 0) {
    return { kind: 'unknown', totalAyat: 0, totalDurationSeconds: null };
  }

  const sized = rows.filter(
    (row): row is SizedRow & { readonly bytes: number } =>
      typeof row.bytes === 'number' && Number.isFinite(row.bytes) && row.bytes > 0,
  );

  if (sized.length === 0) {
    return { kind: 'unknown', totalAyat, totalDurationSeconds };
  }

  /*
    Where the sizes came from. Against the live feed this resolves to `measured` the moment anything
    is known, because the publisher supplies none — and a caption that credited the vendor with a
    figure this device worked out itself would be misattributing a measurement.
  */
  const measuredCount = sized.filter((row) => row.measured === true).length;
  const sizeSource: SizeSource =
    measuredCount === 0 ? 'published' : measuredCount === sized.length ? 'measured' : 'mixed';

  const knownBytes = sized.reduce((sum, row) => sum + row.bytes, 0);
  if (sized.length === totalAyat) {
    return { kind: 'exact', totalAyat, bytes: knownBytes, sizeSource, totalDurationSeconds };
  }

  const unknownAyat = totalAyat - sized.length;

  /* Per-surah totals and counts, so a surah's mean is only used when the surah is fully known. */
  const publishedBySurah = new Map<number, { count: number; bytes: number }>();
  const totalBySurah = new Map<number, number>();
  for (const row of rows) {
    totalBySurah.set(row.surah, (totalBySurah.get(row.surah) ?? 0) + 1);
  }
  for (const row of sized) {
    const entry = publishedBySurah.get(row.surah) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += row.bytes;
    publishedBySurah.set(row.surah, entry);
  }

  const surahMeans: number[] = [];
  for (const [surah, entry] of publishedBySurah) {
    if (entry.count === totalBySurah.get(surah)) {
      surahMeans.push(entry.bytes / entry.count);
    }
  }

  let lowPerAyah: number;
  let highPerAyah: number;
  let basis: EstimateBasis;

  if (surahMeans.length >= MIN_SURAHS_FOR_SPREAD) {
    lowPerAyah = Math.min(...surahMeans);
    highPerAyah = Math.max(...surahMeans);
    basis = 'surah-means';
  } else {
    /*
      Not enough fully-published surahs for a spread to mean anything. The extremes of the individual
      published ayat are cruder and wider, and saying so through `basis` is better than presenting a
      narrow range computed from one surah as though it described the whole Qur'an.
    */
    const sizes = sized.map((row) => row.bytes);
    lowPerAyah = Math.min(...sizes);
    highPerAyah = Math.max(...sizes);
    basis = 'ayah-extremes';
  }

  return {
    kind: 'partial',
    totalAyat,
    knownAyat: sized.length,
    knownBytes,
    lowBytes: Math.round(knownBytes + lowPerAyah * unknownAyat),
    highBytes: Math.round(knownBytes + highPerAyah * unknownAyat),
    basis,
    sizeSource,
    totalDurationSeconds,
  };
}

/**
 * Merges what the publisher said with what this device has actually downloaded.
 *
 * ── Why the two are combined here rather than at the call site ─────────────
 * Because the combination *is* the honesty rule, and a call site that got it wrong would produce a
 * screen crediting the vendor with a figure the device worked out. There is one place that decides a
 * row's size is measured rather than published, and this is it.
 *
 * A measured byte count wins over a published one where both exist, and that is deliberate: the file
 * on disk is what occupies the storage the user is being asked about, and it is the figure that was
 * validated. A published size that disagreed with it would have failed validation and never been
 * promoted, so the two cannot silently differ.
 */
export function withMeasuredSizes(
  rows: readonly SizedRow[],
  measuredBytesByVerse: ReadonlyMap<string, number>,
): readonly SizedRow[] {
  if (measuredBytesByVerse.size === 0) {
    return rows;
  }
  return rows.map((row) => {
    const measured = measuredBytesByVerse.get(`${row.surah}:${row.ayah}`);
    if (measured === undefined || measured <= 0) {
      return row;
    }
    return { ...row, bytes: measured, measured: true };
  });
}

/**
 * The largest figure the estimate supports, for a storage preflight.
 *
 * The **upper** bound, deliberately. A preflight that reserved against the midpoint would let a
 * download start that the device cannot finish, and the failure would land after the user had waited
 * and spent the data. `null` when nothing is published, which is not the same as zero — see
 * `storageDecisionFor`, which treats the two differently.
 */
export function upperBoundBytes(estimate: SizeEstimate): number | null {
  switch (estimate.kind) {
    case 'exact':
      return estimate.bytes;
    case 'partial':
      return estimate.highBytes;
    case 'unknown':
      return null;
  }
}

/**
 * Free space kept back beyond whatever the download needs.
 *
 * A device driven to zero free bytes does not merely fail this download: it fails the manifest write
 * that would have recorded what had already been fetched, and on Android it starts failing things
 * that have nothing to do with NoorLife. 256 MiB is roughly the headroom the platform itself wants
 * for its own caches and updates, and leaving it is the difference between a download that stops and
 * a phone that misbehaves.
 */
export const STORAGE_SAFETY_MARGIN_BYTES = 256 * 1024 * 1024;

/**
 * The mean size of one ayah of resource 3, as measured on a device.
 *
 * ── Why a measured constant exists at all, when this module refuses to invent sizes ──
 * Because the two uses are not the same act. Showing a user "562 MB" derived from a bitrate nobody
 * published is a fabricated *claim*; choosing a threshold below which a multi-gigabyte download is
 * obviously doomed is a *safety decision*, and the alternative to making it from measurement is
 * making it from a guess — which is what happened, and it was wrong by a factor of six.
 *
 * This value is never displayed. `describeEstimate` has no access to it and there is no code path
 * that turns it into a caption; it exists solely to set the floor below.
 *
 * ── The measurement ────────────────────────────────────────────────────────
 * Release build on the Android emulator, 2026-08-16, generation
 * `gen-1786885216299-fc1ccbdb`: the first 288 promoted files totalled 138,029,860 bytes, a mean of
 * 479,270 bytes per ayah. Across 6,236 ayat that projects to roughly 3.0 GB.
 *
 * The previously documented figure — "Sudais ayat measured on device average roughly 90 KB" — was
 * wrong by 6.6×, and every conclusion drawn from it (including a 1 GiB floor that would have let a
 * download start with a quarter of the room it needed) was wrong with it.
 */
const MEASURED_MEAN_AYAH_BYTES = 479_270;

/** 6,236 ayat at the measured mean. Rounded up to a whole gibibyte. */
const MEASURED_COMPLETE_BYTES = 3 * 1024 * 1024 * 1024;

/**
 * Free space below which a download will not start even when the total is unknown.
 *
 * The floor that makes an unknown estimate actionable. Without it, a scope whose size nothing
 * published could be started on a device with 40 MB free, and the honest-but-useless outcome would be
 * a download that fails a few files in.
 *
 * ── Why this is 3 GiB and not the 1 GiB it was ─────────────────────────────
 * 1 GiB was chosen on the assumption that it "comfortably exceeds a complete Sudais recitation at any
 * bitrate the CDN serves". Measurement says otherwise: the complete recitation is about 3.0 GB, so a
 * device with 1.2 GB free would have passed the preflight and run out of space at roughly 40% — the
 * precise failure the preflight exists to prevent, and the one the design calls worse than never
 * starting.
 *
 * The during-download re-check still backstops this: once files land, the estimate becomes a
 * projection from real measurements and `storageDecisionFor` narrows with it.
 */
export const UNKNOWN_ESTIMATE_FLOOR_BYTES = MEASURED_COMPLETE_BYTES;

/** Exported for the report and for tests; never rendered. */
export const MEASURED_MEAN_AYAH_BYTES_FOR_REPORTING = MEASURED_MEAN_AYAH_BYTES;

export type StorageDecision =
  | { readonly kind: 'ok' }
  /** Clearly insufficient. Refused before a byte is requested. */
  | {
      readonly kind: 'insufficient';
      readonly availableBytes: number;
      /** What was needed, including the margin. */
      readonly requiredBytes: number;
    }
  /**
   * The platform would not report free space.
   *
   * Permitted to proceed, and that is a considered choice: refusing would make the feature
   * unavailable on any device whose filesystem API is unavailable, and the during-download re-check
   * still catches a device that fills up. The state is distinct so the screen can say the check was
   * not possible rather than implying it passed.
   */
  | { readonly kind: 'unmeasurable' };

/**
 * Whether there is room, given an estimate that may not exist.
 *
 * Three inputs and no hidden ones: what the publisher said, what the platform reports free, and how
 * much is already downloaded and therefore does not need to be fetched again. The third is what makes
 * "resume after a storage-short condition" work — a run that is 80% done needs 20% of the space, and
 * a preflight that ignored progress would refuse to finish a download it had nearly completed.
 */
export function storageDecisionFor(input: {
  readonly estimate: SizeEstimate;
  readonly availableBytes: number | null;
  /** Bytes already on disk and verified for this scope. Subtracted from what is still required. */
  readonly alreadyDownloadedBytes: number;
  readonly marginBytes?: number;
}): StorageDecision {
  const margin = input.marginBytes ?? STORAGE_SAFETY_MARGIN_BYTES;
  if (input.availableBytes === null) {
    return { kind: 'unmeasurable' };
  }

  const upper = upperBoundBytes(input.estimate);
  if (upper === null) {
    return input.availableBytes >= UNKNOWN_ESTIMATE_FLOOR_BYTES
      ? { kind: 'ok' }
      : {
          kind: 'insufficient',
          availableBytes: input.availableBytes,
          requiredBytes: UNKNOWN_ESTIMATE_FLOOR_BYTES,
        };
  }

  const remaining = Math.max(0, upper - input.alreadyDownloadedBytes);
  const required = remaining + margin;
  return input.availableBytes >= required
    ? { kind: 'ok' }
    : { kind: 'insufficient', availableBytes: input.availableBytes, requiredBytes: required };
}
