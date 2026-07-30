# Phase 4A — Mismatch audit, Faith and Health

Written **before** implementation, from the approved references at
`design-reference/individual-core-screens/03-faith.png` and `04-health.png`, compared
against the emulator output of the generic framework as it stood at commit `8a60f6b`.

Scale derivation: each reference is a 512 × 1024 device mockup. Anchoring on the hero
card — which spans the content column — gives 426 px / 361 dp = **1.18 px/dp** for Faith
and 443 px / 361 dp = **1.23 px/dp** for Health, consistent with a 393 dp viewport and
16 dp page padding. All dp figures below are derived from those two scales.

---

## The core finding

The generic composition is wrong for both screens, not merely mis-tuned. It renders

> hero → 3 quick actions → "At a glance" → "Today" list → AI card → feature grid

None of the approved references contain "quick actions", "At a glance", or a generic
"Today" list. Faith has eight feature cards, a Continue-Quran card, a two-column
Ayah/Worship row, two compact date cards and an AI insight. Health has four metric
cards, two different two-column rows, a Quick Log card and an AI insight. **Section
count, order, content and card shapes all differ.** Tuning the generic layout cannot
produce either screen; each needs its own composition.

---

## Faith — section-by-section

| # | Approved reference | Current implementation | Verdict |
| --- | --- | --- | --- |
| 1 | Header: circled back, profile portrait, "Faith", circled help | Plain (uncircled) back and help icons | **Differs** — needs circular chrome |
| 2 | Hero ≈ 168 dp: illustrated mosque scene, gold corner ornament, crescent, "Next Prayer / Dhuhr / 12:35 PM", Gregorian + Hijri dates, gold "View Prayer Times" pill | 88 dp mosque *pictogram* on a flat green gradient, generic framework copy, no button | **Differs fundamentally** — artwork missing, copy wrong, no CTA |
| 3 | Eight feature cards, 2 rows × 4, card ≈ 84 × 54 dp, 9 dp gaps, ~27 dp line-art icons: Quran, Hadith, Duas, Prayer, Qibla, Tasbih, Mosques, Calendar | Six capability tiles at 74 dp height, two marked unavailable, labels Prayer/Qur'an/Today/More/Qibla/Dhikr | **Differs** — wrong count, labels, order and height |
| 4 | Continue Quran card ≈ 62 dp: book icon, title, "Surah Al-Kahf • Verse 32", progress bar, circular play button | Absent | **Missing** |
| 5 | Two-column row ≈ 118 dp: Daily Ayah (Arabic + English + reference + share) \| Today's Worship (View All + 4 status rows) | Absent; a generic "Today" activity card exists instead | **Missing** |
| 6 | Two compact cards ≈ 69 dp: Upcoming/Ramadan 1446 AH \| Islamic Calendar | Absent | **Missing** |
| 7 | Faith AI Insight ≈ 83 dp: robot PNG, title, insight, "Source: Sahih Bukhari" pill, chevron, pale green surface | Present but generic: filled action button, no source pill, no chevron | **Differs** |
| 8 | Bottom nav: Today, Quran, raised Faith AI **with "Faith AI" caption**, Worship, More | Correct five labels, but **no caption** under the centre control | **Differs** — Faith's reference shows the caption |
| — | Not in the reference | "Prayer times / Read Qur'an / Ask Faith AI" quick actions, "At a glance" summary card | **Must be removed** |

## Health — section-by-section

| # | Approved reference | Current implementation | Verdict |
| --- | --- | --- | --- |
| 1 | Header as Faith, title "Health" | Plain back and help icons | **Differs** |
| 2 | Hero ≈ 156 dp: "Today's Wellness / Wellness Score / 86 / You're building a balanced day.", white "View Insights" pill, ~88 dp circular score ring with heart-ECG centre, illustrated lake/trees/runner/rising-chart scene | 88 dp heart pictogram on a flat blue gradient, generic copy, no ring, no button | **Differs fundamentally** — artwork missing, no ring, no CTA |
| 3 | Four metric cards ≈ 84 × 42 dp, icon left + value/label stacked right: 7,542 Steps · 7h 15m Sleep · 6 cups Water · Good Mood | Two-metric "At a glance" card with trend sentences | **Differs** — wrong count, shape and content |
| 4 | Two-column ≈ 110 dp: Medication Reminder (Vitamin D, 8:00 AM pill, Taken pill) \| Today's Focus (Mindful Breathing, 20-minute Walk, chevrons) | Absent | **Missing** |
| 5 | Two-column ≈ 108 dp: Weekly Trend (sentence + 7-point line chart, Mon–Sun) \| Recent Activity (View All + 3 rows with times) | Absent | **Missing** |
| 6 | Quick Log card ≈ 82 dp: title + four bordered mini-cards ≈ 49 dp: Water, Mood, Medication, Weight | Absent | **Missing** |
| 7 | Health AI Insight: robot in a blue rounded square, title, insight, "This is general information, not medical advice.", ⓘ control, pale blue surface + blue border | Present but generic: warning-toned banner, filled button, no ⓘ | **Differs** |
| 8 | Bottom nav: Overview, Track, raised Health AI **with no caption**, Trends, Records | Correct five labels, no caption | **Matches** |
| — | Not in the reference | "Log entry / Trends / Ask Health AI" quick actions, "At a glance", generic Today list | **Must be removed** |

---

## Cross-cutting differences

1. **Card metrics.** The references use a shorter, denser card than the framework's
   defaults: feature cards 54 dp (not 74), metric cards 42 dp, section gaps ≈ 10 dp
   (not 18). The framework's `sectionGap: 18` inflates every screen.
2. **Centre-caption is per module, not global.** Faith shows "Faith AI"; Health shows
   nothing. The framework assumed no caption everywhere, following locked Main Home.
3. **Header chrome.** Both references circle the back and help controls in a bordered
   white disc; the framework renders bare glyphs.
4. **Two-column rows are the dominant layout primitive** in both references and the
   framework has no such primitive.
5. **Live data graphics.** Health needs a progress ring and a 7-point line chart; Faith
   needs a progress bar. None exist yet. These are data visualisations, not artwork, so
   they must be drawn in React Native.

## Missing assets — blocking full fidelity

Searched every image under `D:\ChatGPT\NoorLife` (12 directories, all PNG/JPG/SVG/WebP)
and every file under `assets/`. **Neither hero illustration exists as a standalone
asset.** They exist only baked into the 512 × 1024 composite mockups, where the hero
region is ~426 × 200 px — about 2.5× short of the ~1083 px needed for a 361 dp card at
3× density, so extracting them would ship a visibly soft upscale, which the pictogram
lock forbids.

| Needed | Expected path | Content |
| --- | --- | --- |
| Faith hero scene | `assets/images/modules/faith/faith-hero.png` | Mosque skyline with domes and minarets, gold corner ornament, crescent and stars, on transparent or dark-emerald ground. ~1083 × 504 px (361 × 168 dp @3×) |
| Health hero scene | `assets/images/modules/health/health-hero.png` | Lake/trees/sky landscape with a running silhouette and a rising white chart line, on transparent or blue ground. ~1083 × 468 px (361 × 156 dp @3×) |

Per the brief I will not invent a replacement. The heroes are built with a dedicated
artwork slot that renders nothing while the registry entry is `null` — the same honest
pattern already used for the absent Google "G" mark — so dropping each file in and
setting one registry value completes them without restructuring.

---

# Post-implementation: remaining visual differences

Verified against `design-reference/phase-4a-verification/faith-vs-reference.png` and
`health-vs-reference.png` — the capture beside its reference at equal screen height.

**Matching:** section count, section order, every label, card counts (Faith 8 features,
Health 4 metrics + 4 Quick Log), two-column structure, navigation labels, Faith's
"Faith AI" caption and Health's absence of one, theme colours, header layout, the live
score ring and seven-point chart.

**Remaining differences, in priority order:**

1. **Both hero illustrations are absent** — blocking, external. Nothing is invented in
   their place; the slot renders nothing while `heroArtwork` is `null`. This is the single
   largest visual difference on both screens.
2. **The AI insight's last line falls below the fold** — Faith's "Source: Sahih Bukhari"
   pill and Health's medical disclaimer. Both are reachable by a short scroll and both are
   in the accessibility label, so nothing is lost to a screen reader, but the reference
   shows them without scrolling. Five density passes recovered ~60 dp; the last ~20 dp
   would need either smaller type than is comfortable or a shorter insight string.
3. **Three strings ellipsise** where the reference fits them: Faith's "Morning Adhkar"
   (beside "Completed"), Health's "5 min • Calm your mind" and "Keep your body moving".
   All three are at the edge in the reference too; Poppins renders slightly wider here.
4. **"Ramadan 1446 AH" wraps to two lines** in Faith's compact card; the reference keeps
   it on one.
5. **Faith's feature glyphs are MaterialCommunityIcons, not the reference's line art.**
   Same subjects and colours, different drawing. There are no approved PNGs for these
   eight, and the project's single-icon-family rule points at MCI. Tasbih (prayer beads)
   is the weakest match — MCI has no beads glyph, so `circle-multiple-outline` stands in.
   Prayer and Mosques share the `mosque` glyph, differing only in colour, as the reference
   also differentiates them by treatment rather than subject.
6. **Density is marginally looser than the reference throughout** — card padding is 11 dp
   against a measured ~10, which is what item 2 accumulates from.

None of 2–6 changes what the screen says or does. Item 1 needs the two files listed above.
