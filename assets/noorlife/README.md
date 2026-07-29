# NoorLife production assets — required, not yet supplied

This directory is the **asset slot** for Main Home, per
`design-reference/implementation-pack/main-home/MAIN_HOME_IMPLEMENTATION_LOCK.md` §2.

Every file listed below is **missing**. Each slot is wired at the correct display
size in `src/features/home/components/robot-asset.tsx` and
`hero-illustration.tsx`; supplying the file and flipping the one documented
`ASSET_AVAILABLE` flag in each is the whole integration.

## Missing files

| Path | Display box | Requirements |
|---|---|---|
| `main-home-hero.webp` | **184 × 156 dp** | Illustration only: robot, day-path, mosque, family, sun, lightbulb, clipboard. Transparent background preferred. **No baked headline or button text.** `resizeMode="contain"`. Master ≥ 552 × 468 px (@3×). |
| `robot-head.png` | 50 dp (AI insight), 38 dp (nav centre), 34 dp (Noor AI tile) | Approved white robot head, dark face, cyan expression. Transparent background. Master ≥ 256 × 256 px. |
| `avatar-ahmed.png` | 34 dp | Square, ≥ 128 × 128 px. |

## Why there is no stand-in artwork

Lock §2 is explicit: *"Do not draw a different robot with CSS or vector
primitives."* An earlier implementation composed the mascot from `View`s; that has
been removed from Main Home for exactly this reason.

The reference crops in `design-reference/implementation-pack/main-home/` cannot be
used as the interface either — §2 forbids embedding them as UI, because they carry
baked-in text and would break accessibility and localisation.

That leaves no approved raster in the project. Per the asset rules the slots
therefore render the **nearest approved asset**: the `robot` glyph from
`@expo/vector-icons/MaterialCommunityIcons` — the same icon library lock §8
mandates for every other module glyph — inside a box of exactly the locked
dimensions. It is a placeholder, it is not a redrawn mascot, and it is not an
abstract AI orb.

## Also still required (outside Main Home's scope)

| Asset | Note |
|---|---|
| App icon | `assets/images/icon.png` is still the Expo template icon |
| Adaptive icon | `assets/images/android-icon-*.png` are template art; `app.json` also sets a blue `#E6F4FE` background that contradicts the neutral canvas |
| Splash | `app.json` sets `backgroundColor: "#208AEF"` — off-palette blue; should be canvas `#F7F8FA` |
| NoorLife wordmark | Needed for splash and the authentication screens |

The three native items are baked in at prebuild, so changing them requires
`npx expo prebuild` plus a dev-client rebuild, which would invalidate the
currently installed Android development build.
