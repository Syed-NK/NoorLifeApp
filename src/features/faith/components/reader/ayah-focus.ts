import { AccessibilityInfo, findNodeHandle } from 'react-native';

/**
 * Where the screen reader's focus goes when the verse action sheet opens and closes.
 *
 * ── Why this needs a registry rather than a ref ─────────────────────────────
 * Opening the sheet has to move focus *into* it, and closing it has to put focus back on the verse
 * the user opened it from. The first is a ref inside one component. The second is not: the sheet
 * lives at the top of the reader and the verse is one of up to 286 blocks inside a scroll view, so
 * the thing that has to be focused on close is a node the closer has no reference to.
 *
 * A screen reader that loses its place on dismiss is not a cosmetic failure. TalkBack falls back to
 * the top of the screen, so a user who opened the sheet on verse 210 is returned to the surah
 * header and has to swipe back down through two hundred verses to reach where they were.
 *
 * The registry is the smallest thing that closes that gap: each verse records its own pill node
 * under its ayah number, and the reader asks for one back by number when the sheet closes.
 */

/**
 * Moves the screen reader to a node, and reports whether it could.
 *
 * `findNodeHandle` is what turns a component instance into the tag `setAccessibilityFocus` takes.
 * It answers `null` where there is no native view behind the instance — under the test renderer,
 * and for a node unmounted between the request and this call — and the guard is why a dismissed
 * sheet cannot throw on the way out.
 */
export function moveAccessibilityFocus(node: unknown): boolean {
  if (node === null || node === undefined) {
    return false;
  }
  const handle = findNodeHandle(node as never);
  if (typeof handle !== 'number') {
    return false;
  }
  AccessibilityInfo.setAccessibilityFocus(handle);
  return true;
}

export type AyahFocusRegistry = {
  /** Called from each verse's ref callback. `null` unregisters, which is what unmount passes. */
  readonly register: (ayah: number, node: unknown) => void;
  /** Returns true when a node was registered for that verse and the focus request was made. */
  readonly focus: (ayah: number) => boolean;
};

export function createAyahFocusRegistry(): AyahFocusRegistry {
  const nodes = new Map<number, unknown>();

  return {
    register: (ayah, node) => {
      if (node === null || node === undefined) {
        nodes.delete(ayah);
        return;
      }
      nodes.set(ayah, node);
    },
    focus: (ayah) => {
      const node = nodes.get(ayah);
      if (node === undefined) {
        return false;
      }
      /*
        Deliberately reports whether a node was *registered*, not whether the platform accepted the
        tag. The two differ only under the test renderer, and the distinction the reader cares about
        is "was there a verse to go back to" — a verse scrolled out of the tree has none, and
        leaving focus where it is beats sending it somewhere arbitrary.
      */
      moveAccessibilityFocus(node);
      return true;
    },
  };
}
