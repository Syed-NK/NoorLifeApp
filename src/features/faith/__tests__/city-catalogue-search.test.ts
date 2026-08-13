import fs from 'fs';
import path from 'path';

import {
  cityAt,
  loadCityCatalogue,
  resetCityCatalogueForTest,
  type LoadedCatalogue,
} from '../data/location/city-catalogue';
import { CITY_EXONYMS, expandQuery } from '../data/location/city-exonyms';
import {
  MATCH_TIER,
  MAX_RESULTS,
  MIN_QUERY_LENGTH,
  normalizeCityQuery,
  searchCityIndex,
} from '../data/location/city-search';

/**
 * The bundled catalogue, and the search over it.
 *
 * ── Why these run against the real 34,000-row asset ─────────────────────────
 * A fixture of ten cities would prove the ranking function orders ten cities. It would not prove
 * that the shipped data is in the shape this code expects, that the importer's normaliser agrees
 * with the runtime's, that duplicate city names are actually disambiguated, or that a scan over the
 * real catalogue is fast enough to type against. Those are the properties that decide whether a user
 * finds their city, and every one of them is a fact about the asset rather than about the algorithm.
 *
 * The cost is a ~2 MB parse once per suite, which the timing case below measures rather than
 * assumes.
 */

let catalogue: LoadedCatalogue;

beforeAll(async () => {
  catalogue = await loadCityCatalogue();
});

describe('the bundled asset', () => {
  it('loads every declared row', () => {
    expect(catalogue.index.size).toBeGreaterThan(30_000);
    expect(catalogue.index.name).toHaveLength(catalogue.index.size);
    expect(catalogue.index.normalized).toHaveLength(catalogue.index.size);
  });

  it('carries the attribution GeoNames’ licence requires', () => {
    expect(catalogue.attribution).toMatch(/GeoNames/);
    expect(catalogue.attribution).toMatch(/CC BY 4\.0/);
  });

  it('holds a valid coordinate for every row', () => {
    /*
      The importer validates on the way in; this checks what actually shipped. A NaN that survived
      the encoding would produce a prayer time and a Qibla bearing that are confidently wrong, and
      nothing on screen would look unusual.
    */
    let invalid = 0;
    for (let at = 0; at < catalogue.index.size; at += 1) {
      const latitude = catalogue.index.latitude[at] ?? NaN;
      const longitude = catalogue.index.longitude[at] ?? NaN;
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      ) {
        invalid += 1;
      }
    }
    expect(invalid).toBe(0);
  });

  it('names every row and gives every row a stable id', () => {
    let unnamed = 0;
    let unidentified = 0;
    for (let at = 0; at < catalogue.index.size; at += 1) {
      if ((catalogue.index.name[at] ?? '') === '') unnamed += 1;
      if (!Number.isInteger(catalogue.index.geonameId[at])) unidentified += 1;
    }
    expect({ unnamed, unidentified }).toEqual({ unnamed: 0, unidentified: 0 });
  });

  it('is ordered by population descending, which the ranking’s tiebreak relies on', () => {
    let outOfOrder = 0;
    for (let at = 1; at < catalogue.index.size; at += 1) {
      if ((catalogue.index.population[at] ?? 0) > (catalogue.index.population[at - 1] ?? 0)) {
        outOfOrder += 1;
      }
    }
    expect(outOfOrder).toBe(0);
  });

  /**
   * The parity check the duplicated normaliser depends on.
   *
   * `city-search.ts` reimplements the importer's folding so the device never folds 34,000 names at
   * load. That is only safe if the two agree, and this asserts it against the *shipped data* rather
   * than by comparing source — so it fails if either implementation drifts, and also if the asset
   * were ever rebuilt by an older importer.
   */
  it('stores a normalised name the runtime normaliser reproduces exactly', () => {
    const mismatches: string[] = [];
    for (let at = 0; at < catalogue.index.size; at += 1) {
      const name = catalogue.index.name[at] ?? '';
      const stored = catalogue.index.normalized[at] ?? '';
      if (normalizeCityQuery(name) !== stored) {
        mismatches.push(`${name} → stored ${stored}, computed ${normalizeCityQuery(name)}`);
        if (mismatches.length >= 5) break;
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('normalisation', () => {
  it.each([
    ['Malmö', 'malmo'],
    ['Köln', 'koln'],
    ['São Paulo', 'sao paulo'],
    ['Ålesund', 'alesund'],
    ['Đà Nẵng', 'da nang'],
    ['İzmir', 'izmir'],
    ['Stoke-on-Trent', 'stoke on trent'],
    ['Sant Julià de Lòria', 'sant julia de loria'],
    ['  Dubai  ', 'dubai'],
    ['DUBAI', 'dubai'],
  ])('folds %s to %s', (input, expected) => {
    expect(normalizeCityQuery(input)).toBe(expected);
  });

  it('keeps words separated, so a typed query can still prefix-match', () => {
    // The defect this prevents: deleting punctuation yields "stokeontrent", which "stoke on" misses.
    expect(normalizeCityQuery('Stoke-on-Trent').startsWith(normalizeCityQuery('stoke on'))).toBe(
      true,
    );
  });
});

describe('query bounds', () => {
  it.each(['', ' ', 'a', '-', '  x  ', '!!'])('returns nothing for %p', (query) => {
    expect(searchCityIndex(catalogue.index, query)).toEqual([]);
  });

  it('searches at exactly the minimum length', () => {
    expect(normalizeCityQuery('lo')).toHaveLength(MIN_QUERY_LENGTH);
    expect(searchCityIndex(catalogue.index, 'lo').length).toBeGreaterThan(0);
  });

  it('never returns more than the bound, even for a query matching thousands', () => {
    expect(searchCityIndex(catalogue.index, 'san').length).toBeLessThanOrEqual(MAX_RESULTS);
    expect(searchCityIndex(catalogue.index, 'a b').length).toBeLessThanOrEqual(MAX_RESULTS);
  });
});

describe('ranking', () => {
  const namesFor = (query: string) =>
    searchCityIndex(catalogue.index, query).map((match) => cityAt(catalogue.index, match.at)?.name);

  it('puts an exact name match first', () => {
    const results = searchCityIndex(catalogue.index, 'Dubai');
    expect(results[0]?.tier).toBe(MATCH_TIER.exact);
    expect(cityAt(catalogue.index, results[0]!.at)?.name).toBe('Dubai');
  });

  it('orders tiers before population', () => {
    const results = searchCityIndex(catalogue.index, 'york');
    const tiers = results.map((match) => match.tier);
    // Non-decreasing: every exact precedes every prefix, which precedes every word prefix.
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });

  it('prefers the larger city when two share a tier', () => {
    const results = searchCityIndex(catalogue.index, 'london');
    const populations = results
      .filter((match) => match.tier === results[0]?.tier)
      .map((match) => cityAt(catalogue.index, match.at)?.population ?? 0);
    expect([...populations].sort((a, b) => b - a)).toEqual(populations);
  });

  it('reaches a later word by its own prefix', () => {
    // "york" must find "New York", which no name-prefix rule alone would do.
    expect(namesFor('york')).toContain('New York City');
  });

  it('is deterministic — the same query twice gives the same order', () => {
    expect(namesFor('springfield')).toEqual(namesFor('springfield'));
  });
});

describe('duplicate city names', () => {
  it('returns several Springfields, each separable by country and region', () => {
    const results = searchCityIndex(catalogue.index, 'Springfield')
      .map((match) => cityAt(catalogue.index, match.at))
      .filter((city): city is NonNullable<typeof city> => city !== null)
      .filter((city) => normalizeCityQuery(city.name) === 'springfield');

    expect(results.length).toBeGreaterThan(1);

    /*
      The property that makes the list usable: no two rows a user has to choose between are
      indistinguishable. Country alone is not enough — the United States has many Springfields — so
      the region is what separates them, and this asserts the pair is unique rather than assuming it.
    */
    const labels = results.map((city) => `${city.name}|${city.countryCode}|${city.region}`);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every result a country code, so no row is unattributable', () => {
    for (const match of searchCityIndex(catalogue.index, 'san')) {
      expect(cityAt(catalogue.index, match.at)?.countryCode).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('diacritics', () => {
  it.each([
    ['malmo', 'Malmö'],
    ['koln', 'Köln'],
    ['zurich', 'Zürich'],
    ['sao paulo', 'São Paulo'],
  ])('finds %s typed without accents', (typed, expected) => {
    const names = searchCityIndex(catalogue.index, typed).map(
      (match) => cityAt(catalogue.index, match.at)?.name,
    );
    expect(names).toContain(expected);
  });

  it('renders the accented name rather than the folded one', () => {
    const first = searchCityIndex(catalogue.index, 'malmo')[0];
    expect(cityAt(catalogue.index, first!.at)?.name).toBe('Malmö');
  });
});

describe('English exonyms', () => {
  it('finds Makkah when the user types Mecca', () => {
    const names = searchCityIndex(catalogue.index, 'Mecca').map(
      (match) => cityAt(catalogue.index, match.at)?.name,
    );
    expect(names).toContain('Makkah');
  });

  it('finds Madinah when the user types Medina', () => {
    const names = searchCityIndex(catalogue.index, 'Medina').map(
      (match) => cityAt(catalogue.index, match.at)?.name,
    );
    expect(names).toContain('Madinah');
  });

  it('widens rather than redirects — the typed word still matches its own cities', () => {
    const names = searchCityIndex(catalogue.index, 'Medina').map(
      (match) => cityAt(catalogue.index, match.at)?.name,
    );
    // Real places literally named Medina exist, and a user typing it may mean one of them.
    expect(names.some((name) => normalizeCityQuery(name ?? '') === 'medina')).toBe(true);
  });

  it('lists each city once even when both the exonym and the endonym match', () => {
    const results = searchCityIndex(catalogue.index, 'Rome');
    const ids = results.map((match) => cityAt(catalogue.index, match.at)?.geonameId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('maps every entry to a name the catalogue actually contains', () => {
    /*
      Guards the curated list against rot. An endonym that no longer matches a row is not a wrong
      answer, but it is a silently dead entry, and a list nobody can trust is worse than no list.
    */
    const dead: string[] = [];
    for (const [exonym, endonym] of Object.entries(CITY_EXONYMS)) {
      expect(normalizeCityQuery(exonym)).toBe(exonym);
      expect(normalizeCityQuery(endonym)).toBe(endonym);
      const found = searchCityIndex(catalogue.index, endonym).some(
        (match) => normalizeCityQuery(cityAt(catalogue.index, match.at)?.name ?? '') === endonym,
      );
      if (!found) dead.push(`${exonym} → ${endonym}`);
    }
    expect(dead).toEqual([]);
  });

  it('leaves an unrecognised query as a single term', () => {
    expect(expandQuery('manchester')).toEqual(['manchester']);
  });
});

describe('offline and cost boundary', () => {
  it('reaches no network to load or to search', () => {
    /*
      Structural rather than behavioural: `fetch` is not stubbed and not asserted on, because the
      point is that these modules have no transport to call. A source scan is what proves that for
      code that could otherwise acquire one in a later change.
    */
    for (const file of [
      'src/features/faith/data/location/city-catalogue.ts',
      'src/features/faith/data/location/city-search.ts',
      'src/features/faith/data/location/city-exonyms.ts',
      'src/features/faith/data/location/city-lookup.ts',
      'src/features/faith/data/location/country-names.ts',
    ]) {
      const source = fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|axios|https?:\/\//);
    }
  });

  it('does not log the query or any coordinate', () => {
    for (const file of [
      'src/features/faith/data/location/city-catalogue.ts',
      'src/features/faith/data/location/city-search.ts',
      'src/features/faith/data/location/city-lookup.ts',
      'src/features/faith/data/location/country-names.ts',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/console\.\w+\(/);
    }
  });
});

describe('performance', () => {
  /**
   * Recorded rather than asserted tightly.
   *
   * CI hardware varies and a tight bound would become a flaky test that gets loosened until it means
   * nothing. The thresholds below are deliberately generous — they exist to catch an order-of-
   * magnitude regression, such as somebody moving normalisation back to query time — while the
   * `console.log` puts the real numbers in the run output where they can be read and reported.
   */
  it('loads the catalogue once, in a time worth recording', async () => {
    resetCityCatalogueForTest();
    const started = Date.now();
    const cold = await loadCityCatalogue();
    const coldMs = Date.now() - started;

    const warmStarted = Date.now();
    await loadCityCatalogue();
    const warmMs = Date.now() - warmStarted;

    console.log(
      `[city-catalogue] cold load ${coldMs}ms (${cold.index.size} cities), warm ${warmMs}ms`,
    );
    expect(coldMs).toBeLessThan(5_000);
    // A second call must reuse the memo rather than re-parse 2 MB.
    expect(warmMs).toBeLessThan(coldMs === 0 ? 50 : Math.max(50, coldMs / 2));
  });

  it('answers representative and worst-case queries quickly', () => {
    const probes = [
      ['typical', 'lond'],
      ['short/broad', 'sa'],
      ['exonym', 'mecca'],
      ['no match', 'zzzzqx'],
      ['long', 'san francisco'],
    ] as const;

    const timings: string[] = [];
    let worst = 0;
    for (const [label, query] of probes) {
      // Several passes, so a single scheduling hiccup does not become the reported number.
      const started = Date.now();
      for (let run = 0; run < 5; run += 1) {
        searchCityIndex(catalogue.index, query);
      }
      const perQuery = (Date.now() - started) / 5;
      worst = Math.max(worst, perQuery);
      timings.push(`${label} (${query}) ${perQuery.toFixed(1)}ms`);
    }

    console.log(`[city-catalogue] ${timings.join(', ')}`);
    expect(worst).toBeLessThan(250);
  });
});
