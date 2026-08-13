import { useCallback, useEffect, useState } from 'react';

import type { FaithResult } from '../data/faith-result';
import type { DhikrPreset, TasbihSession } from '../data/tasbih.repository';
import { useFaithRepositories } from '../di/faith-repository-context';

/**
 * The tasbih counter's state.
 *
 * ── Why every mutation goes through the repository ──────────────────────────
 * `increment` does not do `setCount(count + 1)`. It awaits the repository, which persists
 * and returns the new session, and the hook renders that. The round-rollover rule (at the
 * target, count resets to zero and a round is banked) therefore lives in exactly one
 * place, and a failed write surfaces as `error` instead of a number that disappears on
 * restart.
 *
 * The cost is a storage round-trip per tap. AsyncStorage on a warm key is well under a
 * frame, and correctness on a worship counter is worth more than the microseconds.
 */

export type UseTasbih = {
  readonly session: TasbihSession | null;
  readonly presets: readonly DhikrPreset[];
  /** Set when a write failed, so the screen can warn rather than lie. */
  readonly error: string | null;
  /** Returns the session the write produced, so a caller can see what changed. */
  readonly increment: () => Promise<TasbihSession | null>;
  readonly decrement: () => Promise<void>;
  readonly reset: () => Promise<void>;
  readonly choosePreset: (presetId: string) => Promise<void>;
  readonly adjustTarget: (delta: number) => Promise<void>;
};

export function useTasbih(): UseTasbih {
  const { tasbih } = useFaithRepositories();
  const [session, setSession] = useState<TasbihSession | null>(null);
  const [presets, setPresets] = useState<readonly DhikrPreset[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [presetResult, sessionResult] = await Promise.all([
        tasbih.listPresets(),
        tasbih.getSession(),
      ]);
      if (!active) {
        return;
      }
      if (presetResult.kind === 'ok') {
        setPresets(presetResult.data);
      }
      if (sessionResult.kind === 'ok') {
        setSession(sessionResult.data);
        return;
      }
      // No stored session — start one on the first preset so the screen is usable
      // immediately rather than showing an empty state for a counter.
      if (sessionResult.kind === 'empty' && presetResult.kind === 'ok' && presetResult.data[0]) {
        const started = await tasbih.startSession(presetResult.data[0].id);
        if (active && started.kind === 'ok') {
          setSession(started.data);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [tasbih]);

  /**
   * Runs one mutation and renders whatever it produced.
   *
   * ── Why it returns the session rather than void ─────────────────────────────
   * The Tasbih screen needs to know whether a tap *completed a round*, because the haptic for the
   * strand coming round is deliberately different from the one for a bead. It used to work that out
   * by stashing the previous count in a ref and writing to it during render — which is a ref access
   * in render, the pattern the React Compiler rejects and ESLint fails the build on.
   *
   * Handing the caller the resulting session removes the need for any of that: it compares the
   * rounds it had against the rounds it got, from two ordinary values.
   */
  const run = useCallback(
    async (operation: () => Promise<FaithResult<TasbihSession>>): Promise<TasbihSession | null> => {
      const result = await operation();
      if (result.kind === 'ok') {
        setSession(result.data);
        setError(null);
        return result.data;
      }
      setError(result.kind === 'error' ? result.code : 'unknown');
      return null;
    },
    [],
  );

  return {
    session,
    presets,
    error,
    increment: useCallback(() => run(() => tasbih.increment()), [run, tasbih]),
    decrement: useCallback(async () => {
      await run(() => tasbih.decrement());
    }, [run, tasbih]),
    reset: useCallback(async () => {
      await run(() => tasbih.reset());
    }, [run, tasbih]),
    choosePreset: useCallback(
      async (presetId: string) => {
        await run(() => tasbih.startSession(presetId));
      },
      [run, tasbih],
    ),
    adjustTarget: useCallback(
      async (delta: number) => {
        await run(() => tasbih.adjustTarget(delta));
      },
      [run, tasbih],
    ),
  };
}
