import { useMemo } from 'react';

import { useModule, useOptionalModule } from './module-context';
import { moduleColorThemes, moduleNeutrals, type FrameworkModuleId } from './module-tokens';

/**
 * **Which modules paint from the surface contract, and what every shared component asks** — #91.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── One decision, in one place ─────────────────────────────────────────────
 * #86 gave `ModuleColorTheme` six surface roles and deliberately changed no pixel. This is the
 * layer that spends them, and the whole rollout is the one list below.
 *
 * A shared component never asks "is this Finance?" — it asks `moduleSurfaces(id)` for the ground it
 * should paint, and gets either the module's roles or today's neutrals. So opting a module in is
 * appending to `SURFACE_ROLE_MODULES`, and there is no `moduleId === 'finance'` anywhere in the
 * component layer to find and update later. That matters more than it looks: the Faith pattern this
 * programme keeps unwinding began as one local constant that seemed obviously correct at the time.
 *
 * ── Why the neutral branch returns today's exact values ────────────────────
 * The seven modules that have not opted in must render byte-identically. So the fallback is not
 * "something close to neutral" — it is the same `moduleNeutrals` entries the components read
 * before, moved behind one call. A test asserts that mapping value by value, because the failure
 * mode of a rollout like this is a module nobody was looking at shifting a shade.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * There is no `disabled` role. `moduleNeutrals.surfaceMuted` means two different things in the
 * component layer — a decorative nested row, and an unavailable control — and only the first is
 * decoration. Tinting the second would make Finance's Bank sync and Receipts tiles read as
 * available, which is the opposite of what #90 just finished asserting. Callers keep using
 * `surfaceMuted` directly for the disabled case, and that separation is asserted too.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The modules that paint from their own roles.
 *
 * Finance is first by decision: the contract lands on a module before that module grows data
 * screens, so those screens are born correct rather than recoloured afterwards.
 */
export const SURFACE_ROLE_MODULES: readonly FrameworkModuleId[] = ['finance'];

export function usesSurfaceRoles(moduleId: string): boolean {
  return (SURFACE_ROLE_MODULES as readonly string[]).includes(moduleId);
}

/**
 * The grounds a module screen paints.
 *
 * Named by what they are *for*, not by which token they came from, so a component reads as a layout
 * decision rather than as a colour lookup.
 */
export type ModuleSurfaces = {
  /** Behind all module content. */
  readonly page: string;
  /** Cards, sheets and the navigation bar. */
  readonly card: string;
  /** A decorative nested row inside a card. Never the disabled state — see the note above. */
  readonly elevated: string;
  /** Icon wells and feature tiles. Already per module before this change. */
  readonly well: string;
  /** Card, tile and input borders. */
  readonly border: string;
  /** Hairline between rows. */
  readonly divider: string;
  /** The selected navigation slot's ground. Transparent-equivalent when a module has not opted in. */
  readonly navSelected: string;
};

/**
 * Resolve one module's surfaces.
 *
 * Cheap enough to call in a render — it is a table lookup and an object literal — but the returned
 * object is a new reference each call, so it belongs in a `useMemo` where a component passes it to
 * something identity-sensitive.
 */
export function moduleSurfaces(moduleId: string): ModuleSurfaces {
  const theme = moduleColorThemes[moduleId as FrameworkModuleId];

  if (theme === undefined || !usesSurfaceRoles(moduleId)) {
    /*
      Exactly what the shared components read before #91. Not an approximation of neutral: the same
      four values, so a module that has not opted in cannot shift by a shade.
    */
    return {
      page: moduleNeutrals.pageBackground,
      card: moduleNeutrals.surface,
      elevated: moduleNeutrals.surfaceMuted,
      well: theme?.wellSurface ?? moduleNeutrals.surfaceMuted,
      border: moduleNeutrals.border,
      divider: moduleNeutrals.divider,
      /* No tint behind a selected tab today; the marker and the ink carry the state. */
      navSelected: moduleNeutrals.navBackground,
    };
  }

  return {
    page: theme.pageSurface,
    card: theme.cardSurface,
    elevated: theme.elevatedSurface,
    well: theme.wellSurface,
    border: theme.borderTint,
    divider: theme.borderTint,
    navSelected: theme.navSelectedSurface,
  };
}

/**
 * Whether a status banner must draw its semantic ink as a visible border.
 *
 * Finance forced this rule. Its `pageSurface` `#FFF3E6` sits at **1.02:1** against
 * `warningSurface` `#FFF6E6` — the same colour to any eye — so a warning banner on a Finance page
 * cannot be identified by its fill. The banner therefore keeps its semantic fill *and* gains a
 * border in its semantic ink, which clears the 3:1 non-text bar on every module page (#86 asserts
 * that for all four statuses across all eight modules).
 *
 * Only for opted-in modules: on a neutral page the fills are already distinguishable, and adding a
 * border there would change seven modules' appearance for no reason.
 */
export function statusNeedsInkBorder(moduleId: string): boolean {
  return usesSurfaceRoles(moduleId);
}

/**
 * The current module's surfaces, read from the context the scaffold provides.
 *
 * Exists so a component asks for a ground rather than for a module identity — there is no
 * `module.id === 'finance'` anywhere in the component layer, and adding a module to
 * `SURFACE_ROLE_MODULES` is the whole rollout.
 */
export function useModuleSurfaces(): ModuleSurfaces {
  const module = useModule();
  return useMemo(() => moduleSurfaces(module.id), [module.id]);
}

/**
 * The current module's surfaces, or the neutral set outside a provider.
 *
 * For shared components that render both inside a module and outside one. Neutral is the safe
 * direction: a component that cannot tell which module it is in must not guess at a tint.
 */
export function useOptionalModuleSurfaces(): ModuleSurfaces {
  const module = useOptionalModule();
  const moduleId = module?.id ?? '';
  return useMemo(() => moduleSurfaces(moduleId), [moduleId]);
}

/** Whether the surrounding module needs its status banners bordered. Neutral-safe. */
export function useStatusInkBorder(): boolean {
  const module = useOptionalModule();
  return module === null ? false : statusNeedsInkBorder(module.id);
}
