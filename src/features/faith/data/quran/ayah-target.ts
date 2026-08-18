import { MAX_PAGE_SIZE } from '../quran-foundation/quran-foundation.contract';
import type { FaithPageRequest } from '../faith-result';

/**
 * Working out what to load so a deep-linked verse is actually on screen.
 *
 * ── The defect this exists to fix ───────────────────────────────────────────
 * `reader/2?ayah=255` announced "Opened at verse 255" and rendered Al-Baqarah from verse 1. Nothing
 * was wrong with the announcement code in isolation: the reader read `?ayah=` straight from the route
 * and told the screen reader about it, while the *loading* path ignored it entirely and fetched the
 * first twenty verses like any other open. Verse 12 appeared to work only because 12 is inside that
 * first page — the feature had never worked, it had only ever been tested inside page one.
 *
 * The rule that follows from it, and that everything below serves: **the announcement is downstream
 * of the render**. Nothing may claim a verse was opened until that verse is in the list the reader
 * drew.
 *
 * ── Why a span from verse one, rather than the target's page alone ──────────
 * Fetching only the page containing 255 would put the reader in Al-Baqarah at verse 241 with no way
 * back to 240 and a "Load next verses" cursor whose meaning depends on where it started. Loading the
 * span 1…target keeps one invariant that the whole reader relies on: **the list always begins at
 * verse one and runs forward without gaps**, so pagination after the target continues from the
 * ordinary next cursor and the reader has no special case anywhere else.
 *
 * ── How the span is fetched, and why it is not thirteen 20-row requests ─────
 * At **`MAX_PAGE_SIZE`**, following the source's own cursors, and stopping the moment the target is
 * in hand. Verse 255 at the reader's ordinary 20 rows is thirteen pages; at 50 it is six, and 2:12
 * is one. The reduction comes from the page size, not from guessing where the pages are.
 *
 * ── Why the cursors are followed rather than computed ───────────────────────
 * This is the part worth being careful about. `FaithPageRequest.cursor` is **opaque**: the caller may
 * only ever echo back a `nextCursor` the repository gave it. The two implementations encode it
 * differently and both are entitled to — the Quran Foundation adapter writes a *page number*, the
 * in-memory repository writes an *item offset*.
 *
 * An earlier version of this file computed `String(pageNumber)` and issued the whole span at once.
 * Against the approved adapter that happened to be right; against the other repository, cursor `"6"`
 * means "start at item 6", so the reader would have rendered verses 6–55 while captioning them as
 * the page containing verse 255 — a wrong-verse bug of exactly the family this whole correction
 * exists to remove, and one that would have passed every test written against the vendor's encoding.
 *
 * So concurrency was given up and correctness kept. A deep link costs at most six sequential reads
 * of a cached, paginated endpoint; a synthesized cursor costs an unbounded risk of showing somebody
 * the wrong ayah.
 */

/**
 * The page size used when a route names a verse — the largest the contract permits.
 *
 * Deliberately *not* the reader's ordinary `DEFAULT_PAGE_SIZE`. The two are different jobs: 20 keeps
 * a scroll-driven read cheap, and this one is minimising how many requests stand between a tap on a
 * bookmark and the verse being visible. Bounded by the contract's own maximum rather than a number
 * chosen here, because the edge function refuses anything larger and a client that asked for more
 * would silently page wrongly for the rest of the surah.
 */
export const AYAH_TARGET_PAGE_SIZE = MAX_PAGE_SIZE;

/** What the reader should do about the `?ayah=` it was given. */
export type AyahTargetPlan =
  /** No verse was named. The reader opens at the top and pages normally. */
  | { readonly kind: 'none' }
  /**
   * A verse was named that this surah does not have.
   *
   * Carried as data rather than thrown, and distinguished from a load failure, because the two need
   * opposite affordances: a network failure deserves Retry, and `2:300` deserves being told that
   * Al-Baqarah has 286 verses. Retrying the second forever is the dishonest option.
   */
  | { readonly kind: 'out-of-range'; readonly ayah: number; readonly ayahCount: number }
  /** The verse exists. Read forward at `pageSize` until it is in hand, or `maxPages` is reached. */
  | {
      readonly kind: 'span';
      readonly ayah: number;
      readonly pageSize: number;
      /**
       * The most pages this target should need, computed from the verse and the page size.
       *
       * A bound, not a plan: the reader stops as soon as the verse arrives. It exists so a source
       * that returned a cursor pointing at itself cannot spin, and so "this took more reads than the
       * arithmetic allows" is a detectable condition rather than a hang.
       */
      readonly maxPages: number;
    };

/**
 * Decides what to load for a named verse, given the surah's real length.
 *
 * `ayahCount` comes from the surah summary — the source's own count — rather than from a table in
 * this app, so "does 2:255 exist" is answered by the same authority that serves the verse.
 */
export function planAyahTarget({
  ayah,
  ayahCount,
  pageSize = AYAH_TARGET_PAGE_SIZE,
}: {
  readonly ayah: number | null;
  readonly ayahCount: number;
  readonly pageSize?: number;
}): AyahTargetPlan {
  if (ayah === null) {
    return { kind: 'none' };
  }
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > ayahCount) {
    return { kind: 'out-of-range', ayah, ayahCount };
  }

  /*
    The page the verse falls in, one-based. `Math.ceil` rather than a loop so the arithmetic is
    checkable by eye: verse 1 is page 1, verse 50 is page 1, verse 51 is page 2.
  */
  return { kind: 'span', ayah, pageSize, maxPages: Math.ceil(ayah / pageSize) };
}

/**
 * The request for the first page of a target span, and for each page after it.
 *
 * `cursor` is only ever a value the repository itself returned — that is the whole point, see the
 * note at the top of the file. `limit` is the reader's, because page *size* is a caller's business
 * in a way page *position* is not.
 */
export function targetPageRequest(
  cursor: string | null,
  pageSize: number = AYAH_TARGET_PAGE_SIZE,
): FaithPageRequest {
  return cursor === null ? { limit: pageSize } : { cursor, limit: pageSize };
}

/**
 * Concatenates the fetched pages into one ascending run, with no repeats.
 *
 * ── Why this is not just `flat()` ───────────────────────────────────────────
 * Because the brief's "do not duplicate or reorder Ayat" has to be enforced somewhere, and the place
 * to enforce it is where pages from separate responses are joined. A source that returned an
 * overlapping page — or a retry that resolved twice — would otherwise put verse 50 on screen twice,
 * and the reader's `key` is the verse reference, so React would warn about duplicate keys and then
 * render one of them anyway.
 *
 * Sorted by ayah rather than trusted to arrive in order, for the same reason the requests are issued
 * concurrently: `Promise.all` preserves *positional* order, which is the order asked for, but the
 * items inside a page are the source's and this is the last point where a scrambled one is cheap to
 * notice.
 */
export function mergeAyahPages<T extends { readonly ayah: number }>(
  pages: readonly (readonly T[])[],
): readonly T[] {
  const byAyah = new Map<number, T>();
  for (const page of pages) {
    for (const item of page) {
      /*
        First writer wins. A later page repeating an earlier verse is the overlap case, and the
        earlier copy is the one whose position in the run is already correct.
      */
      if (!byAyah.has(item.ayah)) {
        byAyah.set(item.ayah, item);
      }
    }
  }
  return [...byAyah.values()].sort((left, right) => left.ayah - right.ayah);
}

/**
 * Whether the verse the route asked for is actually in what was loaded.
 *
 * The one predicate the announcement is allowed to consult. Written as a search over the rendered
 * items — never as `ayah <= items.length`, which is the same positional reasoning that let the
 * reader believe it had opened at 255 while showing verse 1 through 20.
 */
export function containsAyah(
  items: readonly { readonly ayah: number }[],
  ayah: number | null,
): boolean {
  return ayah !== null && items.some((item) => item.ayah === ayah);
}
