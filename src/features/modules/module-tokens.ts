import { modulePalettes, type ModuleId } from '@ds/tokens';

/**
 * Design tokens for the core module framework.
 *
 * ── Relationship to the locked Main Home tokens ─────────────────────────────
 * Main Home is design-locked. Nothing in this file modifies it. Brand hues are
 * *read* from `modulePalettes` so a hue can still only be changed in one place,
 * and everything a module screen needs beyond that hue is defined here as a
 * module-specific token. That is the separation the phase brief asks for: extend
 * alongside the lock, never edit it to make module screens easier.
 *
 * ── Why each theme carries more than one version of its colour ──────────────
 * The brand primaries were chosen for hero gradients and tile tints, not for
 * text. Measured against white, white-on-primary fails WCAG AA (4.5:1) for five
 * of the seven modules — finance 2.64, health 2.90, goals 3.39, family 3.64,
 * planner 4.48. Shipping one `primary` for fills *and* labels would therefore
 * ship unreadable labels on most modules.
 *
 * So each theme separates the roles, and each role is a hue-preserving darkening
 * of the same brand primary (constant HSL hue and saturation, lightness reduced
 * until the requirement is met) so it still reads as the module's colour:
 *
 *   primary        the brand hue. Decorative fills and gradient ends only, and
 *                  never the sole carrier of meaning.
 *   ink            text and small icons. ≥4.5:1 on both `lightSurface` and white.
 *   fill           filled control backgrounds carrying a white label. ≥4.5:1.
 *   border         boundaries and rings. ≥3:1 on both `lightSurface` and white,
 *                  which is the non-text UI component threshold.
 *   gradientStart  hero gradient start. ≥7:1 against white, so white hero text
 *                  clears AAA at the top of the gradient and AA at the bottom.
 *   lightSurface   the module's tinted section background.
 *
 * The ratios above are asserted in `__tests__/module-tokens.test.ts`, so a future
 * colour edit fails a test rather than silently degrading contrast.
 *
 * ── Why lightSurface repeats the Main Home tile tints ───────────────────────
 * Opening Faith from Main Home should feel like the tile expanded. The tints are
 * therefore the same values as `MODULE_TILE_TINT`, restated here rather than
 * imported so the module layer does not depend on a locked Main Home file. A test
 * asserts the two agree, which turns "keep them in sync" into a build failure
 * instead of a convention.
 */

/**
 * The eight core modules. Excludes only `main`, which is locked Main Home.
 *
 * Noor AI was previously excluded as "global, not a module". That was wrong: it has its own
 * approved individual-core-screen reference, its own five-slot navigation and its own hero
 * asset, so it is a core module like the rest. Treating it as a placeholder is what left a
 * "Noor AI arrives in Phase 2" screen in the app.
 */
export type FrameworkModuleId = Exclude<ModuleId, 'main'>;

export const FRAMEWORK_MODULE_IDS: readonly FrameworkModuleId[] = [
  'noor-ai',
  'faith',
  'health',
  'planner',
  'finance',
  'learning',
  'family',
  'goals',
] as const;

export type ModuleColorTheme = {
  readonly primary: string;
  readonly ink: string;
  readonly fill: string;
  readonly border: string;
  readonly gradientStart: string;
  readonly gradientEnd: string;
  /**
   * @deprecated Use `wellSurface`. Kept as an exact alias so the four shared components that
   * already read it cannot change colour; new code must name the role it means — issue #86.
   */
  readonly lightSurface: string;
  /** Text/icon colour on `fill` and on the hero gradient. */
  readonly onFill: string;

  /* ── The surface roles — issue #86 ──────────────────────────────────────
     One owner for a module screen's colour family, so a consumer names the role it wants instead
     of choosing between two near-identical tints. Every value below is an explicit token derived
     from the locked module palette. None is sampled from artwork, and no raster asset is tinted:
     `moduleRasterIcon` is untouched by this contract and stays the only path to commissioned art.
     ───────────────────────────────────────────────────────────────────── */

  /**
   * The module page's own ground.
   *
   * Exactly the locked palette's `soft`, so adopting it recolours nothing that already used that
   * value — it renames an ambiguous field into the role it was always filling.
   */
  readonly pageSurface: string;
  /** Card and sheet ground. White, deliberately: it is the contrast headroom every card relies on. */
  readonly cardSurface: string;
  /** A nested row inside a card — one step off white, still lighter than the page. */
  readonly elevatedSurface: string;
  /** Icon wells and feature tiles. Exactly today's `lightSurface`, so those surfaces do not move. */
  readonly wellSurface: string;
  /** Card border and divider on a tinted page. Clears the non-text threshold on page *and* card. */
  readonly borderTint: string;
  /** The selected navigation slot's ground, on the neutral bar. */
  readonly navSelectedSurface: string;
};

/**
 * Derived accessible variants, one row per module.
 *
 * Measured ratios are recorded beside each value. They were computed, not
 * guessed — see the test for the assertions that keep them true.
 */
type DerivedRoles = Pick<
  ModuleColorTheme,
  'ink' | 'fill' | 'border' | 'gradientStart' | 'gradientEnd' | 'lightSurface'
>;

const DERIVED: Readonly<Record<FrameworkModuleId, DerivedRoles>> = {
  'noor-ai': {
    ink: '#6556C8', //  4.95 on surface · 5.65 on white — already AA, no darkening needed
    fill: '#6556C8', //  5.65 white-on-fill
    border: '#6556C8', //  4.95 · 5.65
    gradientStart: '#5544C2', //  7.02 on white
    gradientEnd: '#6556C8',
    lightSurface: '#F1EEFF',
  },
  faith: {
    ink: '#217E68', //  4.54 on surface · 4.94 on white
    fill: '#23856D', //  4.52 white-on-fill
    border: '#23856D', //  4.15 on surface · 4.52 on white
    gradientStart: '#1A6452', //  7.03 on white
    gradientEnd: '#23856D',
    lightSurface: '#ECF8F2',
  },
  health: {
    ink: '#2577AD', //  4.50 · 4.86
    fill: '#277CB5', //  4.53
    border: '#3896D4', //  3.00 · 3.24
    gradientStart: '#1D5D88', //  7.06
    gradientEnd: '#277CB5',
    lightSurface: '#EDF8FE',
  },
  planner: {
    ink: '#4E68C5', //  4.54 · 5.11
    fill: '#5971C9', //  4.54
    border: '#5A72C9', //  3.98 · 4.48
    gradientStart: '#3952AE', //  7.02
    gradientEnd: '#5971C9',
    lightSurface: '#F1F0FF',
  },
  finance: {
    ink: '#A85F17', //  4.51 · 4.87
    fill: '#B06318', //  4.52
    border: '#D3781D', //  3.01 · 3.24
    gradientStart: '#844B12', //  7.01
    gradientEnd: '#B06318',
    lightSurface: '#FFF5E8',
  },
  learning: {
    ink: '#7657D6', //  4.53 · 5.12 — the one primary already AA as text
    fill: '#7657D6', //  5.12
    border: '#7657D6', //  4.53 · 5.12
    gradientStart: '#5E3ACF', //  7.04
    gradientEnd: '#7657D6',
    lightSurface: '#F3EFFF',
  },
  family: {
    ink: '#CE3061', //  4.51 · 4.98
    fill: '#D23E6C', //  4.52
    border: '#D95B82', //  3.30 · 3.64
    gradientStart: '#A5264D', //  7.04
    gradientEnd: '#D23E6C',
    lightSurface: '#FFF0F4',
  },
  goals: {
    ink: '#1F7E78', //  4.51 · 4.87
    fill: '#20847E', //  4.50
    border: '#269B94', //  3.14 · 3.39
    gradientStart: '#18635F', //  7.03
    gradientEnd: '#20847E',
    lightSurface: '#ECF9F7',
  },
};

/**
 * The surface roles, one row per module — issue #86.
 *
 * ── Where each value comes from ────────────────────────────────────────────
 * `pageSurface` is the locked palette's `soft`, unchanged. `wellSurface` is the `lightSurface`
 * this file already derived, unchanged. Those two carry every colour that renders today, which is
 * why adopting this contract moves no pixel: it gives two existing values their real names.
 *
 * The other three are new, and are stated here as explicit tokens rather than computed at runtime
 * — a colour that is derived on each render cannot be reviewed, and the measured ratios beside each
 * value are the review. They were produced by mixing locked palette values toward white or black in
 * fixed steps and then recorded; nothing is sampled from an image.
 *
 * ── The ladder ─────────────────────────────────────────────────────────────
 * `cardSurface` (white) → `elevatedSurface` → `wellSurface` → `pageSurface`, lightest to deepest.
 * A card sits above its page, a nested row sits just off white, and a well reads as inset without
 * competing with the page it sits on.
 *
 * `navSelectedSurface` is *lighter* than `pageSurface`, not deeper, and that is deliberate: it sits
 * on the neutral navigation bar and has to carry `ink` at AA. Several modules' `ink` clears 4.5:1
 * on `pageSurface` by only a few hundredths, so a deeper selected slot would have pushed the
 * selected label under the bar it is meant to clear.
 *
 * Ratios recorded per row: `ink` on the surface, then `textPrimary` on it. `borderTint` records
 * its separation from `pageSurface` and from `cardSurface`, both against the 3:1 non-text bar.
 */
const SURFACES: Readonly<
  Record<
    FrameworkModuleId,
    Pick<ModuleColorTheme, 'pageSurface' | 'elevatedSurface' | 'borderTint' | 'navSelectedSurface'>
  >
> = {
  'noor-ai': {
    pageSurface: modulePalettes['noor-ai'].soft,
    elevatedSurface: '#F8F7FF', //  5.31 · 13.41
    borderTint: '#6556C8', //  4.91 on page · 5.65 on card
    navSelectedSurface: '#F5F2FF', //  5.12 · 12.92
  },
  faith: {
    pageSurface: modulePalettes.faith.soft,
    elevatedSurface: '#F6FCF9', //  4.76 · 13.73
    borderTint: '#23856D', //  4.07 · 4.52
    navSelectedSurface: '#F0F9F5', //  4.61 · 13.30
  },
  health: {
    pageSurface: modulePalettes.health.soft,
    elevatedSurface: '#F6FCFF', //  4.70 · 13.78
    borderTint: '#4492C7', //  3.09 · 3.40 — darker than `border`, which clears 3:1 only on white
    navSelectedSurface: '#F0F9FD', //  4.55 · 13.36
  },
  planner: {
    pageSurface: modulePalettes.planner.soft,
    elevatedSurface: '#F8F8FF', //  4.83 · 13.49
    borderTint: '#5A72C9', //  3.97 · 4.48
    navSelectedSurface: '#F3F5FC', //  4.69 · 13.09
  },
  finance: {
    pageSurface: modulePalettes.finance.soft,
    elevatedSurface: '#FFFAF4', //  4.69 · 13.74
    borderTint: '#C8792C', //  3.09 · 3.37 — darker than `border` for the same reason as Health
    navSelectedSurface: '#FFF7EE', //  4.59 · 13.44
  },
  learning: {
    pageSurface: modulePalettes.learning.soft,
    elevatedSurface: '#F9F7FF', //  4.82 · 13.43
    borderTint: '#7657D6', //  4.46 · 5.12
    navSelectedSurface: '#F5F2FF', //  4.64 · 12.92
  },
  family: {
    pageSurface: modulePalettes.family.soft,
    elevatedSurface: '#FFF8FA', //  4.75 · 13.63
    borderTint: '#D95B82', //  3.20 · 3.64
    navSelectedSurface: '#FEF2F6', //  4.56 · 13.07
  },
  goals: {
    pageSurface: modulePalettes.goals.soft,
    elevatedSurface: '#F6FCFB', //  4.69 · 13.74
    borderTint: '#269B94', //  3.07 · 3.39
    navSelectedSurface: '#EFF9F8', //  4.54 · 13.30
  },
};

/** Card and sheet ground. One value for every module — the contrast headroom cards depend on. */
const CARD_SURFACE = '#FFFFFF';

/** Builds one module's full colour theme from the locked palette and the rows above. */
function themeFor(moduleId: FrameworkModuleId): ModuleColorTheme {
  const derived = DERIVED[moduleId];
  return {
    primary: modulePalettes[moduleId].primary,
    onFill: '#FFFFFF',
    ...derived,
    ...SURFACES[moduleId],
    cardSurface: CARD_SURFACE,
    /* The same value the wells already render. `lightSurface` stays as its deprecated alias. */
    wellSurface: derived.lightSurface,
  };
}

/** The seven module colour themes. Brand hue from the locked palette, roles derived here. */
export const moduleColorThemes: Readonly<Record<FrameworkModuleId, ModuleColorTheme>> =
  Object.fromEntries(FRAMEWORK_MODULE_IDS.map((id) => [id, themeFor(id)])) as Readonly<
    Record<FrameworkModuleId, ModuleColorTheme>
  >;

/**
 * Neutrals shared by every module screen.
 *
 * Deliberately a small set. A module screen gets its identity from one accent
 * colour against these neutrals, not from a second palette.
 */
export const moduleNeutrals = {
  /** Page background behind all module content. */
  pageBackground: '#F7F9FC',
  /** Card and sheet background. */
  surface: '#FFFFFF',
  /** A second surface for nested rows inside a card. */
  surfaceMuted: '#F4F6FA',
  /** Primary text. 13.1:1 on every module light surface. */
  textPrimary: '#14265F',
  /** Supporting text. ≥4.7:1 on every module light surface and on white. */
  textSecondary: '#5A6B8C',
  /** Lowest-emphasis text. Metadata only, never the sole label. */
  textTertiary: '#78849E',
  /** Hairline between rows. */
  divider: '#E6EAF2',
  /** Card and input border. */
  border: '#DCE2EC',
  /** Bottom-navigation bar. */
  navBackground: '#FFFFFF',
  /**
   * Inactive navigation label and icon — raised to clear AA in issue #88.
   *
   * Was `#6B7896`, measured 4.4191:1 on `navBackground`. #86 recorded that shortfall and pinned it
   * rather than moving it, because it preserved every rendered colour. This is the decision it was
   * waiting for.
   *
   * The value is `textSecondary`'s own hex, deliberately: this is secondary text on a light ground,
   * so the palette already had the right colour and no new one was introduced. Measured with
   * `contrastRatio`, unrounded:
   *
   *     on navBackground #FFFFFF            5.3619   (AA text 4.5)
   *     worst navSelectedSurface #FFF7EE     4.8583   (headroom for #91's opt-in)
   *
   * ── Why darkening the inactive label does not flatten the selected state ───
   * #88's stated risk is that too dark an inactive label stops the selected one reading as
   * selected. Measured, lightness was never carrying that distinction. Against the eight module
   * inks the old value separated by only 1.0998–1.2780:1, and the new one by 1.0480–1.1032:1 —
   * both far under the 3:1 that makes a lightness difference legible at all. On the Health bar the
   * old separation was already 1.0998.
   *
   * What actually carries selection is unchanged by this token: the 2.5 dp marker in
   * `theme.ink` above the selected slot, the hue shift from neutral to the module's own, Finance's
   * tinted `navSelectedSurface` ground, and `accessibilityState.selected`. Every one of those
   * clears its own threshold — see `nav-inactive-contrast.test.tsx`, which measures them off the
   * rendered tree rather than off this file.
   *
   * Main Home's bar does **not** read this token. It has its own, `navigationColors.inactive`
   * `navigationColors.inactive`, which issue #171 corrected separately from `#7A8496` (3.7713:1)
   * to `#667085` (4.9748:1), amending §3.2 and the Main Home lock with it.
   */
  navInactive: '#5A6B8C',
  /** Skeleton base and its highlight. */
  skeleton: '#E8ECF3',
  skeletonHighlight: '#F2F5F9',
  /** Status tones, shared with the entry/auth layer's semantics. */
  success: '#1B8A5A',
  warning: '#B26A00',
  error: '#C4314B',
  info: '#2563EB',
  /** Very light tints behind the status tones. */
  successSurface: '#EAF7F0',
  warningSurface: '#FFF6E6',
  errorSurface: '#FDEDEF',
  infoSurface: '#EDF3FF',
} as const;

/**
 * A locked hex colour at a stated opacity.
 *
 * Introduces no hue: the input must be a value from the locked palette, and the output is that
 * value made translucent. This is the same device `onHeroColors` uses for its white steps, lifted
 * to a helper because the reader's dock needs three steps of one hue rather than one.
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const channel = (at: number): number => Number.parseInt(value.slice(at, at + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`;
}

/**
 * The opaque colour a translucent locked hue resolves to over a known ground.
 *
 * Contrast is a property of what the eye receives, not of what the style sheet says, so a
 * translucent surface can only be measured once it is flattened. Exported so the contrast
 * assertions run against the same arithmetic the compositor performs rather than a second guess
 * at it.
 */
export function flattenAlpha(hex: string, alpha: number, over: string): string {
  const parse = (input: string): readonly number[] => {
    const value = input.replace('#', '');
    return [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  };
  const top = parse(hex);
  const ground = parse(over);
  const mixed = top.map((channel, index) =>
    Math.round(channel * alpha + (ground[index] ?? 0) * (1 - alpha)),
  );
  return `#${mixed
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/**
 * The Qur'an reader's docked player — a pale gold ground, from the locked Faith supporting hue.
 *
 * ── Why gold, and why this pale ───────────────────────────────────────────────
 * The approved reader mockup draws the player as a warm panel that separates it from both the ivory
 * reading column above and the white navigation bar below. `modulePalettes.faith.supporting` is
 * NoorLife's own gold and the only one the locked palette carries, so the panel is that value at
 * three opacities rather than a new hue invented at the call site.
 *
 * The 15% step is not a matter of taste. Every step darker measurably costs text contrast on the
 * panel: at 22% the supporting-text grey drops under 4.5:1 against it, and at 25% the module ink
 * does too. 15% keeps both text roles above AA — asserted in `quran-audio-player.test.tsx` — while
 * still reading as gold rather than as another grey.
 *
 * ── Why these are flattened rather than left translucent ────────────────────
 * They were `rgba(...)` at first, which is the ordinary way to express "this hue at 15%" and was
 * wrong here for a reason only a device shows. The panel carries `shadowRaised`, which on Android
 * is an `elevation`, and an elevated view with a **translucent** background lets its own drop
 * shadow show through from underneath: the shadow is densest at the edges, so the panel rendered
 * with a grey vignette around its padding and a visibly lighter rectangle in the middle. Caught on
 * the emulator, not in Jest — no test can see a compositing artifact.
 *
 * Flattening the three values against the ground each actually sits on produces the identical
 * colour with no second layer to composite. It also makes the contrast assertions exact rather than
 * approximate: what the test measures is now literally the value that ships.
 */
export const readerDockColors = {
  /**
   * The panel itself — the specified `#FFF2D4`.
   *
   * ── Why this is now a literal rather than a derivation ──────────────────────
   * It used to be Faith's supporting gold at 15% flattened over the page background, which landed
   * near this value by construction. The correction brief specifies the audio player's ground
   * exactly, so the exact value is what ships: a derivation that merely *approximates* a specified
   * colour is a value nobody can check against the specification.
   */
  surface: '#FFF2D4',
  /** Its edge. Decorative — the controls inside carry their own contrast. */
  border: flattenAlpha(modulePalettes.faith.supporting, 0.75, '#FFF2D4'),
  /**
   * The unplayed part of the seek bar — flattened over the **panel**, not the page, because that is
   * what it lies on.
   */
  track: flattenAlpha(modulePalettes.faith.supporting, 0.4, '#FFF2D4'),
  /**
   * The emerald the player's transport glyphs and seek bar are drawn in.
   *
   * ── What this is and is not fixing ──────────────────────────────────────────
   * Stated precisely, because the easy version of this comment would be wrong. These elements are
   * non-text UI, so their threshold is 3:1, and `faith.ink` (#217E68) clears it on this panel at
   * **4.45:1** — as it did on the panel's previous value (#F2EDE2, 4.23:1). Nothing was failing,
   * and switching to the specified `#FFF2D4` did not make anything worse.
   *
   * What it does buy is headroom. 4.45 is comfortably over 3:1 and comfortably *under* the 4.5:1
   * a text label would need, so the transport sat one design change away from a violation: the
   * moment any of these controls gained a visible label — a speed readout, a reciter name beside
   * the glyph — the colour would have had to change anyway, and colours that change late get
   * changed at the call site. `gradientStart` measures **6.33:1** here, which clears both
   * thresholds, so the same value works whether an element is a glyph or a label.
   *
   * No new hue: this is Faith's own `gradientStart` from the locked palette, already asserted at
   * 7.03:1 on white.
   */
  accent: DERIVED.faith.gradientStart,
} as const;

/**
 * The Qur'an reader's page — the specified `#FDFAF5`.
 *
 * ── Why the reader alone leaves the shared page background ──────────────────
 * Every other module screen sits on `moduleNeutrals.pageBackground` (#F7F9FC), a cool near-white
 * chosen for cards and data. The reader is not a screen of cards; it is a reading column, and a
 * long passage of scripture on a blue-grey ground reads colder and more clinical than the ivory
 * the correction brief specifies. This is the one surface where the difference is worth a second
 * value.
 *
 * Measured against it, `textPrimary` reaches 13.70:1, `textSecondary` 5.15:1 and `faith.ink`
 * 4.75:1 — all above AA, so the reader's existing text roles need no adjustment to sit on it.
 */
export const readerPageBackground = '#FDFAF5';

/**
 * The Tasbih screen's ground, matched to the stage photographs.
 *
 * ── Why this is not `readerPageBackground` ──────────────────────────────────
 * The six V4 stage plates are photographs on a warm studio ivory. Measured at their four corners,
 * all six sit within a few units of **#F6ECE4** — walnut #F6EEE5, green jade #F6EDE4, black onyx
 * #F5EBE3, white jade #F6ECE4, sandalwood #F6EDE5, figured brown #F6ECE4. The reader's ivory is
 * #FDFAF5, which is lighter and cooler, so the plate drew a visible rectangle on the page: a hard
 * seam exactly where the artwork was supposed to blend into the screen.
 *
 * Setting the screen's own ground to the photographs' ivory removes the join without touching the
 * image — no crop, no fade mask, no scrim over the beads. The plates agree closely enough that one
 * shared value serves all six; a per-material ground would make the page flicker on every swatch.
 *
 * Local to Tasbih. `moduleNeutrals.pageBackground` is untouched, as is the reader's.
 *
 * Measured on it: `textPrimary` 12.25:1 and `textSecondary` 4.61:1, both over the 4.5:1 AA bar, and
 * `faith.ink` 4.25:1 against the 3:1 non-text bar. White cards separate from it at 1.16:1, which is
 * what keeps the two control cards reading as raised surfaces.
 */
export const tasbihStageSurface = '#F6ECE4';

/**
 * The reader's scripture surface **before** the correction, kept so the change is checkable.
 *
 * This is `moduleColorThemes.faith.lightSurface` — the palest Faith green, and what the reciting
 * ayah used to be washed with. It was rejected as too pale to read as a state at all: on a page of
 * ivory it is a two-percent shift in luminance, which a reader following a recitation cannot find.
 * It is named rather than described so `PREVIOUS_ACTIVE_AYAH_SURFACE` can be measured against
 * `readerAyahColors.active` in a test, the same device `PREVIOUS_SCRIPTURE_FONT_SIZE` uses.
 */
export const PREVIOUS_ACTIVE_AYAH_SURFACE = DERIVED.faith.lightSurface;

/**
 * The three states one ayah can be in inside the reader, as three fills and nothing else.
 *
 * ── Why these are fills and never rules, rails or markers ───────────────────
 * The reciting ayah used to carry a 3 dp dark-green bar down its leading edge on top of the wash,
 * and the deep-linked ayah carried another one around the whole verse. Two vertical marks in the
 * same column, in the same hue, meaning two different things — and neither of them survives the
 * correction. A state on a page of scripture is a *ground*, because the one thing that must not
 * change is the scripture: no border, no marker, no progress stripe and no decorative rail, so the
 * Arabic keeps its own colour, its own size and its own measured contrast in every state.
 *
 * ── Why three, and why they must not be merged ──────────────────────────────
 * They answer three different questions and the user can act on each differently:
 *
 *   active    the ayah being recited **right now**. The darkest of the three, because it is the one
 *             a listener is tracking across a moving page.
 *   focused   the ayah the player is *pointed at* — idle, paused, or stepped to. Visibly a state,
 *             deliberately weaker than `active`: a paused player that kept the recitation's own
 *             ground would be claiming audio is playing when none is.
 *   selected  the ayah whose action sheet is open. Faith's supporting **gold**, not its green, so
 *             "the one I picked" can never be mistaken for "the one being recited" — and so the
 *             chosen verse is still identifiable through the sheet's dimming scrim.
 *
 * ── Measured, not chosen by eye ─────────────────────────────────────────────
 * Every value below carries `moduleNeutrals.textPrimary` scripture on it, and each ratio is
 * asserted in `quran-reader-actions.test.tsx` rather than recorded here on trust:
 *
 *   active   #D7EEE3 — 11.7:1   (requirement: ≥7:1)
 *   focused  #EAF6F0 — 12.9:1
 *   selected #F7EAD1 — 12.0:1
 */
export const readerAyahColors = {
  /** The ayah being recited. Emerald, and the darkest of the three. */
  active: '#D7EEE3',
  /** The ayah the player is pointed at while idle or paused. */
  focused: '#EAF6F0',
  /** The ayah whose action sheet is open — Faith's supporting gold, not its green. */
  selected: '#F7EAD1',
} as const;

/** Type ramp for module screens. `[fontSize, lineHeight]` at the 393 dp baseline. */
export const moduleType = {
  /** Module header title. */
  headerTitle: [17, 24],
  /** Hero headline inside the hero card. */
  heroTitle: [19, 26],
  /**
   * The hero display figure — Faith's prayer name and time, Health's score.
   *
   * Measured at ~30 dp on the Faith reference. Line height is deliberately tight (1.13)
   * because Faith stacks two of these lines and the reference shows them close-set.
   */
  heroDisplay: [24, 28],
  /**
   * Faith's combined prayer and time line, e.g. "Dhuhr 12:35 PM".
   *
   * 20 dp. It was 24 while the copy was centred across the full 361 dp card; the left-copy
   * hero gives it a 199 dp column instead, where 24 dp measured ~158 dp and left too little
   * margin once Android's font scale applied. At 20 dp the string measures ~132 dp and holds
   * one line with room to spare, which is the requirement — and 20 dp remains comfortably
   * above the accessible floor for a display line.
   */
  faithPrayer: [20, 25],
  /** Health's wellness score, larger again at ~40 dp in its reference. */
  heroScore: [30, 34],
  /** Hero supporting line. */
  heroBody: [12.5, 18],
  /** Hero eyebrow / module name above the headline. */
  eyebrow: [11, 15],
  /** Section heading. */
  sectionTitle: [14, 20],
  /** Section trailing action ("See all"). */
  sectionAction: [12, 17],
  /**
   * Heading inside a half-width card, e.g. "Today's Worship".
   *
   * Smaller than `sectionTitle`: measured ~13 dp on the reference, and at the full 14 dp
   * "Today's Worship" plus its "View All" link cannot fit a 176 dp column — it truncated to
   * "Today's Wor…" on the first build.
   */
  cardHeading: [12, 17],
  /** The trailing link beside a `cardHeading`. ~11.5 dp on the reference. */
  cardAction: [10.5, 14],
  /** A list row's label inside a half-width card. ~11.5 dp measured. */
  rowLabel: [11, 15],
  /** A list row's trailing value or time. ~10.5 dp measured. */
  rowMeta: [9.5, 13],
  /**
   * A metric card's figure, e.g. "7,542".
   *
   * Its own token because a quarter-width card leaves ~45 dp for text: at the shared
   * 13.5 dp card title every one of Health's four metrics truncated ("7,5…", "Go…").
   */
  metricValue: [12.5, 16],
  /** Chart axis ticks. A seventh of a half-width card is ~18 dp, so these must be small. */
  chartAxis: [9.5, 13],
  /** Card title. */
  cardTitle: [13.5, 19],
  /** Card body and list rows. */
  body: [12.5, 18],
  /** Metadata, timestamps, units. */
  caption: [11, 15],
  /**
   * Qur'anic Arabic.
   *
   * Larger than body text and with a much taller line height: harakat sit above and
   * below the baseline, and a 1.3 ratio clips them. Measured ~18 dp on the reference.
   */
  arabic: [18, 32],
  /** A large metric inside a summary card. */
  metric: [22, 27],
  /** Metric unit suffix. */
  metricUnit: [11, 15],
  /** Feature-grid tile label. */
  tileLabel: [11, 15],
  /** Quick-action label. */
  quickAction: [11, 15],
  /** Bottom-navigation label. */
  navLabel: [9.5, 13],
  /** Button label. */
  button: [13.5, 18],
  /** State-screen title (empty, error, offline, permission). */
  stateTitle: [15, 21],
  /** State-screen body. */
  stateBody: [12.5, 18],
  /** Status-banner message. */
  banner: [12, 17],
  /**
   * The AI Insight card's title and body.
   *
   * Main Home's `aiTitle` / `aiBody` values exactly — restated here so the module layer
   * does not import a locked file, and asserted equal by
   * `design-system/components/__tests__/ai-insight-geometry.test.ts`. They are smaller
   * than `cardTitle` / `body` on purpose: the card's height is fixed at 68 dp and this
   * ramp is what makes a title plus two body lines fit inside it.
   */
  aiInsightTitle: [10.5, 14],
  aiInsightBody: [10, 13],
} as const;

export type ModuleTypeToken = keyof typeof moduleType;

/**
 * Module layout contract, in dp at the 393 dp baseline.
 *
 * Values echo Main Home's proportions — 16 dp page padding, a 68 dp navigation
 * bar, a raised 58 dp centre AI button — because a module must feel like the same
 * app. They are restated here rather than imported so tuning a module screen can
 * never reach into the locked contract.
 */
export const moduleLayout = {
  referenceWidth: 393,
  pagePadding: 16,
  /**
   * Vertical gap between stacked sections.
   *
   * 7 dp. It was 18 while the framework had one generic composition, then 8 once the
   * approved compositions landed, and 7 after Faith Home was measured on a Pixel 8 and
   * found to overflow by 10.9 dp. Density is not decoration here — it is what makes the
   * approved screens fit without scrolling, and the alternative was dropping content the
   * reference shows.
   *
   * (The comment here previously claimed 10, which never matched the value. Corrected.)
   */
  sectionGap: 7,
  /** Gap between a section heading and its content. */
  headingGap: 10,
  /** Gap between cards within a section. */
  cardGap: 10,
  /** Module header. */
  headerHeight: 54,
  /** Back and Help glyph. 19 dp, mid of the specified 18-20 band. */
  headerIcon: 19,
  /** Profile portrait (brief: 34-36 dp). Its touch target is the full 44 dp. */
  headerAvatar: 35,
  /** Gap between Help and Profile (brief: 4-8 dp). */
  headerControlGap: 6,
  /** Hero card. */
  heroMinHeight: 132,
  heroPadding: 14,
  /**
   * The hero pictogram's box, in dp.
   *
   * 88 sits in the specified 78–92 dp band, near the top of it deliberately: the
   * canonical normalized PNGs carry a 37 px transparent margin and fill 71.1% of their
   * canvas, so an 88 dp box renders about 63 dp of visible artwork. Compensating once
   * here is the alternative to per-module scale tweaks, which the brief caps at ±4% and
   * which would not be needed anyway — all eight assets measure at identical occupancy.
   */
  heroArtSize: 88,
  /**
   * Share of the card width given to the hero copy — **Noor AI's hero only**.
   *
   * 0.52, matching the quiet band the locked artwork leaves on the copy side. It was 0.62
   * while the hero was a flat gradient with a pictogram, and at that width Finance's body
   * copy ran straight over the wallet. The brief is explicit that copy must not cover the
   * main artwork, and the artwork decides where the room is.
   *
   * Noor AI draws its own hero, with the copy on the *right* beside the robot, so its column is
   * measured against a different asset and a different subject position. The shared module-home
   * card reads `heroCopyColumnRatio` below; this value stays 0.52 so that widening the shared card
   * cannot move Noor AI, and `hero-copy-fit.test.ts` asserts both halves of that.
   */
  heroTextColumnRatio: 0.52,
  /**
   * Share of the card width given to the copy in the **shared** module-home hero.
   *
   * ── Why this is 0.545 and not 0.52 ───────────────────────────────────────
   * Issue #50, final refinement. At 0.52 the copy column is 155.0 dp at 384 dp and 159.7 dp at the
   * reference width, and "manageable" is 158.7 dp on its own at the `heroDisplay` token — so
   * Planner's headline could not be laid out beside its artwork on an ordinary phone at the default
   * text size, and the responsive rule correctly gave it the whole card. Correct, and still the
   * wrong outcome: one of eight modules then lost its locked artwork permanently.
   *
   * 0.545 is the smallest ratio that gives that word measured room at both ordinary widths while
   * leaving every other required outcome intact — the copy still takes the whole card at 320 dp and
   * at every text size above 1.0, where it genuinely does not fit. Derived rather than chosen: see
   * `heroCopyColumnHeadroom` in `hero-copy-fit.ts` for the window this sits in, and
   * `hero-copy-fit.test.ts` for the boundary cases that pin it.
   *
   * The copy's right edge moves from 0.480 to 0.505 of the card width, which stays well inside the
   * scrim ramp — `ModuleHeroArtwork` holds its strength to 0.396 and reaches zero at 0.720 — and was
   * confirmed against artwork bounds on both Android targets.
   */
  heroCopyColumnRatio: 0.545,
  /** Cards. */
  cardPadding: 11,
  /** Padding inside a half-width card, where every dp of inner width counts. */
  twoColumnPadding: 10,
  cardRadius: 16,
  radiusSmall: 10,
  radiusPill: 999,
  /** Feature grid — four columns matching Main Home's module grid rhythm. */
  featureColumns: 4,
  featureGap: 9,
  featureTileHeight: 74,
  featurePictogram: 40,
  /** Quick actions row. */
  quickActionHeight: 62,
  quickActionIcon: 22,
  /** Bottom navigation. */
  navHeight: 68,
  navIcon: 24,
  navAIButton: 58,
  /**
   * The Noor AI mark inside the raised control.
   *
   * 53 dp fills the 54 dp inner circle (58 outer, 2 dp ring each side) without clipping, so
   * the mark reads as large as it can. The brief asks for 76-82% of the inner diameter; note
   * the normalized asset carries ~29% transparent margin, so the *visible* robot lands nearer
   * 70% of the inner circle. Closing that gap would need the tighter-cropped original, which
   * would break the "same asset as Main Home" requirement — so the asset wins.
   */
  navAIImage: 53,
  navAIRaise: 15,
  /**
   * ── Metrics derived from the approved individual-core-screen references ────
   *
   * Every value below was measured off `design-reference/individual-core-screens/`
   * (Faith at 1.18 px/dp, Health at 1.23 px/dp — see docs/PHASE_4A_MISMATCH_AUDIT.md).
   * They are grouped and named after what they measure so a future screen cannot reach
   * for "roughly the card size" and drift.
   */
  /** Header back/help control: a bordered white disc, as both references draw it. */
  headerControl: 36,
  /**
   * Hero height, shared by every module.
   *
   * 132 dp, and not a matter of taste: the locked hero PNGs are 1083 x 396 px, which at 3x
   * is 361 x 132 dp — exactly the module content column. At this height each asset renders
   * one-to-one, so `cover` neither crops nor stretches it.
   *
   * This supersedes the per-screen heights measured off the individual-core-screen mockups
   * (Faith ~168, Health ~156). Those mockups pre-date the locked artwork, and honouring them
   * would force `cover` to scale by height and crop 27-49 dp off each side — which on Faith
   * removes the flanking minarets and on Health the trees. Given a locked canvas cut to the
   * content column, showing all of the artwork is the faithful reading.
   *
   * The consequence, stated plainly: hero type is smaller than in those mockups, because a
   * 132 dp box holds less. See docs/PHASE_4A_MISMATCH_AUDIT.md.
   */
  heroHeight: 132,
  /** Vertical padding inside the hero copy group, so a button never touches the card edge. */
  heroCopyPaddingV: 12,
  /** Hero call-to-action height (brief: 34-38 dp). */
  heroButtonHeight: 34,
  /**
   * Faith's hero height — 144, taller than the shared 132.
   *
   * ── Why Faith alone is taller ───────────────────────────────────────────
   * Faith stacks five elements where every other hero stacks three: eyebrow, prayer
   * line, two date lines, and a button. Measured, that column needs 142 dp. At the
   * shared 132 it overflowed by 14 and the button clipped — which is the clipping the
   * correction brief forbids, and the brief is equally explicit that content must not be
   * dropped to make it fit. Raising the box is the only remaining lever.
   *
   * The cost, stated plainly: `03-faith-hero-left-copy-v2.png` is 2105 x 747, which at
   * the 361 dp content width is 128 dp tall. Covering a 144 dp box therefore scales by
   * height and crops ~22 dp from each side — 5.5%. On this asset that removes empty green
   * on the left and the outermost palm fronds on the right; the dome, the minaret and the
   * lanterns all sit well inside. Verified on device.
   */
  faithHeroHeight: 144,
  /** Faith hero spacing, all explicit per the correction brief. */
  faithHeroPaddingTop: 12,
  faithHeroPaddingBottom: 11,
  /** Clear air between "Next Prayer" and the prayer line. */
  faithHeroEyebrowGap: 4,
  faithHeroDateGap: 6,
  /** Clear air before the action, so the button never touches the prayer text. */
  faithHeroButtonGap: 9,
  /**
   * The Noor AI composer's input, and therefore the visible field's height.
   *
   * This is the **`TextInput`'s** minimum height, not the wrapper's, and that distinction is the
   * whole point of the token. The wrapper used to carry an 84 dp `minHeight` while the input sat at
   * its natural single-line height inside it, so roughly the lower two thirds of a box that looked
   * like a text field did not respond to a tap — found on the API 36 emulator during AI-5's
   * verification pass, where a tap at the bottom of the field left it unfocused.
   *
   * The input now carries the height and its own padding, so it fills the field to the border and
   * every part of the visible box is the input. It is a floor, never a fixed height: a long question
   * still grows the input and the field rather than scrolling or clipping inside them.
   *
   * 82 + the wrapper's 1 dp border top and bottom = the 84 dp field the reference draws.
   */
  noorAIComposerInputHeight: 82,
  /**
   * Faith's eight approved submenu tiles: 4 columns, 9 dp gaps.
   *
   * 74 dp tall with a 40 dp image box. The previous 48/27 pair drew a small glyph in a
   * short tile and left the large unused band the correction brief calls out; at 40 dp the
   * pictogram is big enough to read as artwork, and 74 dp leaves 3 dp of gap plus a 15 dp
   * label line beneath it without wrapping. Both clear the 44 dp touch minimum.
   */
  faithSubmenuTileHeight: 74,
  faithSubmenuImage: 40,
  /**
   * The pictogram a Faith child screen repeats from the tile that opened it.
   *
   * 56 dp, mid-band of the specified 48–64, and identical on all eight children: they are
   * seen in sequence, so a per-screen size would read as a hierarchy that does not exist.
   */
  faithIdentityImage: 56,
  /** The Continue-Quran card's identity pictogram. */
  faithContinueImage: 42,
  /** The supporting date cards' identity pictogram — smaller, as they are secondary. */
  faithCompactImage: 28,
  /** Health's four metric cards: icon left, value/label stacked right. */
  healthMetricHeight: 42,
  healthMetricIcon: 21,
  /** Faith's Continue-Quran card. */
  continueCardHeight: 62,
  /** The two-column content rows both screens are built from. */
  twoColumnGap: 9,
  /** Faith's compact Upcoming / Islamic Calendar pair. */
  compactCardHeight: 64,
  /** Health's Quick Log mini-cards. */
  quickLogHeight: 49,
  /** Health's wellness score ring. */
  scoreRing: 72,
  /** Keeps the score ring off the artwork's runner on the far right. */
  healthRingInset: 40,
  scoreRingStroke: 8,
  /** The AI insight card's robot artwork. */
  insightRobot: 50,
  /** Minimum touch target, both axes. WCAG 2.5.5 / Android accessibility. */
  minTouchTarget: 44,
  /**
   * The pictogram inside a Faith **section hero**.
   *
   * Larger than `faithIdentityImage`'s 56 because the box it sits in is larger: the identity card
   * it replaces was content-height, and this one is the full `faithHeroHeight`. 76 dp keeps the
   * same ratio of artwork to card that Faith Home's hero draws, so a child screen's mark reads at
   * the same weight as the home hero's artwork rather than shrinking inside a taller card.
   */
  faithHeroPictogram: 76,

  /**
   * Space below scrollable content, on top of the navigation bar and the safe area.
   *
   * 14, down from 24. The scaffold already insets by `navHeight + insets.bottom`, so this
   * is purely breathing room under the last card — and it was the cheapest 10 dp of the
   * 10.9 dp Faith Home was overflowing by. 14 dp still keeps the AI Insight visibly clear
   * of the bar rather than tucked against it.
   */
  scrollBottomInset: 14,
} as const;

/**
 * The one measured geometry every Faith hero rectangle is built from.
 *
 * ── Why this exists as a single object ──────────────────────────────────────
 * Faith Home's hero and the nine section heroes (Qur'an, Hadith, Duas, Prayer, Qibla, Tasbih,
 * Mosques, Calendar, Faith AI) are required to be the *same rectangle*: same outer height, same
 * corner radius, same horizontal margins, same internal padding, same artwork scale, same title
 * and subtitle positions, same responsive behaviour.
 *
 * "Required to be the same" is not a thing a comment can enforce. Two components each reading
 * `moduleLayout.faithHeroHeight` are only equal until somebody tunes one screen and reaches for a
 * literal, which is exactly how the child screens ended up with a 56 dp identity card while the
 * home carried a 144 dp hero. So the measurements are grouped here, both components read this
 * object rather than the individual tokens, and `faith-hero-geometry.test.ts` asserts that the
 * rendered style of every hero matches these values — a drift becomes a failing test rather than
 * a visual difference nobody measures.
 *
 * The values themselves are unchanged: they are Faith Home's, which is the stated reference.
 *
 * ── What is deliberately *not* in here ──────────────────────────────────────
 * Colour and copy. The brief fixes the geometry across the nine screens, not the palette, and a
 * hero that also owned its fill could not carry Faith Home's artwork and a child's pictogram. Fill
 * is the component's business; the rectangle is this object's.
 */
export const faithHeroGeometry = {
  /**
   * Outer height. Faith Home's 144, not the shared 132 — see `faithHeroHeight`.
   *
   * ── Read as a floor on Faith Home, and as exact on the other nine ──────────
   * The nine section heroes apply this as `height`, because their copy is baked into the artwork or
   * fixed in the registry and nothing inside them can grow. Faith Home applies it as `minHeight`:
   * its copy is live — a prayer name and time, a countdown joined to a resolved place name, a Hijri
   * date — and pinning the box cropped the surplus at large OS text sizes. At ordinary sizes the
   * content still measures under 144, so both render the identical rectangle. See `faith-hero.tsx`,
   * and `faith-hero-geometry.test.tsx` for the two assertions that keep the distinction honest.
   */
  height: moduleLayout.faithHeroHeight,
  /** Corner radius, shared with every module card. */
  radius: moduleLayout.cardRadius,
  /**
   * Horizontal margin.
   *
   * Zero, and that is the whole point: the hero is laid out *inside* the scaffold's content
   * column, which already applies `pagePadding` on both edges. A hero that added its own margin
   * would sit narrower than the cards beneath it. Named rather than omitted so the requirement
   * "same horizontal margins" has something to assert against.
   */
  marginHorizontal: 0,
  /** Internal padding, per edge. */
  paddingTop: moduleLayout.faithHeroPaddingTop,
  paddingBottom: moduleLayout.faithHeroPaddingBottom,
  paddingLeft: moduleLayout.heroPadding,
  paddingRight: moduleLayout.heroPadding,
  /** Gap between the eyebrow and the title. */
  eyebrowGap: moduleLayout.faithHeroEyebrowGap,
  /** Gap between the title and the supporting line. */
  titleGap: moduleLayout.faithHeroDateGap,
  /** Gap before a trailing action, so a button never touches the copy above it. */
  actionGap: moduleLayout.faithHeroButtonGap,
  /**
   * Share of the card width reserved for artwork.
   *
   * Lifted from `faith-hero.tsx`, where it was `ARTWORK_RESERVE_RATIO`. It is a `maxWidth` on the
   * copy column and never a fixed `width`, so a short title does not leave the column artificially
   * narrow and a long one is not forced to truncate inside it.
   */
  artworkReserveRatio: 0.38,
  /**
   * How far a hero title may shrink before wrapping is preferred to shrinking.
   *
   * 0.8 of the token size. Below this the line stops reading as the hero's title, and a second
   * line is the better trade — which is why titles carry `numberOfLines={2}` rather than 1.
   */
  titleMinScale: 0.8,
} as const;

/**
 * The narrowest a half-width card may get, per unit of text size, before its pair stacks.
 *
 * ── What the unit is, and why it is not simply dp ───────────────────────────
 * 132 **font-scale-independent** dp. A half-width card's problem is never its width alone; it is
 * how much width it has *relative to the text it must hold*. A 176 dp column at the default text
 * size and the same column at 1.5x are different columns, and only the second one cannot fit
 * "Maghrib Prayer" beside a time. Dividing the measured half-column by the OS font scale expresses
 * both in one number, so a single threshold covers every width and text size instead of a grid of
 * device exceptions.
 *
 * ── Where the value comes from ──────────────────────────────────────────────
 * Measured, not chosen. The two pairs on Faith Home — Verse of the day | Today's worship, and
 * Upcoming | Islamic calendar — were rendered on the emulator across six widths and four text
 * sizes, and the boundary sits between two observations:
 *
 *   411 dp @ 1.3  →  176 / 1.3 = 135.4  ·  everything fits, some labels take a second line
 *   411 dp @ 1.5  →  176 / 1.5 = 117.3  ·  "Maghrib Pr…", "Verse of the …", "Islamic cale…"
 *
 * 132 sits inside that gap and nearer the failing end, so a layout that only just works keeps its
 * two columns. It also produces the required behaviour at the narrow end without a second rule:
 * 320 dp gives a 143.5 dp half-column, which clears 132 at the default text size and falls under it
 * from 1.15x upward — which is where that width starts truncating.
 *
 * ── Why a threshold rather than measuring the strings ───────────────────────
 * Measuring would be exact and would also be a layout that changes shape depending on today's
 * observance name or a translated label, so the same device could stack on one day and not the
 * next. A fixed threshold is predictable, and the cost of being slightly conservative is one
 * stacked pair, not a hidden word.
 */
export const twoColumnMinimumHalfWidth = 132;

/**
 * Whether a two-column pair has to become a one-column stack.
 *
 * Pure and exported so the rule can be asserted directly rather than inferred from a rendered
 * tree — see `__tests__/module-two-column.test.tsx`.
 */
export function shouldStackTwoColumn(halfColumnWidth: number, fontScale: number): boolean {
  // A font scale at or below 1 cannot earn a card extra columns: the approved layout is the
  // two-column one, and text smaller than default is not a reason to change shape.
  const effective = halfColumnWidth / Math.max(fontScale, 1);
  return effective < twoColumnMinimumHalfWidth;
}

/**
 * Layout scale for a given screen width.
 *
 * Identical rule to Main Home and the entry flow: downscale narrow screens,
 * **never** upscale. A wider handset gets margins, not stretched cards.
 */
export function moduleScale(screenWidth: number): number {
  return Math.min(screenWidth / moduleLayout.referenceWidth, 1);
}

/**
 * How much of the bottom of the screen the navigation bar occupies.
 *
 * ── Why this is a function and not a constant ───────────────────────────────
 * Two of its three terms are only known at render: the layout scale, which depends on the device
 * width, and the safe-area inset, which depends on the device's own gesture bar. Anything that has
 * to clear the navigation therefore has to *ask*, and this is the one place that answers.
 *
 * ── Why it exists at all ────────────────────────────────────────────────────
 * The bar is `position: absolute`, so it occupies no space in the scaffold's flex column: it draws
 * over whatever the column put there. Three separate places had to know how tall it is anyway —
 * the bar itself, the scroll region's bottom padding, and now the docked panel's clearance — and
 * they each computed `dp(navHeight) + insets.bottom` inline. Two of them agreeing was a convention;
 * this makes it a fact. The safe-area inset is added exactly once, here.
 */
export function moduleNavigationHeight(
  scaled: (value: number) => number,
  safeAreaBottom: number,
): number {
  return scaled(moduleLayout.navHeight) + safeAreaBottom;
}

/**
 * How far above the screen's bottom a **docked panel** must sit to clear the navigation entirely.
 *
 * ── Why this is taller than the bar ─────────────────────────────────────────
 * The centre AI control is raised: it carries `marginTop: -navAIRaise` inside the bar, so it stands
 * 15 dp *above* the bar's own top edge. A panel that cleared only `moduleNavigationHeight` would
 * therefore have the robot button overlapping its bottom 15 dp — which is a control covering
 * another control, and on the reader it lands squarely on the audio player's seek row.
 *
 * The 15 dp between the panel and the bar is not empty space: it is the raised control's, and it is
 * what the approved reader mockup draws. This is why the value is derived from `navAIRaise` rather
 * than being a margin someone liked the look of.
 */
export function moduleDockClearance(
  scaled: (value: number) => number,
  safeAreaBottom: number,
): number {
  return moduleNavigationHeight(scaled, safeAreaBottom) + scaled(moduleLayout.navAIRaise);
}

/**
 * How many lines the module header's title may take — issue #143.
 *
 * One, until a 384 dp Samsung at a 1.5 text scale drew `Prayer locatio…`. The title band is
 * arithmetic on the screen width and the control cluster (see `headerTitleBandWidth`), and it is
 * already *maximal* for a title centred on the screen: the reserve is symmetric because the brief
 * centres the title on the screen rather than on the gap between the controls, so roughly 50 dp on
 * the left is unusable by design. Measured at 384 dp the band is 164 dp, and `Prayer location` needs
 * about 178 dp once the header's 1.3x cap is applied. Widening the band would put text under the
 * Help control, which is the defect the band was introduced to fix.
 *
 * So the title gets the second line instead, which is the same remedy #52, #136 and #139 applied to
 * tile labels and #133 to navigation labels: a label that names a destination is not allowed to
 * ellipsise at a supported text size.
 */
export const moduleHeaderTitleLines = 2;

/**
 * The cap on the header title's font growth.
 *
 * 1.3 exactly, and it is the floor as well as the ceiling: #115 established 1.3 as the minimum any
 * clamp in this app may use, so this may not be lowered to buy width. It lives here rather than as a
 * literal at the call site because `moduleHeaderHeight` and the `ModuleText` that renders the title
 * must agree about it — if they disagreed, the reserved height would not match the text drawn into
 * it, which is precisely how the band and the layout came to describe different rectangles before.
 */
export const moduleHeaderTitleMaxFontScale = 1.3;

/**
 * The module header's height, in scaled dp.
 *
 * ── Why this is arithmetic and not measured ─────────────────────────────────
 * The header's height is consumed in two places that must agree: the header draws it, and
 * `prayerDashboardSafeBodyHeight` subtracts it to decide whether Faith Home needs to scroll. A
 * content-driven height would leave the second place guessing, and `prayer-dashboard-fit.ts` records
 * what that costs — a 707 dp dashboard once reported as overflow inside a 716.6 dp gap, because the
 * deduction and the content disagreed. One function, both callers, no divergence.
 *
 * ── Why it does not depend on the title string ──────────────────────────────
 * Knowing whether *this* title wraps means measuring it, and `module-header.tsx` explains at length
 * why the title box deliberately depends on no font measurement: on a cold deep link the title lays
 * out in the system fallback face, and a box sized to that never re-measures once Poppins arrives.
 * So the header reserves room for `moduleHeaderTitleLines` whenever the text size makes that exceed
 * the base height, uniformly across all eight modules. Every header is the same height as every
 * other at a given text size, which is what the shared chrome should look like anyway.
 *
 * ── Why font scale 1.0 is untouched ────────────────────────────────────────
 * Two lines at 1.0 measure 2 x 24 = 48 dp against a 54 dp base, so the base still wins and the
 * header is exactly the height it has always been. The growth begins only where the type demands
 * it: at 1.5 the capped line box is 24 x 1.3 = 31.2 dp, so two lines need 63 dp and the header
 * becomes 63 dp rather than clipping the second line inside 54.
 */
export function moduleHeaderHeight(scaled: (value: number) => number, fontScale: number): number {
  const capped = Math.min(Math.max(fontScale, 1), moduleHeaderTitleMaxFontScale);
  const lineBox = scaled(moduleType.headerTitle[1]) * capped;
  return Math.max(scaled(moduleLayout.headerHeight), Math.ceil(lineBox * moduleHeaderTitleLines));
}
