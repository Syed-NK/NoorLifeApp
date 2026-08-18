# Faith module — missing approved assets

Recorded rather than substituted. Where an approved pictogram does not exist, the
screen keeps a restrained vector and this file says so; nothing is generated in
code to fill the gap.

## Missing

Every gap below is specified in `FAITH_ASSET_MANIFEST.md`, with a per-asset generation prompt, the
exact path the code will require, and an acceptance checklist. None has been generated yet, and no
placeholder has been committed — each surface keeps a restrained vector until real artwork exists.

| Surface | Needed | Current | Manifest ID |
|---|---|---|---|
| Upcoming / observances card (Faith Home) | A Ramadan or observance pictogram | `crescent` vector, gold | A5 |
| Bookmarks screen identity | A bookmark pictogram | `bookmark` vector | A1 |
| Translation preferences and content information | A translation pictogram | none | A2 |
| Reciter preferences and the transport bar | A recitation pictogram | none | A3 |
| Reading progress screen | A progress pictogram | `target` vector | A4 |
| Qibla dial face | A compass rose | Bordered circle with a hairline and an "N" label | B1 |
| Qibla direction marker | A Kaaba marker that points up | `qibla` icon-font glyph, rotated | B2, B3 |
| Tasbih counter | A bead strand, and lit/unlit beads | A progress bar | C1, C2, C3 |
| Bookmarks-empty and progress-empty | An empty-state illustration | Text only | D1 |
| Faith offline states | An offline illustration | Text only | D2 |
| Reader surah header | A decorative band | Nothing | D3 |

The Upcoming card's entry is the oldest of these and its reasoning still stands: borrowing
`08-calendar.png` would make it and the Islamic Calendar card beside it visually identical, which is
worse than a vector.

## Gaps introduced by the selected design references (2026-08-11)

The nine approved references each draw bespoke artwork that has no approved asset behind it. None
of it was substituted with something invented, and none of it blocks the screens — every one of
them renders with its approved submenu pictogram in the shared hero instead.

| Reference | Artwork it draws | What ships instead |
|---|---|---|
| `hadith-a.png` | A bound green volume with gilt tooling, olive sprigs, an arch screen | `02-hadith.png` in the shared hero |
| `duas-a.png` | Raised hands over a sunrise valley and a distant skyline | `03-duas.png` in the shared hero |
| `prayer-b.png` | A day/night arc with the six prayer positions plotted on it | `04-prayer.png` in the shared hero |
| `qibla-b.png` | An engraved compass rose with a 3D Kaaba at its centre | `05-qibla.png`; the existing dial stays vector — see B1/B2 above |
| `tasbih-a.png` | A photographic wooden bead strand with a jade marker bead and a gold tassel | `06-tasbih.png`; see C1–C3 above |
| `mosques-b.png` | A night skyline of domes and minarets under a crescent | `07-mosques.png` in the shared hero |
| `calendar-b.png` | Per-event Hijri medallions (crescent, star, mosque) | `08-calendar.png`; events use vectors |
| `faith-ai-a.png` | A lantern-and-foliage flourish beside the robot | The robot alone, on a tinted card |

**The one reference asset that was supplied and is now installed:** the NoorLife AI robot.
`selected-faith-designs/noor-ai-green-robot.png` → `assets/images/modules/faith/noor-ai-robot.png`,
resampled 1024x1536 → 512x768 (aspect identical to six decimal places, 1,239 KB → 395 KB) with its
flat cream backdrop lifted to transparency so it can sit on the emerald hero. Referenced only
through `src/features/faith/faith-ai-assets.ts`. Nothing was recoloured or cropped.

**Not a gap, deliberately:** the references' serif display face. NoorLife's locked typography permits
Poppins only, and that decision was reaffirmed for this rebuild — the references define layout and
interaction, not the typeface.

## Gaps introduced by the approved Hadith, Duas and Prayer designs (2026-08-12)

The three selected references draw a dimensional emerald/cream/gold pictogram in every slot. Three
of those slots are filled by an existing NoorLife asset that genuinely matches; the rest ship a
restrained vector through a **typed replaceable slot** (`FaithPictogramSlot` in
`components/faith-locked-library.tsx`).

**Since 2026-08-12 those slots are no longer named at the call sites.** They resolve through one
registry — `src/features/faith/faith-pictogram-assets.ts` — which holds sixteen entries, the exact
filename each expects, its subject, and the dp box it renders in. Screens call
`faithPictogramSlot('h1')` and know nothing about whether the artwork exists yet. Three things now
hold the line that a document alone did not:

- **`FaithPictogramDevAudit`** renders the pending list *on* Hadith, Duas and Prayer in development,
  so a stand-in is visible in the screenshot rather than recorded in a file nobody opens.
- **`faith-pictogram-registry.test.ts` arms itself.** A PNG present in
  `assets/images/modules/faith/pictograms/` whose slot is still `awaiting-artwork` **fails**. The
  dangerous moment is not now, while every slot is obviously empty — it is the day fourteen of
  sixteen get wired and two are missed.
- **The destination directory carries its own README**, at the exact place somebody would be tempted
  to drop a placeholder, saying that no placeholder PNG may be committed.

The table below is the specification; the registry is the code, and the README at the destination is
the reminder. The three are kept from disagreeing by the registry test, which reads the filenames
from the registry rather than from any prose.

Nothing was invented, no emoji is used as a production icon, and no third-party artwork was copied.

> **Resolved 2026-08-13.** Every row below is installed except P3, which is *held* — its artwork
> exists, is registered and deliberately does not render. The "Ships now" column is kept as the
> record of what each slot stood in with, because two of the three rejections during acceptance were
> caught by comparing an asset against the set it had to join, and that comparison is only possible
> if the history survives. Registry counts: **15 installed, 1 held, 0 awaiting artwork.**

| ID | Surface | Placement | Size | Needed | Ships now |
|---|---|---|---|---|---|
| H1 | Hadith | Preview row 1 | 40 dp | Stacked bound volumes with gilt tooling | `library` vector, emerald |
| H2 | Hadith | Preview row 2 | 40 dp | Open book with a gold ribbon marker | `bookmark` vector, emerald |
| H3 | Hadith | Preview row 3 | 40 dp | Closed volume beside a gold pocket watch | `history` vector, emerald |
| D1 | Duas | Preview row 1 | 40 dp | Sunrise over a jade bead strand with a gold tassel | `crescent` vector, emerald |
| D2 | Duas | Preview row 2 | 40 dp | Dimensional emerald house with a crescent finial | `home` vector, emerald |
| D3 | Duas | Preview row 3 | 40 dp | Open book with a gold ribbon marker | `bookmark` vector, emerald |
| S1 | Hadith + Duas | Trust notice | 38 dp | Emerald shield with a gold rim and a cream check | `shield` vector in a gold-rimmed disc |
| P1 | Prayer | Location card | 28 dp | Mosque inside a gold map-pin | `07-mosques.png` — **acceptable substitute**, no pin |
| P2 | Prayer | Day arc, 6 marks | 14–22 dp | Crescent, sunrise, prayer rug, sun, mosque, crescent-and-stars | Plain emerald/gold discs |
| P3 | Prayer | Reminders row | 20 dp | Dimensional gold bell | `notification` vector — **held, see below** |
| P4 | Prayer | Calculation settings row | 20 dp | Dimensional gold gear | `settings` vector |

### P3 is held out of production, and the reason is not the artwork

**Decided 2026-08-13.** `p3-reminder-bell.png` may be generated and may be registered, but it must
**not** be wired into the Prayer reminders row until notification delivery genuinely exists.

The row today persists a preference and nothing else. NoorLife does not request notification
permission, does not schedule a local notification, keeps no background delivery handler, does not
reschedule after a restart or a timezone change, and cannot verify that anything was delivered. The
switch is honest about this only because a banner and a subtitle say so in words.

A dimensional gold bell would quietly undo that. It is the visual vocabulary of a finished reminder
feature, and placing it beside a switch that reminds nobody makes the screen assert — in the one
register users read fastest — that reminders work. Somebody misses a prayer trusting it.

The general rule this is an instance of: **a decorative upgrade must not make an incomplete control
look complete.** Artwork is not neutral when it sits next to an affordance.

So the honest end state until scheduling is built and separately approved is:

- the row keeps its restrained vector;
- the "scheduling arrives with notification support" banner stays;
- no permission is requested and no native notification dependency is added;
- P3's registry entry, once artwork exists, is `held` rather than `installed` — a third state,
  distinct from "awaiting artwork", meaning *the asset is here and deliberately unused*.

**Consequence for the integration gate, stated so it is not discovered late:** the registry test
asserts zero *pending* slots once every expected file is present. P3 must not count as pending —
it is not waiting for anything — and must not count as installed either. Without the third state
the set cannot reach a clean gate while P3 is correctly held, and the temptation at that moment
would be to wire the bell to make the test go green. That is exactly the pressure this note exists
to remove.

P4 is unaffected. Calculation settings navigates to `/faith/preferences`, which owns the value the
row displays, so its artwork upgrades a control that already does what it appears to do.

**Generation prompt, shared by every row above.** "A single [subject] rendered as a soft 3D
dimensional pictogram in NoorLife's Faith palette — deep emerald green (#217E68), warm cream
(#FFF2D4) and restrained antique gold (#D4A843) — lit from the upper left with a soft shadow,
centred on a fully transparent background, no text, no border, no scene, no drop shadow touching the
canvas edge. Square canvas, **1024×1024** px PNG with alpha, subject occupying **84–87%** of the
canvas, centred within 3%."

> **Corrected 2026-08-13.** This prompt previously said `512x512` and `~72%` occupancy, and the
> manifest said 78–86% for the same property. All three were wrong. The eight pictograms that
> already ship measure **85.9%** occupancy, uniformly — established by measuring them, not by
> reading a document — and they are the acceptance reference. The `~72%` instruction is removed
> rather than adjusted, because it was the figure a generator would have worked from and it would
> have produced a set that visibly did not match the eight beside it.
>
> A rejected first cut of H1 landed at 90.6% under the old guidance and had to be reframed. It now
> measures 85.7%.

**Acceptance for each** — the full checklist, mechanical and human, is
`FAITH_ASSET_MANIFEST.md` §4, and is not restated here so the two cannot disagree. In summary:
1024×1024, real alpha with transparent corners, no matte or visible chroma residue, 84–87%
occupancy centred within 3%, no colour outside the three Faith hues plus neutral shading, legible at
its rendered dp size on both `#FFFFFF` and `#ECF8F2`, and **under 80 KB** after lossless
optimisation.

> The previous 120 KB allowance here contradicted the manifest's 80 KB and is withdrawn. 80 KB is
> achievable at 1024×1024 — H1 optimises to 75 KB — so the larger canvas does not buy a larger
> budget.

**Where they go:** `assets/images/modules/faith/pictograms/`, under the exact filenames the registry
declares — listed in that directory's README and asserted by `faith-pictogram-registry.test.ts`:

```
h1-hadith-collections.png   d1-morning-evening.png   p1-location-mosque-pin.png   p2-maghrib.png
h2-bookmarked-book.png      d2-everyday-moments.png  p2-fajr.png                  p2-isha.png
h3-reading-history.png      s1-verified-shield.png   p2-sunrise.png               p3-reminder-bell.png
                                                     p2-dhuhr.png                 p4-calculation-gear.png
                                                     p2-asr.png
```

Fifteen files for sixteen slots: **D3 reuses H2's image.** Both are "an open cream book with an
emerald/gold ribbon", and drawing two different books for one idea would put two answers to the same
question three taps apart in the same module.

Installing one is two lines in `faith-pictogram-assets.ts` — uncomment the `require` written at that
entry, delete the `awaiting-artwork` line — and no change anywhere else. The require lines are
written out in full at each entry because they cannot be *live* until the file exists: Metro
resolves `require` at build time, so a require of a missing file fails the bundle.

### Reused rather than regenerated

| Surface | Asset | Why it genuinely matches |
|---|---|---|
| Hadith status card | `submenu/02-hadith.png` | NoorLife's own emerald-and-gold bound volume — what the reference draws in this slot |
| Duas status card | `submenu/03-duas.png` | NoorLife's own cupped hands over an emerald book — the reference's subject exactly |
| Prayer location card | `submenu/07-mosques.png` | The reference's mosque, without the map-pin surround (recorded as P1) |

## Present and in use

All eight `faith-submenu-pngs` finals are installed at
`assets/images/modules/faith/submenu/` and registered in
`src/features/faith/faith-submenu-assets.ts`.

## Deliberately kept as vectors

These are functional controls, not feature identities. They are small, several
carry state, and they must stay crisp at 13–22 dp — a generated PNG could do
none of that.

- Back, Help, Profile chevron
- Continue-Quran play / pause (two states)
- Daily Ayah share
- Search, close, bookmark
- Worship completion circles (dynamic state)
- Qibla dial arrow (rotates with the live bearing)
- Hero clock glyph inside the "View Prayer Times" button
