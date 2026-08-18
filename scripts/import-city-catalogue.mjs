#!/usr/bin/env node
// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds NoorLife's bundled offline city catalogue from the official GeoNames dump.
 *
 * ── Why an importer exists rather than a committed dump ─────────────────────
 * `cities15000.txt` is 8.4 MB of 19 tab-separated columns, of which NoorLife needs eight. Shipping
 * it raw would put feature codes, elevation, DEM readings, admin2–admin4 codes and a modification
 * date into every user's install for nothing, and would leave normalisation to run on-device at
 * search time — the one place it must not, because it would run per keystroke on a phone.
 *
 * So the expensive, deterministic half happens here, once, on a developer's machine: parse,
 * validate, fold diacritics, deduplicate, rank, and emit a compact payload the app can index in one
 * pass. The device does string comparison and nothing else.
 *
 * ── Reproducibility is the property that makes this auditable ───────────────
 * Same inputs → byte-identical output. There is no clock, no locale-dependent collation, no
 * `Math.random`, and every sort has a total ordering with an explicit final tiebreak. That is what
 * lets the recorded checksums below mean something: anyone can re-run this against the same source
 * files and confirm the committed asset is what this script produces.
 *
 * ── What is deliberately NOT carried across ─────────────────────────────────
 * The dump has a `timezone` column, and it is excluded on purpose. NoorLife resolves a coordinate's
 * IANA zone locally through `tz-lookup`, and `prayer-location-store.ts` stores that zone beside the
 * coordinate precisely so the pair cannot disagree. Importing a *second* zone for the same place
 * would recreate the two-sources-of-truth defect that file exists to prevent: a catalogue row and a
 * polygon lookup differing by one zone is a plausible wall-clock time that is silently wrong.
 *
 * ── Licence ────────────────────────────────────────────────────────────────
 * GeoNames is CC BY 4.0. Attribution is required and is recorded in
 * `docs/THIRD_PARTY_LICENCES.md`, surfaced in-app, and stamped into the asset's own `meta` block so
 * the credit travels with the data rather than depending on a document staying in sync with it.
 *
 * Usage:
 *   node scripts/import-city-catalogue.mjs --source <dir-with-geonames-files>
 */

// `fileURLToPath`, not `URL.pathname` — the latter yields `/D:/...` on Windows, which `resolve`
// then treats as a relative path off the current drive root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(REPO_ROOT, 'assets', 'data', 'city-catalogue.json');

/**
 * ── Why the `alternatenames` column is not imported at all ──────────────────
 * It was, for three builds, and the output is the reason it is not. GeoNames stores alternate names
 * in no useful order, so "the first four Latin-script entries" is an arbitrary sample rather than a
 * selection, and the arbitrary sample is bad. Measured, on real rows:
 *
 *   Malmö      → `mal mjo malm o malme malmey`      — fragments and misspellings
 *   São Paulo  → `sampa san paolo san paul ed brasil` — `san` competes with every San Diego
 *   Kisumu     → carries `florence`                  — so typing "Florence" surfaces a Kenyan city
 *
 * Tightening the filter (minimum length, no prefixes of the name) removed the airport codes and left
 * all three of those intact, because they are not malformed — they are genuine low-value aliases, and
 * no length or shape rule separates "Cologne" from "san paul ed brasil". The last one is the
 * disqualifying case: a wrong city offered confidently for a correctly-spelled query is the same
 * class of failure as a wrong coordinate. Measured cost of carrying them: 3.00 MB against 2.19 MB
 * without, so 0.81 MB — 27% of the asset — for that.
 *
 * The genuinely valuable exonyms — Mecca/Makkah, Medina/Madinah, Cologne/Köln — are a short, stable,
 * auditable list. They live in `city-exonyms.ts` beside the search, cost nothing in the asset, and
 * can be reviewed by a person, which a 34,000-row harvest cannot.
 */

/**
 * Field and record delimiters.
 *
 * ── Why not the ASCII separator controls, which is what they are for ────────
 * Because the payload lives inside a JSON string, and `JSON.stringify` escapes every C0 control as
 * a six-byte \uXXXX sequence. At one separator per field per row across 34,000 rows that is ~1.4 MB
 * of pure escaping — measured, not guessed: on identical data, U+001F/U+001E produced a 4.42 MB
 * asset where this pair produced 2.99 MB.
 *
 * A pipe survives JSON unescaped and a newline costs two bytes rather than six. Neither can occur in
 * a GeoNames place name — but unlike a control character that is an assumption rather than a
 * guarantee, so `assertDelimiterSafe` checks it against every field of every row instead of trusting
 * it, and the build fails loudly if the upstream data ever changes under us.
 */
const UNIT = '|';
const RECORD = '\n';

/**
 * Fails the build if any field could be mistaken for a delimiter.
 *
 * The payload is one string, so a stray pipe inside a place name would not corrupt that row alone —
 * it would shift every following field of it by one position, pairing one city's name with another
 * city's latitude. That is a wrong coordinate rendered with complete confidence, which is precisely
 * the failure this catalogue exists to prevent, so it is verified rather than assumed.
 */
function assertDelimiterSafe(fields, geonameId) {
  for (const field of fields) {
    const text = String(field);
    if (text.includes(UNIT) || text.includes(RECORD) || text.includes('\r')) {
      fail(
        `geoname ${geonameId} contains a delimiter in ${JSON.stringify(text)} — the payload ` +
          'encoding must be revised before this dataset can ship',
      );
    }
  }
  return fields;
}

const SOURCE_FILES = {
  cities: 'cities15000.txt',
  admin1: 'admin1CodesASCII.txt',
  countries: 'countryInfo.txt',
};

/** The GeoNames `cities*.txt` column layout, by index. Named so the parser reads as prose. */
const COLUMN = {
  geonameId: 0,
  name: 1,
  asciiName: 2,
  latitude: 4,
  longitude: 5,
  countryCode: 8,
  admin1Code: 10,
  population: 14,
};

/**
 * Characters that carry no combining mark, so NFD leaves them alone.
 *
 * Folding is what makes "Malmö" reachable by typing "malmo", and NFD plus mark-stripping handles
 * almost all of it. These are the letters where the diacritic is *part of the glyph* — a stroke
 * through the body rather than a mark above it — which decomposition cannot separate. Without them,
 * Ø, Đ, Ł and the dotless ı survive folding unchanged and their cities become unreachable from a
 * plain keyboard.
 */
const FOLD_EXCEPTIONS = new Map(
  Object.entries({
    ø: 'o',
    Ø: 'o',
    đ: 'd',
    Đ: 'd',
    ð: 'd',
    Ð: 'd',
    ł: 'l',
    Ł: 'l',
    ı: 'i',
    İ: 'i',
    ß: 'ss',
    æ: 'ae',
    Æ: 'ae',
    œ: 'oe',
    Œ: 'oe',
    þ: 'th',
    Þ: 'th',
  }),
);

/**
 * A name reduced to what a search should match on.
 *
 * Lowercased, decomposed, combining marks removed, the exceptions above mapped, and every run of
 * non-alphanumeric characters collapsed to a single space. Punctuation is collapsed rather than
 * deleted so that "Stoke-on-Trent" normalises to "stoke on trent" and stays three words — deleting
 * would produce "stokeontrent", which no prefix of what a user types would match.
 *
 * The *display* name is never passed through this. It keeps its own accents and casing, because the
 * point is to match forgivingly and render faithfully.
 */
export function normalizeName(value) {
  let folded = '';
  for (const char of value) {
    folded += FOLD_EXCEPTIONS.get(char) ?? char;
  }
  return folded
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function fail(message) {
  console.error(`import-city-catalogue: ${message}`);
  process.exit(1);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** `CC.code` → the region's ASCII name, e.g. `GB.ENG` → `England`. */
function readAdmin1(file) {
  const table = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const [key, , asciiName] = line.split('\t');
    if (key && asciiName) {
      table.set(key, asciiName.trim());
    }
  }
  return table;
}

/** ISO-3166 alpha-2 → country name. */
function readCountries(file) {
  const table = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const columns = line.split('\t');
    const code = columns[0]?.trim();
    const name = columns[4]?.trim();
    if (code && name) {
      table.set(code, name);
    }
  }
  return table;
}

function main() {
  const sourceFlag = process.argv.indexOf('--source');
  if (sourceFlag === -1 || !process.argv[sourceFlag + 1]) {
    fail('--source <dir> is required (the directory holding the extracted GeoNames files)');
  }
  const sourceDir = resolve(process.argv[sourceFlag + 1]);

  const paths = {};
  for (const [key, filename] of Object.entries(SOURCE_FILES)) {
    const full = join(sourceDir, filename);
    if (!existsSync(full)) {
      fail(`missing source file: ${full}`);
    }
    paths[key] = full;
  }

  const admin1 = readAdmin1(paths.admin1);
  const countries = readCountries(paths.countries);

  const rejected = { coordinate: 0, name: 0, country: 0, population: 0, columns: 0 };
  const parsed = [];

  for (const line of readFileSync(paths.cities, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const columns = line.split('\t');
    if (columns.length < 19) {
      rejected.columns += 1;
      continue;
    }

    const geonameId = Number.parseInt(columns[COLUMN.geonameId] ?? '', 10);
    const name = (columns[COLUMN.name] ?? '').trim();
    const latitude = Number.parseFloat(columns[COLUMN.latitude] ?? '');
    const longitude = Number.parseFloat(columns[COLUMN.longitude] ?? '');
    const countryCode = (columns[COLUMN.countryCode] ?? '').trim();
    const admin1Code = (columns[COLUMN.admin1Code] ?? '').trim();
    const population = Number.parseInt(columns[COLUMN.population] ?? '0', 10);

    if (!Number.isInteger(geonameId) || geonameId <= 0 || name === '') {
      rejected.name += 1;
      continue;
    }
    /*
      Validated here rather than trusted, even though the source is authoritative. A NaN latitude
      that reached the app would produce a prayer time and a Qibla bearing that are confidently
      wrong, and the cost of the check is one comparison per row at build time.
    */
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      rejected.coordinate += 1;
      continue;
    }
    if (!/^[A-Z]{2}$/.test(countryCode) || !countries.has(countryCode)) {
      rejected.country += 1;
      continue;
    }
    if (!Number.isFinite(population) || population < 0) {
      rejected.population += 1;
      continue;
    }

    const normalized = normalizeName(name);
    if (normalized === '') {
      rejected.name += 1;
      continue;
    }

    parsed.push({
      geonameId,
      name,
      normalized,
      countryCode,
      region: admin1.get(`${countryCode}.${admin1Code}`) ?? '',
      // Six decimal places is ~11 cm. Beyond that is noise for a city centroid and costs bytes.
      latitude: Number(latitude.toFixed(5)),
      longitude: Number(longitude.toFixed(5)),
      population,
    });
  }

  /*
    ── Deduplication, deterministically ──────────────────────────────────────
    `geonameId` is unique in the dump, so the duplicates that matter are *semantic*: the same
    settlement recorded twice under near-identical names within one region. Keyed on normalised name
    plus country plus region plus a coordinate rounded to two decimals (~1.1 km), which is tight
    enough that genuinely distinct same-named towns in one region survive as separate rows.

    The survivor is the higher population, and on a population tie the lower `geonameId`. Both legs
    are needed: population alone is not a total order, and a non-total order makes the output depend
    on input line order, which is exactly the reproducibility this script claims.
  */
  const byKey = new Map();
  let duplicates = 0;
  for (const city of parsed) {
    const key = `${city.normalized}|${city.countryCode}|${city.region}|${city.latitude.toFixed(2)}|${city.longitude.toFixed(2)}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, city);
      continue;
    }
    duplicates += 1;
    const better =
      city.population !== existing.population
        ? city.population > existing.population
        : city.geonameId < existing.geonameId;
    if (better) byKey.set(key, city);
  }

  /*
    Sorted once, at build time, so the device never sorts the whole catalogue. Population descending
    is the ranking every tie in the app's search falls back to; `geonameId` ascending makes the order
    total. The runtime ranker relies on this order for its final tiebreak, so it is part of the
    contract rather than a convenience.
  */
  const cities = [...byKey.values()].sort((a, b) =>
    b.population !== a.population ? b.population - a.population : a.geonameId - b.geonameId,
  );

  /*
    ── The payload is one delimited string, not an array of objects ───────────
    A 34,000-element array of nine-key objects is ~300,000 allocations for `JSON.parse` to make
    before the app can show a single row, and it holds all of them for the process's life. One string
    parses as one allocation; the runtime splits it once into a flat index and keeps that.

    See UNIT and RECORD at the top of the file for why the delimiters are ASCII separators.
  */
  const rows = cities
    .map((city) =>
      assertDelimiterSafe(
        [
          city.geonameId,
          city.name,
          city.normalized,
          city.countryCode,
          city.region,
          city.latitude,
          city.longitude,
          city.population,
        ],
        city.geonameId,
      ).join(UNIT),
    )
    .join(RECORD);

  const asset = {
    meta: {
      schema: 1,
      source: {
        provider: 'GeoNames',
        dataset: 'cities15000',
        url: 'https://download.geonames.org/export/dump/cities15000.zip',
        files: Object.fromEntries(
          Object.entries(paths).map(([key, file]) => [
            SOURCE_FILES[key],
            { bytes: statSync(file).size, sha256: sha256(file) },
          ]),
        ),
      },
      licence: {
        name: 'CC BY 4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
        attribution: 'City data © GeoNames, licensed under CC BY 4.0',
      },
      fields: [
        'geonameId',
        'name',
        'normalized',
        'countryCode',
        'region',
        'latitude',
        'longitude',
        'population',
      ],
      cityCount: cities.length,
      /*
        Recorded because a future reader's first question is "is anything missing, and why". A
        rejection count that changes between imports is the signal that the upstream format moved.
      */
      rejected,
      duplicatesCollapsed: duplicates,
    },
    rows,
  };

  /*
    Two spaces, trailing newline, keys in insertion order — the same shape Prettier would produce, so
    a re-import produces no spurious diff. `rows` is one very long line by design; it is data, not
    source, and wrapping it would only make the diff unreadable.
  */
  writeFileSync(OUTPUT, `${JSON.stringify(asset, null, 2)}\n`, 'utf8');

  const bytes = statSync(OUTPUT).size;
  console.log(`cities:      ${cities.length}`);
  console.log(`duplicates:  ${duplicates} collapsed`);
  console.log(`rejected:    ${JSON.stringify(rejected)}`);
  console.log(`output:      ${OUTPUT}`);
  console.log(`size:        ${(bytes / 1024 / 1024).toFixed(2)} MB (${bytes} bytes)`);
  console.log(`sha256:      ${sha256(OUTPUT)}`);
}

main();
