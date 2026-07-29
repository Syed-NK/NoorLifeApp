# Illustration assets still required

> **Main Home does not use this directory.** Its implementation lock
> (`design-reference/implementation-pack/main-home/MAIN_HOME_IMPLEMENTATION_LOCK.md` §2)
> forbids drawing the mascot with CSS or vector primitives, so Main Home renders the
> robot through the asset slots in `src/features/home/components/robot-asset.tsx` and
> `hero-illustration.tsx`. The canonical list of assets Main Home needs is
> **`assets/noorlife/README.md`** — start there.
>
> What remains below applies to the module placeholder screens and the shared
> `StateView`, which still use the primitive-composed mascot. When the approved raster
> lands, those should migrate to the same asset slots and this directory should be
> retired.

Phase 1 ships **placeholders only**. Everything in this directory is composed from
`View`s and design tokens — no bitmap or vector asset is bundled, and nothing here
is final artwork.

The placeholders are deliberately faithful to the approved mascot (white shell,
dark visor, cyan expression). **No abstract AI orb is used anywhere and none may
be introduced.** The mascot is not a substitute for the illustrated hero art in
`design-reference/`.

## Why placeholders, not the reference PNGs

The images under `design-reference/` are composite mock boards — several phone
screens per file, at board resolution. They are design references, not
production-ready, correctly-cropped, correctly-scaled app assets. Slicing artwork
out of them would produce blurry, mis-registered output, so the illustration layer
holds a clean boundary until real assets arrive.

## Swap surface

Modules never import artwork. A `ModuleTheme` names a `heroIllustration` key and
`hero-artwork.tsx` resolves it. Replacing a placeholder means editing
`hero-artwork.tsx` only — no module configuration and no screen changes.

## 1. Robot mascot (highest priority)

| Asset | Where it is used | Requirement |
|---|---|---|
| `robot-mascot-wave.png` | Noor AI hero, onboarding, auth help | Full body, waving, transparent background, @1x/@2x/@3x, ≥ 320 px tall at @3x |
| `robot-mascot-neutral.png` | Main Home hero | Full body, neutral/presenting pose, transparent background |
| `robot-mascot-laptop.png` | Loading state (§20) | Robot at a laptop |
| `robot-mascot-box.png` | Empty state (§19) | Robot holding an empty box |
| `robot-mascot-concerned.png` | Error state (§21) | Concerned robot |
| `robot-mascot-offline.png` | No-internet state (§22) | Robot with disconnected Wi-Fi |
| `robot-mascot-shield.png` | Permission-required state (§25) | Robot with a shield |
| `robot-mascot-thumbs-up.png` | Success state (§28) | Happy robot |
| `robot-head.svg` | Every compact AI control | Head only; must tint cleanly at 20–52 px |

Constraints: white shell, dark face plate, cyan expression (`#45BFD1`), no other
hue in the mascot itself.

## 2. Hero illustrations

One per `HeroIllustrationKey`. Each must read clearly on a module
`dark`→`primary` gradient, occupy 35–45% of a ≥ 180 px-tall card, and keep
decorative elements clear of the text column (§3.3).

| Key | Subject (from the spec) |
|---|---|
| `main-day-timeline` | Robot beside a calm day timeline, subtle sun/star elements |
| `noor-ai-robot-wave` | Full robot mascot waving, soft violet field |
| `faith-mosque-geometry` | Elegant green mosque silhouette, restrained gold geometry |
| `health-pulse-landscape` | Light-blue heart/pulse or robot with a wellness dashboard |
| `planner-calendar-stack` | Layered calendar, clock and checkmarks |
| `finance-wallet-chart` | Warm wallet, coins or abstract budget chart |
| `learning-glowing-book` | Glowing open book with subtle stars |
| `family-portrait` | Warm family portrait or connected avatars |
| `goals-summit-target` | Target with a progress path and a small celebration detail |

## 3. Brand and native assets

| Asset | Note |
|---|---|
| App icon | `assets/images/icon.png` is still the Expo template icon |
| Adaptive icon | `assets/images/android-icon-*.png` are template art; `app.json` also sets a blue `#E6F4FE` background that contradicts the neutral canvas |
| Splash | `app.json` sets `backgroundColor: "#208AEF"` — off-palette blue; must become neutral canvas `#F7F8FA` |
| NoorLife wordmark | Needed for splash and auth screens (§01, `design-reference/01-*.png`) |

The three native items above are baked in at prebuild. Changing them requires
`npx expo prebuild` + a dev-client rebuild, which would invalidate the currently
installed Android development build, so they are deliberately untouched in
Phase 1.

## 4. Fonts

- **Poppins** — supplied by `@expo-google-fonts/poppins` (SIL OFL 1.1). Nothing needed.
- **Noto Sans Arabic** — boundary declared in `design-system/typography/fonts.ts`;
  asset intentionally not bundled until an Arabic UI surface exists.
- **Uthmani Quran face** — **must not be bundled without a licence.** The boundary
  (`quranFontFamily`) is `null` and any Quran surface must refuse to fall back to
  Poppins.

## 5. Deferred technical dependency

Hero gradients currently use a layered two-tone `View` (module `dark` → `primary`).
A true gradient needs `expo-linear-gradient`, which is a native module and would
require a dev-client rebuild. Recommended for Phase 2 alongside
`react-native-svg` for charts, progress arcs and real vector illustration.
