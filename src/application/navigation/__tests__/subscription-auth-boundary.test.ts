import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AuthState } from '@application/providers/auth-provider';

import { protectedRouteAccess, routeClassFor, ROUTE_CLASSES } from '../protected-routes';
import { recoveryRouteAccess } from '../recovery-route-access';

/**
 * **Purchases belong to a validated account** — the product decision issue #28 left open.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The decision, and why it is this one ───────────────────────────────────
 * #28 observed a simulated purchase completing end to end from a signed-out launch, and closed by
 * asking one question it deliberately did not answer: *should the subscription flow be reachable
 * with no session at all?*
 *
 * It should not. Purchase and entitlement state has to be **owned**: an entitlement is a claim about
 * what a particular account may use, and a purchase made with nobody signed in either belongs to
 * nobody or belongs to whoever happens to sign in next. Neither is a state this app should be able
 * to reach. Anonymous or ambiguously-owned purchase state is not a bug to reconcile later; it is a
 * record with no correct owner, and the only way to not have one is to refuse to create it.
 *
 * So every route in the subscription stack — the welcome screen, plan comparison, the plan details,
 * confirmation, processing, success, restore-purchases and the billing-problem screens — is
 * **authenticated-only**. Truthful pricing may be shown publicly, but only on a route that is
 * explicitly classified `public`, and there is none today.
 *
 * ── Why this file exists when the boundary is already tested ────────────────
 * `protected-route-boundary.test.ts` proves the general rule and lists `subscription` among the
 * authenticated stacks by hand. That is coverage of the mechanism, not a record of the decision: a
 * reviewer reading #28 would find no test that names purchasing, and a hand-written list does not
 * fail when somebody adds `subscription/gift.tsx`.
 *
 * This file enumerates the stack **from the filesystem** and states the reason, so the decision is
 * checkable rather than remembered.
 *
 * ── What is deliberately not here ──────────────────────────────────────────
 * Returning a user to the route they originally asked for, after they authenticate, is desirable and
 * **is not implemented**. `RESUMABLE_ROUTE_PREFIXES` already allow-lists `/subscription`, but only
 * the callback and recovery flows consume it; `ProtectedRouteBoundary` redirects to Welcome and
 * records nothing. That is issue #62, it touches the boundary's redirect rather than its verdict, and
 * it needs its own open-redirect review — so nothing below asserts it works, and the last case here
 * asserts it is honestly absent rather than half-claimed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const APP_ROOT = join(__dirname, '..', '..', '..', 'app');
const SUBSCRIPTION_DIR = join(APP_ROOT, 'subscription');

/**
 * Every route file in the subscription stack, read from disk.
 *
 * From the filesystem rather than a list, because the failure this guards against is a *new* route.
 * A hand-written enumeration passes forever and covers whatever it happened to name on the day.
 */
function subscriptionRouteFiles(): readonly string[] {
  return readdirSync(SUBSCRIPTION_DIR)
    .filter((entry) => entry.endsWith('.tsx'))
    .filter((entry) => entry !== '_layout.tsx')
    .sort();
}

const base = {
  hasCompletedOnboarding: true,
  pendingVerificationEmail: null,
  isBackendConfigured: true,
} as const;

const user = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  fullName: 'A',
  givenName: 'A',
  subscriptionTier: 'free',
  greeting: 'Assalamu Alaikum,',
} as const;

const authStates = {
  resolving: { ...base, status: 'unknown', authority: null, user: null } as AuthState,
  signedOut: { ...base, status: 'signed-out', authority: null, user: null } as AuthState,
  online: { ...base, status: 'signed-in', authority: 'online', user } as AuthState,
  offline: { ...base, status: 'signed-in', authority: 'offline', user } as AuthState,
};

// ─────────────────────────────────────────────────────────────────────────────
// The stack, enumerated
// ─────────────────────────────────────────────────────────────────────────────

describe('the subscription stack', () => {
  it('has the routes this decision covers, and they are read from disk', () => {
    /*
      Named once so the inventory is visible in the record, and asserted as a superset check rather
      than an equality, so adding a route does not fail here — it fails the classification case
      below, which is where a new route should be caught.
    */
    const files = subscriptionRouteFiles();
    for (const expected of [
      'index.tsx',
      'compare.tsx',
      'single.tsx',
      'family.tsx',
      'yearly.tsx',
      'confirm.tsx',
      'processing.tsx',
      'success.tsx',
      'restore.tsx',
      'expired.tsx',
      'billing-issue.tsx',
    ]) {
      expect(files).toContain(expected);
    }
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  it('classifies every one of its routes authenticated, however many there are', () => {
    /*
      The load-bearing case. `ROUTE_CLASSES` is keyed by first path element, so every file under
      `subscription/` inherits the stack's class — which means this passes for a route added
      tomorrow, and fails immediately if anybody re-keys the stack or classifies a file separately
      to make one screen public.
    */
    for (const file of subscriptionRouteFiles()) {
      expect(routeClassFor(`subscription/${file}`)).toBe('authenticated');
    }
    expect(ROUTE_CLASSES.subscription).toBe('authenticated');
  });

  it('cannot silently become public, callback or unclassified', () => {
    /*
      Stated as the negative because those are the three ways the decision could be reversed without
      deleting anything: reclassify the stack public, hide it behind the callback exemption that
      exists for session-establishing links, or drop it from the table so it defaults to nothing.
    */
    expect(ROUTE_CLASSES.subscription).not.toBe('public');
    expect(ROUTE_CLASSES.subscription).not.toBe('callback');
    expect(routeClassFor('subscription/index.tsx')).not.toBeNull();

    /*
      And the fourth way, which is the one a mutation caught this file missing.

      `routeClassFor` keys on the **first** path element only, so a more specific entry like
      `'subscription/gift.tsx': 'public'` does not override the stack — it is inert. That is safe and
      it is also misleading: somebody adding it would believe they had made one screen public, a
      reviewer reading the table would believe the same, and nothing would fail. The route would stay
      authenticated for a reason unrelated to what the table appears to say.

      So no key mentioning this stack may claim a weaker class than the stack has, whether the
      classifier would honour it or not.
    */
    for (const key of Object.keys(ROUTE_CLASSES)) {
      if (!key.includes('subscription')) {
        continue;
      }
      expect(ROUTE_CLASSES[key]).toBe('authenticated');
    }
  });

  it('sits inside the shared authentication boundary', () => {
    /*
      Asserted on the layout's source, comments stripped, because the guarantee is structural: one
      boundary at the outermost point of the stack is what makes every route above inherit the
      decision without each file remembering to.
    */
    const layout = readFileSync(join(SUBSCRIPTION_DIR, '_layout.tsx'), 'utf8');
    const code = layout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain('<ProtectedRouteBoundary>');
    expect(code).toContain('</ProtectedRouteBoundary>');
    expect(code).toContain("from '@application/navigation/protected-route-boundary'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What each authority may do with it
// ─────────────────────────────────────────────────────────────────────────────

describe('who may enter the purchase flow', () => {
  it('turns a definitive signed-out verdict away', () => {
    /*
      The decision itself. A visitor the server has confirmed has no session may not begin a purchase
      — not because the screens would break, but because anything they completed would produce
      entitlement state with no account to own it.
    */
    expect(protectedRouteAccess(authStates.signedOut)).toBe('redirect');
  });

  it('waits while authority is unresolved, rather than admitting or ejecting', () => {
    /*
      `unknown` is not a verdict. Admitting here would open the purchase flow for somebody nobody has
      established is signed in; redirecting would eject a signed-in user one frame before their
      session resolves, on every cold link into the stack.
    */
    expect(protectedRouteAccess(authStates.resolving)).toBe('wait');
  });

  it('admits a validated online session', () => {
    expect(protectedRouteAccess(authStates.online)).toBe('allow');
  });

  it('admits permitted-offline authority on the same terms as any authenticated route', () => {
    /*
      A receipt is authority, and the route layer deliberately admits it — this stack is not special
      and must not invent a stricter rule of its own.

      What that does **not** grant is purchase capability. Reaching a screen and being able to
      transact are different questions: the receipt carries no entitlement claim at all and its tier
      is always free, so an offline launch cannot unlock anything, and whatever a real payment
      provider requires it is not going to be satisfiable with no network. This asserts reachability
      only, which is the whole of what a route class decides.
    */
    expect(protectedRouteAccess(authStates.offline)).toBe('allow');
    expect(authStates.offline.user?.subscriptionTier).toBe('free');
  });

  it('is outranked by an open recovery, whatever the authority says', () => {
    /*
      Precedence, not an alternative. A session that owes a password is signed in — that is why the
      marker exists — so it reaches the boundary's `allow` and is then held by the containment gate.
      A purchase flow entered while a recovery is unfinished would be a transaction by a session the
      app is in the middle of refusing to trust.
    */
    expect(protectedRouteAccess(authStates.online)).toBe('allow');
    expect(recoveryRouteAccess({ recoveryOpen: true, resolved: true })).toBe('contain');
    /* And an unresolved marker read holds rather than guessing. */
    expect(recoveryRouteAccess({ recoveryOpen: false, resolved: false })).toBe('wait');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What this decision must not disturb
// ─────────────────────────────────────────────────────────────────────────────

describe('the routes a signed-out visitor still needs', () => {
  it('leaves the entry gate, onboarding and the authentication screens public', () => {
    /*
      The counterweight. "Purchases require an account" is only a coherent policy if getting an
      account is reachable without one — so the same file that pins the restriction pins the way out
      of it.
    */
    expect(ROUTE_CLASSES['index.tsx']).toBe('public');
    expect(ROUTE_CLASSES['(auth)']).toBe('public');
    expect(ROUTE_CLASSES.onboarding).toBe('public');
  });

  it('leaves the authentication callback reachable with no session', () => {
    /* A protocol requirement: gating the route that establishes a session behind a session. */
    expect(ROUTE_CLASSES.auth).toBe('callback');
  });

  it('names no public pricing route, because there is not one yet', () => {
    /*
      Truthful public pricing is permitted by the decision — but only on a route explicitly
      classified `public`, and none exists. Asserted so that adding one is a deliberate act with a
      failing test to update, rather than a quiet reclassification of a purchase screen.
    */
    const publicEntries = Object.keys(ROUTE_CLASSES).filter(
      (key) => ROUTE_CLASSES[key] === 'public',
    );
    expect(publicEntries).not.toContain('subscription');
    expect(publicEntries.some((entry) => entry.includes('pricing'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The follow-up this file must not pretend to have done
// ─────────────────────────────────────────────────────────────────────────────

describe('returning a visitor to the route they asked for', () => {
  it('is not implemented by the boundary, and is not claimed to be', () => {
    /*
      Issue #62. The sanitiser exists and already allow-lists `/subscription`, but the boundary
      redirects to Welcome and records nothing — so a signed-out visitor who opens a purchase screen
      cannot be carried back to it afterwards.

      Asserted rather than merely left out, because the honest failure mode of a decision-recording
      test is to imply the whole story is finished. If somebody implements #62, this case fails and
      whoever changes it has to state what the boundary now does with the request.
    */
    const boundary = readFileSync(join(__dirname, '..', 'protected-route-boundary.tsx'), 'utf8');
    const code = boundary.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain('authRoutes.welcome');
    expect(code).not.toContain('pendingDestination');
    expect(code).not.toContain('RESUMABLE');
  });
});
