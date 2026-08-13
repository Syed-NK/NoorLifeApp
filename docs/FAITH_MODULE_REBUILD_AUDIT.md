# Faith module — audit, information architecture and phased plan

**Date:** 2026-08-10
**Branch:** `feature/subscriptions-family-six`
**Scope:** the complete NoorLife Faith experience — home, Qur'an, reader, translations, audio,
progress, bookmarks, Qibla, Tasbih, and the original PNG asset system.

This document is the deliverable for steps 1–5 of the brief's required process. Nothing has been
implemented from it yet, and no dependency has been installed.

---

## 1. Method

Every file under `src/features/faith/`, `src/features/modules/faith/`, `src/app/faith/`,
`supabase/functions/quran-content/` and the Faith entries in `src/features/modules/module-registry.ts`
was read in full. The audit distinguishes three things that are easy to conflate:

- **Contract exists** — a typed interface describes the capability.
- **Implementation exists** — something satisfies it.
- **Real data exists** — the implementation is backed by a genuine source, not a fixture.

A capability can pass the first two and still be a fabrication. Several do.

---

## 2. What is genuinely finished and must not be disturbed

The Quran Foundation trust boundary is complete, tested from both sides, and is the strongest part
of the module. It is treated as frozen infrastructure by every phase below.

| Component | File | State |
|---|---|---|
| Wire contract | `data/quran-foundation/quran-foundation.contract.ts` | Closed request union; no field can carry a URL, host or credential |
| Transport | `data/quran-foundation/quran-content.endpoint.ts` | Exactly one `supabase.functions.invoke`; no logging; no Supabase object escapes |
| Cache | `data/quran-foundation/quran-cache.ts` | Bounded (48 entries), one-week hard ceiling per licence |
| Repository | `data/quran-foundation/quran-foundation.repository.ts` | Maps wire → domain; no `data/mock` import; no fallback on any failure path |
| Edge function | `supabase/functions/quran-content/` | `verify_jwt = true`, seven-operation allowlist, field-name rejection, input bounds, one-retry, redirect refusal, closed error table |
| Tests | 2 client suites (1,225 lines) + 11 Deno suites | Byte-equality on Arabic, source scans from both directions |

**Constraint carried into every phase:** the seven approved operations, `verify_jwt = true`, the
one-week cache ceiling, the one-retry limit, server-only credentials and the absence of any vendor
hostname in the mobile bundle are not modifiable. Adding an operation (needed for audio — see §7)
is a reviewed addition to the allowlist table, not a relaxation of it.

---

## 3. Feature matrix

Legend: **C** complete · **P** partial · **M** missing · **N** needs native work · **A** needs original PNG · **B** blocked by unapproved scope

### 3.1 Faith home

| Capability | State | Evidence |
|---|---|---|
| Screen composition, 8-tile grid, section order | C | `modules/faith/faith-home-content.tsx` |
| Approved PNG pictograms for the 8 tiles | C | `faith-submenu-assets.ts`, 8 finals installed |
| Genuine access to Quran / Prayer / Qibla / Tasbih / Duas / Calendar / Hadith / Mosques | C | All 19 routes exist and resolve; `faith-routes.test.ts` walks them |
| Faith AI within approved scope | C | `screens/faith-ai-screen.tsx`, `faith-ai-boundary.test.ts` |
| **Continue Quran from real reading state** | **M** | `faith-home-content.tsx:49` reads `faithHomeFixture`; the real hook `useContinueReading` is not used on this screen |
| **Prayer summary from real prayer data** | **M** | Same fixture; prayer times themselves are fixtures (§3.7) |
| **No fabricated dates / progress / activity** | **M** | See defects D1–D4 |
| **No dead controls** | **M** | See defect D5 |
| Faith is free, never premium-locked | C | No entitlement gate anywhere in the Faith tree |
| Original home artwork beyond the 8 tiles | A | Hero PNG exists; Ramadan/Upcoming card has no mark (`docs/FAITH_ASSET_GAPS.md`) |

### 3.2 Qur'an home

| Capability | State | Evidence |
|---|---|---|
| Complete surah catalogue from approved source | C | `listSurahs` → `list_chapters` |
| Continue reading card | P | Renders, but the position is seeded with a fabricated value (D3) |
| **Open a chosen surah** | **M** | `quran-screen.tsx:116` — every surah row pushes the reader with **no parameter**; the reader opens whatever position was last stored. Tapping surah 2 does not open surah 2. |
| Real recent-reading history | M | No history is recorded anywhere |
| Real bookmarks | P | List exists; see §3.8 |
| Translation preferences | C | `preferences-screen.tsx` |
| Reciter preferences | P | Catalogue and selection exist; nothing plays |
| Reading progress | M | Nothing beyond a single last-position record |
| Loading / offline / empty / auth / service-error states | C | `FaithResourceView` + `FaithResult` union covers all eight |
| **Prominent API-source banner removed** | **M** | `faith-states.tsx:154` renders `Source: Quran Foundation Content API` at the top of Qur'an home, reader and Daily Ayah |
| No mock scripture in production | P | Production path is clean, but `use-continue-reading.ts:4` imports `mockSurahsForTest` and uses it for on-screen surah names (D6) |
| Search marked unavailable | C | `search-screen.tsx` states it; repository returns `unsupported` |
| No Search API calls | C | B — no operation exists to make one |

### 3.3 Qur'an reader

| Capability | State | Evidence |
|---|---|---|
| Arabic byte-for-byte from approved source | C | Copied by assignment; asserted by fixture byte-equality |
| Arabic visually dominant | C | `ArabicText size="display"` |
| Translation separate from scripture | C | Distinct types all the way to render |
| Verse number and surah context | P | Verse number shown; **surah name/number is not on screen** |
| Translation title and translator attribution | **M** | The reader shows the source badge only. Translator name never appears in the reader. |
| Bookmarking | C | Per-ayah toggle |
| Continue-reading position | P | Written on an explicit tap — correct design — but with a **hard-coded 0.55 progress** (D4) |
| Bounded pagination / load-more | C | Cursor-based, 20/page, 50 max |
| Honest "more remains" indication | C | "Showing 20 of 286 verses" |
| Retains loaded verses when a page fails | C | `moreFailed` renders a retry line beneath existing verses |
| Responsive typography / large font | C | `useModuleMetrics().dp` + `faith-viewport-fit.test.tsx` |
| RTL correctness | C | Per-node `writingDirection`, not app-wide flip |
| Screen-reader labels | C | Throughout |
| Safe-area support | C | `FaithScreen` scaffold |
| No machine translation, no Arabic normalisation | C | Source-scanned |
| No page-mode selector | C | None exists — correct, no Mushaf assets |

### 3.4 Translations

| Capability | State |
|---|---|
| Live catalogue via `list_translation_resources` | C |
| Selection and persistence | C |
| Default `131` | C (`DEFAULT_TRANSLATION_ID`) |
| Migration from mock IDs | C (`LEGACY_IDS`) |
| Title, author, language shown | P — shown in **preferences only**, never in the reader or Daily Ayah |
| Behaviour when an edition becomes unavailable | M — a `404` for a stored translation id surfaces as a bare error with no recovery path |
| No implicit unattributed fallback | C |
| No direct vendor request from mobile | C |

### 3.5 Audio and reciter selection

| Capability | State |
|---|---|
| Live reciter catalogue, default `1`, persisted | C |
| **Verse-level playback** | **M / N** — no audio operation on the edge function, no audio player in the app, no native audio package installed |
| Play/pause, prev/next ayah, speed, repeat, auto-advance | M / N |
| Visible reciter name and style | P — preferences only |
| Loading / buffering / offline / error states | M |
| Stop on navigation/lifecycle | M |
| Accessible controls | M |
| Translated-audio narration | Correctly absent — the API does not provide it |

**Native audit:** `package.json` contains no `expo-audio` and no `expo-av`. See §7.1.

### 3.6 Reading progress

Effectively absent. One `ReadingPosition` record exists (surah, ayah, progress, updatedAt) and its
`progress` value is a literal `0.55` written by the reader. Everything else in the brief's §6 —
completion percentage, daily goal, minutes or ayat read, history, streak, weekly visualisation,
reset/edit-goal — has no code and no storage behind it. **M** throughout.

There is also no definition anywhere of when an ayah counts as read.

### 3.7 Prayer data (supporting Faith home)

| Capability | State |
|---|---|
| Repository contract (location, method, Asr convention, offsets, next-prayer) | C |
| Notification preference persistence | C |
| **Real times** | **M** — `mock-prayer-times.repository.ts` returns the reference screenshot's fixed times (05:02 / 12:35 / 16:15 / 20:44 / 22:10) for every location and every date |
| **Real location** | **M / N** — returns a hard-coded Manchester coordinate; `expo-location` is not installed |
| Hijri date | M — hard-coded string |

### 3.8 Bookmarks

| Capability | State |
|---|---|
| Add/remove verse bookmark | C |
| Bookmark list, grouped by kind | C |
| Empty state | C |
| Local persistence | C |
| No Quran Foundation user APIs | C (B — none exist in the contract) |
| **Navigate from bookmark to the correct surah and ayah** | **M** — `bookmarks-screen.tsx:69` renders rows with no `onPress`. A bookmark is a dead entry. |
| Preserve translation and reading context | M — follows from the above |

### 3.9 Qibla

| Capability | State |
|---|---|
| Correct bearing calculation | C — real great-circle bearing + haversine distance, `mock-mosque.repository.ts` |
| Permission-denied state | C — routed through `FaithResourceView` |
| **Real device heading** | **M / N** — no magnetometer, no `expo-location`, no `expo-sensors`. The screen states plainly that it is not a live compass, which is honest but is not the feature. |
| **Real user location** | **M / N** — fixture coordinate |
| Calibration and accuracy state | M |
| Turn left/right and aligned guidance | M |
| Emulator / no-sensor behaviour | M |
| Original compass dial, Kaaba marker, direction indicator | **A** — currently a bordered circle with a rotated icon-font glyph |
| Tests for bearing and guidance | P — bearing math is tested; there is no guidance to test |

### 3.10 Tasbih

| Capability | State |
|---|---|
| Counting, persistence, rounds, dhikr presets | C |
| Reset with confirmation | C |
| Arabic / transliteration / translation kept distinct | C |
| Accessible controls, live-region count | C |
| **Tap-anywhere counting** | **M** — only the 190 dp circle counts |
| **Configurable target** | **M** — target is fixed per preset |
| **Haptic feedback** | **M / N** — `expo-haptics` not installed |
| **Original bead PNG assets and animation** | **A** |

### 3.11 Original PNG asset system

| Asset | State |
|---|---|
| Quran, Prayer, Qibla, Tasbih, Duas, Calendar, Hadith, Mosques (8 submenu marks) | C — installed, registered, no fallback path |
| Faith hero | C |
| Bookmarks, Translation, Recitation/audio, Reading progress | **A** |
| Empty and offline state art | **A** |
| Compass dial, Kaaba direction marker | **A** |
| Tasbih beads | **A** |
| Reader decorative elements | **A** |
| Ramadan / Upcoming mark | **A** — already recorded in `docs/FAITH_ASSET_GAPS.md` |

---

## 4. Defects found

These are not missing features; they are statements the app currently makes that are not true.

| # | Defect | Location | Why it matters |
|---|---|---|---|
| **D1** | The entire Faith home is fixture-driven: next prayer "Dhuhr 12:35 PM", "May 19, 2025", "21 Dhul-Qa'dah 1446 AH", today's worship with five fixed times, "Ramadan 1446 AH — In 296 days", and a Faith AI insight captioned "Source: Sahih Bukhari". | `modules/faith/faith-view-model.ts`; `faith-home-content.tsx:49`; `module-registry.ts` faith `hero` | Fabricated dates and activity. Also a **content-integrity** issue: an unverified narration is attributed to Sahih Bukhari on the home screen. |
| **D2** | Qur'anic Arabic is hard-coded in the JS bundle, unattributed. | `faith-view-model.ts:117` | Scripture from a non-approved source, outside the boundary the whole integration exists to enforce. The existing source scans cover `src/features/faith/` and do not reach this file. |
| **D3** | Continue-reading seeds a fabricated position (Al-Kahf 32 at 55%) before the user has read anything. | `use-continue-reading.ts:27` | Fabricated progress presented as the user's own. |
| **D4** | The reader writes a literal `0.55` as reading progress for every verse saved. | `reader-screen.tsx:226` | The progress bar is meaningless. |
| **D5** | The Continue-Quran play button flips a boolean and streams nothing; its hint says audio "arrives with the approved recitation source". | `faith-home-content.tsx:58` | A non-functional control presented as a transport control. |
| **D6** | Production presentation reads mock data: surah names on the Continue card come from `mockSurahsForTest`. | `use-continue-reading.ts:4,45` | Mock data reaching a production surface. |
| **D7** | Surah rows do not open their surah. | `quran-screen.tsx:116` | Core navigation is wrong. |
| **D8** | Bookmark rows are inert. | `bookmarks-screen.tsx:69` | The feature's stated purpose is unreachable. |
| **D9** | The prominent `Source: Quran Foundation Content API` badge sits at the top of three reading surfaces. | `faith-states.tsx:154` | Explicitly to be removed by the brief. |
| **D10** | The module registry marks Qibla and Dhikr `available: false` with "arrives in a later release" while both screens exist and are linked from the home grid. | `module-registry.ts` | Two contradictory statements about the same feature. |
| **D11** | Reader shows no surah context and no translator attribution. | `reader-screen.tsx` | Attribution requirement; also a usability gap. |

---

## 5. Proposed information architecture

Original to NoorLife. The organising idea is **three intents** — *read*, *practise*, *orient* — rather
than a flat grid of every feature, with the home surfacing only what is true right now.

```
Faith (tab: Today)
├── Today                       ← home; real state only
│   ├── Next prayer strip           (real times, or an honest "set your location")
│   ├── Continue reading            (only when a real position exists)
│   ├── Verse of the day            (live from approved source)
│   ├── Today's worship             (real local marks)
│   └── Feature grid                (8 tiles, unchanged geometry)
│
├── Qur'an (tab)
│   ├── Qur'an home
│   │   ├── Continue reading        (real position)
│   │   ├── Reading progress card   (real, links to Progress)
│   │   ├── Recently read           (real history, empty until there is some)
│   │   ├── Bookmarks               (n saved)
│   │   ├── Surah catalogue         (114, tappable → reader/[surah])
│   │   └── Reading settings        (translation · reciter · font size)
│   ├── reader/[surah]?ayah=        ← addressable; this is the fix for D7 and D8
│   ├── progress                    ← new: goal, history, completion
│   └── bookmarks
│
├── Practice (tab: Worship)
│   ├── Worship checklist
│   ├── Tasbih
│   ├── Duas
│   └── Hadith
│
├── Faith AI (tab)                  ← unchanged, existing approved scope
│
└── More (tab)
    ├── Orient — Prayer times · Qibla · Mosques · Calendar
    ├── Preferences — translation · reciter · calculation · reading
    └── About this content          ← new: discreet Quran Foundation acknowledgment,
                                       translation edition, reciter, cache policy
```

**Route changes required**

| Route | Change |
|---|---|
| `/faith/reader` | → `/faith/reader/[surah]` with optional `?ayah=` and `?from=bookmark` |
| `/faith/progress` | new |
| `/faith/content-info` | new — attribution home |
| `/faith/search` | kept, but the control is **removed from Qur'an home**; search remains reachable from More and covers Hadith and duas only, labelled as such |

Removing the Qur'an-home search entry point is the more honest option of the two the brief offers:
a search field on the Qur'an screen that cannot search the Qur'an is a worse experience than no field.

---

## 6. Component outlines (low detail)

Vertical bars are card edges; nothing here is final visual design.

### 6.1 Faith Today (home)

```
┌───────────────────────────────────────────┐
│  hero artwork (existing PNG)              │
│  Next prayer · Maghrib 20:44 · in 3h 12m  │   ← real, or:
│  [Set your location] ─────────────────────│   ← when permission is absent
└───────────────────────────────────────────┘
┌ Continue ─────────────────────────────────┐   ← rendered only when a real
│ [quran.png]  Al-Kahf · verse 32           │      position exists; otherwise
│              ▓▓▓▓▓░░░░░  32 of 110        │      a "Start reading" card
└───────────────────────────────────────────┘
┌ 8-tile grid (unchanged geometry) ─────────┐
│  Quran  Hadith  Duas   Prayer             │
│  Qibla  Tasbih  Mosques Calendar          │
└───────────────────────────────────────────┘
┌ Verse of the day ──────┐┌ Today's worship ┐
│  العربية (live)         ││ ✓ Fajr          │
│  translation           ││ ● Dhuhr         │
│  Surah 94:6            ││ ○ Asr           │
└────────────────────────┘└─────────────────┘
┌ Faith AI ─────────────────────────────────┐   ← scope note only; no fabricated
└───────────────────────────────────────────┘      "insight" and no hadith caption
```

Removed from this screen: the fixture play button, the Ramadan countdown, the hard-coded Hijri
card, and the fabricated insight body.

### 6.2 Qur'an home

```
[ Continue reading — Al-Kahf 32 ▓▓▓░░ ]
[ Progress — 4 of 7 days · 128 ayat this week   → ]   ← real or hidden
[ Recently read — Al-Kahf · Yasin · Al-Mulk     → ]   ← real or hidden
[ Bookmarks (12) ] [ Reading settings ]
── All surahs ────────────────────────────────
 1  Al-Fatihah    The Opening · 7 · Meccan   الفاتحة
 2  Al-Baqarah    The Cow · 286 · Medinan    البقرة
 …                                    (→ reader/[surah])
```

No source banner. Provenance moves to **More → About this content**.

### 6.3 Reader `/faith/reader/[surah]`

```
┌ Al-Kahf · The Cave · 110 verses ──────────┐   ← surah context (fixes D11)
│                          [Aa] [♪] [🔖]     │   ← font size · audio · bookmarks
└───────────────────────────────────────────┘
┌ verse 32 ─────────────────────────────────┐
│                          ٱلْعَرَبِيَّة (display)  │
│  ─────────────────────────────────────────│
│  Translation text                          │
│  Dr. Mustafa Khattab — The Clear Quran     │   ← translator, per screen (fixes D11)
│  [▶ play]  [🔖]                            │
└───────────────────────────────────────────┘
   … Showing 20 of 110 verses
   [ Load the next verses ]
```

Audio transport, when Phase 4 lands, is a docked bar above the safe-area inset:

```
┌ ▶  Al-Kahf 32 · AbdulBaset AbdulSamad ── ⏮ ⏸ ⏭ ─┐
```

### 6.4 Reading progress `/faith/progress`

```
[ Daily goal — 10 ayat ]  [ Edit goal ]
 M  T  W  T  F  S  S          ← bars from recorded days only; absent days are
 ▓  ▓  ░  ▓  ░  ░  ░             empty, never interpolated
Surah completion
  Al-Kahf   32/110  ▓▓▓░░░░░░░
[ Reset reading data ]        ← confirmed, destructive
```

### 6.5 Qibla

```
        ┌─────────────────┐
        │   compass dial   │  ← original PNG dial, north-locked
        │        ▲         │  ← Kaaba marker PNG, rotates with (qibla − heading)
        │      Kaaba       │
        └─────────────────┘
   Turn right 24°     ·     Aligned ✓
   Accuracy: low — move your phone in a figure eight
   1,240 km to Makkah
```

States: permission denied · no compass on this device · calibrating · low accuracy · aligned.
Reduced-motion honoured by snapping the rotation instead of animating it.

### 6.6 Tasbih

```
   ┌──── bead strand PNG, advances one bead per count ────┐
                  ٱللَّٰهُ أَكْبَر
                  Allahu Akbar
                  God is the greatest
              ┌───────────────┐
              │      33       │   ← whole card is the tap target
              │    of 33      │
              └───────────────┘
        rounds: 3      target: [33 ▾]      [Undo] [Reset]
```

---

## 7. Decisions and dependencies requiring approval

Nothing in this section has been actioned.

### 7.1 Native dependencies

Verified against the SDK 57 documentation (`https://docs.expo.dev/versions/v57.0.0/`).

| Package | Needed for | SDK 57 status | Build impact | Alternative |
|---|---|---|---|---|
| `expo-audio` | Brief §5 in full | Supported in SDK 57. Config-plugin properties for background playback (default on) and Android `RECORD_AUDIO` (leave off — NoorLife records nothing) | **New development build required.** This project runs `expo-dev-client` + `expo run:android`, not Expo Go, so any new native module means a rebuild on both targets | None. There is no JS-only audio path in React Native. Not shipping audio is the only alternative. |
| `expo-location` | Brief §8 real location **and** real heading; also real prayer times | Supported. Adds `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` automatically. `watchHeadingAsync` returns `magHeading`, `trueHeading` (−1 without location permission) and a 0–3 `accuracy` calibration level | **New development build required.** Adds two Android permissions to the manifest | `expo-sensors` magnetometer alone gives magnetic heading but no declination correction, so the Qibla arrow would be wrong by up to ~20° in parts of the world. Rejected. |
| `expo-haptics` | Brief §9 optional haptics | Supported | **New development build required** | Omit haptics. The feature is optional in the brief. |

**Recommendation:** approve `expo-audio` and `expo-location` together so one rebuild serves both, and
decide `expo-haptics` at the same time since it is free to include in the same rebuild.

If none are approved: §5 cannot be built at all, §8 stops at the current bearing-only screen, and
the Faith home cannot show real prayer data.

### 7.2 Edge-function change (audio)

Verse-level recitation needs one new operation on the allowlist — the vendor's per-ayah recitation
audio route, which is **within the approved Content scope**. This is an addition to the closed table
in `supabase/functions/quran-content/contract.ts` and `quran-foundation-client.ts`, mirrored in the
mobile contract, with matching Deno tests. It does not weaken any control: `verify_jwt`, the field
allowlist, the bounds and the error table are untouched.

**Requires:** approval to edit the function, and a deployment of `quran-content` when it lands.
Deployment is explicitly out of scope until authorised.

### 7.3 Prayer-time calculation

Real prayer times need an audited calculation. Two options:

1. **A vetted JS library** (e.g. `adhan`, pure JavaScript, no native code, no rebuild). Implements the
   six conventions already enumerated in `CalculationMethod`.
2. **Keep prayer times as clearly-labelled samples** and make the Faith home say so, rather than
   showing a fabricated next prayer.

Option 2 is the default if no approval arrives — it is honest and needs no dependency. Option 1 is
what makes the brief's "prayer summary based on real prayer data" achievable, and is a product
decision (which authority NoorLife stands behind) as much as a technical one.

### 7.4 Original PNG production

I cannot generate production-quality raster artwork inside this environment. Two paths:

1. **Manifest + prompts** (brief's stated fallback). Phase 8 produces a precise per-asset manifest —
   subject, palette hexes from the Faith theme, lighting, perspective, canvas size, `@2x`/`@3x`
   variants, transparency and safe-area rules — plus a generation prompt per asset, matched to the
   existing eight submenu marks so the set reads as one system.
2. **Canva** is connected to this session and can generate and export designs. Whether Canva-generated
   artwork satisfies "original work only" for NoorLife's licensing is **your call**, not mine.

Until artwork exists, no placeholder ships: surfaces that need art keep the restrained vector they
have and the gap is recorded in `docs/FAITH_ASSET_GAPS.md`, as the existing convention does.

### 7.5 Product decisions

| Decision | Options | Recommendation |
|---|---|---|
| Qur'an search control | Remove from Qur'an home / keep with "unavailable" label | **Remove.** Keep search in More, scoped and labelled to Hadith + duas. |
| When does an ayah count as read? | On render / on scroll-past / on explicit tap / on dwell | **Scroll-past with a dwell threshold**: an ayah counts once it has been at least half visible for ≥2s. Never on mount. Definition goes in one constant with a test. |
| Streak | Show / omit | **Omit until there is ≥7 days of real data**, then derive strictly from recorded days. |
| Faith home "insight" card | Remove / keep as a scope note | **Keep as a scope note** with no generated content and no attribution claim. |
| Fixture prayer times on home | Show labelled / hide the strip | Depends on §7.3. |

---

## 8. Phased implementation plan

Each phase is independently shippable, ends green on the full gate, and touches a disjoint set of
files where possible. Phases 1–3 and 6–7 need **no** new dependency and can start immediately on
your word. Phases 4 and 5 are blocked on §7.1.

### Phase 0 — Truth pass (no new features)

Fixes D1–D6, D9, D10. Removes every fabrication before anything is built on top of it.

- Delete `faithHomeFixture`; drive the home from real hooks and repositories.
- Delete the hard-coded Arabic (D2) and extend the Faith source scan to
  `src/features/modules/faith/` so it cannot return.
- Remove the seeded reading position (D3) and the literal `0.55` (D4).
- Remove the fixture play button (D5).
- Move surah-name formatting off `mockSurahsForTest` onto the repository catalogue (D6).
- Remove the `Source: …` badge from reading surfaces; add **More → About this content** carrying the
  discreet Quran Foundation acknowledgment, the active translation edition and translator, the
  reciter, and the cache policy.
- Reconcile `module-registry.ts` capability flags with the screens that exist (D10).

*Tests:* home renders no date/time string that is not derived from a repository; source scan for
Arabic literals outside the approved path; badge absence; registry-vs-routes consistency.

### Phase 1 — Addressable reader

Fixes D7, D8, D11.

- `/faith/reader/[surah]` with `?ayah=`; surah rows and bookmark rows navigate to it.
- Surah context header; translator attribution per verse block; font-size control.
- Deep-link into a specific ayah scrolls to it and highlights without altering progress.

*Tests:* navigation from catalogue and from a bookmark lands on the right surah and ayah; back
behaviour; existing pagination tests still pass.

### Phase 2 — Reading progress

- Storage: `faith-reading-log` — per-day ayat read, per-surah furthest ayah, session minutes.
- The "counts as read" rule as one tested constant (§7.5).
- `/faith/progress`: goal, edit goal, weekly bars from recorded days only, per-surah completion,
  reset with confirmation.
- Qur'an home gains real *Recently read* and a real progress card; both hidden when empty.

*Tests:* the read rule (including that rendering alone never increments), goal edit, reset,
weekly aggregation with gaps, persistence across restart.

### Phase 3 — Translation robustness

- Translator + edition surfaced in the reader and Daily Ayah.
- Recovery path when a stored translation id 404s: name the problem, offer the catalogue, never
  silently substitute.

### Phase 4 — Audio ⛔ blocked on §7.1 + §7.2

- New edge-function operation, mirrored contract, Deno tests, deployment request.
- `expo-audio` player behind a `QuranAudioPlayer` port so the screens never import it directly.
- Verse-level play/pause, prev/next, buffering and error states, reciter name visible, stop on blur
  and on unmount. Speed/repeat/auto-advance **only** if they work; otherwise absent, not disabled.

### Phase 5 — Qibla ⛔ blocked on §7.1

- `expo-location` for coordinate and heading; declination handled via `trueHeading`.
- Turn-left/right and aligned guidance as a pure function with its own test table.
- Calibration and accuracy states; explicit no-sensor and emulator behaviour; reduced motion.
- Real location also unblocks honest prayer times if §7.3 option 1 is approved.

### Phase 6 — Tasbih

- Tap-anywhere target, configurable target, loop count, optional haptics (if approved).
- Bead strand animation driven by count, reduced-motion aware.

### Phase 7 — Faith home integration

Reassembles the home on the now-real data from Phases 0–6.

### Phase 8 — Original PNG production

Manifest + prompts per §7.4, then integration behind a single `faith-assets.ts` map with no
fallback path, mirroring how the eight submenu marks are already handled. Every asset verified on
light and dark backgrounds.

### Phase 9 — Device verification and full gate

Android API 36 emulator **and** the physical Samsung device, at large font scale, small viewport,
RTL, offline, denied permissions, expired auth and a forced upstream failure. Then: focused Faith
tests, full Jest, `deno task verify`, `tsc --noEmit`, ESLint, Prettier on touched files,
`git diff --check`, secret scan, and the mobile-side vendor source scan.

---

## 9. Decisions — approved 2026-08-10

Recorded here rather than left in a conversation, because each one changes what ships.

| Decision | Outcome | Consequence |
|---|---|---|
| `expo-audio` | **Approved** | Phase 4 proceeds. Carries with it approval to add one audio operation to the `quran-content` allowlist (§7.2). Deployment still requires a separate explicit authorisation. |
| `expo-location` | **Approved** | Phase 5 proceeds with `trueHeading`. Adds `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` to the Android manifest. |
| `expo-haptics` | **Approved** | Phase 6 haptics proceed. |
| Prayer times | **Vetted JS library (`adhan`)** | Pure JavaScript, no native rebuild. The six conventions already in `CalculationMethod` map onto it. NoorLife stands behind the calculation; the method and Asr convention remain user-selectable and are stated on screen. |
| PNG production | **Manifest + generation prompts** | Phase 8 produces the spec of record; no artwork is generated in this environment and no placeholder ships. |
| Qur'an-home search | **Removed** | Search stays in More, scoped and labelled to Hadith and duas. |

All three native packages are installed in a single pass so one development build serves all of
them. Both targets — Android API 36 emulator and the physical Samsung device — need that rebuild
before Phases 4–6 can be verified.

### Still requiring separate authorisation

- Deploying the modified `quran-content` edge function.
- Any commit, push or secret change.

---

## 10. Implementation status

### Phases 0–3 — complete, full gate green

| Phase | Delivered |
|---|---|
| **0** | Every fabrication removed. `faithHomeFixture` deleted; the home is driven by `useFaithHome` and the real repositories. Hijri dates are now calculated (`data/hijri/`), replacing a fixture that returned 21 Dhul-Qadah 1446 AH to every caller on every day. The `Source: …` badge is gone from the three reading surfaces and attribution moved to a new **About this content** screen. Registry capability flags reconciled with the shipped screens. |
| **1** | The reader is addressable: `/faith/reader/[surah]` with optional `?ayah=`. Surah rows open their surah, bookmarks open their verse, the reader carries a surah header and a translator credit, and reading progress is derived rather than a literal `0.55`. |
| **2** | Real reading progress: a precisely defined read rule, a local log, a daily goal with edit controls, a seven-day view drawn only from recorded days, per-surah completion, and a confirmed reset. No streak, no minutes — both recorded as deliberate omissions with reasons. |
| **3** | Translator and edition surfaced in the reader and the Daily Ayah. A withdrawn edition is reported as such, with the action that can actually help, rather than silently dropping the translation. |

**Defects closed:** D1–D11, plus two found by the new scan (a fabricated prayer time in the Faith AI
fixture, and a hero copy column too narrow for the longest real prayer line — both were invisible
while the screen rendered a fixture).

**Gate at this point:** `tsc --noEmit` clean · ESLint clean · Prettier clean · `git diff --check`
clean · **123 suites, 3,732 tests, all passing** (up from 120 / 3,354).

New guardrail: `faith-no-fabrication-scan.test.ts` scans **both** `src/features/faith/` and
`src/features/modules/faith/` for Arabic literals, clock times, formatted dates, countdowns and
narration attributions. The existing scans walked only the first of those directories, which is
exactly why the home fixture survived several phases unnoticed.

### Phases 4–8 — complete, full non-device gate green

| Phase | Delivered |
|---|---|
| **5b** | Real calculated prayer times via `adhan`. The fixture returning 05:02 / 12:35 / 16:15 for every coordinate and date is **deleted**. Location resolves through a port, is stored once resolved, and has **no fallback city** in any branch. |
| **4** | `list_verse_recitations` added to the edge-function allow-list, with a host allow-list on the returned URLs — the only operation whose response the device fetches directly. `expo-audio` playback with per-verse controls, a transport bar naming the reciter, real buffering/failure states, auto-advance, and playback that stops on unmount. No speed or repeat control, because neither is built. |
| **5** | Live Qibla. `trueHeading` only — magnetic north is never substituted. Turn-left/right and aligned guidance as pure functions, calibration and accuracy states, an explicit no-compass path, and the bearing maths moved out of `data/mock/`. |
| **6** | Tap-anywhere counting, a configurable round length, haptics with a distinct pattern at the round boundary, and a **serial mutation queue** in the repository — rapid tapping previously dropped counts. |
| **7** | The home shows a real reading-progress card once there is a log, and offers "set your location" instead of naming a prayer time it cannot compute. |
| **8** | `FAITH_ASSET_MANIFEST.md`: fourteen assets, a palette and craft specification, integration contract, acceptance checklist, and a generation prompt per asset. No artwork generated; no placeholder committed. |

### Verification at the native-build checkpoint

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| ESLint (Faith, modules/faith, app/faith, plugins, jest.setup) | 0 problems |
| Prettier (all touched non-Deno files) | clean |
| `deno fmt --check` / `deno lint` / `deno check` | clean |
| Deno tests (`noor-ai` + `quran-content`) | **467 passed** |
| Jest | **130 suites, 3,890 tests, all passing** |
| `git diff --check` | clean |
| Secret scan | nothing beyond a documented `supabase secrets set` example |
| Vendor source scan | no Quran Foundation hostname in executable mobile source |
| `expo-doctor` | 19/20; the one failure is the pre-existing "16 packages behind SDK", none of them added by this work |

**Outstanding:** the native rebuild on both targets, the device passes, and the edge-function
deployment. None has been started.
