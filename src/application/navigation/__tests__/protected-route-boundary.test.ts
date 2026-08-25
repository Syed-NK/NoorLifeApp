import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AuthState } from '@application/providers/auth-provider';

import {
  ROUTE_CLASSES,
  authenticatedRouteEntries,
  protectedRouteAccess,
  routeClassFor,
} from '../protected-routes';

/**
 * **Every route that needs authority is behind the one boundary** — the guard for issue #28.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * The authentication decision lived at the entry route, `src/app/index.tsx`, and a direct URL
 * renders its target without ever mounting it. Faith had its own guard; the other twelve
 * authenticated stacks had an *entitlement* gate and no authentication decision at all, so
 * "may this account use this module" was enforced where "is anybody signed in" was not.
 *
 * ── Why these tests read the filesystem ────────────────────────────────────
 * Because the defect was a *missing* guard, and no rendered assertion can fail for a screen nobody
 * remembered to guard. The proof has to be exhaustive over the route tree rather than over a list
 * somebody maintained: these tests walk `src/app`, require every route to be classified, and require
 * every classified-authenticated route to be behind the boundary. Adding an unguarded route fails a
 * test without anybody having to think of it.
 *
 * The behavioural half — what the boundary decides for each authority state — is asserted on the
 * pure function, the same way `faith-deep-link-authority.test.tsx` does, and for the same reason: a
 * decision expressed as a function is assertable without a navigator, a provider tree or a mounted
 * screen.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const APP_ROOT = join(__dirname, '..', '..', '..', 'app');
const BOUNDARY = 'ProtectedRouteBoundary';

/** Every route file under `src/app`, as paths relative to it. */
function routeFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, prefix === '' ? entry : `${prefix}/${entry}`);
        continue;
      }
      if (entry.endsWith('.tsx')) {
        found.push(prefix === '' ? entry : `${prefix}/${entry}`);
      }
    }
  };
  walk(APP_ROOT, '');
  /*
    The root layout is excluded because it is not a route and cannot have a class: it renders for
    every one of them. What matters about it is asserted separately — it must carry no boundary,
    because a boundary there would gate the authentication screens themselves.
  */
  return found.filter((file) => file !== '_layout.tsx');
}

function source(relative: string): string {
  return readFileSync(join(APP_ROOT, relative), 'utf8');
}

/** Comment-stripped, so a docblock mentioning the boundary can never stand in for mounting it. */
function code(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const base = {
  hasCompletedOnboarding: true,
  pendingVerificationEmail: null,
  isBackendConfigured: true,
} as const;

/**
 * The authority states the provider can publish, in the shape it publishes them.
 *
 * Complete `AuthState` values rather than partials cast into place: the boundary reads `status` and
 * `authority`, and a fixture that omitted the rest would still compile past a widened signature —
 * which is exactly the change most likely to break this rule by accident.
 */
const authStates = {
  resolving: { ...base, status: 'unknown', authority: null, user: null } as AuthState,
  signedOut: { ...base, status: 'signed-out', authority: null, user: null } as AuthState,
  online: {
    ...base,
    status: 'signed-in',
    authority: 'online',
    user: {
      id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      fullName: 'A',
      givenName: 'A',
      subscriptionTier: 'free',
      greeting: 'Assalamu Alaikum,',
    },
  } as AuthState,
  offline: {
    ...base,
    status: 'signed-in',
    authority: 'offline',
    user: {
      id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      fullName: 'A',
      givenName: 'A',
      subscriptionTier: 'free',
      greeting: 'Assalamu Alaikum,',
    },
  } as AuthState,
};

describe('the route classification is exhaustive', () => {
  /*
    The single most valuable assertion here. The defect was twelve unclassified stacks; this makes
    "somebody added a route and nobody thought about authentication" a failing test rather than a
    thing discovered on a device.
  */
  it('classifies every route file under src/app', () => {
    const unclassified = routeFiles().filter((file) => routeClassFor(file) === null);
    expect(unclassified).toEqual([]);
  });

  it('classifies each of the three classes at least once, so none is vestigial', () => {
    const classes = new Set(Object.values(ROUTE_CLASSES));
    expect(classes).toEqual(new Set(['public', 'callback', 'authenticated']));
  });

  it('keeps the entry gate, onboarding and the authentication screens public', () => {
    expect(routeClassFor('index.tsx')).toBe('public');
    expect(routeClassFor('splash.tsx')).toBe('public');
    expect(routeClassFor('+not-found.tsx')).toBe('public');
    expect(routeClassFor('(auth)/welcome.tsx')).toBe('public');
    expect(routeClassFor('(auth)/sign-in.tsx')).toBe('public');
    expect(routeClassFor('onboarding/one.tsx')).toBe('public');
  });

  it('keeps the authentication callback reachable without a session', () => {
    /*
      A protocol requirement, not a product choice: the callback is the route a confirmation or
      recovery link lands on, so gating it behind a session would break the flow that creates the
      session. Kept as its own class so it can never be widened together with `public`.
    */
    expect(routeClassFor('auth/callback.tsx')).toBe('callback');
    expect(routeClassFor('auth/set-new-password.tsx')).toBe('callback');
  });

  it('classifies every module, account and system stack as authenticated', () => {
    for (const entry of [
      'faith',
      'health',
      'planner',
      'finance',
      'learning',
      'family',
      'goals',
      'ai',
      'profile',
      'settings',
      'subscription',
      'home.tsx',
      'insights.tsx',
      'modules.tsx',
      'notifications.tsx',
      'personalization.tsx',
      'module-coming-soon.tsx',
    ]) {
      expect(ROUTE_CLASSES[entry]).toBe('authenticated');
    }
  });

  it('grants no route-specific exemption to the development audit routes', () => {
    /*
      They already redirect to Home in a release build, so they are not a production surface — but
      classifying them as an exception would have introduced the app's first route-specific bypass
      to save a signed-out developer one sign-in.
    */
    expect(ROUTE_CLASSES['module-gallery.tsx']).toBe('authenticated');
    expect(ROUTE_CLASSES['hero-audit.tsx']).toBe('authenticated');
  });
});

describe('every authenticated route is behind the boundary', () => {
  /**
   * Where the boundary has to be, for each authenticated entry.
   *
   * A stack directory is covered by its `_layout.tsx`, which every route in it renders through. A
   * top-level file has no layout to intervene in — Expo Router gives a route file no parent but the
   * root — so it carries the boundary itself.
   */
  function coveringFile(entry: string): string {
    return entry.endsWith('.tsx') ? entry : `${entry}/_layout.tsx`;
  }

  it.each(authenticatedRouteEntries())('%s mounts the boundary', (entry) => {
    expect(code(coveringFile(entry))).toContain(`<${BOUNDARY}>`);
  });

  it.each(authenticatedRouteEntries())('%s mounts it outermost', (entry) => {
    /*
      Placement is the fix, not presence. A boundary nested inside a provider would let that provider
      be constructed for somebody the app has not established is signed in — and the Faith layout
      builds a whole repository set on mount.
    */
    const body = code(coveringFile(entry));
    const at = body.indexOf(`<${BOUNDARY}>`);
    /*
      `Redirect` is excluded from "anything else": the two development audit routes answer "not in a
      release build" before anything else, which renders no protected content and needs no authority
      to say. Every other capitalised element is a provider, a gate or a screen.
    */
    const firstOther = body.search(/<(?!ProtectedRouteBoundary|Redirect|\/|>)[A-Z]/);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThanOrEqual(firstOther === -1 ? Number.MAX_SAFE_INTEGER : firstOther);
  });

  it('puts authentication outside entitlement on every gated module', () => {
    /*
      The order is the point: who are you, then what may you use. Reversed, a signed-out visitor
      arriving by direct link is shown a purchase offer — which is what issue #28 observed, where the
      entitlement gate was the only thing between a link and a module home.
    */
    for (const module of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      const layout = code(`${module}/_layout.tsx`);
      expect(layout).toContain('ModuleEntitlementGate');
      expect(layout.indexOf(`<${BOUNDARY}>`)).toBeLessThan(
        layout.indexOf('<ModuleEntitlementGate'),
      );
    }
  });

  it('does not weaken any entitlement gate', () => {
    // Same six gates, same module ids, still present after the change.
    for (const module of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      expect(code(`${module}/_layout.tsx`)).toContain(
        `<ModuleEntitlementGate moduleId="${module}"`,
      );
    }
  });
});

describe('no public or callback route is behind the boundary', () => {
  /*
    The other half of the coverage proof, and the one that stops an over-eager fix. A boundary on the
    authentication screens or the callback would lock the user out of the only routes that can
    establish authority — a redirect loop for the first, a broken confirmation link for the second.
  */
  const openEntries = Object.keys(ROUTE_CLASSES).filter(
    (key) => ROUTE_CLASSES[key] !== 'authenticated',
  );

  it.each(openEntries)('%s stays reachable with no authority', (entry) => {
    const files = entry.endsWith('.tsx')
      ? [entry]
      : routeFiles().filter((file) => file.startsWith(`${entry}/`));
    for (const file of files) {
      expect(code(file)).not.toContain(BOUNDARY);
    }
  });

  it('keeps the boundary off the root layout, which every public route renders through', () => {
    /*
      The narrowest layout containing every authenticated route is the root — and it contains the
      entry gate, onboarding, the authentication screens and the callback too, so a boundary there
      would gate the only routes that can establish authority. This is why the boundary is mounted
      once per authenticated branch instead of once overall.
    */
    expect(code('_layout.tsx')).not.toContain(BOUNDARY);
  });

  it('leaves the entry gate as the only route that resolves a startup destination', () => {
    /*
      One authority, asserted structurally: if the boundary ever grew its own idea of where a
      signed-out user belongs, it would be reading the startup machine here.
      `useStartupRouting` stays the entry gate's alone.
      */
    const boundary = readFileSync(join(__dirname, '..', 'protected-route-boundary.tsx'), 'utf8');
    const rules = readFileSync(join(__dirname, '..', 'protected-routes.ts'), 'utf8');
    for (const body of [boundary, rules]) {
      expect(body).not.toContain('useStartupRouting');
      expect(body).not.toContain('nextStartupState');
    }
  });
});

describe('what the boundary decides, per authority state', () => {
  it('rejects a definitively signed-out visitor', () => {
    expect(protectedRouteAccess(authStates.signedOut)).toBe('redirect');
  });

  it('allows a live authenticated session', () => {
    expect(protectedRouteAccess(authStates.online)).toBe('allow');
  });

  it('allows valid permitted-offline authority', () => {
    /*
      `isLocallyAuthenticated`, deliberately. Opening your own downloaded Qur'an in an aeroplane is
      what the offline receipt is for, and a boundary that demanded a live session would lock a
      legitimately signed-in user out of data already on their phone. Connectivity stays a
      per-operation question with its own predicate.
    */
    expect(protectedRouteAccess(authStates.offline)).toBe('allow');
  });

  it('waits while authority is unresolved, rather than deciding', () => {
    /*
      Neither answer is safe here. Redirecting would bounce a signed-in user to Authentication
      Options one frame before their session resolves, on every cold deep link; admitting would mount
      a protected screen for somebody nobody has established is signed in.
    */
    expect(protectedRouteAccess(authStates.resolving)).toBe('wait');
  });

  it('renders nothing and issues no read while waiting', () => {
    /*
      Asserted on the component's source because the guarantee is about what does *not* happen:
      `wait` returns before `children` is referenced, so no protected provider mounts and no
      repository is constructed. A test that rendered it could only observe the absence.
    */
    const boundary = readFileSync(join(__dirname, '..', 'protected-route-boundary.tsx'), 'utf8');
    /*
      Comments stripped before the check — issue #58 gave this branch a rendered surface and a
      paragraph explaining why, and the guarantee is about the code rather than the prose. Asserting
      against the raw text would fail on a comment that merely names what it is not doing.
    */
    const stripped = boundary.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const waitBranch = stripped.slice(
      stripped.indexOf("if (access === 'wait')"),
      stripped.indexOf("if (access === 'redirect')"),
    );
    /*
      What it renders is a presentation surface that reads a clock — issue #58. It is rendered
      *instead of* the protected tree, on a branch that had already decided to withhold it, so the
      guarantee below is unchanged in substance: the wait branch returns before the protected tree
      is referenced, so no protected provider mounts and no repository is constructed.
    */
    expect(waitBranch).toContain('<StartupWaitPresentation />');
    expect(waitBranch).not.toContain('children');
  });

  it('fails closed on expired, invalid or cleared authority', () => {
    /*
      There is no state between authority and none: the provider drops the session and the receipt on
      a definitive server verdict rather than downgrading them, so every one of those cases arrives
      as `signed-out`. Asserted rather than assumed, because a future "stale" status that defaulted
      to allow is exactly how this would regress.
      */
    const expiredShapes: readonly AuthState[] = [
      { ...base, status: 'signed-out', authority: null, user: null } as AuthState,
      // A cleared receipt leaves no user behind even if a status were mis-set.
      { ...base, status: 'signed-out', authority: 'offline', user: null } as AuthState,
    ];
    for (const state of expiredShapes) {
      expect(protectedRouteAccess(state)).toBe('redirect');
    }
  });

  it('replaces history rather than pushing, so Back cannot reveal protected content', () => {
    /*
      `Redirect` replaces. A pushed navigation would leave the guarded screen mounted underneath —
      one gesture away, and already having issued its reads.
    */
    const boundary = readFileSync(join(__dirname, '..', 'protected-route-boundary.tsx'), 'utf8');
    expect(boundary).toContain('<Redirect href={authRoutes.welcome} />');
    expect(boundary).not.toMatch(/router\.push|\.push\(/);
  });
});

describe('there is exactly one authentication decision in the application', () => {
  it('retired the Faith-only guard rather than leaving a second implementation', () => {
    const faithGuard = join(
      __dirname,
      '..',
      '..',
      '..',
      'features',
      'faith',
      'di',
      'faith-route-guard.tsx',
    );
    expect(() => readFileSync(faithGuard, 'utf8')).toThrow();
  });

  it('leaves no route deciding authentication for itself', () => {
    /*
      A route that consulted `useAuth` to decide whether to render would be a second boundary with
      its own opinion — the exact shape of the divergence issue #28 describes, where one stack was
      guarded and twelve were not. The boundary is the only thing under `src/app` that reads it.
    */
    const offenders = routeFiles().filter((file) => {
      const body = code(file);
      return /useAuth\(|isLocallyAuthenticated|isOnlineAuthenticated/.test(body);
    });
    expect(offenders).toEqual([]);
  });

  it('reaches the authority through the shared predicate, not a status comparison of its own', () => {
    const rules = readFileSync(join(__dirname, '..', 'protected-routes.ts'), 'utf8');
    const body = rules
      .slice(rules.indexOf('export function protectedRouteAccess'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).toContain('isLocallyAuthenticated');
    // `unknown` is the one status read directly, because it is the absence of a verdict.
    expect(body.match(/status ===/g) ?? []).toHaveLength(1);
  });
});
