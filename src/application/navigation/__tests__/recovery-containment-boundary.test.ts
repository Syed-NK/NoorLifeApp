import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { recoveryRouteAccess } from '../recovery-route-access';
import { ROUTE_CLASSES, routeClassFor } from '../protected-routes';

/**
 * **A recovery-contained session reaches nothing but its recovery** — the guard for issue #30.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The gap ────────────────────────────────────────────────────────────────
 * `useRecoveryContainment` was called from `useStartupRouting`, which only `src/app/index.tsx`
 * mounts. Expo Router makes a deep-linked route the *initial* route, so on a direct link the entry
 * gate never mounted, the marker was never read, and no containment decision was taken — while the
 * session restored normally. A user with an open, unfinished password recovery could reach any
 * authenticated route by link.
 *
 * ── What is asserted here, and what is asserted elsewhere ──────────────────
 * Three things live in this file: the *ownership* facts (one actor, one set of side effects, armed
 * above the navigator), the *policy* facts (which route classes a contained user may reach), and the
 * *decision* facts (`recoveryRouteAccess` for every combination).
 *
 * The lifecycle — a marker written by a real exchange, reconstructed on launch, and released on
 * every exit path — is asserted against the running providers in
 * `auth-callback/__tests__/recovery-containment-lifecycle.test.tsx`, and the pure launch-time matrix
 * cell by cell in `startup/__tests__/recovery-containment.test.ts`. Neither is duplicated here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SRC = join(__dirname, '..', '..', '..');

function read(...parts: readonly string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8');
}

/** Comment-stripped, so prose naming a symbol can never stand in for calling it. */
function code(...parts: readonly string[]): string {
  return read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Every production source file, so an ownership claim can be checked against all of them. */
function productionSources(): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'test-support') {
          walk(full);
        }
        continue;
      }
      if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
  };
  walk(SRC);
  return found;
}

describe('there is exactly one containment owner', () => {
  /*
    The single most important assertion in this file. Mounting the actor more widely is only safe if
    it is mounted *once* — a second instance would carry its own `settled` ref and could re-mint a
    grant the password screen had deliberately released, resurrecting a consumed recovery.
  */
  it('calls useRecoveryContainment from exactly one production file', () => {
    const HOOK = join('application', 'startup', 'use-recovery-containment.ts');
    const callers = productionSources()
      // The hook's own module declares it; a declaration is not a call site.
      .filter((file) => !file.endsWith(HOOK))
      .filter((file) =>
        /useRecoveryContainment\s*\(/.test(
          readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, ''),
        ),
      );

    expect(callers.map((file) => file.slice(SRC.length + 1).replace(/\\/g, '/'))).toEqual([
      'application/providers/recovery-containment-provider.tsx',
    ]);
  });

  it('mounts that owner in AppProviders, which every route renders through', () => {
    /*
      This is what makes containment launch-global: `AppProviders` is rendered by the root layout, so
      the actor is armed for a cold direct link, a warm link, an ordinary launch and a launch that
      begins on the callback alike — the same reasoning `useNativeSplashBackstop` records for the
      native splash ceiling.
    */
    const providers = code('application', 'providers', 'app-providers.tsx');
    expect(providers).toContain('<RecoveryContainmentProvider>');
    expect(code('app', '_layout.tsx')).toContain('<AppProviders>');
  });

  it('mounts it inside Auth and AuthCallback, whose actions it needs', () => {
    const providers = code('application', 'providers', 'app-providers.tsx');
    const actor = providers.indexOf('<RecoveryContainmentProvider>');
    // It reads the session and may sign out; it mints and clears the in-memory grant.
    expect(providers.indexOf('<AuthProvider>')).toBeLessThan(actor);
    expect(providers.indexOf('<AuthCallbackProvider>')).toBeLessThan(actor);
  });

  it('no longer lets the entry route be the thing that arms containment', () => {
    /*
      The defect, asserted directly. `useStartupRouting` must consume the verdict, not own the actor —
      otherwise a launch that skips the entry gate skips containment, which is the whole issue.
    */
    const routing = code('application', 'startup', 'use-startup-routing.ts');
    expect(routing).not.toMatch(/useRecoveryContainment\s*\(/);
    expect(routing).toContain('useRecoveryContainmentState()');
  });

  it('still feeds the startup machine the same verdict it always did', () => {
    // Ordinary signed-out, signed-in and offline startup routing must be untouched by the move.
    expect(code('application', 'startup', 'use-startup-routing.ts')).toContain(
      'hasPendingRecovery:',
    );
  });
});

describe('the gate performs no side effect of its own', () => {
  /*
    The non-duplication proof for the *nineteen* mount points. The boundary is mounted once per
    authenticated branch, so if it did any of these things it would do them nineteen times over.
    It reads two context values and renders — nothing else.
  */
  const boundary = code('application', 'navigation', 'protected-route-boundary.tsx');

  it('reads no storage and writes none', () => {
    expect(boundary).not.toMatch(
      /AsyncStorage|SecureStore|readRecoveryPending|writeRecoveryPending/,
    );
  });

  it('clears no marker and no grant', () => {
    expect(boundary).not.toMatch(/clearRecoveryPending|clearRecovery\s*\(/);
  });

  it('mints no grant', () => {
    expect(boundary).not.toMatch(/grantRecovery/);
  });

  it('ends no session', () => {
    expect(boundary).not.toMatch(/signOut/);
  });

  it('registers no listener and holds no state', () => {
    expect(boundary).not.toMatch(/useEffect|useState|useRef|addEventListener|addListener/);
  });

  it('imperatively navigates nowhere — it renders a declarative replacement', () => {
    /*
      `Redirect` replaces rather than pushes, and being declarative it cannot fire twice for one
      decision the way an effect calling `router.replace` could under a double render.
    */
    expect(boundary).toContain('<Redirect href={SET_NEW_PASSWORD_ROUTE} />');
    expect(boundary).not.toMatch(/router\.(push|replace|navigate)/);
  });

  it('is therefore safe to mount at every authenticated branch', () => {
    // The same component the authentication boundary uses, so the count cannot drift between them.
    expect(boundary).toContain('<RecoveryContainmentGate>');
  });
});

describe('the actor owns every side effect, and each is idempotent or guarded', () => {
  const hook = code('application', 'startup', 'use-recovery-containment.ts');

  it('guards its decision with a once-per-instance latch', () => {
    expect(hook).toContain('settled.current');
  });

  it('keeps the marker read separate from the decision, which stays pure', () => {
    expect(hook).toContain('resolveRecoveryContainment(read, sessionUserId)');
    // The pure function is where the matrix lives; the hook only carries out what it returns.
    expect(code('application', 'startup', 'recovery-containment.ts')).not.toMatch(
      /AsyncStorage|SecureStore|useEffect|signOut/,
    );
  });

  it('cancels its in-flight read on unmount, so a late answer cannot set state', () => {
    expect(hook).toContain('cancelled');
  });

  it('clears the marker before ending the session, so the sequence describes itself', () => {
    const signOutBranch = hook.slice(hook.indexOf("case 'sign-out'"));
    expect(signOutBranch.indexOf('clearRecoveryPending')).toBeLessThan(
      signOutBranch.indexOf('signOut('),
    );
  });
});

describe('route policy while a recovery is open', () => {
  /*
    The policy is not a new list. Containment is composed *inside* the authentication boundary, so
    "which routes can a contained user reach" is answered by the classification that already exists:
    everything `authenticated` is behind the gate, and everything `public` or `callback` is not.

    That is what makes the recovery screen, the callback and the authentication screens reachable
    without a single route-specific exemption — and it is why the redirect cannot loop.
  */
  it('leaves the recovery screen reachable, so the redirect has a destination', () => {
    expect(routeClassFor('auth/set-new-password.tsx')).toBe('callback');
  });

  it('leaves the callback reachable, so a fresh link can still establish a recovery', () => {
    expect(routeClassFor('auth/callback.tsx')).toBe('callback');
  });

  it('leaves the authentication screens reachable, so a contained user can exit by signing out', () => {
    expect(routeClassFor('(auth)/welcome.tsx')).toBe('public');
    expect(routeClassFor('(auth)/sign-in.tsx')).toBe('public');
    expect(routeClassFor('(auth)/forgot-password.tsx')).toBe('public');
  });

  it('blocks every authenticated class, named individually', () => {
    for (const entry of [
      'faith',
      'planner',
      'subscription',
      'health',
      'finance',
      'learning',
      'family',
      'goals',
      'ai',
      'profile',
      'settings',
      'home.tsx',
      'insights.tsx',
      'modules.tsx',
      'notifications.tsx',
      'personalization.tsx',
      'module-coming-soon.tsx',
      'hero-audit.tsx',
      'module-gallery.tsx',
    ]) {
      expect(ROUTE_CLASSES[entry]).toBe('authenticated');
    }
  });

  it('redirects to the recovery screen and nowhere else', () => {
    const boundary = read('application', 'navigation', 'protected-route-boundary.tsx');
    expect(boundary).toContain('SET_NEW_PASSWORD_ROUTE');
  });

  it('grants no route a recovery-specific exemption', () => {
    /*
      A per-route escape hatch is how the original inconsistency arose — one stack treated differently
      from the rest. The gate consults nothing about the destination.
    */
    /*
      Module and function names legitimately contain "route" — what must be absent is any inspection
      of *which* route is being entered: a module id, a pathname, or the router's segments.
    */
    const gate = code('application', 'navigation', 'recovery-route-access.ts');
    expect(gate).not.toMatch(/faith|planner|subscription|profile|settings/i);
    expect(gate).not.toMatch(/pathname|useSegments|usePathname|href/i);
  });
});

describe('what the gate decides, per state', () => {
  it('contains an open recovery', () => {
    expect(recoveryRouteAccess({ recoveryOpen: true, resolved: true })).toBe('contain');
  });

  it('contains an open recovery even before the launch-time read answers', () => {
    /*
      The callback screen mints a grant directly on a fresh exchange, so a grant can exist before the
      marker read finishes. Checking `resolved` first would let that recovery through for one render.
    */
    expect(recoveryRouteAccess({ recoveryOpen: true, resolved: false })).toBe('contain');
  });

  it('waits while the launch-time read has not answered', () => {
    /*
      A cold direct link renders before the marker has been read. Admitting here would flash a
      protected screen — and on a link into Planner that screen would have issued its reads.
    */
    expect(recoveryRouteAccess({ recoveryOpen: false, resolved: false })).toBe('wait');
  });

  it('allows once the read has answered and no recovery is open', () => {
    expect(recoveryRouteAccess({ recoveryOpen: false, resolved: true })).toBe('allow');
  });

  it('releases the moment the grant is cleared, without being told', () => {
    /*
      Completing, cancelling or invalidating a recovery clears the grant. Because the gate reads the
      live grant rather than the launch-time verdict, that single clear is the release — exactly once,
      with nothing to remember. The launch-time verdict deliberately does not gate this: it stays
      `resolved` and would otherwise hold the user at the password screen after they had set it.
    */
    expect(recoveryRouteAccess({ recoveryOpen: true, resolved: true })).toBe('contain');
    expect(recoveryRouteAccess({ recoveryOpen: false, resolved: true })).toBe('allow');
  });

  it('is a total function over both inputs', () => {
    for (const recoveryOpen of [true, false]) {
      for (const resolved of [true, false]) {
        expect(['allow', 'contain', 'wait']).toContain(
          recoveryRouteAccess({ recoveryOpen, resolved }),
        );
      }
    }
  });
});

describe('the authentication boundary is unchanged and still first', () => {
  const boundary = code('application', 'navigation', 'protected-route-boundary.tsx');

  it('answers identity before it answers recovery', () => {
    /*
      The order is a dependency, not a preference: a contained user *is* signed in, so asking about
      recovery is only meaningful once authority is established.
    */
    expect(boundary.indexOf('protectedRouteAccess(auth)')).toBeLessThan(
      boundary.indexOf('recoveryRouteAccess('),
    );
    expect(boundary.indexOf('<Redirect href={authRoutes.welcome} />')).toBeLessThan(
      boundary.indexOf('<RecoveryContainmentGate>'),
    );
  });

  it('keeps the two decisions as separate functions in separate modules', () => {
    // Neither may grow the other's opinion.
    expect(code('application', 'navigation', 'recovery-route-access.ts')).not.toMatch(
      /isLocallyAuthenticated|AuthState|status ===/,
    );
    expect(code('application', 'navigation', 'protected-routes.ts')).not.toMatch(/recovery|grant/i);
  });

  it('still renders no protected content while authority is unresolved', () => {
    /*
      Issue #31's wait is untouched: the authentication branch returns before `children` is
      referenced, exactly as before, and the recovery gate is not reached at all in that state.
    */
    /* Comments stripped: the guarantee is about the code, not the prose explaining it. */
    const stripped = boundary.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const authWait = stripped.slice(
      stripped.indexOf("if (access === 'wait')"),
      stripped.indexOf("if (access === 'redirect')"),
    );
    /*
      #31's wait now shows #58's identity-free notice past the ceiling instead of a blank canvas.
      What is untouched is the part that matters here: the authentication branch still returns before
      the protected tree is referenced, and the recovery gate is still not reached in that state.
    */
    expect(authWait).toContain('<StartupWaitPresentation />');
    expect(authWait).not.toContain('children');
  });

  it('leaves entitlement running after both decisions', () => {
    for (const module of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      const layout = code('app', module, '_layout.tsx');
      expect(layout).toContain(`<ModuleEntitlementGate moduleId="${module}"`);
      expect(layout.indexOf('<ProtectedRouteBoundary>')).toBeLessThan(
        layout.indexOf('<ModuleEntitlementGate'),
      );
    }
  });
});

describe('nothing reaches storage through a recovery route', () => {
  it('exposes no owner and no account-scoped read from the gate', () => {
    const gate = code('application', 'navigation', 'protected-route-boundary.tsx');
    expect(gate).not.toMatch(/ownerId|userId|noorlife\./);
  });

  it('carries a verdict and no actions across the context', () => {
    /*
      A consumer that could mint a grant or clear a marker would be a second owner in all but name.
      The provider publishes state only.
    */
    const provider = code('application', 'providers', 'recovery-containment-provider.tsx');
    expect(provider).not.toMatch(/ActionsContext|grantRecovery|clearRecovery|signOut/);
  });

  it('fails closed when the provider is absent', () => {
    /*
      `pending: null` is "unanswered", so a tree rendered without the provider waits rather than
      assuming no recovery is in progress. Production always has it; this is the safe reading for the
      case that cannot happen.
    */
    const provider = read('application', 'providers', 'recovery-containment-provider.tsx');
    expect(provider).toMatch(/UNANSWERED[\s\S]{0,120}pending: null/);
    expect(recoveryRouteAccess({ recoveryOpen: false, resolved: false })).toBe('wait');
  });
});
