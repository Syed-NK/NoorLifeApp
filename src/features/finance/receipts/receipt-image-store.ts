import { getRandomValues } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { financeOwnerSegment } from '../data/finance-ledger.repository';

/**
 * **Where a receipt image lives, for exactly as long as it is wanted** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Two places, and the difference between them is the whole design ────────
 * A **staged** image is the app's own working copy of whatever the camera or the picker produced. It
 * exists so the workflow can hand a stable, app-owned path to the recogniser and delete it
 * afterwards without touching anything of the user's. It lives under `Paths.cache`, so the operating
 * system reclaiming it costs a retake and nothing else.
 *
 * A **retained** image is one the user explicitly asked to keep. It lives under `Paths.document`,
 * inside a directory named for the account that kept it, and the OS does not reclaim it. The
 * recitation store records the same one-character distinction between these two roots for the same
 * reason: `cache` and `document` are one constant apart and mean entirely different promises.
 *
 * ── Never delete what the app does not own ─────────────────────────────────
 * `launchImageLibraryAsync` returns a URI pointing at the *user's* photo. Deleting that, or deleting
 * anything reached from it, would destroy a file NoorLife did not create — a data loss with no undo
 * and no way for the user to have expected it. So every removal in this file first proves the path
 * sits under one of this feature's own roots, and refuses otherwise. It is a guard, not a
 * convention, because the convention is one careless call from being a bug report about missing
 * photographs.
 *
 * ── Names carry nothing ────────────────────────────────────────────────────
 * A file is named from 16 random bytes and an extension. Not the merchant, not the total, not the
 * date, not the account id — a filename is visible in a directory listing, in a crash report that
 * enumerates one, and in any backup tool the user runs, and a name built from what the receipt said
 * would disclose a purchase to everything that can read a directory. The audio store reached the
 * same conclusion about URLs, and the reasoning transfers exactly.
 *
 * The *directory* is named for the account, because partitioning has to be visible in the address —
 * the encoding is Finance's own owner rule, which admits only a v4-shaped uuid and refuses anything
 * else outright, so no id can name another account's directory and a signed-out session has no
 * directory at all.
 *
 * ── Cleanup is idempotent and never fatal ──────────────────────────────────
 * Removing a file that is already gone is success, not an error: cancel, replace and confirm can all
 * reach the same removal, and a workflow that threw on the second one would fail *after* the ledger
 * write. That ordering is the point — the transaction is recorded first and cleanup can only ever be
 * best-effort afterwards, so a filesystem that refuses cannot duplicate or erase a confirmed record.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The feature's directory name under both roots. One constant, so the two can be compared. */
const RECEIPTS_ROOT = 'finance-receipts';
const STAGING = 'staging';
const KEPT = 'kept';

/**
 * Extensions a staged copy may carry.
 *
 * An allow-list rather than "whatever the source had": the extension is the one part of the source
 * path that survives into a name this app writes, and an unbounded one is a path fragment from
 * somewhere else. Anything unrecognised becomes `jpg`, which is what a camera capture is.
 */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] as const;

export type StagedReceiptImage = {
  /** A `file://` URI under the staging root. The only path this workflow gives the recogniser. */
  readonly uri: string;
};

export type RetainedReceiptImage = {
  readonly uri: string;
};

/** The staging root: reclaimable, shared by every account on the device, never account data. */
export function receiptStagingDirectory(): Directory {
  return new Directory(Paths.cache, RECEIPTS_ROOT, STAGING);
}

/**
 * The retention root for one account, or `null` when there is no account that can own one.
 *
 * `null` for a signed-out session rather than a shared fallback directory. A fallback would be a
 * real, writable path that every signed-out user shares — a shared namespace wearing a scoped
 * costume, which is exactly the defect Faith's partitioning was written to remove.
 */
export function receiptRetentionDirectory(ownerId: string | null): Directory | null {
  const segment = financeOwnerSegment(ownerId);
  return segment === null ? null : new Directory(Paths.document, RECEIPTS_ROOT, KEPT, segment);
}

function extensionOf(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0] ?? '';
  const tail = withoutQuery.slice(withoutQuery.lastIndexOf('.') + 1).toLowerCase();
  return (IMAGE_EXTENSIONS as readonly string[]).includes(tail) ? tail : 'jpg';
}

/**
 * 32 hex characters from 16 random bytes.
 *
 * Collision-resistant rather than merely unlikely to repeat: a counter or a timestamp would collide
 * across a reinstall or two captures in the same millisecond, and a collision here overwrites
 * somebody's kept receipt with a different one.
 */
function randomName(extension: string): string {
  const bytes = getRandomValues(new Uint8Array(16));
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `${hex}.${extension}`;
}

/** Whether a URI sits under a directory this feature owns. The precondition for every removal. */
function ownedBy(uri: string, directory: Directory | null): boolean {
  if (directory === null) {
    return false;
  }
  const root = directory.uri.endsWith('/') ? directory.uri : `${directory.uri}/`;
  /*
    `startsWith` on the root *with* its trailing slash. Without it, a sibling directory that merely
    shares a prefix would pass the containment check — a different place that happens to begin with
    the same characters, which is precisely the mistake the recitation store's own containment test
    exists to catch.
  */
  return uri.startsWith(root) && !uri.slice(root.length).includes('..');
}

/**
 * Copies an acquired image into the app's own staging area.
 *
 * A copy, not a move. The source may be the user's photograph in their own library, and moving it
 * would take it out of their library — the destructive version of the same feature.
 */
export function stageReceiptImage(sourceUri: string): StagedReceiptImage | null {
  try {
    const directory = receiptStagingDirectory();
    directory.create({ intermediates: true, idempotent: true });
    const destination = new File(directory, randomName(extensionOf(sourceUri)));
    new File(sourceUri).copySync(destination);
    return { uri: destination.uri };
  } catch {
    return null;
  }
}

/**
 * Removes a staged copy. Idempotent, and refuses anything outside the staging root.
 *
 * Returns whether the file is now absent, which is what a caller can act on — `true` for "deleted"
 * and for "was already gone", `false` only for a path this function will not or could not remove.
 */
export function discardStagedImage(image: StagedReceiptImage | null): boolean {
  if (image === null) {
    return true;
  }
  if (!ownedBy(image.uri, receiptStagingDirectory())) {
    return false;
  }
  try {
    const file = new File(image.uri);
    if (file.exists) {
      file.delete();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Promotes a staged copy into the account's retained area.
 *
 * A copy again, so a failure part-way leaves the staged file intact and the workflow can still clean
 * up after itself. The staged copy is discarded by the caller once this has succeeded.
 */
export function retainReceiptImage(
  image: StagedReceiptImage,
  ownerId: string | null,
): RetainedReceiptImage | null {
  const directory = receiptRetentionDirectory(ownerId);
  if (directory === null || !ownedBy(image.uri, receiptStagingDirectory())) {
    return null;
  }
  try {
    directory.create({ intermediates: true, idempotent: true });
    const destination = new File(directory, randomName(extensionOf(image.uri)));
    new File(image.uri).copySync(destination);
    return { uri: destination.uri };
  } catch {
    return null;
  }
}

/**
 * Removes a retained image, refusing anything outside that account's own directory.
 *
 * Used when a draft that had already produced a retained copy is abandoned — retention is confirmed
 * by *recording the transaction*, not by pressing the toggle, so a kept image whose transaction was
 * never confirmed is a file the user did not agree to keep.
 */
export function discardRetainedImage(
  image: RetainedReceiptImage | null,
  ownerId: string | null,
): boolean {
  if (image === null) {
    return true;
  }
  if (!ownedBy(image.uri, receiptRetentionDirectory(ownerId))) {
    return false;
  }
  try {
    const file = new File(image.uri);
    if (file.exists) {
      file.delete();
    }
    return true;
  } catch {
    return false;
  }
}
