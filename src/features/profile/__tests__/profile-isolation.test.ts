import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Profile does not reach into Main Home, and Profile's presentation does not reach into Supabase.
 *
 * ── What this guards, and what it does not ──────────────────────────────────
 * Main Home's entitlement work is complete and out of scope for this phase. That the files are
 * byte-identical is verified with git, which is a stronger statement than any test could make and
 * does not go stale the first time Main Home is legitimately edited.
 *
 * What a test *can* usefully hold is the boundary: Profile must not import Main Home's locked
 * components, screen or metrics, because an import is how a "small change over there" becomes a
 * change over here. The one Main Home module Profile is allowed is `module-pictograms`, which is
 * the shared asset registry — it holds the approved profile portrait and is not part of the locked
 * dashboard.
 */

const PROFILE_ROOT = join(__dirname, '..');

const FORBIDDEN = [
  'home/components/module-grid',
  'home/components/today-timeline',
  'home/components/home-summary-row',
  'home/components/ai-insight-card',
  'home/components/quick-actions-row',
  'home/components/home-bottom-navigation',
  'home/screens/main-home-screen',
  'home/main-home-metrics',
] as const;

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.endsWith('.ts') || entry.endsWith('.tsx') ? [path] : [];
  });
}

describe('the Profile feature', () => {
  const files = sourceFiles(PROFILE_ROOT);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(FORBIDDEN)('never imports %s', (module) => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(module));
    expect(offenders).toEqual([]);
  });

  it('takes only the shared pictogram registry from Main Home', () => {
    const homeImports = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/@features\/home\/([\w/-]+)/g)) {
        homeImports.add(match[1] as string);
      }
    }
    expect([...homeImports].sort()).toEqual(['module-pictograms']);
  });
});

/**
 * Presentation never imports the Supabase client.
 *
 * ── Why the whole feature is checked, not just the screens ──────────────────
 * A screen that imports a component that imports the client is exactly as coupled as a screen that
 * imports it directly, and rather harder to notice. The rule is therefore stated over every source
 * file in the feature: screens, components and hooks all go through the service layer, which owns
 * the client and the error mapping.
 *
 * The hooks and screens *are* allowed to import from `@services/…`. That is the boundary working as
 * intended — the point is that nothing here knows what is behind it.
 */
describe('the Profile presentation layer', () => {
  const files = sourceFiles(PROFILE_ROOT);

  it.each(['@/lib/supabase', '@supabase/supabase-js', 'createClient('])(
    'never references %s',
    (forbidden) => {
      const offenders = files
        .filter((file) => readFileSync(file, 'utf8').includes(forbidden))
        .map((file) => file.replace(PROFILE_ROOT, ''));
      expect(offenders).toEqual([]);
    },
  );

  it('reaches the backend only through the service and provider layers', () => {
    const serviceImports = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/@services\/([\w/.-]+)/g)) {
        serviceImports.add(match[1] as string);
      }
    }
    // The read path and the write path. Nothing else — and in particular no client.
    expect([...serviceImports].sort()).toEqual(['auth/auth.service', 'profile/profile.service']);
  });
});
