import { markActiveLocationChanged } from '../data/location/active-location';
import { timeZoneForCoordinate } from '../data/prayer/location-time-zone';
import type { Coordinate } from '../data/prayer-times.repository';
import {
  faithStorageKeys,
  hasNumber,
  hasString,
  isRecord,
  readJson,
  writeJson,
} from './faith-storage';

/**
 * The active prayer location: one versioned record, and the one place that writes it.
 *
 * ── Why the previous shape had to go ────────────────────────────────────────
 * It carried both `manual: boolean` and `mode?: 'device' | 'manual'`, which are the same fact
 * expressed twice. Two of the four combinations are contradictions — `manual: true, mode: 'device'`
 * and its mirror — and nothing prevented one being written. A record like that has no correct
 * reading: the mode decides whether an automatic GPS refresh may overwrite a saved city, and
 * guessing which field to believe would silently replace somebody's deliberate choice.
 *
 * A discriminated union makes both contradictions *unrepresentable*. `mode` is the discriminant and
 * the only mode field; `manual` is gone from everything newly written.
 *
 * ── Why the timezone is stored beside the coordinate ────────────────────────
 * Because they are one fact. Every prayer instant is stamped in the location's zone, so a record
 * that carries a coordinate and re-derives the zone on each read has two places to disagree — and a
 * plausible time in the wrong zone is indistinguishable from a correct one. Storing them together,
 * and validating the pair before publishing, means a snapshot is either wholly usable or rejected.
 *
 * ── Why the label carries provenance ────────────────────────────────────────
 * "Dubai, UAE" typed by a user and "Dubai, United Arab Emirates" returned by a reverse geocoder are
 * different kinds of claim, and only one of them is evidence of anything. The provenance travels
 * with the label so no screen has to infer it from the mode.
 */

/** The schema version. Bumped only when the *meaning* of a stored field changes. */
export const PRAYER_LOCATION_SCHEMA_VERSION = 2;

export type PrayerLocationMode = 'device' | 'manual';

export type SavedPrayerLocationV2 =
  | {
      readonly version: 2;
      readonly mode: 'manual';
      readonly coordinate: Coordinate;
      readonly label: string | null;
      /** A manual label is always the user's own words, and is never verified. */
      readonly labelProvenance: 'user-supplied';
      readonly timezone: string;
      readonly resolvedAt: string;
    }
  | {
      readonly version: 2;
      readonly mode: 'device';
      readonly coordinate: Coordinate;
      readonly label: string | null;
      /** A device label comes from the platform geocoder, or the geocoder had nothing. */
      readonly labelProvenance: 'reverse-geocoded' | 'unavailable';
      readonly timezone: string;
      readonly resolvedAt: string;
      readonly accuracyMetres: number | null;
    };

/** What a caller supplies. The timezone is resolved by the boundary, never passed in. */
export type PrayerLocationCandidate =
  | {
      readonly mode: 'manual';
      readonly coordinate: Coordinate;
      readonly label: string | null;
      readonly resolvedAt: string;
    }
  | {
      readonly mode: 'device';
      readonly coordinate: Coordinate;
      readonly label: string | null;
      readonly resolvedAt: string;
      readonly accuracyMetres: number | null;
    };

export type CommitOptions = {
  /**
   * Why this write is happening.
   *
   * `change` is a real location change and publishes a new revision. `migration` rewrites an
   * existing location into the current schema — the place has not moved, so subscribers have nothing
   * to recompute and the revision must not move either.
   */
  readonly reason?: 'change' | 'migration';
};

export type CommitResult =
  | {
      readonly kind: 'committed';
      readonly record: SavedPrayerLocationV2;
      readonly published: boolean;
    }
  /** Nothing was written because the candidate is already exactly what is stored. */
  | { readonly kind: 'unchanged'; readonly record: SavedPrayerLocationV2 }
  | {
      readonly kind: 'rejected';
      readonly reason: 'invalid-coordinate' | 'timezone-unresolved' | 'write-failed';
    };

function isUsableCoordinate(value: unknown): value is Coordinate {
  if (!isRecord(value) || !hasNumber(value, 'latitude') || !hasNumber(value, 'longitude')) {
    return false;
  }
  const { latitude, longitude } = value as { latitude: number; longitude: number };
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/**
 * **The single mutation boundary.** Nothing else writes `faithStorageKeys.location`.
 *
 * ── What it exclusively owns ────────────────────────────────────────────────
 * Validating the candidate; resolving and attaching the timezone; deciding whether the write is even
 * necessary; serialising; completing the write; incrementing the revision; publishing to
 * subscribers. Splitting any of those across call sites is how a revision gets published before the
 * bytes land, or a record gets stored with a zone that does not match its coordinate.
 *
 * ── The ordering guarantee ──────────────────────────────────────────────────
 * The revision is incremented **after** `writeJson` resolves, never before. A subscriber woken by a
 * revision always re-reads storage that already holds the new value; a failed write publishes
 * nothing at all.
 */
export async function commitActivePrayerLocation(
  candidate: PrayerLocationCandidate,
  options: CommitOptions = {},
): Promise<CommitResult> {
  if (!isUsableCoordinate(candidate.coordinate)) {
    return { kind: 'rejected', reason: 'invalid-coordinate' };
  }

  /*
    Resolved here rather than accepted from the caller. The zone is a *function* of the coordinate,
    so letting a caller supply one would be letting it supply a contradiction — and validating a
    passed-in zone against the coordinate is the same work as deriving it.
  */
  const timezone = timeZoneForCoordinate(candidate.coordinate);
  if (timezone === null) {
    return { kind: 'rejected', reason: 'timezone-unresolved' };
  }

  const record: SavedPrayerLocationV2 =
    candidate.mode === 'manual'
      ? {
          version: PRAYER_LOCATION_SCHEMA_VERSION,
          mode: 'manual',
          coordinate: candidate.coordinate,
          label: candidate.label,
          labelProvenance: 'user-supplied',
          timezone,
          resolvedAt: candidate.resolvedAt,
        }
      : {
          version: PRAYER_LOCATION_SCHEMA_VERSION,
          mode: 'device',
          coordinate: candidate.coordinate,
          label: candidate.label,
          // Provenance follows whether the geocoder actually produced a name.
          labelProvenance: candidate.label === null ? 'unavailable' : 'reverse-geocoded',
          timezone,
          resolvedAt: candidate.resolvedAt,
          accuracyMetres: candidate.accuracyMetres,
        };

  /*
    An equivalent snapshot writes nothing and publishes nothing. `resolvedAt` is excluded from the
    comparison deliberately: a re-resolution of the same place at the same accuracy is not a change
    anything downstream can act on, and treating it as one would reschedule 35 notifications every
    time a screen opened.
  */
  /*
    ── Deliberately the *non-migrating* read ─────────────────────────────────
    `readActivePrayerLocation` migrates a legacy record by calling this function, so using it here
    would recurse: commit → read → migrate → commit. It did, and the suite exhausted the heap. The
    equivalence check only ever needs to compare against an already-current record, so it reads the
    raw V2 value and treats anything else as "not equivalent" — which is correct, because a legacy
    record genuinely is not equal to the V2 one replacing it.
  */
  const existing = await readRawV2();
  if (existing !== null && isEquivalent(existing, record)) {
    return { kind: 'unchanged', record: existing };
  }

  try {
    await writeJson(faithStorageKeys.location, record);
  } catch {
    return { kind: 'rejected', reason: 'write-failed' };
  }

  const publish = (options.reason ?? 'change') === 'change';
  if (publish) {
    markActiveLocationChanged();
  }
  return { kind: 'committed', record, published: publish };
}

/** The stored value if — and only if — it is already a valid V2 record. Never migrates, never writes. */
async function readRawV2(): Promise<SavedPrayerLocationV2 | null> {
  const raw = await readJson<unknown>(
    faithStorageKeys.location,
    null,
    (_value): _value is unknown => true,
  );
  return isSavedV2(raw) ? raw : null;
}

/** Whether two records describe the same active location, ignoring when it was resolved. */
function isEquivalent(a: SavedPrayerLocationV2, b: SavedPrayerLocationV2): boolean {
  if (a.mode !== b.mode || a.timezone !== b.timezone || a.label !== b.label) {
    return false;
  }
  if (
    a.coordinate.latitude !== b.coordinate.latitude ||
    a.coordinate.longitude !== b.coordinate.longitude
  ) {
    return false;
  }
  if (a.mode === 'device' && b.mode === 'device') {
    return a.accuracyMetres === b.accuracyMetres;
  }
  return true;
}

/** A stored value that is already a valid V2 record. */
function isSavedV2(value: unknown): value is SavedPrayerLocationV2 {
  if (!isRecord(value) || value.version !== PRAYER_LOCATION_SCHEMA_VERSION) {
    return false;
  }
  if (!isUsableCoordinate(value.coordinate) || !hasString(value, 'timezone')) {
    return false;
  }
  if (!hasString(value, 'resolvedAt')) {
    return false;
  }
  const label = value.label;
  if (label !== null && typeof label !== 'string') {
    return false;
  }
  if (value.mode === 'manual') {
    return value.labelProvenance === 'user-supplied';
  }
  if (value.mode === 'device') {
    const accuracy = value.accuracyMetres;
    return (
      (value.labelProvenance === 'reverse-geocoded' || value.labelProvenance === 'unavailable') &&
      (accuracy === null || typeof accuracy === 'number')
    );
  }
  return false;
}

/**
 * A legacy record, migrated — or `null` when it cannot be migrated honestly.
 *
 * ── Where this fails closed, and why ────────────────────────────────────────
 * When `manual` and `mode` are both present and disagree. That pair has no correct reading, and the
 * two possible guesses have opposite consequences: read it as `device` and an automatic refresh may
 * replace a city the user chose; read it as `manual` and their location stops following them. A
 * record nobody can interpret is discarded rather than interpreted.
 */
export function migrateLegacyRecord(value: unknown): PrayerLocationCandidate | null {
  if (!isRecord(value) || !isUsableCoordinate(value.coordinate)) {
    return null;
  }
  if (!hasString(value, 'resolvedAt')) {
    return null;
  }

  const legacyManual = value.manual;
  const legacyMode = value.mode;
  const hasManual = typeof legacyManual === 'boolean';
  const hasMode = legacyMode === 'manual' || legacyMode === 'device';

  if (hasManual && hasMode) {
    const impliedByManual = legacyManual === true ? 'manual' : 'device';
    if (impliedByManual !== legacyMode) {
      // Contradictory. Fail closed — see the note above.
      return null;
    }
  }
  const mode: PrayerLocationMode = hasMode
    ? (legacyMode as PrayerLocationMode)
    : hasManual && legacyManual === true
      ? 'manual'
      : 'device';

  const label = typeof value.label === 'string' && value.label.length > 0 ? value.label : null;
  const coordinate = value.coordinate;
  const resolvedAt = value.resolvedAt as string;

  if (mode === 'manual') {
    return { mode: 'manual', coordinate, label, resolvedAt };
  }
  const accuracy = value.accuracyMetres;
  return {
    mode: 'device',
    coordinate,
    label,
    resolvedAt,
    accuracyMetres: typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null,
  };
}

/**
 * The last record that was successfully read or committed in this process.
 *
 * ── Why a runtime snapshot exists at all ────────────────────────────────────
 * The brief's recovery rule: if a stored record cannot be migrated into a complete valid one, the
 * app should retain the last valid snapshot rather than losing the user's location. Storage is still
 * the source of truth — this is only what the process already knew, so a corrupt write does not blank
 * a working screen mid-session.
 */
let lastValidSnapshot: SavedPrayerLocationV2 | null = null;

/**
 * The active location, migrating a legacy record exactly once.
 *
 * ── Why a read is allowed to write ──────────────────────────────────────────
 * Only on the one read that finds a legacy record. It goes through the same mutation boundary, with
 * `reason: 'migration'` so no revision is published — the place has not moved, only its
 * representation — and every subsequent read finds V2 and writes nothing.
 */
export async function readActivePrayerLocation(): Promise<SavedPrayerLocationV2 | null> {
  const raw = await readJson<unknown>(
    faithStorageKeys.location,
    null,
    (_value): _value is unknown => true,
  );
  if (raw === null || raw === undefined) {
    return null;
  }

  if (isSavedV2(raw)) {
    lastValidSnapshot = raw;
    return raw;
  }

  const candidate = migrateLegacyRecord(raw);
  if (candidate === null) {
    // Unreadable or contradictory. Keep whatever this process last knew to be valid.
    return lastValidSnapshot;
  }

  const committed = await commitActivePrayerLocation(candidate, { reason: 'migration' });
  if (committed.kind === 'rejected') {
    return lastValidSnapshot;
  }
  lastValidSnapshot = committed.record;
  return committed.record;
}

/** Forgets the location. Used when the user clears it, and by the Faith data reset. */
export async function clearActivePrayerLocation(): Promise<void> {
  lastValidSnapshot = null;
  const { removeKey } = await import('./faith-storage');
  await removeKey(faithStorageKeys.location);
}

/** Drops the in-process recovery snapshot. Test-only. */
export function resetPrayerLocationSnapshotForTest(): void {
  lastValidSnapshot = null;
}
