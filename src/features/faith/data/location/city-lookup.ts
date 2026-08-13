import type { CityChoice } from '../prayer-times.repository';
import { cityAt, loadCityCatalogue, type CityRecord } from './city-catalogue';
import { MAX_RESULTS, searchCityIndex } from './city-search';
import { countryNameFor } from './country-names';

/**
 * The seam between the packed catalogue and the domain.
 *
 * ── Why this layer exists at all ────────────────────────────────────────────
 * `city-catalogue.ts` holds eight parallel arrays and hands out positions; `city-search.ts` ranks
 * positions. Both shapes exist to make a 34,084-row scan cheap on a phone, and neither is something a
 * screen should ever hold. A position is only meaningful for one particular build of one particular
 * asset — re-import the catalogue and every stored index means a different city — so letting one
 * escape into React state would be a bug that survives testing and appears after a data refresh.
 *
 * Everything above this module speaks in `CityChoice`: stable identity, real names, no `''`
 * sentinels, and no knowledge that a parallel-array index exists.
 *
 * ── Still no transport ──────────────────────────────────────────────────────
 * This module imports a bundled asset reader, a pure ranking function and a static name table. It has
 * no fetch, no URL and no host, so nothing it exposes can be made to bill anybody or to send a typed
 * query anywhere.
 */

/** What a search produced, with the credit that has to travel beside it. */
export type CitySearchOutcome = {
  readonly cities: readonly CityChoice[];
  /** GeoNames' required attribution, read from the asset's own `meta`. */
  readonly attribution: string;
  /** Milliseconds the search itself took, so the cost can be measured rather than claimed. */
  readonly searchMs: number;
};

/**
 * A catalogue row as the domain's shape.
 *
 * The two conversions are deliberate. `''` becomes `null`, because "GeoNames records no first
 * administrative division for this place" and "the region is the empty string" render differently —
 * one omits a line, the other leaves a gap. And the country code becomes a name, because a two-letter
 * code is a lookup the user has to perform, which defeats the purpose of showing the country at all.
 */
function toChoice(record: CityRecord): CityChoice {
  return {
    geonamesId: record.geonameId,
    name: record.name,
    region: record.region.length === 0 ? null : record.region,
    countryCode: record.countryCode,
    countryName: countryNameFor(record.countryCode),
    coordinate: { latitude: record.latitude, longitude: record.longitude },
  };
}

/**
 * The best matches for a query, as domain objects.
 *
 * Bounded to `MAX_RESULTS` by the search itself. Returns an empty list — never an error — for a query
 * too short to search or one that matched nothing; the caller distinguishes those from the query it
 * already holds.
 */
export async function searchCityChoices(
  query: string,
  limit: number = MAX_RESULTS,
): Promise<CitySearchOutcome> {
  const catalogue = await loadCityCatalogue();
  const startedAt = Date.now();
  const matches = searchCityIndex(catalogue.index, query, limit);
  const cities: CityChoice[] = [];
  for (const match of matches) {
    const record = cityAt(catalogue.index, match.at);
    if (record !== null) {
      cities.push(toChoice(record));
    }
  }
  return { cities, attribution: catalogue.attribution, searchMs: Date.now() - startedAt };
}

/**
 * The catalogue's own record for an id, or `null` when the catalogue does not contain it.
 *
 * ── Why a save re-reads rather than trusting what it was handed ─────────────
 * The `CityChoice` reaching a save has passed through a screen — held in state across a search, a
 * preview, a scroll and a re-render. Re-deriving it from the catalogue turns "the right object was
 * passed along" from an assumption into a checked fact, and it is the only thing that makes the
 * stored `geonames` provenance mean something: a record that cannot be found in the catalogue it
 * claims to come from must not be stored as though it could.
 *
 * A linear scan, not an index. It runs once per save rather than once per keystroke, and a 34,084-key
 * `Map` kept alive for the process to save that one scan is the wrong trade on a phone.
 */
export async function findCityChoice(geonamesId: number): Promise<CityChoice | null> {
  if (!Number.isInteger(geonamesId) || geonamesId <= 0) {
    return null;
  }
  const catalogue = await loadCityCatalogue();
  const { index } = catalogue;
  for (let at = 0; at < index.size; at += 1) {
    if (index.geonameId[at] === geonamesId) {
      const record = cityAt(index, at);
      return record === null ? null : toChoice(record);
    }
  }
  return null;
}

/** The credit CC BY 4.0 requires, from the asset itself. */
export async function cityCatalogueAttribution(): Promise<string> {
  return (await loadCityCatalogue()).attribution;
}
