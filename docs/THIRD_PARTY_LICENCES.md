# Third-party licence notices

**Created:** 2026-08-12
**Scope:** runtime dependencies that carry a notice obligation, plus the ones whose licence is worth
recording because they were chosen deliberately over alternatives.

This file exists because the repository had **no licence-notice mechanism**. There is a top-level
`LICENSE` covering NoorLife's own code and nothing recording what NoorLife ships alongside it. That
gap was found while verifying a newly added dependency against the instruction to include it "in
licence notices as required by repository policy" — there was no policy to comply with, so this is
the start of one.

**What this file is not.** It is not a complete dependency audit. Every entry below was read from
`package-lock.json` and, where a licence file ships, from the package itself. Nothing here is
inferred from a package name or a README. Entries are added as dependencies are reviewed, not
generated in bulk, so an absence means "not yet reviewed" rather than "no obligation".

---

## Notice obligations

| Package | Version | Licence | Notice required? |
|---|---|---|---|
| `adhan` | 4.4.4 | MIT | **Yes** — MIT requires the copyright notice and permission notice be retained |
| `expo` | 57.0.8 | MIT | **Yes** |
| `react-native` | 0.86.0 | MIT | **Yes** |
| `@photostructure/tz-lookup` | 11.6.1 | CC0-1.0 | **No** — see below |
| Poppins (`@expo-google-fonts/poppins`) | — | SIL OFL 1.1 | **Yes** — OFL requires the licence travel with the font |
| **GeoNames `cities15000`** — bundled data, not a package | dump downloaded 2026-08-13 | **CC BY 4.0** | **Yes**, and it is the only entry here whose notice must be **user-visible**. See below |

MIT and OFL notices are satisfied by the licence text shipping inside each package in
`node_modules`, which is included in the application bundle's dependency tree. A user-facing
acknowledgements screen does not yet exist; when one is added, the MIT and OFL entries above are
what it must list.

---

## `@photostructure/tz-lookup` — the entry this file was created for

| Field | Value |
|---|---|
| Version | 11.6.1 (pinned `^11.6.1`, locked with `resolved` + `integrity`) |
| Licence | **CC0-1.0** — a public-domain dedication |
| Attribution required | **No.** CC0 explicitly waives the attribution requirement |
| Unpacked size | ~88 KB, 5 files, no transitive dependencies |
| Native code | None. One JavaScript file plus type definitions |
| Network access | None. The boundary data is bundled and the lookup is local |

Recorded here despite requiring no notice, because "no notice required" is itself a fact worth being
able to check, and because the alternatives that were rejected are part of why this one is present:

- `geo-tz` — MIT, but ~73 MB unpacked and Node-`fs` based, so not viable in a React Native bundle.
- `tz-lookup` (the original) — also CC0-1.0, ~152 KB, superseded by the above.
- A network timezone service — would send user coordinates to a third party for a value obtainable
  offline. Rejected on privacy grounds, not licensing.
- `expo-location`'s `timezone` field — exists, but the SDK 57 documentation marks it **iOS only**.

### Why the licence matters to this dependency in particular

It resolves a **coordinate to an IANA timezone**, which is what makes prayer times display in the
prayer location's own clock rather than the device's. The data is a compressed raster of the IANA
boundary set — a derived work of a public-domain database, dedicated to the public domain in turn.
Had it been copyleft, bundling it into a closed application would have been the licensing question
to answer before adopting it. It is not, so there is none.

Offline resolution is also a privacy property rather than only a performance one: no coordinate
leaves the device to obtain a timezone. Asserted by `faith-prayer-timezone.test.ts`, and structurally
by the module having no transport to reach.

---

## GeoNames `cities15000` — the bundled offline city catalogue

The only third-party **data set** NoorLife ships, and the only entry in this file that carries a
**user-visible** notice obligation. MIT and OFL are satisfied by licence text travelling in the
bundle; CC BY is not — it requires attribution "in the manner specified by the author", which for a
shipped application means a credit a user can actually find.

### Source, exactly as obtained

| Field | Value |
|---|---|
| Provider | GeoNames (`geonames.org`) |
| Dataset | `cities15000` — every city with population > 15,000 |
| Download URL | `https://download.geonames.org/export/dump/cities15000.zip` |
| Supporting files | `admin1CodesASCII.txt`, `countryInfo.txt` (same directory) |
| Downloaded | 2026-08-13 |
| Licence | **CC BY 4.0** — `https://creativecommons.org/licenses/by/4.0/` |
| Required attribution | `City data © GeoNames, licensed under CC BY 4.0` |

GeoNames publishes no version number, so the download date plus the checksums below are the version.

### Checksums

Source files, as downloaded:

| File | Bytes | SHA-256 |
|---|---|---|
| `cities15000.zip` | 3,305,700 | `c60c95493f830103510465e1952b416851a930966eef753b36c57d98ab87c767` |
| `cities15000.txt` | 8,404,560 | `6741785521e08f9b5af1be3d0bb3a2da85dc841303431039481a54cf93ca4c26` |
| `admin1CodesASCII.txt` | 151,536 | `590651498043f674accda2b7f46d21286cda0e290b02f8561c5005eee9a5448c` |
| `countryInfo.txt` | 31,678 | `93bafc525813f22e4711ff9ed6d626343094ce48c26388dc7c49189b3d7d5512` |

Processed asset, as committed:

| File | Bytes | SHA-256 |
|---|---|---|
| `assets/data/city-catalogue.json` | 2,297,003 (2.19 MB) | `39656ac69333179ad7daff2cb443daa86886392d1241c78b300bba47101dda1a` |

The same three source files re-run through `scripts/import-city-catalogue.mjs` reproduce that hash
byte for byte — the importer has no clock, no locale-dependent collation and no randomness, and
every sort has an explicit total ordering. That reproducibility is what makes these checksums an
audit rather than a note: the committed asset can be proven to be what the recorded inputs produce.

### What is redistributed, and what is not

**34,084 cities**, each carrying exactly eight fields: GeoNames id, display name, a precomputed
normalised search name, ISO country code, first administrative region, latitude, longitude, and
population. Nothing was rejected during import (0 invalid coordinates, 0 unnamed rows, 0 unknown
country codes); one semantic duplicate was collapsed.

The raw dump is **not** committed. Eleven of its nineteen columns are dropped: feature class and
code, `cc2`, admin2–admin4 codes, elevation, DEM, the modification date, and the `alternatenames`
column.

Two of those exclusions are deliberate decisions rather than trimming:

- **`timezone` is excluded on purpose.** NoorLife derives a coordinate's IANA zone locally through
  `tz-lookup`, and `prayer-location-store.ts` stores that zone beside the coordinate specifically so
  the two cannot disagree. Importing a second zone for the same place would recreate exactly the
  defect that design prevents — a catalogue row and a polygon lookup differing by one zone is a
  plausible wall-clock time that is silently wrong.
- **`alternatenames` is excluded after measurement.** Importing it cost 0.81 MB — 27% of the asset,
  2.19 MB against 3.00 MB — and produced actively harmful rows: Kisumu carries the alias `florence`,
  São Paulo carries `san`.
  The importer's header records the full measurements. The handful of English names GeoNames does
  not already use are curated by hand in `city-exonyms.ts` instead.

### Personal data

**None.** The dataset describes populated places, not people. Every retained field is a property of a
settlement — its name, its administrative parent, its centroid and its population. There is no
person, address, contact detail or identifier in it, and the eight-field allow-list is enumerated in
the importer so a future column cannot be added without the decision being visible in a diff.

### Where the attribution appears

1. **In the asset itself** — `meta.licence.attribution`, so the credit travels with the data rather
   than depending on a document staying in sync with it.
2. **In the app**, on the content-information screen, read from that field rather than retyped.
3. **Here.**

### What CC BY 4.0 requires, and what it does not

It permits redistribution, including inside a commercial application, and permits the derivative form
this asset is. It requires credit, a licence link, and an indication that changes were made — the
data **is** modified: columns dropped, names normalised, rows deduplicated and re-sorted. The
attribution string plus this section carry all three.

It does **not** require the app to be open source, does not restrict commercial use, and imposes no
share-alike obligation on NoorLife's own code.

---

## Review

Add an entry whenever a runtime dependency is introduced. Record the version, the licence as stated
in the lockfile, whether a notice is required, and — if the choice was contested — what was rejected
and why.
