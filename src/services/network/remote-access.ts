/**
 * Whether this launch is allowed to talk to a server at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a gate exists when the failure would be automatic anyway ───────────
 * An offline launch holds a receipt, and a receipt carries no token. So a Supabase call made in
 * that state cannot succeed — it fails at the transport, eventually, with whatever error the
 * platform produces for an unreachable host.
 *
 * "Fails eventually" is the problem. Between the tap and the failure the user waits on a spinner
 * for a timeout they did not ask for, the app may retry, and the message they finally get describes
 * a network fault rather than the honest fact that they are offline. Worse, some of these calls
 * are *writes*: a profile update that half-lands, or a purchase flow entered without a session, is
 * a state the app then has to reconcile. Refusing before anything is sent turns all of that into
 * one immediate, accurate answer.
 *
 * ── Why the flag lives here and not in a React context ─────────────────────
 * The callers are services, not components. `noor-ai.service.ts` and `profile.service.ts` are
 * imported by hooks, effects and other services, and several are reachable from outside a render
 * entirely. A context would force each of them to become a hook, which is a much larger change than
 * the guarantee needs — and it would leave the non-component callers ungated, which is where the
 * risk actually is.
 *
 * The authority still has exactly one source: `AuthProvider` sets this from the same resolution
 * that decides `SessionAuthority`, so the flag cannot disagree with the session state it mirrors.
 *
 * ── What is deliberately *not* gated ───────────────────────────────────────
 * `auth.service.ts`. Two of its functions are how the app finds out whether it is online at all:
 * gating `resolveSession` on a flag derived from `resolveSession` is a circular definition that
 * would leave a device permanently offline once it ever was. And `signOut` must always be
 * attempted — an offline sign-out still has to clear local access, and the network call failing is
 * the expected case, not a reason to skip it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Refusal to start a remote operation.
 *
 * A distinct type so a caller can tell "you are offline" from "the server said no". Collapsing them
 * is what produces a screen saying "something went wrong" to somebody who simply has no signal.
 */
export class OfflineOperationError extends Error {
  /** Discriminant for call sites that cannot use `instanceof` across a module boundary. */
  readonly code = 'offline' as const;

  constructor(
    /** What was refused, for the message only. Never an id, an address or a URL. */
    readonly operation: string,
  ) {
    super(`${operation} needs a connection.`);
    this.name = 'OfflineOperationError';
  }
}

export function isOfflineOperationError(error: unknown): error is OfflineOperationError {
  return (
    error instanceof OfflineOperationError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'offline')
  );
}

/**
 * Default `true`, and that direction is deliberate.
 *
 * `AuthProvider` sets the real value on every resolution, but modules are imported and services can
 * be called before the first resolution completes — and in tests, in tooling, and in any future
 * entry point that does not mount the provider at all. Defaulting to *blocked* would make those
 * paths fail in a way that looks exactly like a genuine outage and would be diagnosed as one.
 *
 * The failure mode of defaulting open is a request that goes out and fails at the transport, which
 * is precisely the behaviour that existed before this module. The failure mode of defaulting closed
 * is a working app that refuses to work. Only one of those is a regression.
 */
let remoteAccessAuthorised = true;

/** Set from `AuthProvider`, from the same resolution that decides the session authority. */
export function setRemoteAccessAuthorised(authorised: boolean): void {
  remoteAccessAuthorised = authorised;
}

export function isRemoteAccessAuthorised(): boolean {
  return remoteAccessAuthorised;
}

/**
 * Throws unless a server may be contacted.
 *
 * Called as the **first statement** of every remote operation, before the client is touched. That
 * placement is the whole claim: a test can assert the Supabase double recorded no call, which is a
 * stronger and much more durable statement than asserting a particular error came back.
 */
export function assertRemoteAccess(operation: string): void {
  if (!remoteAccessAuthorised) {
    throw new OfflineOperationError(operation);
  }
}

/** Test-only. Restores the launch default. */
export function resetRemoteAccessForTest(): void {
  remoteAccessAuthorised = true;
}
