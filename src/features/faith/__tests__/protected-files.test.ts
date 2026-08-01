import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Design-locked files must be unchanged from the branch point.
 *
 * ── Why this compares against git rather than a stored hash ─────────────────
 * A checked-in hash list is a second thing to keep in step, and the failure mode is
 * someone updating the hash instead of reverting the file — which is precisely the change
 * this test exists to catch. Diffing against the branch point asks git the real question:
 * "did this branch touch a locked file?"
 *
 * The list is Main Home and Entry/Auth, which the briefs name as untouchable. Shared
 * module-framework files are *not* listed: this work legitimately changes the module
 * scaffold, header and navigation, and locking the whole framework would make that
 * impossible to do honestly.
 */

const BASE_REF = 'feature/core-module-framework';

const PROTECTED_PATHS: readonly string[] = [
  // Main Home — design-locked.
  'src/features/home/components/home-header.tsx',
  'src/features/home/components/home-hero.tsx',
  'src/features/home/components/quick-actions-row.tsx',
  'src/features/home/components/ai-insight-card.tsx',
  'src/features/home/components/home-bottom-navigation.tsx',
  'src/features/home/components/robot-asset.tsx',
  'src/features/home/main-home-metrics.ts',
  'src/features/home/module-pictograms.ts',
  'src/features/home/module-tile-theme.ts',
  // Entry / Auth — approved layouts.
  'src/features/entry-auth/entry-auth-tokens.ts',
  'src/features/entry-auth/entry-auth-copy.ts',
  'src/features/entry-auth/entry-auth-assets.ts',
  'src/features/entry-auth/screens/splash-screen.tsx',
  // Authentication service — not a layout, but out of scope for design work.
  'src/services/auth/auth.service.ts',
];

/**
 * Entry screens deliberately reopened, with the reason recorded rather than the entry deleted.
 *
 * The entry sequence was asked to carry a shared step indicator and swipe-back navigation across
 * onboarding, Welcome and the credentials screens, so the user can return to an earlier screen.
 * That cannot be built without editing these four files, so their byte-for-byte lock was lifted on
 * request. Leaving them silently absent from the list above is the failure mode this whole test is
 * designed to catch, so they are named here instead.
 *
 * What remains locked is the part that carries the approved design: `entry-auth-tokens.ts`,
 * `entry-auth-copy.ts`, `entry-auth-assets.ts` and the splash composition are all still above, and
 * this work changed none of them — no colour, measurement, string or asset moved. The changes are
 * structural: a footer slot, a dot row and a gesture wrapper.
 *
 * Anything beyond that still needs the design owner's sign-off.
 */
const REOPENED_ON_REQUEST: readonly string[] = [
  'src/features/entry-auth/screens/onboarding-screen.tsx',
  'src/features/entry-auth/screens/welcome-screen.tsx',
  'src/features/entry-auth/screens/login-screen.tsx',
  'src/features/entry-auth/screens/sign-up-screen.tsx',
  /**
   * Main Home's module grid — reopened for Phase 6B.
   *
   * Free users must see the six paid modules as locked, and there is no way to render a lock state
   * on a tile without editing the file that draws the tile. The phase brief authorises exactly
   * this: entitlement-aware states *within* the existing geometry.
   *
   * What did not change is the geometry itself. Every locked measurement still comes from
   * `LOCKED.grid` — four columns, 7 dp gaps, 71 dp tiles, 13 dp radius, 48 dp pictograms — and
   * `main-home-metrics.ts` is untouched and still locked above. The approved PNGs are still
   * rendered by `getModulePictogram`, never swapped for a lock glyph. What was added is a scrim, a
   * badge and a branch on entitlement.
   *
   * A geometry test in the Main Home suite asserts the tile count and layout are unchanged, which
   * is the guarantee this entry gives up and that test takes over.
   */
  'src/features/home/components/module-grid.tsx',
  /**
   * "Today at a Glance" and the two summary cards — reopened for Phase 6B.
   *
   * Reason recorded on request: **user-approved Free entitlement presentation and interaction.**
   *
   * Three of the four timeline rows and both summary figures are paid content. A free user
   * currently sees School drop-off, Work focus time and Family dinner as ordinary rows that walk
   * into Planner and Family, and is shown "4 of 5 complete" and "68% — You're on track", which are
   * statements about a week they do not have. Neither can be corrected without editing the file
   * that draws the row and the file that draws the card, so their byte-for-byte lock was lifted on
   * request rather than the entries being quietly deleted.
   *
   * What did not change is the geometry. Every measurement still comes from `LOCKED.today` and
   * `LOCKED.summary` — the 126 dp card, the 23 dp rows, the 7 dp dot, the 62 dp time column, the
   * 90 dp summary cards, the 46 dp ring and its 6 dp stroke — and `main-home-metrics.ts` is
   * untouched and still locked above. Section order, card positions, spacing and the type ramp are
   * as they were; the locked states are drawn *inside* that geometry. The Main Home suite asserts
   * those dimensions directly, which is the guarantee these two entries give up and that test
   * takes over.
   *
   * Anything beyond entitlement state in these two files still needs the design owner's sign-off.
   */
  'src/features/home/components/today-timeline.tsx',
  'src/features/home/components/home-summary-row.tsx',
  /**
   * The Main Home screen itself — reopened for Phase 6B on an approved architecture decision.
   *
   * Reason recorded on request: **user-approved Free entitlement presentation and interaction.**
   *
   * Five surfaces on this screen raise contextual upgrade explanations, or will: the timeline
   * rows, the two summary cards, the Noor AI insight, the quick actions and the bottom
   * navigation. Their nearest common ancestor is this file, so it is the narrowest level at which
   * one controller can serve all five and one sheet can be drawn. The alternatives were both
   * rejected on the record: `AppProviders` would hold Main Home's state for every route in the
   * app, and anything lower would give each row and card a modal of its own.
   *
   * The permitted change is exactly that and nothing else — one `UpgradeSheetProvider` and one
   * `UpgradeSheetHost` in the screen's shell function. Both are layout-neutral: the provider
   * renders context alone, and the host renders nothing until something asks for it and a `Modal`
   * after that, which takes no part in the flex layout of the column. `MainHomeContent`, which
   * holds the entire visual composition, is untouched — no padding, no wrapper view, no visible
   * element, no reordered section, and `main-home-metrics.ts` is untouched and still locked above.
   *
   * A section-order test in the Main Home suite asserts all seven sections still render in the
   * locked sequence, which is the guarantee this entry gives up and that test takes over.
   */
  'src/features/home/screens/main-home-screen.tsx',
];

/**
 * Line endings are normalised before comparing.
 *
 * `core.autocrlf` is true on Windows, so git stores LF and checks out CRLF. `git show`
 * returns the stored blob while the filesystem returns the working copy, and the two
 * differ on every line by an invisible byte nobody typed. Comparing raw would make this
 * test fail after a `git checkout` — a *restore*, which is the opposite of the edit it
 * exists to catch.
 *
 * Everything else stays byte-exact: a changed space, a reordered import or a reworded
 * comment all still fail.
 */
function normalise(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function gitShow(ref: string, filePath: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${filePath}`], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function baseExists(): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', BASE_REF], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('protected design-locked files', () => {
  const available = baseExists();

  it('can resolve the base ref to compare against', () => {
    // If this fails the suite below is meaningless, so it is asserted rather than
    // silently skipped — a protection test that quietly does nothing is worse than none.
    expect(available).toBe(true);
  });

  it.each(PROTECTED_PATHS)('%s is unchanged from the branch point', (filePath) => {
    if (!available) {
      throw new Error(`Cannot verify ${filePath}: base ref ${BASE_REF} is unavailable.`);
    }

    const baseline = gitShow(BASE_REF, filePath);
    expect(baseline).not.toBeNull();

    const current = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
    expect(normalise(current)).toBe(normalise(baseline as string));
  });
});

/**
 * The reopened entry screens keep the *visual* lock even though the byte lock is gone.
 *
 * A file removed from the list above would otherwise be free to drift in any direction. These two
 * checks keep the part that matters: the approved palette and measurements stay in the locked token
 * file, so a colour or size cannot be quietly introduced at the call site.
 */
describe('entry screens reopened on request', () => {
  it('does not also claim to lock them, which would contradict itself', () => {
    for (const filePath of REOPENED_ON_REQUEST) {
      expect(PROTECTED_PATHS).not.toContain(filePath);
    }
  });

  it.each(REOPENED_ON_REQUEST)('%s hard-codes no colour of its own', (filePath) => {
    const current = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');

    // Every colour on these screens must come from entryAuthColors. A literal here would be a
    // visual change escaping the lock on entry-auth-tokens.ts.
    expect(current).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(current).not.toMatch(/\brgba?\(/);
  });
});
