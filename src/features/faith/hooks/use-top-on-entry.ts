import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import type { ScrollView } from 'react-native';

/**
 * Keeps a scaffold's scroll region at the top whenever the screen is *entered*, and only then.
 *
 * ── The defect this closes ──────────────────────────────────────────────────
 * Saving a location returns to Prayer Times by popping the navigation stack, and a popped-to screen
 * is never unmounted — it was mounted the whole time, underneath. Its `ScrollView` therefore keeps
 * the offset it had when the user left, so a person who had scrolled down to reach the Change action
 * came back to a dashboard whose hero was above the viewport, with the timeline apparently starting
 * under the fixed header. Nothing had restored a scroll position; nothing had *reset* one.
 *
 * The same is true of the bottom navigation, which switches between mounted routes rather than
 * rebuilding them.
 *
 * ── One policy, stated once ─────────────────────────────────────────────────
 * The scroll resets on **entry**, and entry means exactly three things:
 *
 *   • the screen mounts;
 *   • the screen regains navigation focus — returning from Prayer Location, or through the tabs;
 *   • the identity of what is being displayed changes, which is `resetKey`.
 *
 * Everything else deliberately leaves the offset alone. A countdown tick re-renders this screen
 * every fifteen seconds and must not yank a reader back to the top; a background resource refresh
 * repaints cards under a reader who did not ask to move; an app returning from the background is the
 * *same* screen the user left and their position in it is theirs. None of those touch `resetKey`,
 * and none of them is a focus change, so none of them moves anything.
 *
 * ── Why `resetKey` and not a list of effects ────────────────────────────────
 * Because "what is being displayed" is one idea with several sources — the active location revision,
 * the calculation method, the Asr convention — and a screen that reset from three separate effects
 * would reset three times for one change, animating the user to the top in stages. One string, one
 * comparison, one reset.
 *
 * @returns the ref to hand to `FaithScreen`/`ModuleScaffold`'s `scrollRef`.
 */
export function useTopOnEntry(resetKey: string): React.RefObject<ScrollView | null> {
  const scrollRef = useRef<ScrollView | null>(null);

  useOnScreenEntry(
    useCallback(() => {
      /*
        `animated: false` on purpose. An entry is not a movement the user made, so animating it would
        draw attention to a correction rather than simply presenting the screen as it should have
        been. A `null` ref is the ordinary case on a screen whose body is still in its loading state
        — the scaffold has not rendered a scroll region yet, and the next entry will find one.
      */
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []),
    resetKey,
  );

  return scrollRef;
}

/**
 * The entry policy on its own, without the scroll region it usually moves.
 *
 * ── Why this is a separate export rather than an inlined effect ─────────────
 * Because it is the half that can be asserted. Under this project's Jest environment `ScrollView` is
 * a function component with no instance, so a `ref` to it is permanently `null` and `scrollTo` is
 * unreachable — a suite written against the ref would be asserting that nothing happened and calling
 * it a pass. What *is* observable is when an entry is declared, and that is the rule the correction
 * is actually about: on mount, on focus, on an identity change, and on nothing else.
 *
 * So the decision lives here and takes the action as a parameter. `useTopOnEntry` supplies the one
 * the dashboard wants; the suite supplies a spy and drives the four cases that must fire and the two
 * that must not.
 */
export function useOnScreenEntry(onEnter: () => void, resetKey: string): void {
  /*
    Read through a ref so an unstable callback cannot turn either effect below into a per-render
    one — which would be exactly the "a countdown tick must not move the reader" case this policy
    exists to rule out. Assigned in an effect rather than during render, and declared first, so it is
    current by the time anything reads it.
  */
  const latest = useRef(onEnter);
  useEffect(() => {
    latest.current = onEnter;
  }, [onEnter]);

  /*
    Focus covers mount as well: a freshly mounted screen is focused, so this fires once on entry and
    again on every return. The cleanup is deliberately absent — there is nothing to undo, and firing
    on *blur* would move a screen the user is walking away from.
  */
  useFocusEffect(
    useCallback(() => {
      latest.current();
    }, []),
  );

  /*
    Identity changes, for the case focus cannot see: a location saved, or a calculation method
    changed, while this screen is already the focused one. Runs after the commit that rendered the
    new content, so what it acts on is the new region rather than the height of the old.

    ── The first run is skipped, and the skip is the point ───────────────────
    An effect keyed on a value runs once when that value first exists, and mount is already an entry
    the focus effect above has declared. Without the skip every entry through the door would be
    declared twice — harmless for a scroll reset, and a fair description of a rule that would then be
    impossible to state as "once per entry".
  */
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = resetKey;
      return;
    }
    if (seen.current === resetKey) {
      return;
    }
    seen.current = resetKey;
    latest.current();
  }, [resetKey]);
}
