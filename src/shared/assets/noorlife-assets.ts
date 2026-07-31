import type { ImageSourcePropType } from 'react-native';

/**
 * The single registry of approved NoorLife PNG artwork.
 *
 * Every entry is a **static** `require()`. A dynamic path is not bundled by Metro and would fail at
 * runtime rather than at build time, so paths here are literals and never composed.
 *
 * ── Alias note ──────────────────────────────────────────────────────────────
 * The brief's snippet writes `@/assets/images/...`, but this project maps `@/*` to `./src/*` and
 * `@assets/*` to `./assets/*` (see tsconfig paths). `@/assets/...` would therefore resolve to
 * `src/assets/...`, which does not exist. The alias is corrected to `@assets/` so the paths resolve;
 * the file layout the brief specifies is unchanged.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * `brand.googleMark` is `null`. Google's branding guidelines require their official multicolour "G"
 * used unmodified, and that asset is not in the repository. Drawing an approximation would be a
 * modified mark, which those guidelines forbid, so the mark is *absent* rather than substituted and
 * the required path is recorded below for whoever adds it.
 */

/** Where the Google mark must be placed. Absent until the official asset is added. */
export const REQUIRED_GOOGLE_MARK_PATH = 'assets/brand/google/g-logo.png';

export const noorLifeAssets = {
  entryAuth: {
    /** The locked splash, used unchanged and full-screen. */
    splash: require('@assets/images/entry-auth/splash-soft-mint.png') as ImageSourcePropType,
    /** Approved 3D privacy shield — screens 04 and 11. */
    privacyShield: require('@assets/images/entry-auth/privacy-shield.png') as ImageSourcePropType,
    /** Approved 3D envelope — screens 05, 08, 09 and 10. */
    emailEnvelope: require('@assets/images/entry-auth/email-envelope.png') as ImageSourcePropType,
    /** Family and Noor AI group, extracted from the locked splash — screens 02 and 12. */
    familyRobot: require('@assets/images/entry-auth/family-robot.png') as ImageSourcePropType,
    /** Noor AI alone, extracted from the locked splash — screens 03–11. */
    noorAiRobot: require('@assets/images/entry-auth/noor-ai-robot.png') as ImageSourcePropType,
  },

  /**
   * The eight approved module pictograms, normalized to transparent artwork at ~86% of a 256 px
   * canvas. The pack ships them as mockup tiles — a white card on a grey page — so the card and the
   * neighbouring tile's divider are keyed away here; rendering the raw files would put a white
   * rectangle behind every pictogram.
   */
  modules: {
    noorAI: require('@assets/images/pictograms/noor-ai.png') as ImageSourcePropType,
    faith: require('@assets/images/pictograms/faith.png') as ImageSourcePropType,
    health: require('@assets/images/pictograms/health.png') as ImageSourcePropType,
    planner: require('@assets/images/pictograms/planner.png') as ImageSourcePropType,
    finance: require('@assets/images/pictograms/finance.png') as ImageSourcePropType,
    learning: require('@assets/images/pictograms/learning.png') as ImageSourcePropType,
    family: require('@assets/images/pictograms/family.png') as ImageSourcePropType,
    goals: require('@assets/images/pictograms/goals.png') as ImageSourcePropType,
  },

  /**
   * The locked, text-free module hero artwork.
   *
   * Source: `design-reference/module-hero-assets/README.md`. Every file is exactly
   * 1083 × 396 px — which is 361 × 132 dp at 3×, i.e. precisely the width of the module
   * content column. That is not a coincidence: the canvas was cut to this layout, so a
   * 132 dp hero renders each asset one-to-one with no crop and no stretch.
   *
   * Rules these carry with them, from the README and enforced by test:
   *   • `resizeMode="cover"`, absolute-fill inside the hero card
   *   • the card supplies the corner radius and clips with `overflow: 'hidden'`
   *   • no tint, border, background tile, pedestal or padding
   *   • all text, values, rings and buttons stay live React Native above the image
   *   • the small Main Home pictogram is never substituted for one of these
   *
   * `00-module-hero-contact-sheet.png` is a preview and is deliberately not copied into
   * the project.
   */
  moduleHeroes: {
    noorAI: require('@assets/images/modules/heroes/02-noor-ai-hero.png') as ImageSourcePropType,
    /**
     * The left-copy revision.
     *
     * `03-faith-hero.png` was symmetrical — mosques on both flanks — which forced Faith's
     * copy into the centre and made it the one hero that did not match the others'
     * left-aligned treatment. `…-left-copy-v2` moves the architecture to the right and
     * leaves a quiet dark-green field on the left, so Faith now reads like every other
     * module. The superseded asset stays in the repository; nothing references it.
     */
    faith:
      require('@assets/images/modules/faith/faith-hero-left-copy-v2.png') as ImageSourcePropType,
    health: require('@assets/images/modules/heroes/04-health-hero.png') as ImageSourcePropType,
    planner: require('@assets/images/modules/heroes/05-planner-hero.png') as ImageSourcePropType,
    finance: require('@assets/images/modules/heroes/06-finance-hero.png') as ImageSourcePropType,
    learning: require('@assets/images/modules/heroes/07-learning-hero.png') as ImageSourcePropType,
    family: require('@assets/images/modules/heroes/08-family-hero.png') as ImageSourcePropType,
    goals: require('@assets/images/modules/heroes/09-goals-hero.png') as ImageSourcePropType,
  },

  brand: {
    /**
     * Official Google "G". Null until `assets/brand/google/g-logo.png` is supplied.
     *
     * Consumers must render no mark at all when this is null — never a stand-in shape.
     */
    googleMark: null as ImageSourcePropType | null,
  },
} as const;

export type ModuleAssetKey = keyof typeof noorLifeAssets.modules;
