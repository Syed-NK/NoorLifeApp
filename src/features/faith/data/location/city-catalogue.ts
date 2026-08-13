import type { CityIndex } from './city-search';

/**
 * The bundled offline city catalogue: loaded once, indexed once, reused for the process's life.
 *
 * ── The constraint that shaped every decision here ──────────────────────────
 * A user types into a search field on a low-end Android phone, and each keystroke must feel
 * immediate. That rules out re-reading or re-parsing anything per keystroke, and it rules out
 * folding diacritics over 34,000 names at query time. So all of the expensive work happens exactly
 * twice in the app's life: once at build time in `scripts/import-city-catalogue.mjs`, and once here
 * on first use.
 *
 * ── Why the load is lazy, and why that is not a micro-optimisation ──────────
 * A top-level `require` of a 2.19 MB JSON module makes Metro parse it during the *startup* module
 * graph, so every user pays for a city catalogue whether or not they ever open city search — on a
 * screen where the app is already competing for the main thread. Deferring it to the first search
 * moves that cost to the one moment a user has explicitly asked for it and is prepared to wait a
 * moment for a list.
 *
 * ── Why the promise is memoised rather than the result ──────────────────────
 * Two keystrokes arriving before the first parse completes must not start two parses. Caching the
 * *promise* makes the second caller await the first's work; caching only the finished index would
 * leave a window in which `index === null` twice and the 2 MB parse runs twice. The failure case is
 * cached deliberately too — see `loadCityCatalogue`.
 *
 * ── There is no network here, and there is no way to add one ────────────────
 * The catalogue is a bundled asset reached by `require`. This module has no transport, no URL and no
 * fetch, so city search cannot make a request even by mistake — which is the cost guarantee the
 * release brief asks for, expressed structurally rather than as a policy.
 */

/** What the importer writes. Only the fields this module reads are declared. */
type CatalogueAsset = {
  readonly meta: {
    readonly schema: number;
    readonly cityCount: number;
    readonly licence: { readonly attribution: string };
    readonly source: { readonly provider: string; readonly dataset: string };
  };
  readonly rows: string;
};

/** The schema this reader understands. A mismatch fails loudly rather than mis-parsing. */
const SUPPORTED_SCHEMA = 1;

/** Field order within a row. Must match the importer's emission order. */
const FIELD = {
  geonameId: 0,
  name: 1,
  normalized: 2,
  countryCode: 3,
  region: 4,
  latitude: 5,
  longitude: 6,
  population: 7,
} as const;

const UNIT = '|';
const RECORD = '\n';

export type CityRecord = {
  readonly geonameId: number;
  /** The place as it is spelled, accents intact. Never the folded form. */
  readonly name: string;
  readonly countryCode: string;
  /** First administrative region, or `''` where the source has none. */
  readonly region: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly population: number;
};

export type LoadedCatalogue = {
  readonly index: CityIndex;
  /** The credit GeoNames' licence requires, carried with the data rather than duplicated in a screen. */
  readonly attribution: string;
  /** Milliseconds spent parsing and indexing. Surfaced so the cost can be measured, not assumed. */
  readonly loadMs: number;
};

let pending: Promise<LoadedCatalogue> | null = null;

/**
 * Builds the parallel-array index from the delimited payload.
 *
 * ── One split, then a manual field walk ─────────────────────────────────────
 * `rows.split(RECORD)` produces 34,000 strings, and each is then split on `UNIT`. The obvious
 * alternative — a regex or a per-row object — allocates several times more. The arrays are
 * pre-sized with the count the asset declares so none of them has to grow and re-copy.
 */
function buildIndex(asset: CatalogueAsset): CityIndex {
  const lines = asset.rows.split(RECORD);
  const size = lines.length;

  const geonameId = new Array<number>(size);
  const name = new Array<string>(size);
  const normalized = new Array<string>(size);
  const countryCode = new Array<string>(size);
  const region = new Array<string>(size);
  const latitude = new Array<number>(size);
  const longitude = new Array<number>(size);
  const population = new Array<number>(size);

  for (let at = 0; at < size; at += 1) {
    const fields = (lines[at] ?? '').split(UNIT);
    geonameId[at] = Number(fields[FIELD.geonameId]);
    name[at] = fields[FIELD.name] ?? '';
    normalized[at] = fields[FIELD.normalized] ?? '';
    countryCode[at] = fields[FIELD.countryCode] ?? '';
    region[at] = fields[FIELD.region] ?? '';
    latitude[at] = Number(fields[FIELD.latitude]);
    longitude[at] = Number(fields[FIELD.longitude]);
    population[at] = Number(fields[FIELD.population]);
  }

  return {
    geonameId,
    name,
    normalized,
    countryCode,
    region,
    latitude,
    longitude,
    population,
    size,
  };
}

/**
 * The catalogue, loading it on the first call and reusing it afterwards.
 *
 * ── Why a rejected load clears the memo ─────────────────────────────────────
 * A parse failure here means a corrupt or truncated asset, which a retry cannot fix — but the memo
 * is cleared anyway so a caller that retries gets a fresh attempt rather than the same rejected
 * promise forever. Keeping a rejected promise cached would make one transient failure permanent for
 * the process, and the screen's retry control would be a button that cannot work.
 */
export function loadCityCatalogue(): Promise<LoadedCatalogue> {
  pending ??= (async (): Promise<LoadedCatalogue> => {
    const startedAt = Date.now();
    /*
      Required inside the async body, not at module scope. This is the line that keeps 2.19 MB out of
      the startup module graph — see the note at the top of the file.
    */
    const asset = require('@assets/data/city-catalogue.json') as CatalogueAsset;

    if (asset?.meta?.schema !== SUPPORTED_SCHEMA) {
      throw new Error(
        `city catalogue schema ${String(asset?.meta?.schema)} is not supported (expected ${SUPPORTED_SCHEMA})`,
      );
    }

    const index = buildIndex(asset);
    /*
      The asset states its own row count, so a truncated or partially-written file is caught here
      rather than becoming a silently shorter catalogue in which a user's city simply does not exist.
    */
    if (index.size !== asset.meta.cityCount) {
      throw new Error(
        `city catalogue is truncated: ${index.size} rows for a declared ${asset.meta.cityCount}`,
      );
    }

    return {
      index,
      attribution: asset.meta.licence.attribution,
      loadMs: Date.now() - startedAt,
    };
  })().catch((error: unknown) => {
    pending = null;
    throw error;
  });

  return pending;
}

/** One city, by its position in the index. */
export function cityAt(index: CityIndex, at: number): CityRecord | null {
  if (at < 0 || at >= index.size) {
    return null;
  }
  return {
    geonameId: index.geonameId[at] ?? 0,
    name: index.name[at] ?? '',
    countryCode: index.countryCode[at] ?? '',
    region: index.region[at] ?? '',
    latitude: index.latitude[at] ?? 0,
    longitude: index.longitude[at] ?? 0,
    population: index.population[at] ?? 0,
  };
}

/** Drops the memo so a test can measure a cold load. Test-only. */
export function resetCityCatalogueForTest(): void {
  pending = null;
}
