import type { Href } from 'expo-router';
import type { ImageSourcePropType } from 'react-native';

import type { IconName } from '@shared/models/icon';
import type { ModuleNavigation } from '@shared/models/module-theme';

import type { ModuleAIPolicy } from './module-ai-policy';
import type { FrameworkModuleId, ModuleColorTheme } from './module-tokens';

/**
 * The typed contract every NoorLife module satisfies.
 *
 * A module is *configuration*, not a screen. Everything the shared components need
 * to render a module — its colour, its artwork, its destinations, what it can do,
 * what it may ask the OS for, and what it says when it has nothing to show — is
 * declared here. Adding the eighth module should mean adding one entry to the
 * registry, not writing another screen.
 *
 * The practical test of that claim is the Module Gallery, which renders all seven
 * modules and every state from this data alone.
 */

/**
 * A capability the module offers the user, rendered in the feature grid.
 *
 * `available: false` is a first-class state. A module ships with features that are
 * not built yet, and the honest presentation is a visibly unavailable tile with a
 * reason — not a tile that looks live and does nothing.
 */
export type ModuleCapability = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  /** Where the tile leads. Omitted when the capability is not available yet. */
  readonly href?: Href;
  readonly available: boolean;
  /** Why it is unavailable. Required when `available` is false. */
  readonly unavailableReason?: string;
  /** Screen-reader label when the visible label needs more context. */
  readonly accessibilityLabel?: string;
};

/** An OS or data permission the module may request, with the reason shown to the user. */
export type ModulePermission = {
  readonly key:
    | 'notifications'
    | 'location'
    | 'calendar'
    | 'health-data'
    | 'contacts'
    | 'photos'
    | 'microphone';
  /** Plain-language title used on the permission state. */
  readonly title: string;
  /**
   * Why the module needs it, in the user's terms.
   *
   * Required, and required to be specific: a permission prompt that cannot say what
   * it unlocks should not be asked for.
   */
  readonly rationale: string;
  /** False when the module still works without it, which most should. */
  readonly required: boolean;
};

/** Copy for a state the module can be in. Every module supplies all of them. */
export type ModuleStateCopy = {
  /** Nothing recorded yet. */
  readonly empty: { readonly title: string; readonly body: string; readonly action: string };
  /** A request failed. Never blames the user, always offers a retry. */
  readonly error: { readonly title: string; readonly body: string; readonly action: string };
  /** No connection. States what still works offline. */
  readonly offline: { readonly title: string; readonly body: string };
  /** Loading, announced to a screen reader. */
  readonly loading: string;
};

/**
 * The hero card at the top of a module home.
 *
 * ── Concise, approved copy only ─────────────────────────────────────────────
 * These fields carry the wording from each individual-core-screen reference and nothing
 * else. The framework originally generated marketing sentences here — "Today, in the order
 * it happens", "Know where it went" — which read well but are not the approved content, and
 * were long enough to truncate over the artwork. Short lines are the point: they fit the
 * quiet band without ellipses.
 */
export type ModuleHeroContent = {
  /** Small line above the headline, e.g. "Today’s Wellness". */
  readonly eyebrow: string;
  /**
   * The hero’s headline figure or phrase, e.g. "86", "12 days", "$2,450".
   *
   * Rendered at display size. Kept separate from `eyebrow` and `support` so each module can
   * emphasise the right thing without a per-module layout.
   */
  readonly headline: string;
  /** Optional smaller word set beside the headline, e.g. "left" after an amount. */
  readonly headlineSuffix?: string;
  /** One short supporting line, e.g. "You’re on track! 🎯". */
  readonly support?: string;
  /** A second supporting line where the reference shows one, e.g. a time under a label. */
  readonly supportSecondary?: string;
  /** The hero’s call to action. Every reference has exactly one. */
  readonly actionLabel: string;
  /**
   * A live progress value, 0–1, where the reference draws a bar in the hero.
   *
   * Only Finance has one. It is a value rather than a flag so the bar and the "62% spent"
   * text cannot disagree.
   */
  readonly progress?: number;
  /**
   * Describes the hero artwork to a screen reader, or '' when purely decorative.
   *
   * The artwork itself is `ModuleDefinition.heroArtwork`, so there is one field in the whole
   * system that decides which PNG a hero shows.
   */
  readonly artworkAccessibilityLabel: string;
};

/** A quick action in the row beneath the hero. */
export type ModuleQuickActionSpec = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  readonly href?: Href;
  readonly accessibilityLabel?: string;
};

export type ModuleDefinition = {
  readonly id: FrameworkModuleId;
  /** Display name, used in the header and as the hero eyebrow default. */
  readonly name: string;
  /** One line describing the module, used on the Module Gallery and in Help. */
  readonly summary: string;
  readonly theme: ModuleColorTheme;
  /**
   * The module's approved PNG pictogram, resolved from the locked Main Home registry.
   *
   * Used wherever the module identifies itself at a small size — feature tiles, list
   * rows, state illustrations.
   */
  readonly pictogram: ImageSourcePropType;
  /**
   * The hero card's artwork.
   *
   * Declared separately from `pictogram` so the hero's asset is explicit and auditable
   * rather than implied, but it **must be the same asset**: a test asserts
   * `heroPictogram === pictogram` for all seven modules, and a second test asserts both
   * equal what Main Home's grid renders. That is what stops a future hero from acquiring
   * its own illustration, which is the drift this field exists to make visible.
   *
   * Static requires only — no dynamic path, no conditional require, and no per-feature
   * copy of the same PNG.
   */
  readonly heroPictogram: ImageSourcePropType;
  readonly routes: {
    readonly home: Href;
    readonly ai: Href;
    /** Module-specific help destination reached from the header's Help control. */
    readonly help: Href;
  };
  /**
   * Exactly five destinations, the third being module AI.
   *
   * Reused from the Phase 1 `ModuleTheme`, which validates that invariant at import
   * time. Re-declaring it here would create a second source of truth for the same
   * five routes and a way for them to disagree.
   */
  readonly navigation: ModuleNavigation;
  /**
   * Whether the raised centre control shows its label beneath it.
   *
   * Per module, because the approved references disagree: `03-faith.png` captions the
   * control "Faith AI", `04-health.png` captions nothing. The framework first assumed no
   * caption anywhere, following locked Main Home — an assumption, not a rule.
   */
  readonly showAICaption: boolean;
  /**
   * The module's locked hero illustration — text-free, 1083 x 396 px.
   *
   * Distinct from `pictogram`, and never interchangeable with it: the pictogram is the
   * small mark for tiles and rows, this is the full-bleed scene behind the hero's live UI.
   * Substituting one for the other is explicitly forbidden and asserted against by test.
   *
   * No longer nullable. The artwork was missing through Phase 4A, and the honest handling
   * then was a slot that rendered nothing; now that all eight assets exist, a required field
   * is the stronger contract — a module cannot be registered without its hero.
   */
  readonly heroArtwork: ImageSourcePropType;
  /**
   * Black-scrim opacity over the copy side, 0 for none.
   *
   * Measured, not chosen: the 95th-percentile luminance of each asset's actual copy area,
   * solved for the opacity at which white text clears 4.5:1. Five heroes need none.
   */
  readonly heroScrim: number;
  /** Which side the live copy occupies. Noor AI is right; every module hero is left. */
  readonly heroCopySide: 'left' | 'right';
  readonly hero: ModuleHeroContent;
  readonly quickActions: readonly ModuleQuickActionSpec[];
  readonly capabilities: readonly ModuleCapability[];
  readonly permissions: readonly ModulePermission[];
  readonly ai: ModuleAIPolicy;
  readonly stateCopy: ModuleStateCopy;
};
