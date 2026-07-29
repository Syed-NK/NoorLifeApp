# NoorLife Main Home — Implementation Lock

Status: Mandatory visual contract  
Reference viewport: 512 × 1024 presentation pixels  
React Native baseline: 393 dp wide handset  
Scaling: width-responsive, never height-stretched

## 1. Authority order

1. `00-main-home-exact-reference.png` controls composition and proportions.
2. The section crops control local alignment and card density.
3. This document controls React Native dimensions, behavior, icons, and acceptance.
4. `NOORLIFE_UI_DESIGN_SPEC.md` controls global tokens and accessibility.

Do not reinterpret the reference. Do not replace it with a generic dashboard.

## 2. Required project assets

Reference-only files:

- `00-main-home-exact-reference.png`
- `01-header-reference.png`
- `02-hero-reference.png`
- `03-module-grid-reference.png`
- `04-today-timeline-reference.png`
- `05-summary-cards-reference.png`
- `06-ai-quick-actions-reference.png`
- `07-bottom-navigation-reference.png`

Reference crops must not be embedded as complete UI screenshots. Text, cards, progress,
and controls must remain native components for accessibility and localization.

Production illustration assets required:

- `assets/noorlife/main-home-hero.webp`
  - Illustration only: robot, day-path, mosque, family, sun, lightbulb, clipboard.
  - Transparent background preferred.
  - No baked headline or button text.
  - Display box: 184 × 156 dp at 393 dp screen width.
- `assets/noorlife/robot-head.png`
  - Approved white robot head, dark face, cyan expression.
  - Transparent background.
  - Source master at least 256 × 256 px.
- `assets/noorlife/avatar-ahmed.png`
  - Square source, at least 128 × 128 px.

If these production assets are missing, keep correctly sized placeholders and report the
missing assets. Do not draw a different robot with CSS or vector primitives.

## 3. Responsive measurement model

Use a 393 dp design width.

```ts
const DESIGN_WIDTH = 393;
const scale = Math.min(screenWidth / DESIGN_WIDTH, 1.12);
const dp = (value: number) => Math.round(value * scale);
```

Do not scale typography above 1.05 from width. Respect system font scaling separately.

For screen widths from 360–430 dp:

- Horizontal page padding: 16 dp
- Usable content width: `screenWidth - 32`
- Section gap: 12 dp
- Card gap: 8 dp
- Bottom content padding: `bottomNavHeight + safeAreaBottom + 16`

## 4. Screen layout

The screen has two layers:

1. A `ScrollView` for all dashboard content.
2. A fixed bottom navigation outside the `ScrollView`.

```text
SafeArea top
Header                     52 dp
Gap                         8 dp
Hero                      174 dp
Gap                        10 dp
Module grid               158 dp
Gap                        14 dp
Today header               28 dp
Today card                136 dp
Gap                        10 dp
Summary cards              98 dp
Gap                        10 dp
AI insight                 68 dp
Gap                         8 dp
Quick actions              46 dp
Scroll bottom padding      92 dp
Fixed bottom navigation    72 dp + safe area
```

The whole dashboard may scroll. Do not enlarge components merely to fill a tall device.

## 5. Header

Dimensions:

- Container height: 52 dp
- Avatar: 34 × 34 dp
- Avatar-to-text gap: 10 dp
- Greeting: Poppins 11/15, weight 400, `#667085`
- Name: Poppins 16/21, weight 600, `#172033`
- Notification touch target: 44 × 44 dp
- Notification icon: 22 dp
- Badge: 16 × 16 dp, red `#D92D4C`
- Badge text: Poppins 9, weight 600, white

No back button on Main Home.

## 6. Hero card

Dimensions:

- Width: 100% of content width
- Height: 174 dp
- Radius: 20 dp
- Padding: 18 dp
- Gradient: `#26337D` → `#3949AB`
- Shadow: subtle; maximum opacity 0.12

Text column:

- Width: 48% of hero
- Eyebrow: 11/15, weight 500, white at 90%
- Headline: 23/28, weight 700, white
- Exact text:
  `Your life,\norganized\nwith NoorLife.`
- Maximum three lines
- No ellipsis
- Button: 112 × 36 dp
- Button radius: 10 dp
- Button background: white
- Button text: 12/16, weight 600, `#26337D`
- Star icon: 16 dp, gold `#F2B84B`

Illustration:

- Right-aligned
- Display box: 184 × 156 dp
- Bottom aligned
- `resizeMode="contain"`
- Must not overlap the headline or button
- No generic CSS-drawn robot
- Do not add statistics inside the hero

## 7. Module grid

Grid:

- Exactly four columns
- Exactly two rows
- Horizontal gap: 8 dp
- Vertical gap: 8 dp
- Tile width: `(contentWidth - 24) / 4`
- Tile height: 75 dp
- Radius: 13 dp
- Background: white
- Border: 1 dp `#E2E6EC`
- Shadow opacity: maximum 0.06

Tile content:

- Icon container: 34 × 34 dp
- Icon container radius: 9 dp
- Icon glyph: 21 dp
- Label: 10.5/14, weight 500, `#172033`
- Label maximum one line
- `adjustsFontSizeToFit` allowed down to 9.5
- Never split “Learning” across lines

## 8. Locked icon system

Use `@expo/vector-icons/MaterialCommunityIcons` for module glyphs.

| Module | Icon name | Container | Glyph |
|---|---|---|---|
| Noor AI | custom `robot-head.png` | `#F0EDFF` | approved raster |
| Faith | `mosque` | `#E9F6F1` | `#23856D` |
| Health | `heart-pulse` | `#EAF6FC` | `#4A9FD8` |
| Planner | `calendar-month` | `#EEF1FB` | `#5A72C9` |
| Finance | `currency-usd` | `#FFF3E6` | `#E38A32` |
| Learning | `school` | `#F1EDFF` | `#7657D6` |
| Family | `account-group` | `#FDECF2` | `#D95B82` |
| Goals | `target` | `#E8F7F5` | `#269B94` |

Do not mix Lucide, Ionicons, emoji, and Material icons within the module grid.

## 9. Today at a Glance

Section heading:

- Height: 28 dp
- Title: 15/20, weight 600
- View All: 11/16, weight 500, `#3157C8`

Card:

- Height: 136 dp
- Radius: 14 dp
- Padding horizontal: 14 dp
- Padding vertical: 10 dp
- Border: 1 dp `#E2E6EC`

Rows:

- Four rows
- Row height: 27 dp
- Timeline dot: 8 dp
- Timeline line: 2 dp
- Time width: 70 dp
- Time: 10.5/14, `#667085`
- Activity: 11/15, weight 500
- Trailing icon: 17 dp

Locked rows:

1. `12:35 PM` — `Dhuhr Prayer`
2. `8:00 AM` — `School drop-off`
3. `10:00 AM` — `Work focus time`
4. `5:30 PM` — `Family dinner`

## 10. Summary cards

- Two equal columns
- Gap: 8 dp
- Height: 98 dp
- Radius: 14 dp
- Padding: 12 dp

Family:

- Icon: `account-group`, 20 dp, `#D95B82`
- Title: 11/15, weight 600
- Value: 19/24, weight 600
- Progress bar: 4 dp high

Overall Progress:

- Ring: 54 × 54 dp
- Stroke: 7 dp
- Value: 22/27, weight 600
- Supporting text: 9.5/13

Titles may not truncate. If space is insufficient, reduce title size to 10 dp, not the card width.

## 11. Noor AI insight

- Height: 68 dp
- Radius: 14 dp
- Background: `#F7F5FF`
- Border: 1 dp `#DCD7FF`
- Robot asset: 50 × 50 dp
- Title: 11/15, weight 600, `#473A9E`
- Body: 10.5/14, maximum two lines
- Chevron touch target: 44 × 44 dp

Exact body:

`You have a free 30-minute window at 4 PM.`

## 12. Quick actions

- Three equal-width buttons
- Gap: 8 dp
- Height: 46 dp
- Radius: 12 dp
- White background
- Border: 1 dp `#E2E6EC`
- Icon: 18 dp
- Label: 9.5/13, weight 500

Actions:

- Add Task
- Log Wellness
- Family Check-in

## 13. Bottom navigation

Container:

- Fixed outside ScrollView
- Height excluding safe area: 72 dp
- White background
- Top border: 1 dp `#E2E6EC`
- Five equal slots
- `zIndex` above content

Normal items:

- Touch target: full slot, minimum 44 dp
- Icon: 22 dp
- Label: 9.5/13
- Active: `#3157C8`
- Inactive: `#7A8496`

Center AI:

- Circular button: 54 × 54 dp
- Raised by 17 dp
- White background
- Border: 3 dp `#3157C8`
- Robot head: 38 × 38 dp
- Label below button: `Noor AI`
- Label must not overlap neighboring labels

Locked items:

1. Home — `home-variant`
2. Modules — `view-grid-outline`
3. Noor AI — custom robot head
4. Insights — `chart-line`
5. Profile — `account-outline`

Remove development floating controls before screenshot comparison. They are not app UI.

## 14. Accessibility

- Every touch target: minimum 44 × 44 dp
- Text must support scaling to 1.3 without overlap
- Add accessibility labels to icon-only controls
- Do not rely on color alone
- Hero headline is real text, not embedded in an image
- RTL mirrors structural alignment while keeping numeric times readable

## 15. Visual acceptance tolerances

At a 393 dp-wide screenshot:

- Page padding: ±2 dp
- Card heights: ±4 dp
- Horizontal gaps: ±2 dp
- Corner radii: ±2 dp
- Font sizes: ±1 dp
- Center AI position: ±3 dp
- No text truncation
- No overlap
- No section reordering
- No extra hero metrics
- No missing sections

The implementation is rejected if:

- Hero exceeds 190 dp
- Module cards exceed 84 dp height
- Hero title truncates
- Bottom labels overlap
- Any dashboard section is omitted
- A generic robot replaces the approved asset
- A floating debug control appears in the validation screenshot

## 16. Validation procedure

1. Render Main Home on Pixel 8 emulator.
2. Set font scale to default.
3. Capture screenshot without developer overlays.
4. Compare against `00-main-home-exact-reference.png`.
5. Compare each section against its corresponding crop.
6. Report measured differences, not subjective statements.
7. Iterate only Main Home until all acceptance tolerances pass.

