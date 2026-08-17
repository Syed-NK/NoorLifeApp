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
import { subscribeToFaithScope } from './faith-user-scope';

/**
 * The active prayer location: one versioned record, and the one place that writes it.
 *
 * ── What V3 changes, and why a third mode was necessary ─────────────────────
 * V2 had two modes, `device` and `manual`, and `manual` was carrying two genuinely different claims.
 * A coordinate somebody typed and a city selected from the bundled GeoNames catalogue are not the
 * same kind of fact: one is an unverified pair of numbers with a label that means nothing, the other
 * is an identified settlement with a source, an id, a country and a region that can be re-validated
 * against the catalogue it came from. Collapsing them lost every one of those fields, so a saved city
 * could not be told from a typed coordinate on relaunch — and the screen had to describe both as
 * "manual", which is true of the *authority* and false about the *evidence*.
 *
 * V3 splits them. `city` carries GeoNames identity; `coordinates` carries none and never pretends to.
 *
 * ── `mode` alone decides authority, and nothing else may ────────────────────
 * The discriminant is the whole answer to "may a device refresh overwrite this". Not a boolean beside
 * it, not a label, not the presence of an id — see `isUserSelectedLocation`, which is the only
 * function permitted to answer that question.
 *
 * ── Contradictions are unrepresentable rather than merely invalid ───────────
 * Each variant carries exactly the fields its mode can justify. `accuracyMetres` is a property of a
 * device fix and exists only on `device`. `geonamesId`, `countryCode` and `admin1` are properties of
 * a catalogue record and exist only on `city`. There is no shape in which a typed coordinate claims a
 * GeoNames id, or a selected city claims a GPS accuracy, because the type has no such field to set.
 *
 * ── Why the timezone is stored beside the coordinate ────────────────────────
 * Because they are one fact. Every prayer instant is stamped in the location's zone, so a record that
 * carries a coordinate and re-derives the zone on each read has two places to disagree — and a
 * plausible time in the wrong zone is indistinguishable from a correct one. Storing them together,
 * and validating the pair before publishing, means a snapshot is either wholly usable or rejected.
 *
 * ── Why the label carries provenance ────────────────────────────────────────
 * "Dubai" typed by a user, "Dubai" returned by the platform's reverse geocoder, and "Dubai" read out
 * of the GeoNames catalogue are three different claims, and only two of them are evidence of
 * anything. The provenance travels with the label so no screen has to infer it from the mode, and so
 * a user's own words can never be rendered as though something verified them.
 */

/** The schema version. Bumped only when the *meaning* of a stored field changes. */
export const PRAYER_LOCATION_SCHEMA_VERSION = 3;

/**
 * Where the active location's authority comes from.
 *
 * Three values, not two, and the third is not a refinement of the second — see the note above.
 */
export type PrayerLocationMode = 'device' | 'city' | 'coordinates';

/**
 * What produced the label, as a closed set.
 *
 * `device-unlabelled` and `coordinates` both mean "there is no name for this place", and they are
 * distinct because the reason differs: the geocoder was asked and had nothing, versus nobody was ever
 * in a position to ask. A screen renders the coordinate in both cases; an audit can tell them apart.
 */
export type LabelProvenance =
  /** The platform's reverse geocoder named this coordinate. */
  | 'reverse-geocoded'
  /** A device fix the geocoder could not name. */
  | 'device-unlabelled'
  /** Read from the bundled GeoNames catalogue, with the identity fields to prove it. */
  | 'geonames'
  /** The user's own words. Never verified, and never presented as though it were. */
  | 'user-supplied'
  /** A typed coordinate the user did not name. The numbers are the label. */
  | 'coordinates';

export type SavedPrayerLocationV3 =
  | {
      readonly version: 3;
      readonly mode: 'device';
      readonly coordinate: Coordinate;
      readonly timezone: string;
      readonly label: string | null;
      readonly labelProvenance: 'reverse-geocoded' | 'device-unlabelled';
      readonly resolvedAt: string;
      /**
       * Reported horizontal accuracy of the fix, in metres, or `null` where the platform gave none.
       *
       * Device-only by construction. The acceptance policy compares it against a new fix to decide
       * whether a stationary phone's jitter should rewrite storage; on a city or a typed coordinate
       * there is no such thing as accuracy, and a field that could hold one would invite a comparison
       * that has no meaning.
       */
      readonly accuracyMetres: number | null;
    }
  | {
      readonly version: 3;
      readonly mode: 'city';
      readonly coordinate: Coordinate;
      readonly timezone: string;
      /** Never null: a city selected from the catalogue always has the catalogue's own name. */
      readonly label: string;
      readonly labelProvenance: 'geonames';
      /** The catalogue's identity for this settlement. Lets a save be re-validated against it. */
      readonly geonamesId: number;
      /** ISO 3166-1 alpha-2, as GeoNames records it. */
      readonly countryCode: string;
      /** First administrative division, or `null` where the source has none. */
      readonly admin1: string | null;
      readonly resolvedAt: string;
    }
  | {
      readonly version: 3;
      readonly mode: 'coordinates';
      readonly coordinate: Coordinate;
      readonly timezone: string;
      readonly label: string | null;
      readonly labelProvenance: 'user-supplied' | 'coordinates';
      readonly resolvedAt: string;
    };

/**
 * Whether the active location is one the **user chose**, and must therefore survive a device refresh.
 *
 * ── The one predicate, replacing every scattered `mode === 'manual'` ────────
 * This is the question the old comparison was really asking, and spelling it as a mode comparison at
 * a dozen call sites made it a question each site answered for itself. Adding `coordinates` beside
 * `city` in V3 would have meant finding all of them and remembering that both count — exactly the
 * edit that gets 11 of 12 sites right and silently lets a GPS fix overwrite somebody's saved city on
 * the twelfth.
 *
 * Deliberately **not** a stored boolean. A field would be a second representation of a fact `mode`
 * already determines, which is the contradiction V2 was rewritten to remove; this is a function *of*
 * the discriminant, so it cannot disagree with it.
 */
export function isUserSelectedLocation(location: { readonly mode: PrayerLocationMode }): boolean {
  return location.mode === 'city' || location.mode === 'coordinates';
}

/**
 * What a caller supplies.
 *
 * The timezone is resolved by the boundary and never passed in, and `labelProvenance` is *derived*
 * rather than accepted — both for the same reason: a caller able to supply either could supply one
 * that contradicts the rest of the record, and validating a passed-in value against the fields it
 * must agree with is the same work as deriving it.
 */
export type PrayerLocationCandidate =
  | {
      readonly mode: 'device';
      readonly coordinate: Coordinate;
      readonly label: string | null;
      readonly resolvedAt: string;
      readonly accuracyMetres: number | null;
    }
  | {
      readonly mode: 'city';
      readonly coordinate: Coordinate;
      readonly label: string;
      readonly geonamesId: number;
      readonly countryCode: string;
      readonly admin1: string | null;
      readonly resolvedAt: string;
    }
  | {
      readonly mode: 'coordinates';
      readonly coordinate: Coordinate;
      readonly label: string | null;
      readonly resolvedAt: string;
    };

/**
 * One user-initiated attempt to change the active location.
 *
 * ── The defect this exists to make impossible ───────────────────────────────
 * Acquiring a device fix is slow and asynchronous, and nothing about starting it stops the user
 * doing something else. Press "Use device location" indoors, watch it time out, choose Dubai from the
 * catalogue instead — and if that first request is still alive underneath, its eventual success
 * commits a device fix *over* the city, minutes later, with no interaction. The stored authority
 * changes to something the user did not last ask for, every prayer time moves, and the notification
 * schedule is rebuilt. Nothing on screen reports it, because from the app's point of view a location
 * request simply finished.
 *
 * ── Why a generation counter rather than cancellation ───────────────────────
 * Because the platform will not cancel. `Location.getCurrentPositionAsync` returns a promise with no
 * abort, and `withTimeout` in `expo-location.port.ts` resolves a *race* — the native request keeps
 * running whatever the wrapper decided. `AbortController` would be a decoration over an API that
 * ignores it. What can be controlled is whether a result is allowed to *land*, and that is a decision
 * this process makes at commit time.
 *
 * So every operation takes a number, the newest number wins, and a write from any older number is
 * refused inside the same serialized section that performs the write. A late result is still
 * returned to its caller — it simply has no authority left to store anything.
 *
 * ── Process-local, deliberately ─────────────────────────────────────────────
 * Nothing here is persisted. An operation cannot outlive the process that started it: a pending
 * native request dies with the app, so a counter that survived a restart would be guarding against a
 * race that can no longer happen while adding a durable field to reason about. `V3` is unchanged.
 */
export type LocationOperation = {
  /** Monotonic within the process. Compared against the current generation, never stored. */
  readonly id: number;
};

let operationGeneration = 0;

/**
 * Claims authority for a new location operation, invalidating every operation before it.
 *
 * Called at the *start* of every path that can change the location — a city save, a coordinate save,
 * a device switch, a device refresh, the first resolution. Starting one is what supersedes the
 * others, which is why it happens before the slow work rather than after it.
 */
export function beginLocationOperation(): LocationOperation {
  operationGeneration += 1;
  return { id: operationGeneration };
}

/**
 * Gives up an operation's authority without starting another.
 *
 * Called when an attempt fails, times out or is abandoned. The brief's rule is that a timeout has
 * *lost* the right to commit, and this is what enforces it: without this, a device request that timed
 * out at twelve seconds and succeeded at ninety would still hold the newest generation — nothing
 * newer having been started — and would commit exactly the stale fix the model exists to refuse.
 */
export function retireLocationOperation(operation: LocationOperation): void {
  if (operation.id === operationGeneration) {
    operationGeneration += 1;
  }
}

/** Whether this operation still holds authority. Read-only; the commit re-checks under the lock. */
export function isCurrentLocationOperation(operation: LocationOperation): boolean {
  return operation.id === operationGeneration;
}

/** Resets the generation counter. Test-only. */
export function resetLocationOperationsForTest(): void {
  operationGeneration = 0;
}

export type CommitOptions = {
  /**
   * Why this write is happening.
   *
   * `change` is a real location change and publishes a new revision. `migration` rewrites an existing
   * location into the current schema — the place has not moved, so subscribers have nothing to
   * recompute, the revision must not move, and no notification reconciliation may be triggered.
   */
  readonly reason?: 'change' | 'migration';
  /**
   * The operation this write belongs to.
   *
   * Re-checked **inside** the serialized section, immediately before the write. Checking only before
   * the slow work would be worthless: the whole point is that the world changed while the work was in
   * flight. Omitted only by the migration path, which is a representation change rather than a user
   * intent and can never be superseded by one.
   */
  readonly operation?: LocationOperation;
  /**
   * What must be true of storage at commit time for the write to proceed.
   *
   * `absent` — write only if nothing is stored. Used by the first-resolution path in
   * `resolveCurrentLocation`, which is a *read* that writes: it acquires a device fix when it finds no
   * location, and between that read and its write another surface may have saved one. Without this
   * precondition, opening a screen at the wrong moment could replace a city the user had just chosen
   * with a device fix nobody asked for.
   */
  readonly requires?: 'absent';
};

export type CommitResult =
  | {
      readonly kind: 'committed';
      readonly record: SavedPrayerLocationV3;
      readonly published: boolean;
    }
  /** Nothing was written because the candidate is already exactly what is stored. */
  | { readonly kind: 'unchanged'; readonly record: SavedPrayerLocationV3 }
  | {
      readonly kind: 'rejected';
      readonly reason:
        | 'invalid-coordinate'
        | 'timezone-unresolved'
        | 'incomplete-city'
        | 'write-failed'
        /** A newer operation has claimed authority, or this one was retired. Not a failure. */
        | 'superseded'
        /** Storage was not in the state the caller required. Not a failure either. */
        | 'precondition-unmet';
    };

/**
 * Serialises the critical section, so no two commits interleave.
 *
 * ── Why a lock is needed and a check is not enough ──────────────────────────
 * The section reads what is stored, compares it, writes, and publishes — four awaits. Two commits
 * running concurrently can both read the old value before either writes, and then both write: the
 * loser's bytes land second and win, and two revisions publish for one logical change. Chaining every
 * commit onto the previous one makes "check authority, then write" indivisible, which is what the
 * authority check has to be to mean anything.
 *
 * The chain never rejects — a failed commit must not wedge every later one — so each link swallows
 * its predecessor's outcome and only the caller sees it.
 */
let mutationChain: Promise<unknown> = Promise.resolve();

function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(work, work);
  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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
 * Whether a stamp is a moment rather than a string that merely occupies the field.
 *
 * Validated at the boundary rather than where it is read. Everything downstream measures the
 * location's *age* from this — the Hijri date refuses to state a day past a ceiling, the acceptance
 * policy protects a recent fix — and an unparseable stamp read as age zero would disable exactly the
 * protections that exist for stale data.
 */
function isUsableStamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** A GeoNames id as the catalogue emits them: a positive integer. */
function isUsableGeonamesId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * **The single mutation boundary.** Nothing else writes `faithStorageKeys.location`.
 *
 * ── What it exclusively owns ────────────────────────────────────────────────
 * Validating the candidate; resolving and attaching the timezone; deriving the label provenance;
 * deciding whether the write is even necessary; serialising; completing the write; incrementing the
 * revision; publishing to subscribers. Splitting any of those across call sites is how a revision
 * gets published before the bytes land, or a record gets stored with a zone that does not match its
 * coordinate.
 *
 * ── The ordering guarantee ──────────────────────────────────────────────────
 * The revision is incremented **after** `writeJson` resolves, never before. A subscriber woken by a
 * revision always re-reads storage that already holds the new value; a failed write publishes nothing
 * at all, so a save that could not land leaves every screen on the last record that did.
 *
 * ── Where authority is decided ──────────────────────────────────────────────
 * Under the lock, immediately before the write — never earlier. `options.operation` is re-checked
 * there because everything interesting happens *between* a caller starting its work and reaching
 * this point: a device fix takes seconds, and a user can save a city inside those seconds. A check
 * performed before the slow work would pass and then be wrong; a check performed here cannot be.
 */
export async function commitActivePrayerLocation(
  candidate: PrayerLocationCandidate,
  options: CommitOptions = {},
): Promise<CommitResult> {
  if (!isUsableCoordinate(candidate.coordinate)) {
    return { kind: 'rejected', reason: 'invalid-coordinate' };
  }
  if (!isUsableStamp(candidate.resolvedAt)) {
    return { kind: 'rejected', reason: 'invalid-coordinate' };
  }

  /*
    A city is only a city if it carries the identity that makes it one. Storing a `city` record whose
    id or country is missing would produce a mode that claims catalogue provenance it cannot support
    — the save could never be re-validated, and the GeoNames credit shown beside it would be a claim
    about data that is not there.
  */
  if (
    candidate.mode === 'city' &&
    (!isUsableGeonamesId(candidate.geonamesId) ||
      !isNonEmptyString(candidate.countryCode) ||
      !isNonEmptyString(candidate.label))
  ) {
    return { kind: 'rejected', reason: 'incomplete-city' };
  }

  /*
    Resolved here rather than accepted from the caller. The zone is a *function* of the coordinate, so
    letting a caller supply one would be letting it supply a contradiction.
  */
  const timezone = timeZoneForCoordinate(candidate.coordinate);
  if (timezone === null) {
    return { kind: 'rejected', reason: 'timezone-unresolved' };
  }

  const record = buildRecord(candidate, timezone);

  /*
    ── Everything from here runs under the lock ──────────────────────────────
    The authority check, the equivalence read, the write and the publish are one indivisible step.
    Splitting them is what lets two commits both read the old value and both write, and it is what
    would let a superseded operation pass an authority check and then write after the operation that
    superseded it had already finished.
  */
  return serializeMutation(async (): Promise<CommitResult> => {
    /*
      The re-check the whole model rests on. `operation` is undefined only for the migration path,
      which rewrites the representation of a place that has not moved and cannot be superseded by a
      user intent.
    */
    if (options.operation !== undefined && !isCurrentLocationOperation(options.operation)) {
      return { kind: 'rejected', reason: 'superseded' };
    }

    /*
      An equivalent snapshot writes nothing and publishes nothing. `resolvedAt` is excluded from the
      comparison deliberately: a re-resolution of the same place at the same accuracy is not a change
      anything downstream can act on, and treating it as one would reschedule 35 notifications every
      time a screen opened.

      ── Deliberately the *non-migrating* read ───────────────────────────────
      `readActivePrayerLocation` migrates a legacy record by calling this function, so using it here
      would recurse: commit → read → migrate → commit. It did, and the suite exhausted the heap. The
      equivalence check only ever needs to compare against an already-current record, so it reads the
      raw V3 value and treats anything else as "not equivalent" — which is correct, because a legacy
      record genuinely is not equal to the V3 one replacing it.
    */
    const existing = await readRawV3();

    /*
      The precondition, checked against what is stored *now* rather than what the caller saw when it
      started. This is what stops `resolveCurrentLocation`'s opportunistic first write from landing on
      top of a location saved while it was acquiring a fix.
    */
    if (options.requires === 'absent' && existing !== null) {
      return { kind: 'rejected', reason: 'precondition-unmet' };
    }

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
    lastValidSnapshot = record;
    return { kind: 'committed', record, published: publish };
  });
}

/**
 * The stored shape for a validated candidate.
 *
 * Provenance is derived here and only here. `device` with a label came from the geocoder; without
 * one, the geocoder had nothing. A typed coordinate the user named is `user-supplied` — their own
 * words, marked as such — and one they did not name is `coordinates`, where the numbers are the whole
 * of what is known.
 */
function buildRecord(candidate: PrayerLocationCandidate, timezone: string): SavedPrayerLocationV3 {
  switch (candidate.mode) {
    case 'device':
      return {
        version: PRAYER_LOCATION_SCHEMA_VERSION,
        mode: 'device',
        coordinate: candidate.coordinate,
        timezone,
        label: candidate.label,
        labelProvenance: candidate.label === null ? 'device-unlabelled' : 'reverse-geocoded',
        resolvedAt: candidate.resolvedAt,
        accuracyMetres: candidate.accuracyMetres,
      };
    case 'city':
      return {
        version: PRAYER_LOCATION_SCHEMA_VERSION,
        mode: 'city',
        coordinate: candidate.coordinate,
        timezone,
        label: candidate.label,
        labelProvenance: 'geonames',
        geonamesId: candidate.geonamesId,
        countryCode: candidate.countryCode,
        admin1: candidate.admin1,
        resolvedAt: candidate.resolvedAt,
      };
    default:
      return {
        version: PRAYER_LOCATION_SCHEMA_VERSION,
        mode: 'coordinates',
        coordinate: candidate.coordinate,
        timezone,
        label: candidate.label,
        labelProvenance: candidate.label === null ? 'coordinates' : 'user-supplied',
        resolvedAt: candidate.resolvedAt,
      };
  }
}

/** The stored value if — and only if — it is already a valid V3 record. Never migrates, never writes. */
async function readRawV3(): Promise<SavedPrayerLocationV3 | null> {
  const raw = await readJson<unknown>(
    faithStorageKeys.location,
    null,
    (_value): _value is unknown => true,
  );
  return isSavedV3(raw) ? raw : null;
}

/** Whether two records describe the same active location, ignoring when it was resolved. */
function isEquivalent(a: SavedPrayerLocationV3, b: SavedPrayerLocationV3): boolean {
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
  /*
    Two city records at the same coordinate with different GeoNames ids are different selections, not
    the same one — duplicate names at near-identical coordinates exist in the catalogue, and treating
    them as equivalent would silently discard the user's actual pick.
  */
  if (a.mode === 'city' && b.mode === 'city') {
    return (
      a.geonamesId === b.geonamesId && a.countryCode === b.countryCode && a.admin1 === b.admin1
    );
  }
  return true;
}

/** A stored value that is already a valid V3 record. */
export function isSavedV3(value: unknown): value is SavedPrayerLocationV3 {
  if (!isRecord(value) || value.version !== PRAYER_LOCATION_SCHEMA_VERSION) {
    return false;
  }
  if (!isUsableCoordinate(value.coordinate) || !hasString(value, 'timezone')) {
    return false;
  }
  if (!isUsableStamp(value.resolvedAt)) {
    return false;
  }

  switch (value.mode) {
    case 'device': {
      const label = value.label;
      if (label !== null && typeof label !== 'string') {
        return false;
      }
      const accuracy = value.accuracyMetres;
      const provenanceAgrees =
        label === null
          ? value.labelProvenance === 'device-unlabelled'
          : value.labelProvenance === 'reverse-geocoded';
      return (
        provenanceAgrees &&
        (accuracy === null || (typeof accuracy === 'number' && Number.isFinite(accuracy)))
      );
    }
    case 'city':
      return (
        isNonEmptyString(value.label) &&
        value.labelProvenance === 'geonames' &&
        isUsableGeonamesId(value.geonamesId) &&
        isNonEmptyString(value.countryCode) &&
        (value.admin1 === null || typeof value.admin1 === 'string')
      );
    case 'coordinates': {
      const label = value.label;
      if (label !== null && typeof label !== 'string') {
        return false;
      }
      /*
        Provenance must agree with the label's presence. A `coordinates` record claiming
        `user-supplied` with no label is a record asserting the user named a place and then not
        carrying the name — unreadable, so refused.
      */
      return label === null
        ? value.labelProvenance === 'coordinates'
        : value.labelProvenance === 'user-supplied';
    }
    default:
      return false;
  }
}

/**
 * What a stored value turned out to be — the **one** parser and migration boundary.
 *
 * ── Why a union rather than "returns a record or null" ──────────────────────
 * Because the three outcomes have different consequences and only one of them is a write. A current
 * record is used as-is. A migratable one has to be re-committed, once, through the same atomic
 * boundary as any other write, with the revision suppressed. An unreadable one must leave storage
 * alone and fall back to whatever this process last knew — and collapsing that into `null` alongside
 * "nothing stored" is what would make a corrupt record indistinguishable from a fresh install, which
 * is the difference between "keep what you had" and "offer to set a location".
 */
export type StoredLocationParse =
  /** Already V3 and valid. Nothing to write. */
  | { readonly kind: 'current'; readonly record: SavedPrayerLocationV3 }
  /** A valid earlier record. Must be committed as V3 with `reason: 'migration'`. */
  | { readonly kind: 'migrated'; readonly candidate: PrayerLocationCandidate }
  /** Nothing has ever been stored. */
  | { readonly kind: 'absent' }
  /** Present, and not interpretable honestly. Storage is left exactly as it is. */
  | { readonly kind: 'unreadable' };

/**
 * Interprets whatever is in the key.
 *
 * ── The migration table ─────────────────────────────────────────────────────
 * | Stored                          | Becomes                                              |
 * |---------------------------------|------------------------------------------------------|
 * | V3, valid                       | itself — no write                                    |
 * | V2 `device`                     | V3 `device`, `unavailable` → `device-unlabelled`     |
 * | V2 `manual`                     | V3 `coordinates`                                     |
 * | V1 `manual: false` / `mode: 'device'`  | V3 `device`                                   |
 * | V1 `manual: true` / `mode: 'manual'`   | V3 `coordinates`                              |
 * | V1 with `manual` and `mode` disagreeing | *unreadable*                                |
 * | anything malformed, non-finite or out of range | *unreadable*                        |
 *
 * ── Why a V2 `manual` record can only become `coordinates` ──────────────────
 * Because a V2 `manual` record has no GeoNames id, no country code and no region, and there is no
 * honest way to obtain them from a coordinate. Reverse-matching the nearest catalogue city would
 * fabricate a provenance the user never gave: somebody who typed a coordinate five kilometres outside
 * Dubai would find their location relabelled "Dubai" with a source credit attached, and every screen
 * would then present their own typed guess as catalogue-verified data. `coordinates` is what the
 * record actually is, and the migration says so.
 *
 * ── Why contradictions fail closed rather than picking a side ───────────────
 * A V1 record with `manual: true, mode: 'device'` has no correct reading, and the two guesses have
 * opposite consequences: read it as device and an automatic refresh may replace a place the user
 * chose; read it as user-selected and their location stops following them. A record nobody can
 * interpret is discarded rather than interpreted.
 */
export function parseStoredPrayerLocation(value: unknown): StoredLocationParse {
  if (value === null || value === undefined) {
    return { kind: 'absent' };
  }
  if (isSavedV3(value)) {
    return { kind: 'current', record: value };
  }
  const candidate = migrateLegacyRecord(value);
  return candidate === null ? { kind: 'unreadable' } : { kind: 'migrated', candidate };
}

/**
 * A pre-V3 record as a V3 candidate, or `null` when it cannot be migrated honestly.
 *
 * Exported for the fixture suite, which drives every historical shape through it directly — a
 * migration is only trustworthy if the shapes it refuses are as well covered as the shapes it
 * accepts, and asserting that through storage would test `readJson` rather than this table.
 */
export function migrateLegacyRecord(value: unknown): PrayerLocationCandidate | null {
  if (!isRecord(value) || !isUsableCoordinate(value.coordinate)) {
    return null;
  }
  if (!isUsableStamp(value.resolvedAt)) {
    return null;
  }

  const coordinate = value.coordinate;
  const resolvedAt = value.resolvedAt;
  const label = isNonEmptyString(value.label) ? value.label : null;

  /*
    A V2 record is already unambiguous — `mode` is its only mode field — so it is read directly rather
    than through the V1 reconciliation below. `manual` becomes `coordinates`; see the note above for
    why it cannot become `city`.
  */
  if (value.version === 2 && (value.mode === 'device' || value.mode === 'manual')) {
    return value.mode === 'manual'
      ? { mode: 'coordinates', coordinate, label, resolvedAt }
      : {
          mode: 'device',
          coordinate,
          label,
          resolvedAt,
          accuracyMetres: readAccuracy(value.accuracyMetres),
        };
  }

  /*
    V1 and anything older: `manual: boolean`, `mode`, or both. Both present and disagreeing is the one
    case that fails closed.
  */
  const legacyManual = value.manual;
  const legacyMode = value.mode;
  const hasManual = typeof legacyManual === 'boolean';
  const hasMode = legacyMode === 'manual' || legacyMode === 'device';

  if (!hasManual && !hasMode) {
    /*
      Neither field. Nothing in the record says where its authority came from, and defaulting would be
      a guess with the same opposite consequences as a contradiction.
    */
    return null;
  }
  if (hasManual && hasMode) {
    const impliedByManual = legacyManual === true ? 'manual' : 'device';
    if (impliedByManual !== legacyMode) {
      return null;
    }
  }

  const userSelected = hasMode ? legacyMode === 'manual' : legacyManual === true;
  return userSelected
    ? { mode: 'coordinates', coordinate, label, resolvedAt }
    : {
        mode: 'device',
        coordinate,
        label,
        resolvedAt,
        accuracyMetres: readAccuracy(value.accuracyMetres),
      };
}

/** A stored accuracy, or `null` for anything that is not a finite number. */
function readAccuracy(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The last record that was successfully read or committed in this process.
 *
 * ── Why a runtime snapshot exists at all ────────────────────────────────────
 * The recovery rule: if a stored record cannot be migrated into a complete valid one, the app retains
 * the last valid snapshot rather than losing the user's location. Storage is still the source of
 * truth — this is only what the process already knew, so a corrupt write does not blank a working
 * screen mid-session.
 */
let lastValidSnapshot: SavedPrayerLocationV3 | null = null;

/**
 * Forget the snapshot the instant the account changes.
 *
 * ── Why this is subscribed here rather than called by the provider ─────────
 * A stale snapshot after an account switch is not merely out of date — it is **the previous user's
 * home city**, held in memory and served by `readActivePrayerLocation` on the `unreadable` branch,
 * where the whole point is to keep showing what the process already knew. That recovery rule is
 * right within one account and is an exposure across two.
 *
 * Registering the reset in the module that owns the cell means the guarantee cannot be lost by
 * somebody adding a second provider or reordering a layout. There is exactly one subscriber per
 * process and it is created at import, beside the state it protects.
 */
subscribeToFaithScope(() => {
  lastValidSnapshot = null;
});

/**
 * The active location, migrating a pre-V3 record exactly once.
 *
 * ── Why a read is allowed to write ──────────────────────────────────────────
 * Only on the one read that finds a legacy record. It goes through the same mutation boundary, with
 * `reason: 'migration'` so no revision is published — the place has not moved, only its
 * representation — and every subsequent read finds V3 and writes nothing.
 *
 * That suppression is also what keeps a migration from reconciling notifications twice. Every
 * reconciliation is triggered by a revision change; a migration that published one would rebuild the
 * whole alert schedule on the first launch after an upgrade, for a location that had not moved a
 * metre.
 */
export async function readActivePrayerLocation(): Promise<SavedPrayerLocationV3 | null> {
  const raw = await readJson<unknown>(
    faithStorageKeys.location,
    null,
    (_value): _value is unknown => true,
  );

  const parsed = parseStoredPrayerLocation(raw);
  switch (parsed.kind) {
    case 'current':
      lastValidSnapshot = parsed.record;
      return parsed.record;
    case 'absent':
      /*
        Nothing stored is not a failure and must not resurrect a snapshot: a cleared location has to
        read as cleared, or "reset Faith data" would appear to do nothing until the process restarted.
      */
      return null;
    case 'unreadable':
      // Keep whatever this process last knew to be valid. Storage is left untouched.
      return lastValidSnapshot;
    default: {
      const committed = await commitActivePrayerLocation(parsed.candidate, { reason: 'migration' });
      if (committed.kind === 'rejected') {
        return lastValidSnapshot;
      }
      lastValidSnapshot = committed.record;
      return committed.record;
    }
  }
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
