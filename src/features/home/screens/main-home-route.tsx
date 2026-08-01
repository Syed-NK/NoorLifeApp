import { UpgradeSheetHost } from '@features/subscription/components/upgrade-sheet-host';
import { UpgradeSheetProvider } from '@features/subscription/services/upgrade-sheet-context';

import { MainHomeScreen, type MainHomeScreenProps } from './main-home-screen';

/**
 * Main Home, with the contextual upgrade controller mounted around it.
 *
 * ── Why the provider sits here and not lower ────────────────────────────────
 * Two separate surfaces raise upgrade requests — the timeline rows in `today-timeline.tsx` and the
 * two summary cards in `home-summary-row.tsx`. Their nearest common ancestor is the screen, so this
 * is the narrowest level at which one controller can serve both and one sheet can be drawn. Putting
 * it inside either component would give each row and card its own modal; putting it in
 * `AppProviders` would hold Main Home's state for the whole app, including routes that never ask.
 *
 * ── Why it is a wrapper rather than an edit to the screen ───────────────────
 * `main-home-screen.tsx` is design-locked byte-for-byte and this phase reopened only the two files
 * that had to change to draw the locked states. Composition gets the provider above both surfaces
 * without touching the locked file at all — the sheet is a sibling of the screen, not a section
 * inside it, so no locked measurement, gap or section order is involved.
 *
 * ── Why the sheet is a sibling and not a child ──────────────────────────────
 * It is a `Modal`, so it draws above everything regardless of where it sits in the tree. Keeping it
 * outside the screen means it cannot participate in the fixed-height, no-scroll layout the pack
 * locks, and the bottom navigation keeps its own stacking.
 *
 * Route gates are unaffected: this mounts a controller, it does not decide access. Every lock
 * decision still resolves through `canAccessModule`.
 */
export function MainHomeRoute(props: MainHomeScreenProps) {
  return (
    <UpgradeSheetProvider>
      <MainHomeScreen {...props} />
      <UpgradeSheetHost testID="main-home-upgrade-sheet" />
    </UpgradeSheetProvider>
  );
}
