import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ROUTE_CLASSES, routeClassFor } from '../protected-routes';

/**
 * **Which launch paths the shared progress surface reaches** — issue #58, by construction.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The three sibling files prove what the surface *does*. This one proves it cannot be bypassed, and
 * it is the reason the fix went where it did.
 *
 * The presentation renders from the authentication boundary's wait branches, and
 * `protected-route-boundary.test.ts` already asserts that every `authenticated` route entry is behind
 * exactly one boundary and that no public or callback route is. So coverage of the notice follows
 * from coverage of the boundary — provided the classification table stays total. A new authenticated
 * route nobody classified would have no boundary, and therefore no notice: that is the hole this file
 * exists to keep shut.
 *
 * It also asserts the thing the issue explicitly asked for — that the notice is written once rather
 * than scattered across the nineteen mount sites. Nineteen copies is nineteen chances to disagree,
 * and one stack being fixed while the rest were not is literally how #28 arose.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const APP_ROOT = join(__dirname, '..', '..', '..', 'app');

/**
 * Every entry Expo Router treats as a route, at the granularity the table is keyed by.
 *
 * `_layout.tsx` is excluded for the reason the sibling suite excludes it: a layout is not a route,
 * it is the thing a route renders through, and the root layout in particular must not be classified
 * — it wraps the public and callback routes too.
 */
function routeEntries(): readonly string[] {
  return readdirSync(APP_ROOT).filter((entry) => entry !== '_layout.tsx');
}

describe('the classification the presentation follows', () => {
  it('classifies every entry under src/app, so a new route cannot slip past', () => {
    for (const entry of routeEntries()) {
      expect(routeClassFor(entry)).not.toBeNull();
    }
  });

  it('keeps public and callback routes out of it', () => {
    /*
      Stated as the property rather than a count, so adding a module does not edit this test. The
      point is the shape: presentation is attached to the thing that waits on authority, and public
      and callback routes never wait on it. A notice over the authentication screens would be the
      same mistake as gating them — which is what the boundary's own docblock rules out.
    */
    const authenticated = Object.keys(ROUTE_CLASSES).filter(
      (key) => ROUTE_CLASSES[key] === 'authenticated',
    );
    expect(authenticated.length).toBeGreaterThan(10);
    expect(ROUTE_CLASSES['index.tsx']).toBe('public');
    expect(ROUTE_CLASSES['(auth)']).toBe('public');
    expect(ROUTE_CLASSES.onboarding).toBe('public');
    expect(ROUTE_CLASSES.auth).toBe('callback');
  });
});

describe('the surface is written once', () => {
  it('is rendered from the boundary, on both of its waiting branches', () => {
    const boundary = readFileSync(join(__dirname, '..', 'protected-route-boundary.tsx'), 'utf8');
    const code = boundary.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    /*
      Both: authority unresolved, and the recovery marker read still outstanding. A notice on one and
      a blank on the other would make the same wait look like two different things — and on a slow
      launch the containment read can be the answer still missing after authority has landed.
    */
    expect(code.match(/<StartupWaitPresentation \/>/g)).toHaveLength(2);
  });

  it('is named in no route file, so no mount site can forget it', () => {
    for (const entry of readdirSync(APP_ROOT, { recursive: true }) as string[]) {
      if (!entry.endsWith('.tsx')) {
        continue;
      }
      expect(readFileSync(join(APP_ROOT, entry), 'utf8')).not.toContain('StartupWaitPresentation');
    }
  });

  it('is not a second recovery-containment decision', () => {
    /*
      The separation the issue requires. Containment stays where it is — one owner in a provider, one
      pure gate in the boundary — and the presentation must not read the marker, mint a grant or end a
      session. It reads a clock.
    */
    const surface = readFileSync(
      join(__dirname, '..', '..', 'startup', 'startup-wait-presentation.tsx'),
      'utf8',
    );
    expect(surface).not.toContain('Recovery');
    expect(surface).not.toContain('useAuth');
    expect(surface).not.toContain('Entitlement');
    expect(surface).not.toContain('Journey');
  });

  it('derives everything it shows at render time, so no earlier launch can speak for a later one', () => {
    /*
      A stale answer from a previous launch must not be able to dismiss this launch's notice, and the
      way that is guaranteed is by there being nothing to go stale. The surface holds no state, runs
      no effect and keeps no ref: both inputs — whether the ceiling has passed, and whether the
      boundary is still waiting — are read during render, from a provider whose clock is created and
      cleared with its own tree.

      A cached "already resolved" flag is the shape of defect this rules out, and it would be
      invisible in a behavioural test that only ever ran one launch.
    */
    const surface = readFileSync(
      join(__dirname, '..', '..', 'startup', 'startup-wait-presentation.tsx'),
      'utf8',
    );
    const code = surface.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('useState');
    expect(code).not.toContain('useEffect');
    expect(code).not.toContain('useRef');
  });

  it('navigates nowhere, so Back has nothing to fall through to', () => {
    /*
      #31's actual defect, guarded in its new location. A progress surface that redirected would be a
      stopwatch issuing a verdict again — telling a signed-in user on a slow link that there is nobody
      signed in.
    */
    const surface = readFileSync(
      join(__dirname, '..', '..', 'startup', 'startup-wait-presentation.tsx'),
      'utf8',
    );
    expect(surface).not.toContain('Redirect');
    expect(surface).not.toContain('useRouter');
    expect(surface).not.toContain('router.');
  });
});
