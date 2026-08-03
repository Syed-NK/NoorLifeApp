/**
 * The intended destination a user is carried to after authentication.
 *
 * ── What this is guarding against ───────────────────────────────────────────
 * "Send me back where I was going" is an ordinary feature and an ordinary open-redirect. The value
 * originates in a deep link — an untrusted, attacker-writable string — and it ends up as an argument
 * to `router.replace`. Without a bound on what it may be, a callback carrying
 * `next=https://elsewhere.example` turns the authentication flow into a launcher for arbitrary URLs,
 * and `next=/profile/privacy-security` turns it into a way to arrive at a protected screen by way of
 * a link rather than by way of a session.
 *
 * So this module answers one question — *is this a route I am willing to resume at?* — as a pure
 * function over a declared allow-list, with no I/O and no logging.
 *
 * ── Why an allow-list of prefixes rather than a deny-list ───────────────────
 * A deny-list has to enumerate every route that must not be reachable, and it is wrong the moment
 * somebody adds one. An allow-list is wrong in the safe direction: a new route is not resumable until
 * somebody says it is, and the cost of that is one extra navigation the user makes themselves.
 *
 * ── What sanitizing does *not* do ──────────────────────────────────────────
 * It does not authorise. A path surviving this function is still subject to every gate that path
 * normally has: the startup machine still decides whether a signed-in account owes its plan choice,
 * and the entitlement gates still decide whether a paid module opens. This is a filter on *where a
 * navigation may point*, not a grant.
 */

/**
 * Route prefixes a user may be returned to after authenticating.
 *
 * Deliberately narrow. Each entry is a destination somebody could plausibly have been heading for
 * when they were interrupted by a sign-in, and each one is safe to arrive at with a fresh session:
 *
 *   • `/home`, `/modules`, `/insights`, `/notifications`, `/personalization` — global destinations.
 *   • `/faith` — free on every plan, so resuming here never lands on a locked screen.
 *   • `/profile`, `/settings` — account surfaces the user reached deliberately.
 *   • `/subscription` — the plan surfaces, which the startup machine may route to anyway.
 *
 * Notably absent: the six premium module roots. Resuming into one would land a free account on a
 * locked screen immediately after signing in, which reads as a broken sign-in rather than as a
 * paywall. They are reached through Main Home, where the lock state is drawn in context.
 *
 * Also absent: `/auth`, `/welcome`, `/sign-in`, `/sign-up`, `/new-password`, `/onboarding` and the
 * entry group generally. A destination that sends the user back into authentication after
 * authenticating is a loop, and `/auth/set-new-password` in particular must be reachable only through
 * a recovery grant.
 */
export const RESUMABLE_ROUTE_PREFIXES: readonly string[] = [
  '/home',
  '/modules',
  '/insights',
  '/notifications',
  '/personalization',
  '/faith',
  '/profile',
  '/settings',
  '/subscription',
];

/** A path that has been checked against the allow-list. The nominal type keeps it from being faked. */
export type PendingDestination = string & { readonly __sanitized: unique symbol };

/**
 * The longest path this will consider.
 *
 * A bound rather than a guess: every route in the application is well under it, and it stops a
 * multi-kilobyte "path" being handed to the router or to a comparison loop.
 */
const MAX_PATH_LENGTH = 256;

/** Code points that cannot occur in any route this application declares. */
const SPACE = 0x20;
const DELETE = 0x7f;
const BACKSLASH = 0x5c;

/**
 * Whether the value contains a character no declared route can contain.
 *
 * ── Why this is a loop over code points and not a regular expression ────────
 * The characters being refused are the C0 control range, space and DEL, and a regex literal
 * expressing that range is a line of escape sequences that is easy to get subtly wrong and impossible
 * to read. Comparing numbers says exactly what is meant.
 *
 * Control characters matter more than they look. They are how a value gets past a human reading a log
 * line or a reviewer reading a URL: a carriage return can make the remainder of a path invisible in
 * most terminals, and a tab or newline is what a copied value picks up. A backslash is refused with
 * them because some parsers normalise it to a forward slash, which would let it smuggle a path
 * separator past the traversal check below.
 */
function hasHostileCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= SPACE || code === DELETE || code === BACKSLASH) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the path when it is a destination we are willing to resume at, and null otherwise.
 *
 * The checks are ordered so that the most dangerous shapes are refused first and cheaply.
 */
export function sanitizeDestination(value: unknown): PendingDestination | null {
  if (typeof value !== 'string') {
    return null;
  }
  const candidate = value.trim();

  if (candidate.length === 0 || candidate.length > MAX_PATH_LENGTH) {
    return null;
  }

  /**
   * An absolute path and nothing else.
   *
   * A leading `//` is refused explicitly: `//elsewhere.example/x` is a *scheme-relative URL*, not a
   * path, and it is the classic way a "must start with /" check is defeated.
   */
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return null;
  }
  if (candidate.includes('://') || hasHostileCharacter(candidate)) {
    return null;
  }
  // `%2e%2e` and friends. Nothing legitimate here is percent-encoded, so the whole class goes.
  if (candidate.includes('%')) {
    return null;
  }
  // Traversal, and the `.` segment that can be used to disguise it.
  if (candidate.split('/').some((segment) => segment === '..' || segment === '.')) {
    return null;
  }
  // A fragment or a userinfo `@` has no meaning in an internal route and can only be an attempt to
  // confuse a reader of the value.
  if (candidate.includes('#') || candidate.includes('@')) {
    return null;
  }

  const [path] = candidate.split('?');
  if (path === undefined) {
    return null;
  }

  /**
   * Prefix matching on **segment** boundaries.
   *
   * A plain `startsWith` would accept `/home-of-something-else` for the `/home` entry, and
   * `/profiles-public` for `/profile`. The route either *is* the prefix or continues with a slash.
   */
  const allowed = RESUMABLE_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!allowed) {
    return null;
  }

  return candidate as PendingDestination;
}

/** Whether a path would survive sanitizing. For call sites that only need the answer. */
export function isResumableDestination(value: unknown): boolean {
  return sanitizeDestination(value) !== null;
}
