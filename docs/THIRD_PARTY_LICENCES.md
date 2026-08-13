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

## Review

Add an entry whenever a runtime dependency is introduced. Record the version, the licence as stated
in the lockfile, whether a notice is required, and — if the choice was contested — what was rejected
and why.
