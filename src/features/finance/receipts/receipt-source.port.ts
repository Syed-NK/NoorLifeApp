/**
 * **Getting a receipt image, and asking for permission at the moment it is needed** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why acquisition is its own port ────────────────────────────────────────
 * Because the *timing* of a permission prompt is a product promise, and a promise nothing enforces
 * is a promise somebody refactors away. #90 removed Finance's registry claim that the module wanted
 * photo access, on the grounds that it asked for nothing; the way that stays true while Receipts
 * exists is that the only code able to raise an OS prompt sits behind this interface, and the only
 * thing that calls it is a press handler on Capture or on Import.
 *
 * Nothing here runs on mount. There is no `getPermissionsAsync` on entry, no pre-warm and no
 * "check quietly so the button can be disabled" — a silent check is still a decision the user has
 * not been asked to make, and a disabled Capture button that never says why is worse than a prompt
 * the user can decline.
 *
 * ── Two kinds, never one call that does both ───────────────────────────────
 * `camera` and `library` are separate requests to separate permissions. A single `pick()` that
 * offered a sheet would ask the OS for whichever the user tapped inside it — which is the same
 * prompt at a moment the app can no longer explain, because the explanation was on the screen
 * underneath.
 *
 * ── Denial is an outcome, not an error ─────────────────────────────────────
 * `denied` carries whether asking again can still produce a prompt. On both platforms a second
 * refusal is permanent until the user changes it in Settings, and a screen that offered "Try again"
 * in that state would be offering a button that provably does nothing. The screen shows Settings
 * guidance instead — and, either way, keeps manual entry reachable, because a declined permission
 * must never be the end of the road to recording what somebody spent.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type ReceiptSourceKind = 'camera' | 'library';

export type ReceiptAcquisition =
  /** A local image the caller may now copy. Not yet app-owned — see `receipt-image-store`. */
  | { readonly kind: 'acquired'; readonly uri: string }
  /** The user backed out of the camera or the picker. Not a failure and not a denial. */
  | { readonly kind: 'cancelled' }
  /** The OS refused. `retryable` is false once the platform will no longer show a prompt. */
  | { readonly kind: 'denied'; readonly retryable: boolean }
  /** The camera or picker could not be opened at all, or returned something unusable. */
  | { readonly kind: 'failed' };

export type ReceiptSourcePort = {
  /**
   * Requests the permission this kind needs, then opens it.
   *
   * The request happens **inside** this call, which is what ties the prompt to the press. A caller
   * cannot ask for permission early without also opening the camera, and that is the point.
   */
  acquire(kind: ReceiptSourceKind): Promise<ReceiptAcquisition>;
};
