import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The typography probe must not be reachable through the production route surface.
 *
 * ── Why deleting the route is the fix, and a `__DEV__` guard was not ────────
 * The probe shipped as `src/app/typography-probe.tsx` guarded by `if (!__DEV__) return <Redirect …>`.
 * That guard stops the screen *rendering* in a release build and does nothing about whether it is
 * *in* the build: the route file's `import` is unconditional and sits at module scope, so Metro
 * follows it while building the graph and compiles the screen and every string in it into
 * `index.android.bundle`. The path also stays in the generated route manifest, so it remains
 * discoverable by anyone who unzips the APK even though visiting it redirects.
 *
 * This is the third instance of that pattern — `docs/DEV_ROUTE_BACKLOG.md` records the first two and
 * the procedure, which step 1 of is "delete the route file, so nothing in `src/app` references the
 * screen". That is what removes it from both the manifest and the module graph.
 *
 * ── What these assertions actually pin ──────────────────────────────────────
 * Two separate things, because the guard failed by conflating them:
 *
 *   the manifest   no file under `src/app` names the probe, so no path exists to request
 *   the graph      nothing anywhere imports the screen, so Metro cannot include it
 *
 * ── Why there is no exception for the screen's own file ─────────────────────
 * There was one while the diagnostic still existed: the scans had to skip its definition site, or
 * they would have reported it as its own offender. The screen has since been deleted too, so the
 * assertions are now absolute — the probe's names may not appear as an import or a testID anywhere
 * under `src`, with nothing carved out. An exception nobody needs is an exception that quietly
 * widens, so it is gone rather than left pointing at a path that no longer exists.
 */

const SRC_ROOT = join(process.cwd(), 'src');

/** The screen module, as an import specifier would spell it. */
const PROBE_MODULE = 'typography-probe-screen';

/** The exported component, in case a future import reaches it by some other path. */
const PROBE_COMPONENT = 'TypographyProbeScreen';

function sourceFiles(dir: string): readonly string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') {
        out.push(...sourceFiles(full));
      }
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const asRepoPath = (file: string): string => relative(process.cwd(), file).split(sep).join('/');

describe('the typography probe is absent from the production route surface', () => {
  /**
   * The scan reaches the route tree at all.
   *
   * Every assertion below is an empty-array expectation, and an empty array is also what a walk that
   * found no files produces. Without this, a rename of `src/app` would turn the whole suite green for
   * the wrong reason — which is the same class of silent pass the deleted route's `__DEV__` guard was.
   */
  it('finds the route tree it is scanning', () => {
    const routes = sourceFiles(join(SRC_ROOT, 'app'));
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.map(asRepoPath)).toContain('src/app/_layout.tsx');
  });

  it('has no route file under src/app', () => {
    const routes = sourceFiles(join(SRC_ROOT, 'app'))
      .map(asRepoPath)
      .filter((file) => /typography[-_]?probe/i.test(file));

    expect(routes).toEqual([]);
  });

  /**
   * The route manifest is derived from the file tree, so "no route file" and "no route" are the same
   * statement — but only if nothing else in `src/app` reaches the screen. A layout, a redirect table
   * or a navigation constant naming it would put it back in the graph without adding a route file.
   */
  it('is referenced by nothing under src/app', () => {
    const offenders = sourceFiles(join(SRC_ROOT, 'app'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes(PROBE_MODULE) || source.includes(PROBE_COMPONENT);
      })
      .map(asRepoPath);

    expect(offenders).toEqual([]);
  });

  /**
   * The screen module itself is gone, not merely unreferenced.
   *
   * An unreferenced file is one import away from being referenced again, and the whole point of the
   * backlog procedure is that the module must not be reachable at all. Asserting its absence is what
   * makes "deleted" different from "currently unused".
   */
  it('leaves no screen module behind', () => {
    // `sourceFiles` already skips `__tests__`, so this suite's own filename is not a candidate and
    // needs no exception.
    const survivors = sourceFiles(SRC_ROOT)
      .map(asRepoPath)
      .filter((file) => /typography[-_]?probe/i.test(file));

    expect(survivors).toEqual([]);
  });

  /**
   * Nor is it imported anywhere.
   *
   * Metro's graph is transitive: a Faith screen importing the probe would pull it into the bundle
   * just as surely as a route file would, and would be harder to notice. Prose remains allowed —
   * `docs/DEV_ROUTE_BACKLOG.md` has to be able to record what was removed — so an *import* is what
   * is matched, since that is what puts a module in the graph.
   */
  it('is imported by no module anywhere under src', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .map(asRepoPath)
      .filter((file) => {
        const source = readFileSync(join(process.cwd(), file), 'utf8');
        return (
          new RegExp(`from\\s+['"][^'"]*${PROBE_MODULE}['"]`).test(source) ||
          new RegExp(`require\\(\\s*['"][^'"]*${PROBE_MODULE}['"]`).test(source) ||
          new RegExp(`\\b${PROBE_COMPONENT}\\b\\s*[,}]`).test(source)
        );
      });

    expect(offenders).toEqual([]);
  });

  /**
   * And its diagnostic testIDs appear on no screen.
   *
   * With the probe deleted there is nowhere these belong, so any occurrence means its readout was
   * pasted into a product surface — which is how scaffolding becomes UI.
   */
  it('leaves its diagnostic testIDs nowhere in the app', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .map(asRepoPath)
      .filter((file) =>
        /testID\s*=\s*["']typography-probe/.test(readFileSync(join(process.cwd(), file), 'utf8')),
      );

    expect(offenders).toEqual([]);
  });
});
