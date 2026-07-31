# Phase 5B — required asset that does not exist: the native splash emblem

Status: **blocked on a design asset.** Reported rather than substituted, as the phase brief requires.

## What was asked for

A native splash icon showing a clean NoorLife family-heart emblem, derived from the approved splash
direction, with these hard constraints:

- emblem only — no family characters, no full robot
- no wordmark inside the small native icon
- **transparent PNG**, no square background
- centred on `#FAFFFD`, roughly 120 dp wide

## What exists

Everything searched under `D:\ChatGPT\NoorLife\design`:

| Candidate | Why it does not qualify |
|---|---|
| `splash-options/generated-variants/01-luminous-family-emblem-pictograms-final.png` | The full approved splash. 852 x 1846, colour type 2 (**RGB, no alpha**), contains the wordmark and tagline. This is the React splash, not an icon. |
| `splash-options/generated-variants/01-luminous-family-emblem.png` | Also a full 852 x 1846 RGB composition with no alpha. Not a standalone emblem despite the filename. |
| `website-assets/noorlife-logo-robot-pointing-transparent.png` | Transparent, but it is the **robot** holding a logo — the exact character the brief excludes. |
| `website-assets/noorlife-robot-holding-logo*.png` | Same: robot-based. |
| `assets/images/entry-auth/splash-icon-robot.png` (in-app, previous native icon) | The robot. This is what Phase 5B was asked to remove. |

**No transparent, emblem-only asset exists anywhere in the design tree.**

## Why one was not derived

The emblem could in principle be cropped out of the approved splash, but not *cleanly*:

- The backdrop is a soft gradient carrying sparkles and two faint concentric rings, not a flat
  colour, so alpha-keying it leaves ring fragments and a visible halo.
- The emblem's own edges are deliberately translucent glass with a glow that fades into that
  backdrop. There is no hard boundary to cut along; any threshold either clips the glow or keeps a
  grey fringe.

A native splash icon is the first frame of the app, shown at 120 dp against a near-white field,
which is precisely where a fringe or halo is most visible. Shipping a rough cutout of approved
artwork would be worse than shipping none, and the brief forbids approximating it with an icon-font
or emoji.

## What was done instead

`app.json` now sets the native splash to **`backgroundColor: "#FAFFFD"` with no image at all.**

This is a deliberate interim, and it is defensible on the brief's own terms:

- It removes the robot flash and the repeated onboarding character, which was the reported defect.
- `#FAFFFD` is the exact background of both the native splash and the approved React splash, so the
  handoff has **no colour step and no identity change** — the strongest possible reading of "must
  transition without a strong colour or identity change". A blank matched field cannot clash with
  what follows.
- It invents nothing.

The cost, stated plainly: for the ~200–400 ms before the JS bundle mounts, the app shows a plain
soft-mint screen with no brand mark. That is a real regression in brand presence at cold launch
compared with an emblem, and it is why this document exists rather than the item being closed.

## What is needed to close this

One PNG, from the designer who produced the approved splash:

```
assets/images/entry-auth/splash-emblem.png
```

- the family-heart emblem alone, on **transparent** background
- no wordmark, no tagline, no characters, no robot
- square canvas, emblem centred with ~8% padding so 120 dp renders comfortably
- ideally 512 x 512 or larger

Then `app.json` becomes:

```json
["expo-splash-screen", {
  "backgroundColor": "#FAFFFD",
  "image": "./assets/images/entry-auth/splash-emblem.png",
  "imageWidth": 120
}]
```

That is the only change required; nothing in the React splash or the entry gate depends on it.
