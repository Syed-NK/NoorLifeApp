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
  'src/features/home/screens/main-home-screen.tsx',
  'src/features/home/components/home-header.tsx',
  'src/features/home/components/home-hero.tsx',
  'src/features/home/components/module-grid.tsx',
  'src/features/home/components/today-timeline.tsx',
  'src/features/home/components/home-summary-row.tsx',
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
  'src/features/entry-auth/screens/onboarding-screen.tsx',
  'src/features/entry-auth/screens/welcome-screen.tsx',
  'src/features/entry-auth/screens/login-screen.tsx',
  'src/features/entry-auth/screens/sign-up-screen.tsx',
  // Authentication service — not a layout, but out of scope for design work.
  'src/services/auth/auth.service.ts',
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
