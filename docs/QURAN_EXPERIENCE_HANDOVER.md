# Qur'an experience — audit, handover and phased plan

**Date:** 2026-08-11
**Branch:** `feature/subscriptions-family-six`
**Scope:** Qur'an home, reader, reader settings, translation and reciter catalogues, recitation
playback, bounded offline audio, and reading progress.

This document is the deliverable for the brief's **Required handover**, steps 1–6. Phase 1 (the
translation defect) is implemented and verified. Nothing else had been built when this was written.

> ### Deployment status — verified 2026-08-14
>
> **This block supersedes every "needs a redeploy" and "awaiting deployment" statement in this
> document.**
>
> `quran-content` is live as **production version 11**, deployed 2026-08-11 11:29 UTC, `verify_jwt:
> true`. The deployed bundle was downloaded from the project and compared against the audited local
> source at commit `3a4d96e`: **all eleven runtime files are byte-identical** by SHA-256.
> `ports.ts` is types-only and is erased at bundle time, so its absence from the bundle is expected.
>
> **No redeploy is required.** Phase 1, the `fields=verse_key,resource_name,language_name`
> parameter and the `list_verse_recitations` audio operation are all already in production and were
> each confirmed present in the deployed source.
>
> Two things below read as pending and are not. The git history is misleading on its own: the whole
> function directory landed in a single commit (`7637f50`, 2026-08-13) two days *after* it was
> deployed from the then-uncommitted working tree, so `updated_at` legitimately predates the commit.
> The one Edge change genuinely still outstanding is the **unbuilt** `bismillah_pre` field in §6 —
> future work, not a pending deployment.

> ### Quran-derived Dhikr — permission status, recorded 2026-08-15
>
> **Quran Foundation has confirmed that a Quran-derived Dhikr selector is permitted under NoorLife's
> existing Content API access and Developer Terms.** No additional API scope, licence, fee,
> production approval or periodic report is required, and no new Edge operation is needed — the
> feature is served by `list_verses` and `list_verse_translations`, both already in the approved
> allow-list.
>
> The full record is [`QURAN_FOUNDATION_DHIKR_PERMISSION.md`](QURAN_FOUNDATION_DHIKR_PERMISSION.md).
> Nothing about this feature is waiting on Quran Foundation. Three things are still outstanding and
> are **not** resolved by that grant:
>
> | Outstanding | Why it is not resolved by the permission |
> |---|---|
> | **Scholarly review** of the curated references | A vendor's API permission is not a religious judgement. It is NoorLife's obligation, and until it is met the production catalogue holds **zero** entries and the selector says so. |
> | **Content Sync for translations** | Still the open question of §9 of the audio record. Until a vendor-confirmed mechanism exists, the one-week translation cache ceiling stays. |
> | **Sudais audio synchronisation** | Explicitly out of scope of this confirmation. §8 and §9 below are unchanged. |

---

## 0a. Decisions taken (2026-08-11)

| # | Decision |
|---|---|
| B1 | **Resolved.** Four reference images supplied and reviewed. See §11 for what they change. They are read-only references: nothing is copied into `assets/`, committed, or traced |
| B2 | **Resolved.** Keep the platform Naskh rendering this phase. Proceed with 36–44sp sizing, no truncation, diacritic-safe line height, responsive sizing, RTL and large-font verification. A licensed Qur'an font is a separate reviewed change |
| B3 | **Approved.** Exactly one authenticated `list_recitation_resources` call through the deployed NoorLife function. Every Sudais match to be reported; no style chosen unilaterally; no hard-coded guess |
| — | Page mode stays excluded, and **no non-functional Page option is displayed** |
| — | Phase 1 **deployed** to `dxchgpshydsgfvyydyeb` at 2026-08-11 via `npx supabase functions deploy quran-content`. No `config push`, no other function, no commit, no push. **Confirmed 2026-08-14 as production version 11, byte-identical to `3a4d96e` — no redeploy required.** See the deployment-status block at the top |

---

## 0. Blockers as originally raised — all three now closed by §0a

Kept as the record of what was asked and why, since each decision in §0a is an answer to one of these.

| # | Blocker | Why it blocked | What was needed |
|---|---|---|---|
| **B1** | **The reference screenshots are not in this workspace.** The brief refers throughout to "the attached screenshots" — reader, green active ayah, bottom player, three-tab settings, Qur'an home. No such images are attached to this session, and `design-reference/` contains no folder for them. The nearest files, `phase-4c-faith-wiring/03-reader.png` and `02-quran.png`, are verification captures of NoorLife's **own current** screens, not the new references. | §13 "Visual direction" and the layout ordering in §1, §6 and §7 are specified against images I cannot see. | Drop them into `design-reference/phase-7-quran-experience/`. The written spec is prescriptive enough that I have planned every phase from the text alone — but the visual sign-off will be against images, so getting them in first avoids rework. |
| **B2** | **No licensed Arabic font exists in this repository.** `find assets -name "*.ttf" -o -name "*.otf"` returns nothing. Arabic currently renders with `fontFamily` deliberately unset, falling back to the platform Arabic face (Noto Naskh Arabic on Android). See §3. | §2 requires 36–44sp Arabic on an approved font, with license and source recorded. | A decision between the three options in §3. The safest option needs no asset and is not blocking; the other two need a license record. |
| **B3** | **The Sudais recitation id cannot be resolved without a live catalogue call.** The brief says "resolve the exact ID from the approved live catalogue. Do not guess," and separately forbids uncontrolled production API requests. `DEFAULT_RECITER_ID` is currently `'1'` (AbdulBaset AbdulSamad, Mujawwad) — the one id the vendor's specification names by example. | §8 requires Sudais as the initial selection, and requires a stated selection rule if the catalogue exposes more than one Sudais recording. | Approval for **one** authenticated `list_recitation_resources` call against the deployed function, with the response recorded in this document. That is one read of a public catalogue — but it is a production request, so I am asking rather than assuming. |

Everything else below is actionable now.

---

## 1. Audit — the current reader and player against the specification

Legend: **C** complete · **P** partial · **M** missing · **D** defect (states something untrue)

### 1.1 Reader — `src/features/faith/screens/reader-screen.tsx` (971 lines)

| Spec | Requirement | State | Evidence |
|---|---|---|---|
| §1 | Back · surah number · transliterated name · Arabic name · meaning · ayah count · revelation place | **C** | `SurahHeader`, lines 480–519 |
| §1 | **Surah dropdown** (direct navigation to any of 114) | **M** | No control exists |
| §1 | **Bookmark access** and **reader settings** in the header | **M** | Bookmarking is per-ayah only; there is no settings entry point anywhere |
| §1 | Surah opening treatment / Bismillah rules | **M** | Not rendered. `bismillah_pre` is present in the upstream chapter body but is not read by `readChapter` |
| §1 | No unsupported full-text search button | **C** | Correctly absent; Search scope is not approved |
| §2 | Arabic 36–44sp, visually dominant | **D** | `ArabicText size="display"` is `fontSize: dp(22)`, `lineHeight: dp(40)` — `faith-list.tsx:224`. Roughly **half** the specified size |
| §2 | Translation visibly smaller than Arabic | **P** | It is smaller, but only because Arabic is 22 and body text is ~15 |
| §2 | Arabic right-aligned, RTL, generous line height | **C** | `align="right"`, per-node `writingDirection: 'rtl'` |
| §2 | Scripture preserved byte-for-byte; never normalised | **C** | Asserted by byte-equality fixtures on both sides of the wire |
| §2 | **No `numberOfLines` on scripture** | **C** | Explicitly documented and absent |
| §2 | User-adjustable text size | **M** | No control |
| §3 | Ayah number, bookmark, play/pause, save my place | **C** | `AyahCard`, lines 865–971 |
| §3 | **More/options button** | **M** | — |
| §3 | Translation title and **translator attribution** | **P** | Rendered **once per screen** (`TranslationCredit`), not per ayah. Defensible, but the brief asks for it in the ayah block |
| §3 | Divider between ayat | **P** | Each ayah is a `ModuleCard`; there is no divider treatment |
| §3 | **Translation is not truncated** | **D** | `numberOfLines={6}` on the translation — line 948. Long translations are ellipsised |
| §4 | **Green active-ayah state** | **M** | The only highlight is a 2dp border on the route-named ayah, and it is a *deep-link* highlight, not a reading or reciting state. See §5 for why the existing comment argues against a fill, and how the new design answers it |
| §4 | `Reciting Ayah 3` / `Reading Ayah 3` labels | **M** | — |
| §4 | Distinct treatments for reading / reciting / paused / completed / bookmarked / failed | **M** | Two of six exist (bookmarked, and a transport-level failure icon) |
| §4 | Auto-scroll active ayah into view; reduced motion | **M** | The reader is a plain scroll view with no scroll control |
| §4 | Manual reading advances only on a deliberate action | **C** | Already correct, and already documented — `faith-reading-log.ts` defines the read rule as *furthest position advanced by an explicit save*. See §4 below |
| §5 | Explicit play → load → recite → genuine `didJustFinish` → advance once | **C** | `use-recitation-player.ts` is sound. `handledFinishFor` de-duplicates the sticky flag; `current === null` blocks the wrap-to-ayah-1 bug the brief names; the advance is deferred to a macrotask with a cancelling cleanup |
| §5 | Released-shared-object safety | **C** | The `stopOnUnmount` effect was removed rather than reordered, with the reasoning recorded in the file |
| §5 | Final ayah: stop, **show completion** | **P** | It stops. There is no completion state, and it stops at the end of the *loaded page*, not the end of the surah |
| §5 | Guard against reciter change / logout / navigation during buffering | **P** | A reciter change re-keys the resource and remounts the player, which is safe. Logout mid-playback is untested |
| §6 | **Persistent player, sticky above bottom navigation** | **D** | `RecitationBar` is an ordinary `ModuleCard` rendered *inside the scrolling content*, after the ayah list. It scrolls away while audio plays |
| §6 | Collapse to mini-player / expanded form | **M** | One fixed form |
| §6 | Seek bar, elapsed, duration | **M** | — |
| §6 | Compact player shows surah, ayah, reciter, state | **C** | Already correct, including "Recitation" rather than an invented name when the catalogue has not resolved |
| §6 | No speed, pitch, repeat, translated narration | **C** | All correctly absent, each with a stated reason |
| §7 | Reader Settings — Display / Text / Audio | **M** | The screen does not exist |
| §9 | Bounded offline audio | **M** | Nothing is downloaded. The only cache is an in-memory response cache for JSON |
| §10 | Instant Qur'an home from a validated warm catalogue | **M** | `quran-cache.ts` is **in-memory only** and dies with the process, so every cold start refetches all 114 |
| §11 | Recent surahs, darker rectangular surah rows | **M** | `FaithRow` list; no recents |

### 1.2 What is genuinely good and must not be disturbed

Three things, because a rebuild is the most likely moment to lose them:

1. **The Quran Foundation trust boundary.** Eight approved operations, `verify_jwt = true`, no vendor
   hostname in the mobile bundle, a one-week cache ceiling enforced on both sides, and an audio host
   allow-list. 486 Deno tests. None of the work below needs a new operation.
2. **The recitation player's lifecycle discipline.** The sticky-`didJustFinish` and
   released-shared-object bugs the brief lists under §5 have already been found and fixed here, and
   the reasoning is in the file. The new player is a *wrapper* around this hook, not a replacement.
3. **The read rule.** "An ayah counts as read when the reader's furthest position in that surah
   advances past it" is defined, argued and stored. The brief's §4 requirements about not counting
   renders or scrolls are already satisfied by it.

---

## 2. Proposed component hierarchy

New files marked **+**. Everything under `src/features/faith/`.

```
screens/reader-screen.tsx                    ← becomes a thin composition root
│
├── reader/reader-header.tsx                 +  back · number · names · meaning · count · place
│   └── reader/surah-picker-sheet.tsx        +  114 rows from the already-loaded catalogue
│
├── reader/surah-opening.tsx                 +  title + Bismillah, per the rule in §6 below
│
├── reader/ayah-section.tsx                  +  replaces AyahCard
│   ├── reader/ayah-controls.tsx             +  number · more · bookmark · play · save
│   ├── components/faith-list#ArabicText        (unchanged component, new default size)
│   ├── reader/ayah-translation.tsx          +  text + per-ayah attribution, no numberOfLines
│   └── reader/ayah-state.tsx                +  the six visual states + their text labels
│
├── reader/reader-player.tsx                 +  sticky container, compact ⇄ expanded
│   ├── reader/player-compact.tsx            +
│   └── reader/player-expanded.tsx           +
│
└── reader/reader-settings-sheet.tsx         +  three tabs
    ├── reader/settings-display.tsx          +
    ├── reader/settings-text.tsx             +
    └── reader/settings-audio.tsx            +

hooks/
├── use-recitation-player.ts                    (unchanged — wrapped, not replaced)
├── use-reader-session.ts                     +  owns activeAyah + mode; the single source of truth
├── use-reader-settings.ts                    +  reads/writes the new preference block
├── use-auto-scroll.ts                        +  reduced-motion aware, opt-out
└── use-audio-downloads.ts                    +  bounded, expiring offline cache

storage/
├── faith-reader-settings.ts                  +  display/text/audio settings, versioned
├── faith-recent-surahs.ts                    +  real open history, bounded to 5
├── faith-surah-catalogue-cache.ts            +  persisted 114-entry catalogue, validated
└── faith-audio-cache.ts                      +  file index, sizes, expiry

screens/
├── quran-screen.tsx                             restructured per §11
├── translation-screen.tsx                    +  split out of preferences-screen
└── reciter-screen.tsx                        +  split out of preferences-screen
```

**The one structural decision worth flagging.** `use-reader-session` owns *both* the active ayah and
whether it is active because it is being read or because it is being recited. Those two facts are
currently nowhere — the transport knows what is playing, and nothing knows what is being read. Giving
them one owner is what makes "reading" and "reciting" mutually exclusive by construction rather than
by two components agreeing to be careful.

---

## 3. Font strategy and licensing — **needs a decision (B2)**

### What is actually in the repository today

- **No font asset of any kind for Arabic.** `assets/` contains no `.ttf`, `.otf` or `.woff`.
- The only loaded family is **Poppins**, via `@expo-google-fonts/poppins` (OFL), Latin-only.
- `ArabicText` deliberately leaves `fontFamily` unset. The reasoning is recorded at
  `faith-list.tsx:186` and it is correct: naming Poppins would rely on per-glyph fallback that
  varies by OS version and vendor, whereas an unset family lets the platform pick a real Arabic face.
- On Android that face is **Noto Naskh Arabic** (SIL OFL 1.1, shipped with the OS). It renders the
  full Uthmani harakat set the API returns, including superscript alif and the pause marks.

### What Quran Foundation's guidance says

Their rendering guidance is built around the **glyph-code fields** — `code_v1` / `code_v2` with the
`QCF` page fonts — which is a different rendering model: one font per Mushaf page, addressed by glyph
codes rather than by Unicode. NoorLife requests `fields=text_uthmani` only, deliberately
(`quran-foundation-client.ts:120` — "one Arabic field means there is exactly one string that can be
rendered as scripture"). **The QCF page-font route is therefore not available to us without changing
the request shape, and it is what page mode would require.** That is the same reason §7's page mode
is excluded below.

### The three options

| | Option | License | Risk | Effort |
|---|---|---|---|---|
| **A** | **Keep the platform Arabic face.** Set the size, line height and metrics; ship no font. | None needed — the OS font is the OS's. | Rendering varies slightly across Android versions and OEM skins. Diacritic collision has to be prevented by line height, which is what §2 asks for anyway. | Zero |
| **B** | **Bundle Amiri Quran** (SIL OFL 1.1, `github.com/alif-type/amiri`). Naskh, designed for Qur'anic typesetting, full harakat coverage. | OFL 1.1 — bundling and redistribution permitted, attribution required in About. | ~400 KB per weight. Needs a coverage audit against the exact code points the API returns. | ~1 day incl. audit |
| **C** | **Bundle KFGQPC Uthmanic Hafs**. The most authentic Uthmani rendering. | **Not OFL.** Distributed by King Fahd Complex under terms that are not a standard open license, and redistribution inside a commercial app needs written permission. | Legal, not technical. | Blocked on correspondence |

### Recommendation

**Ship option A now, and treat option B as a separate, reviewable change.** The brief's own
instruction covers this exactly — *"If no approved Quran font is available, retain the safest current
font and report the asset blocker."* Option A delivers every one of §2's requirements except "a
licensed Qur'an font", because the size, weight, alignment, line height and no-truncation rules are
all properties of how the text is laid out rather than of which file draws it. It also removes the
temptation the brief explicitly forbids: importing the reference application's font.

If B is approved, `ArabicText` is the single place it lands, and the license record goes in
`docs/FAITH_ASSET_MANIFEST.md`.

**Sizing, whichever option is chosen:**

| Token | Value | Note |
|---|---|---|
| Arabic default | `dp(38)` | Inside the 36–44 band; the platform Naskh face is optically large, so the top of the band would overflow narrow devices |
| Arabic range | `dp(30)`–`dp(52)` | Five steps. The floor stays readable at 320dp width; the ceiling is bounded by wrap testing |
| Arabic line height | `1.9×` default, `1.6×`–`2.4×` adjustable | 1.9 is what clears a superscript alif stacked over a shadda at 38sp without clipping |
| Translation default | `dp(15)` | Fixed ratio abandoned deliberately: the two are independently adjustable per §7 |

---

## 4. How active **reading** differs from active **reciting**

They are two values of one field, so they cannot both be true.

```ts
type ReaderActivity =
  | { mode: 'idle' }
  | { mode: 'reading';  ayah: number }             // a deliberate user action put it here
  | { mode: 'reciting'; ayah: number; paused: boolean }   // the player put it here
```

| | Active while **reading** | Active while **reciting** |
|---|---|---|
| **What sets it** | Only a deliberate action: tapping the ayah, `Next ayah`, `Mark read and continue`, or the reader's prev/next. Never a render, never a scroll, never a timer. | The transport. `activeAyah` follows `transport.current`, which follows the platform. |
| **Label** | `Reading Ayah 3` | `Reciting Ayah 3` / `Paused at Ayah 3` |
| **Fill** | Soft mint wash, Faith-green left rule | Solid Faith green |
| **Arabic colour** | Unchanged ink on the wash | High-contrast light on green |
| **Advances** | Never on its own | On genuine `didJustFinish`, once, guarded by `handledFinishFor` |
| **Writes progress** | Yes — `save()` + `record()`, the furthest-position rule | **No.** Listening is not reading, and crediting recitation as ayat read would fabricate the number the read rule exists to keep honest |
| **Scrolls** | No | Yes, if auto-scroll is on and reduced motion is off |

**On the existing objection to a green fill.** `reader-screen.tsx:904` argues against a tinted
background behind Arabic because "it changes the contrast the type was measured at". That objection
is right and is answered rather than overruled: both fills ship with a measured contrast pair
(`≥ 7:1` for Arabic on the reciting green, `≥ 12:1` on the reading wash), asserted by test, and the
state is never carried by colour alone — every state has a text label and an icon, per §4 and §14.

**Six states, six treatments, none colour-only:**

| State | Fill | Rule | Label | Icon |
|---|---|---|---|---|
| Reading | mint wash | green, 3dp | `Reading Ayah n` | bookmark-outline |
| Reciting | Faith green | — | `Reciting Ayah n` | speaker |
| Paused | Faith green @ 60% | green, 3dp | `Paused at Ayah n` | pause |
| Completed / previous | none | green, 1dp | `Read` | check |
| Bookmarked | none | gold, 2dp | `Bookmarked` | bookmark-filled |
| Playback failed | none | warning, 2dp | `Could not play. Tap to retry` | retry |

---

## 5. The exact bottom-player layout

The reader is inside `FaithScreen`, which renders NoorLife's module bottom navigation. So the player
docks **above the bottom navigation**, not at the safe-area edge:

```
┌──────────────────────────────────────────────┐
│                                              │
│   ayah list (scrolls)                        │
│   … bottom padding = player height + gap,    │
│     so the last ayah is never covered        │
│                                              │
├──────────────────────────────────────────────┤  ← docked, not scrolling
│ ▸ COMPACT  (default, 72dp)                   │
│  ┌──┐  Al-Kahf · Ayah 3        [⌃]           │
│  │▶ │  Sudais · Reciting                     │
│  └──┘  ⏮   ⏯   ⏭                             │
├──────────────────────────────────────────────┤
│  Qur'an   Progress   Bookmarks   More        │  ← existing bottom navigation
└──────────────────────────────────────────────┘
     ↑ safe-area inset handled by FaithScreen
```

Expanded (tap `⌃`, ~180dp), showing only controls that genuinely work:

```
├──────────────────────────────────────────────┤
│  Al-Kahf · Ayah 3 of 110              [⌄]    │
│  Abdur-Rahman as-Sudais                      │
│  ──────●───────────────────  0:12 / 0:47     │
│     ⏮      ⏯      ⏹      ⏭                   │
│  Auto-advance ●        Reciter ›             │
│  Download this surah (12.4 MB)               │
├──────────────────────────────────────────────┤
```

**Rules the implementation must hold, each testable:**

1. The player renders only when `transport.current !== null`. No idle bar.
2. The scroll container's `contentContainerStyle.paddingBottom` is derived from the measured player
   height. Asserted by a test that the last ayah's bottom edge is above the player's top edge.
3. Collapsed height is 72dp; both `⏮`/`⏭` and `⏯` have 44dp targets via `hitSlop`.
4. Expand/collapse respects reduced motion (snap instead of animate).
5. No speed control, no pitch control, no repeat, no translated narration — as now.
6. If the reader is ever presented fullscreen without bottom navigation, the same component anchors
   to `insets.bottom` instead. One prop, one branch.

### 5a. Superseded on 2026-08-11 by the approved reader/player mockup

The build produced from §5 was **rejected on review**, and the correction brief that came with the
new mockup replaces this section's rules 1, 3, 4 and 5. Recorded here rather than edited away,
because three of the four were deliberate decisions and it is worth knowing they were reversed and
why.

| §5 rule | Replaced by | Why |
|---|---|---|
| 1. No idle bar — the player renders only once a verse is selected | **The complete player mounts as soon as the reader has its first ayah**, and stays mounted through idle, preparing, playing, paused, buffering, completed, offline, failed and "this reciter published nothing" | "No idle bar" produced a reader whose audio controls could only be reached through a verse's overflow menu, and the strip that menu docked was itself mistaken for the player |
| 3. A 72 dp collapsed form | **One form, ~112 dp, nothing collapses and nothing expands** | The three shapes the transport moved through were the review's main objection |
| 4. Expand/collapse motion | Not applicable — there is no expand | |
| 5. No speed control | **Playback speed is mandatory**, cycling the four bounded rates already in `RECITATION_RATES` | The mockup draws it; the bound that keeps a recitation recognisable is unchanged |

Rules 2 and 6 stand unchanged.

Two controls the old player had are **not** in the new layout, and neither is in the brief's
mandatory list: the explicit **Stop**, whose work pause now does (the session is released when the
reader unmounts, and at the end of a surah), and the **auto-advance toggle**, which is now fixed on.
Restoring the toggle needs a home in reader settings and a persisted preference; it is not in this
brief's scope and is flagged for the next one.

Scripture also halved: the 36–44 sp band is now a flat **22 sp** with a 40 dp line height. See
`SCRIPTURE_FONT_SIZE` in `faith-list.tsx`, where the previous value is kept beside it so the
reduction stays checkable.

---

## 6. Native and Edge Function changes

### Edge Function — **no new operation is required**

Everything below is served by the eight already-approved operations. That is worth stating plainly,
because it means none of this work reopens the vendor approval:

| Feature | Operation | Already approved |
|---|---|---|
| Surah dropdown (114) | `list_chapters` | ✓ (already loaded for Qur'an home) |
| Surah opening / Bismillah | `get_chapter` | ✓ — but see the note below |
| Translation catalogue screen | `list_translation_resources` | ✓ |
| Reciter catalogue screen | `list_recitation_resources` | ✓ |
| Offline download | `list_verse_recitations` | ✓ — returns allow-listed HTTPS URLs the device fetches |

**One small server change is needed for the Bismillah rule.** The upstream `chapter` object carries
`bismillah_pre`, and `readChapter` in `normalize.ts` does not read it. Rendering the Bismillah
correctly — present for 112 surahs, absent for Al-Fatihah (where it is ayah 1) and At-Tawbah (where
Quranic rules omit it) — must be driven by that field rather than by a hard-coded list of two surah
numbers in the client. This is an additive field on `WireChapter`, inside an existing operation, and
it needs a redeploy **when it is built**. As of 2026-08-14 it is not built — neither `normalize.ts`
nor any client file references `bismillah_pre` — so it is outstanding work rather than an
undeployed change. It is the **only** Edge change in this document still to be made.

**Phase 1 is deployed.** It went to production on 2026-08-11 as version 11 and was re-confirmed on
2026-08-14 by downloading the deployed bundle and comparing it against `3a4d96e`, byte for byte.
This paragraph previously read "also needs a redeploy"; that was stale. See §8 and the
deployment-status block at the top.

### Native — two new packages, one rebuild

| Package | For | Why it cannot be avoided |
|---|---|---|
| `expo-file-system` (~57) | §9 bounded offline audio | Downloading, sizing, expiring and deleting audio files needs a filesystem. `expo-audio` streams but does not persist. |
| `expo-keep-awake` (~57) | §7 Display → "Keep screen awake while reading" | The brief requires every visible setting to work. Without it, the control cannot ship. |

Both are config-plugin-free autolinked modules, so `app.json` needs no new plugin entry — but adding
them changes the native project and **requires `npx expo run:android`**, not a Metro restart.

**Nothing else is native.** The green states, the sticky player, the settings sheet, the two catalogue
screens, the surah dropdown and the persisted catalogue cache are all JS and need only a Metro
restart.

---

## 7. Scope exclusions, each with a reason

| Excluded | Reason |
|---|---|
| **Page mode** (§7 Display) | Needs the QCF glyph-code fonts and the `code_v1`/`code_v2` fields. NoorLife requests `text_uthmani` only, by design. Shipping a "page mode" that reflows Unicode text is not page mode. |
| **Translation font selection** (§7 Text) | Poppins is the only loaded family. A selector with one option is a control that does nothing. Returns if a second family is approved. |
| **Approved Quran font selection** (§7 Text) | Same — conditional on B2 resolving to two or more licensed faces. |
| **Repetition modes** (§6, §7) | Not implemented, so not drawn. |
| **Playback speed** (§6) | The brief itself says a recitation should play as recorded. |
| **"Translation Reciter"** (§7) | The Content scope provides Arabic recitation only. Correctly absent already. |

---

## 8. Phase 1 — the translation defect: root cause, fix, and verification

**Status: implemented, verified, and deployed.** It was released to `dxchgpshydsgfvyydyeb` on
2026-08-11 as production version 11, and confirmed present in the deployed bundle on 2026-08-14 —
`catalogue_outcome` and `normalize_reason` both appear in the deployed `handler.ts` and
`production.ts`. The line that stood here, "awaiting deployment approval" (the brief's §12.6
stop-gate), was stale: the approval was given and acted on the same day this document was written,
and §0a records it.

### Root cause

The live API omits the optional `resource_name` on every translation row, so the only source of a
translator's name is `/resources/translations` — a **second** upstream read. It was issued
**sequentially after** the content read, on the **same `AbortSignal`** and inside the **same
15-second budget** the content read had already been spending.

The consequence:

- **Warm isolate** → catalogue served from the in-memory day cache → no second request → `200`.
- **Cold isolate** → catalogue must be fetched → gets the *leftover* deadline → when the content read
  had been slow, the catalogue read is aborted by the shared timer → `attribution` is `null` →
  `normalizeTranslations` correctly refuses to render scripture with nobody to credit → **`502`**.

Same surah, same edition, same user, minutes apart. Intermittent by isolate warmth and by timing.

### Why it survived investigation

Three separate blind spots, and all three are now closed:

1. `catalogueFetched` was set to `true` on **every** path that attempted a fetch — including the
   failing ones. `upstream_outcome: ok, catalogue_fetched: true` beside a `502` reads as "the
   catalogue was fine", which is why the evidence pointed at the vendor.
2. All eight independent normalisation checks returned an indistinguishable `null`.
3. No test covered a catalogue read failing during a translated content read.

### The fix

| File | Change |
|---|---|
| `ports.ts` | New closed enums `NormalizeReason` (8 members) and `CatalogueOutcome` (6 members); `catalogueOutcome` on `UpstreamResult`; `catalogue_outcome` and `normalize_reason` on `OperationalLogRecord` |
| `normalize.ts` | `normalizeTranslations` / `normalizePayload` return `Normalized<T>` carrying the check that refused, instead of `null` |
| `quran-foundation-client.ts` | **The behavioural fix** — the catalogue lookup now runs **beside** the content read rather than after it, so it gets the full deadline. Reports which of the six catalogue outcomes occurred |
| `handler.ts` | Records `normalize_reason` and `catalogue_outcome` |
| `production.ts` | Both fields added to the allow-list serialiser |

**Fail-closed attribution is unchanged.** Unattributed scripture is still refused. The repair is to
the lookup that supplies the credit, not to the rule that requires one — asserted by a test that
scans the source for placeholder credits.

### Diagnostics contain nothing about content

Both enums are unions of string literals naming **checks** and **outcomes**. There is no member with
a payload, no free-text field, and the `production.ts` serialiser writes keys by hand. No translation
text, Qur'anic text, token, header, URL, edition id, surah number or user identifier can reach a log
line through either field.

### One query settles it — and it can be run now

The fix is deployed, so this query is live rather than pending:

```
event=quran_content_request
  AND operation=list_verse_translations
  AND error_code=upstream_unavailable
```

- `normalize_reason=attribution` + `catalogue_outcome=unreachable` → confirmed; the fix addresses it.
- `normalize_reason=attribution` + `catalogue_outcome=fetched_miss` → edition 131 has left the
  catalogue; a product fix, not this one.
- Any **other** `normalize_reason` → a genuinely different response variant, now named exactly.

The third outcome is why this ships as diagnostics **plus** a fix rather than a fix alone: I can
prove the mechanism above is broken, and I cannot prove from here that it is the *only* thing broken.

---

## 9. Proposed phase order

Each phase is independently verifiable, and each leaves the app shippable.

| Phase | Work | Gate |
|---|---|---|
| **1** | Translation defect — **done and deployed** (production version 11) | §12.6 stop cleared 2026-08-11 |
| **2** | Typography + ayah structure. Arabic to 38sp, line-height rule, remove the translation truncation defect, per-ayah attribution, dividers | Wrap tests at 320dp × 1.3 font scale |
| **3** | Reader session + green states + auto-scroll | Six-state tests; contrast assertions |
| **4** | Sticky player, compact ⇄ expanded, bottom-nav clearance | Clearance test; collapse/expand test |
| **5** | Reader settings, three tabs, persisted | Every visible setting has a test proving it changes something |
| **6** | Split translation and reciter screens; resolve **B3** | Persistence, unavailable-edition recovery |
| **7** | Surah dropdown, surah opening (needs the `bismillah_pre` redeploy) | Al-Fatihah and At-Tawbah cases |
| **8** | Bounded offline audio (needs `expo-file-system` + rebuild) | Expiry, cancellation, storage bound |
| **9** | Qur'an home: persisted catalogue cache, recent surahs, row restyle | Warm-load test, 114-entry validation |
| **10** | Device verification on emulator **and** the physical Samsung | Screenshots for both |

---

## 10. Verification run for Phase 1

| Gate | Result |
|---|---|
| Deno `fmt --check` · `lint` · `check` · `test` (`deno task verify`) | **486 passed, 0 failed, 5 ignored** |
| New suite `translation-attribution_test.ts` | **8 passed** |
| `quran-content` suites | **164 passed** |
| Focused Faith Jest (24 suites) | **942 passed, 0 failed** |
| Full Jest (131 suites) | **3920 passed, 0 failed** on a clean re-run. The first run showed 2 failures in `faith-tasbih.test.tsx`; it passes in isolation (13/13) and passed on the full re-run, so it is a timing flake under parallel load, not a regression — my diff touches no file Jest loads |
| `tsc --noEmit` | **clean** |
| `expo lint` | **clean** |
| `git diff --check` | **clean** |
| `prettier --check` | **81 pre-existing failures in `src/`**, none in a file I touched. `npm run validate` cannot pass until these are addressed — flagged as a separate pre-existing issue |
| `expo-doctor` | **1 check failed** — 15 packages at patch versions behind SDK 57. Pre-existing |
| Deno source scans (secrets, hosts, scripture, logging) | **pass** |

---

## 11. What the reference images change

Reviewed 2026-08-11 from the read-only paths supplied. **Not copied, not committed, not traced.**
What follows describes *structure and hierarchy* — the part a specification can legitimately take from
a reference — plus an explicit list of what is being left behind.

### 11.1 Reader — the green active ayah

The single most useful correction to my §4 plan:

> **The green fill covers the Arabic block only. The translation sits below it on the normal surface,
> in normal ink.**

That answers the objection recorded at `reader-screen.tsx:904` — "a tinted background behind Qur'anic
Arabic changes the contrast the type was measured at" — more cleanly than my measured-pair proposal
did. The Arabic gets one deliberately measured contrast pair on green; the translation never changes
contrast at all, because it is never on the fill. Adopted.

Also confirmed:

| Observed | Adopted | Note |
|---|---|---|
| Ayah number in a small outlined square, top-left | Yes | Ours is currently an inline caption |
| Overflow dots at the top-right of each ayah | Yes — this is the missing §3 "more/options" control | |
| Hairline divider between ayat, no card chrome | Yes | Replaces the per-ayah `ModuleCard`; matches §3's "distinct reading section, not necessarily a heavy card" |
| Arabic right-aligned, wrapping over 2+ lines, dominant | Yes | Confirms the 36-44sp direction |
| Translation directly beneath, left-aligned, smaller, untruncated | Yes | |
| Fill edge-to-edge behind the Arabic, squared corners | Adapted — NoorLife radii, inset to the content gutter | |

### 11.2 Reader — header

The reference stacks two bars: a green primary bar (back, surah name with a **dropdown caret**, verse
count, bookmark icon, settings icon) and a dark secondary bar repeating the surah number and name in
both scripts.

Adopted: the primary bar, with the caret as the §1 surah-dropdown affordance, and both header icons —
exactly the two entry points §1 requires and the current build lacks. The second bar is **not**
adopted: it repeats what the first already carries, and NoorLife's header also carries the meaning,
ayah count and revelation place.

### 11.3 Reader — surah opening

The reference draws an ornamental Mushaf frame around the surah name and a calligraphic Bismillah.

**Not adopted.** §1 and §13 forbid copying the ornamental Mushaf header, verse medallions and
proprietary calligraphy, and forbid baking Arabic into a PNG. NoorLife renders instead:

- the surah name as text in an original NoorLife treatment (Faith-green rule, restrained gold accent);
- the Bismillah as **live text from the approved source**, shown or omitted per `bismillah_pre`.

The end-of-ayah medallions in the reference are glyphs belonging to that application's Qur'an font,
not artwork to reproduce — a further reason the platform-Naskh decision (B2) is the honest one here.

### 11.4 Reader — bottom player

The reference confirms the §6 layout almost exactly: a docked panel with a seek bar and thumb, elapsed
and duration at either end, and a control row of previous, play, **stop**, next.

Two of its controls are deliberately **not** adopted, both because the brief forbids them:

- a **`1x` speed dropdown** — §6: do not change playback rate, a recitation plays as recorded;
- a **search control** in the player's tab strip — the Search scope is not approved.

> **Superseded on 2026-08-11.** The approved NoorLife mockup draws a `1×` control and the correction
> brief lists playback speed as mandatory, so the first exclusion is reversed — bounded to the four
> rates in `RECITATION_RATES`, which is the part of §6 that still holds. The search control remains
> excluded. See §5a.

### 11.5 Qur'an home

Confirms §11 closely: a "Recents" strip of horizontal cards carrying the Arabic surah name, the
transliterated name, the last-read ayah and a **real** relative date ("Just now", "23/05/26"); then a
sura list of darker rounded rectangles with number, Arabic name, transliterated name and meaning, and a
view-mode dropdown on the section header.

Adopted, with three NoorLife differences:

1. Rows also carry **ayah count, revelation place and real progress**, per §11 — the reference's do not.
2. **No promotional card.** The reference's "Try the Academy feature" banner is exactly the promotional
   content §13 excludes.
3. Recents are **hidden when empty**, per §11, never seeded.

The dark green ground with a low-contrast geometric pattern is consistent with the Faith palette and is
adopted as a *palette* decision using NoorLife's own tokens — not as artwork.

### 11.6 Reader settings

Confirms the §7 three-tab structure: a segmented Display / Text / Audio pill row inside a sheet, grouped
rows beneath, toggles on the right.

Its Audio tab contains three things NoorLife will **not** ship:

| Reference control | Why excluded |
|---|---|
| "Translation Reciter" — enable plus a selected narrator | §7 forbids it explicitly. The Content scope supplies Arabic recitation, not translated narration |
| "Repetition — Never" | §6/§7: not implemented, so not drawn |
| Speed control (in the player) | §6, as above |

Adopted: the pill tab row, "Enable recitation", "Selected reciter" opening a separate screen, "Enable
auto-scroll", "When Sura finishes", and "Next/Previous Button" behaviour — all of which §7 also requires.

---

## 12. Deployed-log verification

**Filter**

```
project dxchgpshydsgfvyydyeb -> Edge Functions -> quran-content -> Logs
event = "quran_content_request"
```

**The complete set of keys that may appear — exactly 18**

`event`, `request_id`, `contract_version`, `http_status`, `outcome`, `error_code`, `error_field`,
`auth_reason`, `operation`, `upstream_outcome`, `upstream_attempts`, `token_renewed`,
`catalogue_fetched`, `catalogue_outcome`, `normalize_reason`, `retry_after_seconds`, `operator_alert`,
`duration_ms`

**Expected values for the verification run**

| Call | `http_status` | `upstream_outcome` | `catalogue_fetched` | `catalogue_outcome` | `normalize_reason` |
|---|---|---|---|---|---|
| A — cold translation | 200 | `ok` | `true` | `fetched_hit` | `null` |
| B1 / B2 — warm translation | 200 | `ok` | `false` | `cached_hit` | `null` |
| C1 — no auth header | 401 | `null` | `false` | `null` | `null` |
| C2 — publishable key only | 401 | `null` | `false` | `null` | `null` |
| D — reciter catalogue | 200 | `ok` | `false` | `null` | `null` |

`catalogue_outcome` is `null` for D because that operation needs no attribution. C1 may not produce a
line at all: the platform gateway rejects a missing header before the function runs.

**What would count as a leak — none of these may appear in any line**

- Any 19th key, or any nested object.
- Arabic script, or any translation prose.
- A translator's name, an edition title, or a resource id.
- A surah number, a verse number, or a `verse_key`.
- `Bearer`, `x-auth-token`, `x-client-id`, `apikey`, or any JWT fragment.
- Any URL or hostname — `apis.quran.foundation`, `verses.quran.foundation`, `oauth2.quran.foundation`.
- An email address, a user id, or a `sub` claim.
- An upstream HTTP status code — only NoorLife's own `upstream_outcome` vocabulary is emitted.

`request_id` is the one identifier present. It is `quran_req_` plus a v4 UUID from the platform CSPRNG,
derived from nothing — not the user, not the operation, not the clock.

**Source-level proof, already passing.** The allow-list serialiser in `production.ts` writes all 18 keys
by hand; a spread was rejected precisely so that widening the record type cannot silently reach a log.
These Deno tests assert it:

- `production-graph_test.ts` — "the production logger is the only thing that can write a line" pins the
  emitted key set by equality;
- `handler-upstream_test.ts` — pins the key set again from the handler side;
- `source-scan_test.ts` — "there is exactly one console call in the production source", "no log call can
  carry a credential, a token, a URL or a verse", and "the modules that touch a credential or a verse
  log nothing at all".
