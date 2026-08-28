import { Directory, File, Paths } from 'expo-file-system';

import { financeLedgerAddress, financeOwnerSegment } from '../data/finance-ledger.repository';
import {
  discardRetainedImage,
  discardStagedImage,
  receiptRetentionDirectory,
  receiptStagingDirectory,
  retainReceiptImage,
  stageReceiptImage,
} from '../receipts/receipt-image-store';

/**
 * **The life of a receipt image, and whose it is** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The failure this suite is really about ─────────────────────────────────
 * `launchImageLibraryAsync` hands back a URI that points at **the user's own photograph**. Every
 * removal in this workflow is one careless argument away from deleting that instead of the app's
 * copy — a data loss with no undo, no warning, and no plausible way for the user to have expected
 * it. So the cases below spend most of their effort on what the store *refuses* to touch.
 *
 * ── And the one it is about after that ─────────────────────────────────────
 * A kept receipt is financial evidence. It has to be reachable by the account that kept it and by
 * nothing else, and the address is what enforces that: the directory carries the owner, derived by
 * Finance's own owner rule, which refuses anything that is not a v4-shaped uuid outright rather than
 * escaping it. A signed-out session resolves to no directory at all, which is why retention simply
 * refuses rather than falling back somewhere shared.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER = '7b1e4a90-2c3d-4e5f-9a08-1d2c3b4a5e6f';

/** A file the app did not create, standing in for the user's own photograph. */
const USER_PHOTO = 'file:///documents/DCIM/Camera/IMG_0042.jpg';

function seed(uri: string, contents = 'jpeg-bytes'): void {
  new File(uri).write(contents);
}

beforeEach(() => {
  /* The in-memory filesystem double is shared; every case starts from nothing of its own. */
  new Directory(Paths.cache).delete();
  new Directory(Paths.document).delete();
});

// ─────────────────────────────────────────────────────────────────────────────
// Staging
// ─────────────────────────────────────────────────────────────────────────────

describe('an acquired image becomes an app-owned copy', () => {
  it('copies into the staging directory and leaves the original alone', () => {
    seed(USER_PHOTO);

    const staged = stageReceiptImage(USER_PHOTO);

    expect(staged).not.toBeNull();
    expect(staged?.uri.startsWith(`${receiptStagingDirectory().uri}/`)).toBe(true);
    /* A copy, not a move. Moving would take the photograph out of the user's own library. */
    expect(new File(USER_PHOTO).exists).toBe(true);
    expect(new File(staged?.uri ?? '').exists).toBe(true);
  });

  it('puts staging under the reclaimable cache root and nowhere else', () => {
    /*
      Asserted against `Paths` rather than a literal, so the case still means something if the
      platform changes what those directories are.
    */
    expect(receiptStagingDirectory().uri.startsWith(Paths.cache.uri)).toBe(true);
    expect(receiptStagingDirectory().uri.startsWith(Paths.document.uri)).toBe(false);
  });

  it('gives two captures two different files', () => {
    seed(USER_PHOTO);

    const first = stageReceiptImage(USER_PHOTO);
    const second = stageReceiptImage(USER_PHOTO);

    expect(first?.uri).not.toBe(second?.uri);
    expect(new File(first?.uri ?? '').exists).toBe(true);
    expect(new File(second?.uri ?? '').exists).toBe(true);
  });

  it('names the copy from nothing that was in the source path', () => {
    seed('file:///documents/DCIM/WAITROSE-RECEIPT-84.20.jpg');

    const staged = stageReceiptImage('file:///documents/DCIM/WAITROSE-RECEIPT-84.20.jpg');
    const name = staged?.uri.slice((staged?.uri.lastIndexOf('/') ?? 0) + 1) ?? '';

    /*
      A filename is visible in a directory listing, a backup tool and any crash report that
      enumerates one. Thirty-two hex characters disclose nothing; the source name discloses a
      purchase.
    */
    expect(name).toMatch(/^[0-9a-f]{32}\.jpg$/);
    expect(staged?.uri).not.toContain('WAITROSE');
    expect(staged?.uri).not.toContain('84.20');
  });

  it.each([
    ['file:///a/b.png', 'png'],
    ['file:///a/b.HEIC', 'heic'],
    ['file:///a/b.webp', 'webp'],
    ['file:///a/b.jpeg', 'jpeg'],
    ['file:///a/b', 'jpg'],
    ['file:///a/b.exe', 'jpg'],
    ['file:///a/b.jpg?token=secret', 'jpg'],
  ])('gives %s the extension %s', (source, extension) => {
    seed(source);

    const staged = stageReceiptImage(source);

    expect(staged?.uri.endsWith(`.${extension}`)).toBe(true);
    /*
      The last row is the guard rather than an expected input — a picker returns a clean path. It is
      here because the extension is the only part of a source path that survives into a name this app
      writes, so "whatever came after the last dot" has to be bounded by an allow-list rather than
      trusted, and a query fragment is the shortest way to show what an unbounded one would carry in.
    */
    expect(staged?.uri).not.toContain('secret');
  });

  it('reports a source that cannot be read rather than throwing', () => {
    expect(stageReceiptImage('file:///documents/does-not-exist.jpg')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Discarding
// ─────────────────────────────────────────────────────────────────────────────

describe('discarding a staged copy', () => {
  it('deletes the copy and only the copy', () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);

    expect(discardStagedImage(staged)).toBe(true);

    expect(new File(staged?.uri ?? '').exists).toBe(false);
    expect(new File(USER_PHOTO).exists).toBe(true);
  });

  it('is idempotent — a second discard is success, not an error', () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);

    /*
      Cancel, replace and confirm can all reach the same removal, and a throw on the second one would
      land *after* the ledger write. Idempotence is what makes cleanup unable to affect a record.
    */
    expect(discardStagedImage(staged)).toBe(true);
    expect(discardStagedImage(staged)).toBe(true);
    expect(discardStagedImage(staged)).toBe(true);
  });

  it('treats nothing to discard as nothing to do', () => {
    expect(discardStagedImage(null)).toBe(true);
  });

  it.each([
    ["the user's own photograph", USER_PHOTO],
    ['a document-root file', 'file:///documents/anything.jpg'],
    [
      'a sibling directory that merely shares a prefix',
      'file:///cache/finance-receipts/staging-other/x.jpg',
    ],
    ['a traversal out of staging', 'file:///cache/finance-receipts/staging/../../secret.jpg'],
    ['the staging directory itself', 'file:///cache/finance-receipts/staging'],
  ])('refuses to delete %s', (_label, uri) => {
    seed(uri.replace('/../../', '/'));

    expect(discardStagedImage({ uri })).toBe(false);
  });

  it('leaves a file it refused exactly where it was', () => {
    seed(USER_PHOTO);

    discardStagedImage({ uri: USER_PHOTO });

    expect(new File(USER_PHOTO).exists).toBe(true);
    expect(new File(USER_PHOTO).textSync()).toBe('jpeg-bytes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retention
// ─────────────────────────────────────────────────────────────────────────────

describe('keeping a receipt image is account-scoped', () => {
  it('copies into a directory named for the account, under the persistent root', () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);

    const kept = retainReceiptImage(staged!, OWNER);

    expect(kept).not.toBeNull();
    expect(kept?.uri.startsWith(Paths.document.uri)).toBe(true);
    expect(kept?.uri).toContain(OWNER);
    /* The staged copy survives the promotion, so a later failure can still be cleaned up. */
    expect(new File(staged?.uri ?? '').exists).toBe(true);
  });

  it('gives two accounts two directories, neither inside the other', () => {
    const mine = receiptRetentionDirectory(OWNER)?.uri ?? '';
    const theirs = receiptRetentionDirectory(OTHER)?.uri ?? '';

    expect(mine).not.toBe(theirs);
    /*
      Not the same assertion as "the URIs differ". One directory *containing* another would let a
      sweep over the first delete everything in the second — containment, in either direction, is the
      failure.
    */
    expect(mine.startsWith(`${theirs}/`)).toBe(false);
    expect(theirs.startsWith(`${mine}/`)).toBe(false);
  });

  it('uses the same owner derivation as the ledger key', () => {
    /*
      One rule, two addresses. A second copy of it would eventually admit an id the other refuses,
      and the two would then disagree about whose data a file is.
    */
    expect(financeOwnerSegment(OWNER)).toBe(OWNER);
    expect(financeLedgerAddress(OWNER)).toContain(financeOwnerSegment(OWNER) ?? 'x');
    expect(receiptRetentionDirectory(OWNER)?.uri).toContain(financeOwnerSegment(OWNER) ?? 'x');
  });

  it.each([
    ['signed out', null],
    ['an empty id', ''],
    ['a traversal', '../../other'],
    ['a dotted id', '3f6d2c18.9a4b.4c7e.8f21.5b7d0e9a1c42'],
    ['a wildcard', '*'],
    ['a slash', '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42/x'],
    ['a prefix of a real id', '3f6d2c18-9a4b-4c7e-8f21'],
  ])('has no retention directory for %s', (_label, ownerId) => {
    expect(receiptRetentionDirectory(ownerId)).toBeNull();
  });

  it('refuses to keep an image when there is no account to keep it for', () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);

    expect(retainReceiptImage(staged!, null)).toBeNull();
    /* And writes nothing anywhere while refusing. */
    expect(new Directory(Paths.document, 'finance-receipts').exists).toBe(false);
  });

  it("refuses to keep anything that is not this app's own staged copy", () => {
    seed(USER_PHOTO);

    /*
      Retention copies *out of staging*. Pointing it at the user's library would put a copy of an
      arbitrary file into the app's private storage on the strength of a caller's say-so.
    */
    expect(retainReceiptImage({ uri: USER_PHOTO }, OWNER)).toBeNull();
  });

  it('names a kept file from nothing readable either', () => {
    seed('file:///documents/DCIM/WAITROSE-84.20.jpg');
    const staged = stageReceiptImage('file:///documents/DCIM/WAITROSE-84.20.jpg');

    const kept = retainReceiptImage(staged!, OWNER);
    const name = kept?.uri.slice((kept?.uri.lastIndexOf('/') ?? 0) + 1) ?? '';

    expect(name).toMatch(/^[0-9a-f]{32}\.jpg$/);
    expect(name).not.toContain(OWNER);
  });

  it('never places a kept image in a shared or public media directory', () => {
    const kept = receiptRetentionDirectory(OWNER)?.uri ?? '';

    /*
      `Paths.document` is app-private on both platforms. What must never appear is a path into shared
      media, where every other app and the system gallery would list somebody's receipts.
    */
    expect(kept.startsWith(Paths.document.uri)).toBe(true);
    expect(kept).not.toMatch(/DCIM|Pictures|Downloads|shared|external|Media/i);
  });
});

describe('discarding a kept image', () => {
  it('removes it for the account that kept it', () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);
    const kept = retainReceiptImage(staged!, OWNER);

    expect(discardRetainedImage(kept, OWNER)).toBe(true);
    expect(new File(kept?.uri ?? '').exists).toBe(false);
  });

  it("refuses to remove another account's kept image", () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);
    const kept = retainReceiptImage(staged!, OWNER);

    /*
      Owner switching is the interesting instant. A cleanup that ran with the *new* account's id
      against the *old* account's file would either delete somebody else's evidence or, with a looser
      check, reach into their directory at all.
    */
    expect(discardRetainedImage(kept, OTHER)).toBe(false);
    expect(new File(kept?.uri ?? '').exists).toBe(true);
  });

  it('refuses to remove anything once there is no account', () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);
    const kept = retainReceiptImage(staged!, OWNER);

    expect(discardRetainedImage(kept, null)).toBe(false);
    expect(new File(kept?.uri ?? '').exists).toBe(true);
  });

  it('is idempotent, and nothing to discard is nothing to do', () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);
    const kept = retainReceiptImage(staged!, OWNER);

    expect(discardRetainedImage(kept, OWNER)).toBe(true);
    expect(discardRetainedImage(kept, OWNER)).toBe(true);
    expect(discardRetainedImage(null, OWNER)).toBe(true);
  });

  it("cannot reach another account's directory through the staging root", () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);
    const kept = retainReceiptImage(staged!, OTHER);

    /* The retained path is checked against the *stated* owner, not against any owner. */
    expect(discardRetainedImage(kept, OWNER)).toBe(false);
    expect(new File(kept?.uri ?? '').exists).toBe(true);
  });
});

describe('the two roots are different places', () => {
  it('keeps staging and retention apart, in both directions', () => {
    const staging = receiptStagingDirectory().uri;
    const retention = receiptRetentionDirectory(OWNER)?.uri ?? '';

    expect(staging).not.toBe(retention);
    expect(staging.startsWith(`${retention}/`)).toBe(false);
    expect(retention.startsWith(`${staging}/`)).toBe(false);
  });

  it('never lets a staged discard reach a kept file', () => {
    seed(USER_PHOTO);
    const staged = stageReceiptImage(USER_PHOTO);
    const kept = retainReceiptImage(staged!, OWNER);

    expect(discardStagedImage({ uri: kept?.uri ?? '' })).toBe(false);
    expect(new File(kept?.uri ?? '').exists).toBe(true);
  });
});
