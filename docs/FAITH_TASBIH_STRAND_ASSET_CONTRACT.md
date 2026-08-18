# Tasbih prayer-bead strand — asset contract

**Status: satisfied by the V4 pack.** Six stage plates and six selector thumbnails are integrated
and approved — see `assets/images/modules/faith/tasbih/MANIFEST.json`, which is the authority for
filenames, ids and SHA-256 hashes. This document is retained as the **commissioning record**: what
was rejected, why, and what any replacement artwork must satisfy.

The sections below are written in the tense of the brief they were, and are accurate as history.
Section 0 states what changed.

---

## 0. What closed this contract

The V4 pack is a photorealistic illustration set, not the photograph §"The next asset" specifies —
so it was accepted on the acceptance criterion rather than on the medium. The criterion was always
compositional and is stated at the foot of §"What has already been rejected": *the strand must
occupy roughly the same visual area, at roughly the same apparent distance, as the locked mock.* V4
does, where the earlier illustration attempt did not:

| Property | Rejected illustration | V4 pack |
|---|---|---|
| Canvas | 1233 × 1650 portrait, mostly empty margin | 1254 × 1254, subject filling the frame |
| Terminal, loop and tassel | Cropped away by `cover` | Complete **inside** the canvas |
| Render mode | `cover` inside a fixed height | `contain` against `aspectRatio: 1` |
| Materials with a plate | One (walnut) | All six |
| Tassel vs. tap instruction | Collided | Clear |

Two integration rules carried over from the rejection and are enforced in code rather than by
review: the plate is an absolute layer with `pointerEvents="none"` so artwork can never take a tap
meant for the count, and `resizeMode` is `contain` against a matching 1:1 stage so nothing is
cropped at any width. `faith-tasbih-locked-design.test.tsx` and `faith-tasbih-thumbnails.test.ts`
assert both, along with the manifest hashes.

**A replacement — including the photograph below — must still meet every requirement in this
document, and must not regress the five compositional failures listed next.**

---

## What has already been rejected, and why it matters

Three approaches are now closed. Reading this before commissioning the next one is the point of the
list.

1. **A ring of small outlined dots** around the count. Read as a progress indicator, not as a strand.
2. **Flat vector circles.** Same failure, more effort.
3. **A generated photorealistic illustration** (six material variants, 1233 × 1650 transparent PNGs).
   These passed every mechanical gate — exact canvas, true alpha, transparent corners, clear count
   area, matching bounds across all six — and were rejected on sight. The gates were measuring the
   wrong things. What failed was compositional:
   - the strand was **too small and too thin** on screen;
   - the beads read as **synthetic**;
   - it was composed as a **hanging necklace**, not the locked mock's **close foreground curve**;
   - the canvas carried so much empty margin that `contain` shrank the subject to fit;
   - the tassel collided with the tap instruction.

   The assets remain in the external handoff folder. They are not in this repository.

**The lesson for the next attempt:** a transparent PNG that satisfies a pixel contract can still be
the wrong picture. The binding requirement is that the strand occupies roughly the same visual area,
at roughly the same apparent distance, as `tasbih-a.png`.

---

## The next asset: a photograph

A real Tasbih owned by NoorLife, photographed on a plain removable background.

### Capture
- Plain, evenly-lit background that can be keyed out cleanly.
- The strand arranged as a **broad foreground curve**, close to camera, as in `tasbih-a.png` — not
  hanging, not laid flat in the distance.
- Even light with a single consistent direction, so shadows sit close under the beads.
- Enough resolution that the cropped subject is at least 1200 px on its long edge at 3×.

### Processing
- Remove the background; keep **genuine shadows close to the beads**.
- Crop to the foreground curve. **Tight occupied bounds** — the transparent margin exists to prevent
  clipping, not to pad the composition.
- Do **not** deliver a nearly empty full-screen canvas. That is what shrank the last attempt.
- No text, Arabic, logo, watermark, hands, phone frame, UI, or coloured fringe.
- Straight (non-premultiplied) alpha, sRGB.

### Placement in the app
- Rendered as an **absolute layer spanning the tap region**, not as an image inside a padded card.
- **Actual measured placement**, not `contain` inside an inner container.
- The count and round render **above** the artwork, in the clear ground the curve frames.
- The Current Dhikr sheet **overlays the strand's lower section**.
- The strand occupies **roughly the same visual area as `tasbih-a.png`** — this is the acceptance
  criterion the last attempt failed, and it is judged by comparison against the mock, not by
  measurement of the file.

### Validation to re-add on delivery
The pixel-level gates were removed with the rejected assets. When the photograph arrives, restore
them — exact dimensions, true alpha, transparent corners, no matte, clear count area — **and add a
side-by-side comparison against `tasbih-a.png` before any integration work**, because that is the
check that would have caught this round.

---

## Material variants

**Delivered.** Six ids — `walnut`, `green-jade`, `black-onyx`, `white-jade`, `sandalwood`,
`figured-brown` — each with its own full stage plate and its own 256 × 256 selector thumbnail. The
ids are the manifest's and are stable: they are persisted in user preferences, so renaming one
orphans a stored selection. `tasbih-materials.ts` resolves an id to an asset with a complete
`Record`, which makes a missing variant a compile error rather than a blank swatch.

The thumbnails were re-cut on 2026-08-15 from the approved V3 source board. The delivered set was
clipped at the bottom on all six, sat ~24 px low and spread 22.5 px horizontally; the replacements
measure within 1 px of a shared centre with a 3 px diameter spread, which is what makes the selector
row read as one row of equal beads. The stage plates were not touched by that pass.

The deferral note this replaces was written when only walnut had artwork.

---

## Licensing

The photograph must be original NoorLife work of an object NoorLife owns, with no attribution
requirement in the UI, and must not be derived from any other application's imagery. Record the
licence and the capture source alongside the asset before it is committed.

**The same bar applies to the V4 pack, and it is the one open item against it.**

`MANIFEST.json` now carries a `provenance` block beside the hashes. Read it before acting on this
section, because most of it says **`unknown — requires owner confirmation`**, and that wording is
load-bearing: the tool, the operator, the date, the medium and the rights holder could not be
established from anything this repository holds. The twelve PNGs carry no `tEXt`, `iTXt` or `tIME`
chunk, no file under `docs/` records the V4 delivery, and no commit message names a supplier. Those
fields were left unknown rather than filled in with a plausible answer — a provenance record that
guesses is worse than one that admits a gap, because the guess is what a future reader would rely
on.

What *is* established is recorded there too: dimensions, colour type, byte sizes, the re-cut date,
and that all twelve hashes verify. Also verified, by rendering every plate and thumbnail on an
Android release build: the artwork carries no text, no Arabic, no logo, no watermark and no
signature.

So this is a **record-keeping obligation, not a rights dispute**, and it blocks nothing on screen —
the artwork is decorative, carries no religious content, and states nothing a user could act on. It
must still be closed by the owner before release, because as things stand NoorLife cannot evidence
who made this artwork or under what terms.

Note the distinction that keeps this section short: **bead artwork is not religious content.** It
depicts an object. Nothing in this contract licenses any Arabic, translation, transliteration,
reference or attribution — the Tasbih screen ships none, and
`docs/FAITH_TASBIH_CONTENT_AUDIT.md` records why.
