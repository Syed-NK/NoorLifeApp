# Faith hero assets — provenance, optimisation, truth corrections and validation

**Date:** 2026-08-12
**App directory:** `assets/images/modules/faith/hero/`
**Central mapping:** `src/features/faith/faith-hero-images.ts`
**Regression tests:** `src/features/faith/__tests__/faith-hero-baked.test.tsx` (87 cases)

---

## 1. Provenance

Original NoorLife design assets. Each file is an approved **selected-B hero card in full** — cinematic
background, foreground object, and the eyebrow and heading baked into the pixels. The gold button was
removed from the sources before they were supplied.

**Sources retained outside the repository, unmodified:**
`D:\ChatGPT\NoorLife\selected-faith-hero-cards-button-free`

An earlier approach that composited separated transparent objects onto a shared midnight-teal
background was abandoned and fully reverted. It rebuilt each card rather than using it, and lost the
per-screen lighting and staging of the originals. No separated object, lantern or generic background
asset remains in the repository or is referenced from any source file.

---

## 2. What was done to each file

Two operations only. No recomposition, no re-matting, no colour work.

1. **Cover-crop to the hero's aspect.** Sources are 2.040–2.239; the hero is 361 × 144 dp = 2.507. A
   full-width slice was taken with the crop window placed at **0.3 of the vertical slack** — biased
   toward the top, because the sources put the crescent, minaret tips and dome highlights in the upper
   third and a plain floor or water reflection along the bottom. Flush-top was rejected: it removes the
   contact shadow that grounds the objects.
2. **Downscale to 1083 × 432** — the hero at 3× — by area average, stored as RGB (colour type 2).

The crop is **baked into the file** rather than left to `resizeMode`. `cover` crops from the centre with
no control over the anchor, which would have clipped the minarets and crescent. Baking it puts the
decision in one auditable place and ships no pixels the screen never shows.

One baked crop serves every width: the card is 2.507 at 393 dp and 2.513 at 320 dp, so `cover` never
crops differently between devices.

---

## 3. Truth correction — three cards had false baked subtitles

| Card | Baked subtitle | Why it could not ship |
|---|---|---|
| Hadith | "Verified narrations, clearly sourced." | No Hadith provider is approved. Nothing is sourced. |
| Duas | "Supplications for every part of your day." | No Dua provider is approved. None are supplied. |
| Mosques | "Find masjids near you." | No directory provider is approved. None can be found. |

**A false statement in an image is a false statement in the product.** It cannot be corrected by an
accessibility label or by honest text lower down the screen, because a sighted user reads the picture.

**Resolution — option 1 of the three permitted.** The subtitle band was removed from those three images
and the honest wording is rendered natively in the cleared space.

This was safe on these three specifically: the subtitle sat on a near-flat dark gradient. Measured
horizontal roughness of the donor rows immediately above and below (mean absolute channel delta between
adjacent pixels) was **1.08–2.28** — essentially a smooth ramp, which reconstructs exactly by
interpolating between the two donor rows. The eyebrow, heading, background and foreground object are
untouched.

Verified: **zero glyph pixels remain** in the band on all three. Mosques required a second pass — a
fragment at x=474–526 survived the first box and was visible on device as a mark over the native copy;
the band was re-measured by column histogram — glyphs span x=315–526, artwork highlights begin at x=641 — and the strip set to x≤560 with a 40 px feather, safely between the two. Re-verified at zero.

The three un-stripped originals were **deleted**, so nothing can accidentally render the false wording.
Files carry a `-locked` suffix to make the transformation visible in the file list.

### Native locked subtitles

| Screen | Visible native text |
|---|---|
| Hadith | Verified Hadith content is not configured yet. |
| Duas | Verified Dua content is not configured yet. |
| Mosques | Nearby mosque information requires an approved directory provider. |

Positioned by **fraction, not by padding token** — the baked headings begin at 5.26%–6.65% of the image
width, inside the hero's own 14 dp padding, so a token-based inset would not line up. Fractions scale
with the image, so alignment holds at every width. `faithHeroBakedCopy` in the mapping holds them.

### The five that kept their baked copy

Qur'an, Qibla, Tasbih and Calendar describe what those screens actually do. **Prayer** keeps the generic
heading "Next prayer" — generic being the point: it names no prayer and states no time, so it cannot be
wrong. The calculated result (real prayer, location-local time, live countdown) is rendered natively in
`faith-prayer-next` immediately below the hero. Nothing dynamic is drawn over the image.

---

## 4. Final dimensions and sizes

| File | Screen | Dimensions | Size |
|---|---|---|---|
| `quran-hero.png` | Qur'an | 1083 × 432 | 515 KB |
| `hadith-hero-locked.png` | Hadith | 1083 × 432 | 542 KB |
| `duas-hero-locked.png` | Duas | 1083 × 432 | 433 KB |
| `prayer-hero.png` | Prayer | 1083 × 432 | 529 KB |
| `qibla-hero.png` | Qibla | 1083 × 432 | 553 KB |
| `tasbih-hero.png` | Tasbih | 1083 × 432 | 463 KB |
| `mosques-hero-locked.png` | Mosques | 1083 × 432 | 458 KB |
| `calendar-hero.png` | Calendar | 1083 × 432 | 488 KB |

**Total 3.9 MB, from 15.1 MB of sources — a 74% reduction.**

### PNG was retained, deliberately

These cards carry **baked text**. JPEG's chroma subsampling and block transform put ringing around
glyph edges, and the headings here are large white type on a dark ground — the worst case for it. The
files are also already RGB with no alpha to preserve, so PNG's cost is the lossless encoding itself.

`sharp` was **not** installed. Available tooling was checked first: only `pngjs` is present (pure JS,
already a dependency), and there is no JPEG or WebP encoder in the project or on the system path
(`/c/WINDOWS/system32/convert` is the Windows disk utility, not ImageMagick). Converting would have
required a new dependency for a format change that risks the text quality, so it was not done.

**Decode cost is one image.** `faith-hero-images.ts` holds all eight `require` calls at module scope;
Metro resolves those to numeric handles at bundle time, and the bitmap is decoded only when an `Image`
mounts with that handle. One hero on screen decodes one file.

---

## 5. The layout defect this pipeline exposed

`StyleSheet.absoluteFill` sets `position` and the four edges but **no dimensions**. That sizes a `View`
and does not size an `Image`: with no definite width or height an Android `Image` measures at its
source's intrinsic size, and `resizeMode` has no frame to fit into.

These files are 1083 × 432 with no `@3x` suffix, so Metro reports them as 1083 × 432 **dp**. The first
build rendered every hero three times too large, showing only its top-left third — a giant "Faith"
eyebrow and the top of the heading. The fix is an explicit `width: '100%', height: '100%'` alongside
`absoluteFill`, and `faith-hero-baked.test.tsx` asserts both as a regression guard.

Worth recording because the earlier separated-object background had the same bug and it was invisible:
a 3× zoom of a smooth night-sky gradient looks like a night-sky gradient.

---

## 6. Hero actions — none, and why

The supplied images are intentionally button-free, and no hero ships a button.

Qur'an's "Start Reading"/"Continue Reading" and Qibla's "Find Qibla" were both **built and worked**. On
device each **covered the second line of its baked subtitle**: the 2.507 crop moves the baked copy lower
in the card than the cleared button region allows for, so the pill landed on "where you stopped." and
"from where you are."

Both actions are optional, and the rule is that a control must not cover existing text — so both were
removed. Neither loses functionality: the Qur'an screen's "Continue reading" card carries the same
navigation with the surah name and real progress, and Qibla's permission-grant affordance sits directly
below its hero.

Prayer, Tasbih and Calendar were never given one: each puts its content (the prayer list, the counter,
the month grid) immediately below the hero, so a button would navigate to where the user already is. No
scroll-ref system was added.

Hadith, Duas and Mosques carry no action while locked.

The component keeps its action path for the two heroes that still compose natively, and for a future
card supplied with a taller cleared band.

---

## 7. Accessibility

| Property | Treatment |
|---|---|
| Baked words reachable | Container carries `accessibleName` — the visible words verbatim |
| Announced once | `accessible` on the container collapses the subtree |
| Image | `accessible={false}` **and** `importantForAccessibility="no"` |
| Native locked subtitle | Inside the collapsed subtree, so it is not announced separately |
| Duplicate native copy | None rendered — no `-copy`, `-title` or `-detail` node exists on a baked hero |
| Locked status | Visible native text on the hero **and** in `FaithProviderLockedState` below |

Accessible names deliberately exclude scenery. "A mosque at night with a crescent moon" is not what the
screen is telling the user, and reading it first buries the point.

**A real limitation:** baked copy does not scale with the OS font setting, cannot be translated, and
cannot be restyled. Only the native locked subtitles scale. This is the accepted cost of using the
approved artwork rather than rebuilding it.

---

## 8. Verified widths

All six: **320, 360, 393, 411, 430, 600 dp.** Checked on the two riskiest heroes — Mosques (longest
locked copy) and Qur'an (two-line baked subtitle) — plus a font-scale 1.3 stress case.

Confirmed at every width: baked eyebrow and heading complete and readable, native locked subtitle
complete on two lines, main object recognisable, crescent and minaret retained, corners clean, no
stretching, no button-removal artifact, no duplicate text, nothing under the bottom navigation, hero
exactly 144 dp.

Above the 393 dp reference the content column caps, so the card stops widening — which is why 411, 430
and 600 dp are not independent risks.

---

## 9. Licence

Original NoorLife design assets. No third-party licence applies and no attribution is required. See
`docs/THIRD_PARTY_LICENCES.md` for dependencies that do carry notice obligations.
