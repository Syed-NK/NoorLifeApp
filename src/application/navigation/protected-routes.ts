import { isLocallyAuthenticated, type AuthState } from '@application/providers/auth-provider';

/**
 * **Which routes need authority, and what the one authority says about them.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this closes (issue #28) ─────────────────────────────────────
 * The application's authentication decision lived at the *entry route*, `src/app/index.tsx`. That
 * file resolves a startup destination and redirects to it — so it decides for launches that go
 * through it, and for nothing else. Expo Router makes a deep-linked route the *initial* route, so a
 * direct URL renders its target and never mounts the entry gate. No authentication decision was
 * taken for it by anybody.
 *
 * Faith already had a guard for exactly this reason, added when a Faith deep link was observed
 * opening a previous account's saved selections while the visible navigation sat at Authentication
 * Options. That guard closed the hole for one stack out of thirteen. Every other authenticated
 * stack had only `ModuleEntitlementGate`, which answers a different question — *may this account
 * use this module* — so entitlement was enforced where identity was not.
 *
 * ── Why a table rather than a guard bolted onto each stack ─────────────────
 * Six copies of an access rule is six chances to disagree, and that divergence is literally how this
 * inconsistency arose: one stack was fixed and the rest were not. So the rule is one function, the
 * classification is one table, and `protected-route-boundary.test.ts` reads every file under
 * `src/app` and fails if any of them is missing from the table. A new route cannot be added without
 * being classified — the proof of coverage is by construction rather than by remembering.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 * It is not the data boundary, and it must never be mistaken for one. `plannerTaskAddress`,
 * `resolveFaithAddress` and their siblings independently return `null` without an owner, so every
 * read answers `unavailable` whatever the router did. This stops the *screen* from mounting; the
 * storage layer stops the *data* from being readable. Neither substitutes for the other and the
 * tests assert them separately — the same separation `faith-deep-link-authority.test.tsx` already
 * documents, for the same reason: either one could rot silently behind the other.
 *
 * It is also not a second authentication state machine. There is exactly one authority — `AuthState`
 * from `auth-provider` — and this module reads it through the same `isLocallyAuthenticated`
 * predicate every other consumer uses. Nothing here re-derives a session, reads a receipt, or holds
 * a state of its own.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * What kind of route this is, with respect to authority.
 *
 * ── Why there is no `'authenticated-online'` class ─────────────────────────
 * Because no route is. Requiring a live session to *reach* a screen would lock a legitimately
 * signed-in user out of data already on their phone — opening your own downloaded Qur'an in an
 * aeroplane is precisely what the offline receipt is for. Connectivity is a per-operation question,
 * and it already has its own predicate: `isOnlineAuthenticated`, which every remote call must ask
 * for explicitly. A route decides *identity*; an operation decides *reachability of a server*.
 * Collapsing the two here would either strand offline users or authorise network calls a receipt
 * cannot pay for.
 */
export type RouteClass =
  /** Reachable before anybody has signed in: onboarding, the authentication screens, the entry gate. */
  | 'public'
  /**
   * A link-driven system route that must stay reachable with no session **by design**.
   *
   * The authentication callback is the route a confirmation or recovery link lands on, so gating it
   * behind a session would break the flow that establishes the session. Separated from `public`
   * rather than merged into it so the two can never be widened together by accident: `public` is a
   * product decision about onboarding, this is a protocol requirement.
   */
  | 'callback'
  /** Needs authority of either kind — a live session, or this device's offline receipt. */
  | 'authenticated';

/**
 * Every route entry under `src/app`, classified.
 *
 * Keyed by the **first** path element — a group directory, a stack directory, or a top-level file —
 * because that is the granularity at which Expo Router lets a layout intervene, and a per-file table
 * would list 139 rows that always agreed with their parent.
 *
 * The two `__DEV__` audit routes are `authenticated` rather than a class of their own. They already
 * redirect to Home in a release build, so they are not a production surface; classifying them as an
 * exception would have added the app's first route-specific bypass to save a signed-out developer
 * one sign-in.
 */
export const ROUTE_CLASSES: Readonly<Record<string, RouteClass>> = {
  // ── Public: before authority exists ──────────────────────────────────────
  /** The entry gate itself. It takes its own decision and must not be gated by one. */
  'index.tsx': 'public',
  'splash.tsx': 'public',
  /** The fallback for an unmatched URL. Gating it would turn a typo into a redirect loop. */
  '+not-found.tsx': 'public',
  '(auth)': 'public',
  onboarding: 'public',

  // ── Callback: link-driven, session-establishing ──────────────────────────
  auth: 'callback',

  // ── Authenticated: the account's own application ─────────────────────────
  'home.tsx': 'authenticated',
  'insights.tsx': 'authenticated',
  'modules.tsx': 'authenticated',
  'notifications.tsx': 'authenticated',
  'personalization.tsx': 'authenticated',
  'module-coming-soon.tsx': 'authenticated',
  'hero-audit.tsx': 'authenticated',
  'module-gallery.tsx': 'authenticated',
  ai: 'authenticated',
  faith: 'authenticated',
  family: 'authenticated',
  finance: 'authenticated',
  goals: 'authenticated',
  health: 'authenticated',
  learning: 'authenticated',
  planner: 'authenticated',
  profile: 'authenticated',
  settings: 'authenticated',
  subscription: 'authenticated',
};

/**
 * The class of the route a file implements, or `null` when it is not classified.
 *
 * `null` rather than a default, so an unclassified route fails a test instead of silently inheriting
 * whichever class was more convenient. Defaulting to `'authenticated'` would be the safe direction
 * but would hide the omission; defaulting to `'public'` would hide an exposure.
 */
export function routeClassFor(relativePath: string): RouteClass | null {
  const first = relativePath.replace(/\\/g, '/').split('/')[0];
  if (first === undefined) {
    return null;
  }
  return ROUTE_CLASSES[first] ?? null;
}

/** Route entries that need authority, for tests that assert each one is behind the boundary. */
export function authenticatedRouteEntries(): readonly string[] {
  return Object.keys(ROUTE_CLASSES).filter((key) => ROUTE_CLASSES[key] === 'authenticated');
}

/**
 * What the boundary should do about the authority it can see.
 *
 * `wait` exists because `unknown` is not a verdict — it means the launch has not finished asking.
 * Redirecting on it would bounce a signed-in user to Authentication Options one frame before their
 * session resolves, on every cold deep link. Admitting on it would mount a protected screen for
 * somebody nobody has established is signed in, which is the defect itself. The third answer is the
 * only correct one: render nothing, issue no read, and decide once the answer exists.
 *
 * This is `faithRouteAccess` generalised — same three answers, same predicate, same reasoning. The
 * Faith name is kept as an alias so the guarantees already asserted for Faith continue to be
 * asserted against the code that now serves every stack, rather than against a copy that could
 * drift.
 */
export type RouteAccess = 'allow' | 'redirect' | 'wait';

export function protectedRouteAccess(auth: AuthState): RouteAccess {
  if (auth.status === 'unknown') {
    return 'wait';
  }
  /*
    `isLocallyAuthenticated`, not `isOnlineAuthenticated` — see `RouteClass` above for why the route
    layer admits offline authority. Expired, revoked and cleared authority all arrive here as
    `signed-out`, because the provider drops the session and the receipt on a definitive server
    verdict rather than downgrading them to something weaker. So "fails closed" needs no branch of
    its own: there is no state between authority and none.
  */
  return isLocallyAuthenticated(auth) ? 'allow' : 'redirect';
}
