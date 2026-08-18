# Faith dimensional pictograms — integration slots

The sixteen approved NoorLife pictogram slots introduced by the Hadith, Duas and Prayer designs.
All fifteen files are installed — see **Current status** at the foot of this file.

Artwork is generated separately and copied in. Nothing in this repository generates it, and **no
placeholder PNG may ever be committed here**: a placeholder resolves through the registry, renders,
and is indistinguishable in a screenshot from the approved asset.

## Expected files

Fifteen files fill sixteen slots — D3 reuses H2's image rather than carrying a visually different
duplicate of the same subject.

| File                         | Slot   | Subject                                                      |
| ---------------------------- | ------ | ------------------------------------------------------------ |
| `h1-hadith-collections.png`  | H1     | Stacked bound emerald volumes with gilt tooling              |
| `h2-bookmarked-book.png`     | H2, D3 | Open cream book with an emerald/gold ribbon bookmark         |
| `h3-reading-history.png`     | H3     | Closed emerald volume with a gold pocket watch               |
| `d1-morning-evening.png`     | D1     | Sunrise over jade prayer beads with a restrained gold tassel |
| `d2-everyday-moments.png`    | D2     | Dimensional emerald home with a crescent finial              |
| `s1-verified-shield.png`     | S1     | Emerald shield with a gold rim and a cream check             |
| `p1-location-mosque-pin.png` | P1     | Mosque inside a gold-rimmed map pin                          |
| `p2-fajr.png`                | P2     | Fajr crescent                                                |
| `p2-sunrise.png`             | P2     | Sunrise — a time marker, not a prayer                        |
| `p2-dhuhr.png`               | P2     | Dhuhr prayer rug                                             |
| `p2-asr.png`                 | P2     | Asr sun                                                      |
| `p2-maghrib.png`             | P2     | Maghrib mosque at sunset                                     |
| `p2-isha.png`                | P2     | Isha crescent and stars                                      |
| `p3-reminder-bell.png`       | P3     | Dimensional gold reminder bell                               |
| `p4-calculation-gear.png`    | P4     | Dimensional emerald-and-gold calculation gear                |

## Specification

Palette, craft rules, alpha and file-size requirements are in
[`docs/FAITH_ASSET_MANIFEST.md`](../../../../../docs/FAITH_ASSET_MANIFEST.md) §1, and the per-slot
table is in [`docs/FAITH_ASSET_GAPS.md`](../../../../../docs/FAITH_ASSET_GAPS.md). Neither is
restated here so the three cannot disagree.

The geometry is repeated here, and only here, because it is the thing that was got wrong:

| Property          | Value                                              |
| ----------------- | -------------------------------------------------- |
| Canvas            | **1024 × 1024** for this directory                 |
| Subject occupancy | **84–87%** of the canvas                           |
| Centring          | within **3%** of centre, nothing touching the edge |
| Optimised size    | **≤ 80 KB**                                        |
| Alpha             | real, with all four corners fully transparent      |

**85.9% is the measured reference.** All eight pictograms in
[`../submenu/`](../submenu/) sit at exactly that figure, and the acceptance test is whether a new
asset looks like part of that set when placed beside `01-quran.png` at the same display size.

Two canvas sizes are in play and both are correct: the original eight are **256 × 256**, this
directory is **1024 × 1024**. Earlier revisions of the manifest claimed the eight were 1024 px
masters; they are not, and the figure above is what is actually on disk.

## Validation

Every mechanical requirement above is checked by script before integration — canvas size, real
alpha, transparent corners, matte and chroma residue, occupancy, centring, edge clearance, file size
and contrast against `#FFFFFF` and `#ECF8F2`. **If any asset fails, the whole integration is
rejected rather than the failing slot being skipped.**

What the script cannot answer, and a person must: no text, numerals, Arabic script, logo, watermark
or emoji; the subject is the one the brief asked for; and it is legible at its real rendered dp size.

Nothing may be baked into an image — no labels, no times, no names. The Prayer day arc renders its
own text so it translates, scales with the user's font size and reaches a screen reader.

A trace of magenta in the anti-aliased edge is expected — these are cut from a magenta key — and
only _visible_ residue (alpha ≥ 16) fails. See `FAITH_ASSET_MANIFEST.md` §4.1.

## P3 is registered but deliberately unused

`p3-reminder-bell.png` belongs in this directory when it exists, and must **not** be wired into the
Prayer reminders row. That row persists a preference and schedules nothing — no permission request,
no local notification, no background handler, no rescheduling after restart. A dimensional gold bell
beside it would assert that reminders work, and somebody would miss a prayer trusting it.

Its registry entry is `held`, not `installed`, until notification delivery exists and is separately
approved. See `docs/FAITH_ASSET_GAPS.md` under "P3 is held out of production".

## Installing one

Assets are integrated as **one pass over the complete set**, not one at a time — a half-installed
set puts approved artwork beside stand-ins on the same screen, which reads as a design decision
rather than as an unfinished state.

1. Validate every file first. Reject the whole batch if any one fails.
2. Copy each PNG in under its exact name above. Only files named `*-final.png` at the source are
   eligible; generation sources, chroma-key intermediates, `-optimized` copies and per-size test
   renders are not.
3. Open `src/features/faith/faith-pictogram-assets.ts`, find each slot, and follow the two-line
   instruction written at that entry: uncomment its `require(...)` and delete its
   `awaiting-artwork` line. P3 is the exception — see above.
4. Run `npx jest faith-pictogram-registry`. It fails until step 3 is done: a PNG present on disk
   whose slot is still `awaiting-artwork` is treated as a defect, not as an option.

## Current status — 2026-08-13

**Integrated.** All fifteen PNGs are in this directory and validated. Fourteen slots render their
artwork; D3 renders H2's; P3 is registered and deliberately does not render.

| Count              | Slots                                                       |
| ------------------ | ----------------------------------------------------------- |
| `installed`        | 15 — H1, H2, H3, D1, D2, D3, S1, P1, the six P2 markers, P4 |
| `held`             | 1 — P3                                                      |
| `awaiting-artwork` | 0                                                           |
| unregistered PNGs  | 0                                                           |

Sixteen slots, fifteen files: D3 shares H2's `require`, so the image is bundled once and both slots
hand the renderer the same source object.

Every asset passed the full mechanical gate — 1024×1024, real alpha, transparent corners,
anti-aliased edge, no visible magenta, no white matte, clear of the canvas boundary, 84–87%
occupancy, centred within 3%, ≤80 KB, and ≥12:1 contrast on both white and `#ECF8F2` — and the human
checks: no text, numerals, Arabic script, logo, watermark or emoji, and every subject matching its
brief.

Two assets were rejected and regenerated before acceptance, which is recorded because the reasons
are the ones most likely to recur: four markers arrived at 64–66% occupancy and would have drawn a
quarter smaller than their siblings in the same arc row, and H3's first pocket watch carried Roman
numerals on the dial.
