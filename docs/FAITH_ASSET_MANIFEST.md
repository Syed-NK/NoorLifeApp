# NoorLife Faith — original PNG asset manifest and generation prompts

**Status:** specification. No artwork has been generated from this document yet, and no placeholder
has been committed. Surfaces awaiting art keep the restrained vector they have today, and the gaps
are listed in `FAITH_ASSET_GAPS.md`.

**Why a manifest rather than generated files:** production-quality raster artwork cannot be
generated inside the development environment this work was carried out in. The approved fallback was
a precise specification plus per-asset prompts, which is what follows. Every asset below can be
produced from its prompt and dropped into the named path without further design decisions.

---

## 1. The system these assets belong to

Eight Faith pictograms already ship and are the reference for everything new. Any asset produced
from this document must sit beside `assets/images/modules/faith/submenu/01-quran.png` and look like
part of the same set — that is the acceptance test, and it matters more than any individual prompt
below.

### 1.1 Palette

Taken from the live Faith theme (`src/features/modules/module-tokens.ts`) and the approved hero
artwork. **No colour outside this list may appear** except as a shading or highlight step of one of
them.

| Role | Hex | Where it comes from |
|---|---|---|
| Faith green, primary | `#23856D` | `moduleColorThemes.faith.fill` |
| Faith green, deep | `#1A6452` | `gradientStart` — shadow side of green forms |
| Faith green, ink | `#217E68` | `ink` — outlines on light ground |
| Mint, light surface | `#ECF8F2` | `lightSurface` — the tile ground these sit on |
| Gold, primary | `#E3BE73` | Hero lanterns, the "View Prayer Times" pill |
| Gold, deep | `#C99B45` | Shadow side of gold forms |
| Gold, line-art | `#B98A2E` | The existing crescent and compact-card glyphs |
| Navy, ink | `#1F3A4D` | Outline and deep shadow where green would muddy |
| Cream | `#FAF6EC` | Page/paper, highlights on gold |
| Warm white | `#FFFFFF` | Specular highlights only |

### 1.2 Craft rules

These are what make eight separate images read as one set. They are non-negotiable and are the first
thing to check on delivery.

- **Perspective.** Three-quarter view from slightly above, ~15° elevation. Not flat-on, not isometric.
- **Lighting.** A single soft light from the upper left. Highlights upper-left, shadows lower-right.
  No rim light, no second source, no cast shadow on the ground.
- **Form.** Rounded, slightly soft geometry. Solid fills with one or two shading steps. No gradients
  longer than about a third of a form, no gloss, no glass, no metallic reflections.
- **Outline.** No black. Where an edge needs definition it is navy `#1F3A4D` at low opacity or a
  deeper tint of the fill.
- **Detail budget.** Legible at 40 dp — the size the Faith home grid renders them at. If a detail
  disappears at 40 dp it should not be in the image.
- **Composition.** Subject centred within 3%, occupying **84–87%** of the canvas, with even optical
  margin. No element touching the edge. See §1.5 for where that band comes from — it is measured
  from the eight that already ship, which sit at 85.9%.

### 1.3 Technical requirements

- **Format:** PNG-24 with a real alpha channel. Fully transparent background — no white matte, no
  near-white pixels around the subject.
- **Canvas:** square, `1024 × 1024` master.
- **Delivered sizes:** see §1.4.
- **No text of any kind baked into the image**, in any language or script. Labels are rendered by the
  app so they translate, scale with the user's font size, and reach a screen reader.
- **No emoji, no third-party brand marks, no photography, no screenshots.**
- **Original work only.** Nothing traced, sampled or derived from another Qur'an app's artwork.
- **Verified on light and dark ground** before acceptance — see §4.

### 1.4 The `@2x`/`@3x` question, answered — and the two canvas sizes in play

**Every asset ships as a single PNG, with no `@2x`/`@3x` variants.**

That is a deliberate departure from the usual React Native convention. The largest box any of them
is drawn in is 84 dp (the Qibla dial marker) and the common case is 40 dp, so density variants would
add three files per asset and buy nothing.

**There are two canvas sizes on disk, and this document previously claimed there was one.**

| Set | Canvas | Where |
|---|---|---|
| The original eight submenu pictograms | **256 × 256** | `assets/images/modules/faith/submenu/` |
| The Hadith/Duas/Prayer pictograms (H1–P4) | **1024 × 1024** | `assets/images/modules/faith/pictograms/` |

This section used to state that the existing eight were 1024 × 1024 masters. **They are not** — all
eight measure 256 × 256, which was found by measuring them rather than by reading this file. The
claim is corrected here rather than quietly amended, because it was the reference a generator would
have worked from.

Both are correct for what they are. 256 px covers 84 dp at 3× with room to spare, and the eight were
produced that way. The new set is delivered at **1024 × 1024 and stays there for the integration
pass**: the masters exist at that size, downsampling them would be a lossy step taken for no measured
benefit, and 1024 px still optimises comfortably under the size ceiling below.

**Optimise before committing:** run each file through a lossless PNG optimiser. Target **under
80 KB**, which applies to both sets. The existing eight range from 41 KB to 78 KB; the first
1024 × 1024 asset (H1) lands at 75 KB, so the ceiling is achievable at the larger canvas and is not
relaxed for it.

### 1.5 Subject occupancy — measured, not asserted

**Target: the subject's bounding box spans 84–87% of the canvas, centred within 3%.**

This too was previously stated twice and inconsistently — §1.2 said 78–86% and the per-asset prompt
in `FAITH_ASSET_GAPS.md` said "~72%". Neither matched what shipped.

**All eight reference pictograms measure exactly 85.9%**, with identical framing; they were cropped
uniformly from one sheet. That figure is the reference, and the 84–87% band is drawn around it.

The reason this matters more than a tolerance usually would is the acceptance test in §4: *placed
beside `01-quran.png` at the same display size, does it look like the same set?* An asset at 90%
renders its subject noticeably larger than the eight beside it in the same 40 dp box, which is
exactly the drift that test exists to catch — and it is invisible in isolation and obvious in a row.

---

## 2. The assets

Fourteen assets in four groups. Each row gives the exact path the code will `require`, so the
integration is a one-line addition per asset to `faith-asset-map.ts` (§3).

### Group A — feature identities (join the existing eight)

| # | Asset | Path | Rendered at | Replaces |
|---|---|---|---|---|
| A1 | Bookmarks | `assets/images/modules/faith/features/09-bookmarks.png` | 40–64 dp | `bookmark` vector on the Bookmarks screen identity |
| A2 | Translation | `assets/images/modules/faith/features/10-translation.png` | 40–64 dp | none — new identity for preferences/content info |
| A3 | Recitation | `assets/images/modules/faith/features/11-recitation.png` | 40–64 dp | none — new identity for the reciter section |
| A4 | Reading progress | `assets/images/modules/faith/features/12-progress.png` | 40–64 dp | `target` vector on the progress screen |
| A5 | Observances / Ramadan | `assets/images/modules/faith/features/13-observances.png` | 24–40 dp | the `crescent` vector — the gap `FAITH_ASSET_GAPS.md` has carried since Phase 4 |

### Group B — Qibla

| # | Asset | Path | Rendered at | Notes |
|---|---|---|---|---|
| B1 | Compass dial face | `assets/images/modules/faith/qibla/compass-dial.png` | 220 dp | Must be **rotationally symmetric about its centre** and centred to sub-pixel accuracy — it sits behind a marker that rotates over it |
| B2 | Kaaba direction marker | `assets/images/modules/faith/qibla/kaaba-marker.png` | 84 dp | Points **straight up** in the source image. The app rotates it; a marker drawn at any other angle offsets every bearing |
| B3 | Marker, aligned state | `assets/images/modules/faith/qibla/kaaba-marker-aligned.png` | 84 dp | Identical geometry to B2, green-forward palette. Same canvas, same centre, so swapping does not shift it |

### Group C — Tasbih

| # | Asset | Path | Rendered at | Notes |
|---|---|---|---|---|
| C1 | Bead strand, full | `assets/images/modules/faith/tasbih/strand.png` | 260 dp wide | A horizontal arc of beads, used behind the counter |
| C2 | Single bead, unlit | `assets/images/modules/faith/tasbih/bead.png` | 18 dp | For a progress row of individual beads |
| C3 | Single bead, counted | `assets/images/modules/faith/tasbih/bead-counted.png` | 18 dp | Identical silhouette to C2 so a row does not jitter as beads fill |

### Group D — states and reader ornament

| # | Asset | Path | Rendered at | Notes |
|---|---|---|---|---|
| D1 | Empty state | `assets/images/modules/faith/states/empty.png` | 120 dp | Used by bookmarks-empty and progress-empty |
| D2 | Offline state | `assets/images/modules/faith/states/offline.png` | 120 dp | Used by the shared offline state within Faith |
| D3 | Reader header ornament | `assets/images/modules/faith/reader/surah-ornament.png` | 320 × 64 dp | A horizontal band above the surah header. **Decorative only** — never behind the Arabic |

---

## 3. Integration contract

Assets are registered in **one** map, mirroring how `faith-submenu-assets.ts` already works:

```ts
// src/features/faith/faith-asset-map.ts
export const faithAssets = {
  bookmarks: require('@assets/images/modules/faith/features/09-bookmarks.png'),
  // …
} as const;
```

Three rules carried over from the existing set, and each exists because breaking it caused a defect
before:

1. **Static `require` only.** No template strings, no lookup by variable, no dynamic import — Metro
   resolves `require` at build time, and a dynamic path silently resolves to nothing in a release
   bundle. That is how an icon-font fallback gets introduced by accident.
2. **No fallback path.** An entry's `source` is non-optional, so a surface cannot be declared without
   its asset. There is no code path that reaches an emoji, a glyph or a coloured square.
3. **Rendered `resizeMode="contain"`, never tinted, never given a background or a second icon well.**
   The surface the asset sits on is its only container.

### 3.1 The one bounded exception to rule 3, and its limits

The Prayer screen's vertical journey timeline draws each of the six P2 markers inside a circular
outline on a vertical track. Read literally that is a container around approved artwork, so it is
recorded here rather than left as a contradiction between the rule and the code.

What makes it admissible, precisely:

- **It is structural, not decorative.** The track runs behind the markers, and the disc is what
  breaks it so the line appears to pass behind each one. Remove the disc and the line runs through
  the artwork.
- **It introduces no second ground.** The disc's fill is `moduleNeutrals.surface` — the card's own
  white, the surface the asset already sat on. Nothing is tinted, nothing is washed, and the artwork
  is composited over exactly the colour it would have been composited over without the disc.
- **The visible edge carries state, not decoration.** A 1 dp neutral outline for an upcoming marker,
  the module ink for a passed one, and a 2 dp gold ring for the next prayer — an *outer* treatment,
  authorised by the Mock B brief, which never touches the image inside it.

The limits, stated so this does not become a general licence: no filled or tinted well behind any
Faith pictogram, no gradient or shadow inside the disc, no ring around a pictogram that is not on a
timeline track, and no second mark inside the same disc.

A test mirroring `faith-approved-assets.test.tsx` asserts every registered path exists on disk and
that no unregistered PNG has appeared in the directories.

---

## 4. Acceptance checklist

Per asset, before it is committed. The mechanical rows are checked by a script rather than by eye —
see §4.1 — and the rows below it are the ones only a person can answer.

**Mechanical, scripted:**

- [ ] Exactly the canvas size for its set (§1.4): 1024 × 1024 for H1–P4
- [ ] Real alpha channel, actually used — not an opaque RGBA
- [ ] All four corners fully transparent
- [ ] No white matte or near-white halo on the cut edge
- [ ] No *visible* magenta chroma residue (see §4.1 on what "visible" means here)
- [ ] Subject occupancy 84–87%, centred within 3%, nothing touching the edge
- [ ] Under 80 KB after lossless optimisation
- [ ] Contrast ≥ 3:1 against `#FFFFFF` and against `#ECF8F2`

**Human eye, unscriptable:**

- [ ] Reads correctly on `#FFFFFF`, on `#ECF8F2` (the tile ground), and on `#1A6452` (dark ground)
- [ ] Legible at the smallest size in §2 for that asset
- [ ] Every colour traceable to §1.1
- [ ] Light from the upper left, consistent with the existing eight
- [ ] No text, numerals, Arabic script, emoji, logo or watermark
- [ ] The subject is the one the brief asked for
- [ ] Placed beside `01-quran.png` at the same display size — does it look like the same set?

### 4.1 On magenta residue, and why the check has a threshold

These assets are produced over a magenta key and cut out, so a trace of the key survives in the
anti-aliased edge. That is normal and is not, by itself, a defect.

The check therefore fails on **visible** residue — magenta at alpha ≥ 16 (6%) — and *reports* the
count below that without failing. The distinction was drawn against a real measurement: H1's first
approved cut carried 39 magenta pixels, every one at alpha 10, which composites to `rgb(254,249,255)`
on white and `rgb(236,243,242)` on mint. Those are shifts of one to six parts in 255.

A gate that fails an asset for something no eye can resolve is a gate that gets overridden, and an
overridden gate protects nothing. The sub-threshold count is still printed, because a jump in it is
how a change in the cutting workflow would announce itself.

---

## 5. Generation prompts

One prompt per asset. Each is self-contained, because a generator has no memory of §1 — the shared
craft rules are restated in the **preamble**, which should be prefixed to every prompt.

### Preamble (prefix to every prompt below)

> A single centred object icon in a soft, rounded, semi-flat vector-illustration style. Three-quarter
> view from slightly above, about 15 degrees elevation. One soft light source from the upper left,
> with highlights on the upper-left surfaces and gentle shadow on the lower-right. Solid colour fills
> with one or two subtle shading steps, no long gradients, no gloss, no glass, no metallic
> reflection, no cast shadow on the ground. No outline in black — where edges need definition use a
> deep desaturated navy. Palette restricted to: deep teal-green #23856D, darker green #1A6452, light
> mint #ECF8F2, warm gold #E3BE73, deeper gold #C99B45, deep navy #1F3A4D, cream #FAF6EC. Fully
> transparent background. Square 1024×1024 canvas, subject centred and occupying about 80 percent of
> the frame with even margins. Absolutely no text, no letters, no numerals, no calligraphy, no
> arabic script, no logos, no watermarks, no emoji. Clean enough to remain legible when scaled down
> to 40 pixels.

### A1 — Bookmarks

> [preamble] Subject: a slim closed book seen at a three-quarter angle with a single ribbon bookmark
> in warm gold trailing from between its pages. The book cover is deep teal-green with a subtle cream
> page block visible along the fore-edge. The ribbon is the focal accent. Calm and still.

### A2 — Translation

> [preamble] Subject: two overlapping rounded rectangular cards suggesting a page and its
> counterpart, the rear card in deep teal-green and the front card in cream, connected by a small
> gold arc between them suggesting correspondence between the two. Abstract and quiet — no letters or
> characters of any kind on either card.

### A3 — Recitation

> [preamble] Subject: a soft rounded speaker or sound-source form in deep teal-green with three
> concentric gold arcs radiating from its right side suggesting sound. The arcs decrease in opacity
> outward. No musical notes, no microphone, no headphones.

### A4 — Reading progress

> [preamble] Subject: an open book seen from a three-quarter angle in cream and teal-green, with a
> gold circular progress ring floating just above and in front of its upper-right corner, the ring
> about two-thirds complete with rounded ends. No numerals inside the ring.

### A5 — Observances / Ramadan

> [preamble] Subject: a slender crescent moon in warm gold, with a single small eight-pointed star in
> deeper gold to its lower right, and a soft mint-green rounded arch shape behind them suggesting a
> niche. Serene, not celebratory. No lanterns, no fireworks, no bunting.

### B1 — Compass dial face

> [preamble] Subject: a circular compass dial face seen flat-on rather than at an angle — this one
> asset is drawn straight on, perfectly circular and perfectly centred on the canvas. A mint-green
> disc with a subtle cream inner ring, a fine deep-navy tick mark at each of the four cardinal points
> and a shorter tick at each of the twelve intermediate positions. A soft gold outer rim. The centre
> is left plain and unornamented. No needle, no arrow, no letters marking the cardinal points.

### B2 — Kaaba direction marker

> [preamble] Subject: a stylised Kaaba — a simple cube seen at a three-quarter angle, deep navy with
> a fine gold band running horizontally around its upper third — sitting directly on top of a slender
> teal-green arrow that points straight up toward the top of the canvas. The arrow's shaft is short
> and its head is soft and rounded. The whole form is vertically symmetric about the canvas centre
> line and points exactly upward.

### B3 — Kaaba direction marker, aligned

> [preamble] Subject: identical in shape, size, position and orientation to the previous Kaaba-and-
> upward-arrow marker, but recoloured to signal confirmation: the arrow in bright deep teal-green
> #23856D with a soft mint glow immediately around it, and the cube's gold band brightened. The
> silhouette, proportions and centre point must match the previous image exactly so the two can be
> swapped without any visible shift.

### C1 — Tasbih bead strand

> [preamble] This one asset is a wide 1024×256 canvas rather than square. Subject: a horizontal arc
> of about fifteen round prayer beads on a fine cream cord, the arc dipping gently toward the centre.
> Beads alternate subtly between deep teal-green and a slightly deeper green, each with a small
> upper-left highlight. A single slightly larger gold bead at the centre of the arc. No tassel, no
> hand, no text.

### C2 — Single bead, uncounted

> [preamble] Subject: one single round prayer bead, deep teal-green with a soft upper-left highlight
> and a small darker shadow at its lower right, with a fine cream cord passing horizontally through
> it and extending a short way out each side. Nothing else in the frame.

### C3 — Single bead, counted

> [preamble] Subject: identical in shape, size and position to the previous single prayer bead, but
> in warm gold #E3BE73 with a deeper gold #C99B45 shadow at its lower right and a brighter cream
> highlight at its upper left. The cord stays cream. Silhouette and centre must match the previous
> image exactly.

### D1 — Empty state

> [preamble] Subject: an open book lying flat and seen at a three-quarter angle, its pages blank
> cream, with three small soft mint-green rounded shapes floating gently above it suggesting
> stillness and space rather than absence. Cover in deep teal-green. Gentle and unhurried, not sad.
> No question mark, no magnifying glass, no exclamation.

### D2 — Offline state

> [preamble] Subject: a soft rounded cloud form in light mint green with a single deep-navy slash
> running diagonally through it from upper left to lower right, the slash with rounded ends. A small
> gold dot sits at the cloud's lower right. Calm and matter-of-fact.

### D3 — Reader header ornament

> [preamble] This one asset is a wide 1280×256 canvas rather than square. Subject: a slender
> horizontal ornamental band, symmetric about its centre, composed of a fine gold line that widens
> into a soft geometric eight-pointed rosette at the exact centre and tapers away to nothing at both
> ends. Deep teal-green accents at the rosette's inner points. Delicate and restrained — it sits above
> text and must not compete with it. Absolutely no calligraphy and no script of any kind.

---

## 6. What is deliberately *not* on this list

- **A Mushaf page background or Quran page-layout art.** The reader has no page mode, and it will not
  get one until a real Mushaf layout implementation and licensed Uthmani font assets exist. Producing
  page ornament first would create pressure to ship the mode it implies.
- **Any recitation or reciter portrait.** Reciters are living people; NoorLife does not depict them.
- **A prayer-times illustration.** The existing `04-prayer.png` already covers it.
- **Anything carrying Arabic script.** Every prompt forbids it explicitly, in both the preamble and
  the two ornament prompts where a generator is most likely to add it unasked. Scripture is rendered
  as live text from the approved source, never baked into a picture where it cannot be verified,
  selected, scaled or read aloud.

---

## Hadith, Duas and Prayer pictograms (2026-08-12)

Eleven slots introduced by the three selected references. Full table — purpose, placement, size,
what each needs, what ships instead, the shared generation prompt, the acceptance checklist and the
destination path — lives in `FAITH_ASSET_GAPS.md` under "Gaps introduced by the approved Hadith,
Duas and Prayer designs", and is not duplicated here so the two files cannot disagree.

IDs: **H1–H3** (Hadith preview rows), **D1–D3** (Duas preview rows), **S1** (shared trust-notice
shield), **P1–P4** (Prayer location pin, day-arc marks, reminder bell, calculation gear).

Each slot is typed as `FaithPictogramSlot` in `src/features/faith/components/faith-locked-library.tsx`
and resolved through **one registry**, `src/features/faith/faith-pictogram-assets.ts`, which is the
single place a slot's artwork is named. Installing one is two lines in that file and nothing
elsewhere; the destination directory, the expected filenames and the acceptance gate are described
in `FAITH_ASSET_GAPS.md` and enforced by `faith-pictogram-registry.test.ts`.

**Status: installed 2026-08-13.** Fifteen files fill sixteen slots, D3 sharing H2's image. P3 alone
is `held` — delivered, registered, and deliberately not rendered while Prayer reminders schedule
nothing. `FaithPictogramDevAudit` states that hold on the Prayer screen in development, worded
"Held pending notification delivery." rather than flagged as an outstanding gap, because it is a
decision rather than a chore.
