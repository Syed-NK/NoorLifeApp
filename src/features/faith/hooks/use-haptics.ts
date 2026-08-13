import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';

import { useFaithPreferences } from './use-faith-preferences';

/**
 * Haptic feedback for the tasbih counter.
 *
 * ── Why counting and completing feel different ──────────────────────────────
 * A physical tasbih gives a small click per bead and a distinctly different sensation when the
 * strand comes round. Reproducing that distinction is the whole reason to have haptics at all: a
 * single uniform buzz per tap tells the user nothing they did not already know, whereas a different
 * feel at the round boundary means they can count without looking at the screen — which is how a
 * tasbih is actually used, often with eyes closed.
 *
 * ── It is off unless the user asked for it ──────────────────────────────────
 * The preference defaults to on because a counter is the one place haptics are unambiguously useful,
 * but it is a stored preference and the screen carries the switch. Someone counting quietly beside a
 * sleeping child should be able to turn it off without leaving the screen.
 *
 * ── Failures are swallowed ──────────────────────────────────────────────────
 * A device with no haptic engine rejects, and that is not an error worth surfacing: the count is
 * already correct and already on screen. Every call is fire-and-forget.
 */

export type UseHaptics = {
  readonly enabled: boolean;
  /** One bead. */
  readonly count: () => void;
  /** The strand coming round — a round completed. */
  readonly completeRound: () => void;
  /** An undo or a reset: something was taken away. */
  readonly undo: () => void;
};

export function useHaptics(): UseHaptics {
  const { preferences } = useFaithPreferences();
  const enabled = preferences.hapticsEnabled;

  const count = useCallback(() => {
    if (!enabled) {
      return;
    }
    // Light: this fires up to a hundred times in a row, and anything stronger becomes unpleasant
    // long before the round is finished.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [enabled]);

  const completeRound = useCallback(() => {
    if (!enabled) {
      return;
    }
    // A success notification rather than a heavier impact: it is a distinctly different pattern, not
    // just a louder version of the count, which is what makes it recognisable without looking.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [enabled]);

  const undo = useCallback(() => {
    if (!enabled) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  }, [enabled]);

  return { enabled, count, completeRound, undo };
}
