import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveDefaultTranslation } from '../data/translation-default';
import { useFaithRepositories } from '../di/faith-repository-context';
import type { TranslationChoice } from '../storage/faith-preferences';
import { useFaithPreferences } from './use-faith-preferences';

/**
 * The chosen translation, resolving NoorLife's default from the live catalogue when there is none.
 *
 * ── Why resolution is a hook and not a constant ─────────────────────────────
 * Because "which translation may this app use?" is a question only the live catalogue can answer,
 * and answering it wrongly is what produced the defect this replaces: a hard-coded `131` that is
 * listed in the catalogue, is selectable, and returns nothing. See `translation-default.ts`.
 *
 * ── What each state means to a screen ───────────────────────────────────────
 * `resolving` is a real state, not a loading spinner over a known value. Until it settles there is
 * genuinely no edition to request, and a screen that guessed one would be re-creating the bug. The
 * reader shows the Arabic — which needs no translation — and says a translation is being chosen.
 *
 * ── When resolution actually runs, since it no longer runs at install ───────
 * `defaultFaithPreferences` now carries `DEFAULT_TRANSLATION_CHOICE`, the resolver's own validated
 * output recorded as a constant, so `preferences.translation` is non-null from the first render and
 * the effect below does nothing. That is the whole of the Qur'an cold-open saving: opening the
 * reader used to wait on one catalogue read plus up to five sequential single-verse probes before
 * it could name an edition to request.
 *
 * The resolver is still reached, by the one route that needs it: `resetToDefault` writes `null`
 * after the reader reports `edition-unavailable`, `migratePreferences` leaves that `null` alone
 * because the install is already marked seeded, and the effect below consults the live catalogue.
 * Revalidation therefore happens when the edition becomes unavailable, and not on a schedule.
 */
export type TranslationPreferenceStatus =
  /** Preferences have not been read yet, or the catalogue is being consulted. */
  | 'resolving'
  /** A translation is selected and usable. */
  | 'ready'
  /** The catalogue could not be reached, so no default could be chosen. Retryable. */
  | 'catalogue-unavailable'
  /** The catalogue answered and no English edition rendered. Not retryable by waiting. */
  | 'no-valid-english';

export type UseTranslationPreference = {
  readonly translation: TranslationChoice | null;
  /**
   * True once storage has answered, whatever it said.
   *
   * Distinct from `status === 'ready'`, which additionally requires an edition to have been
   * resolved. A caller that must not fetch with a half-known request — the reader — waits on this;
   * a caller that only displays what is known waits on nothing.
   */
  readonly ready: boolean;
  readonly status: TranslationPreferenceStatus;
  /** True when the user picked this edition rather than NoorLife defaulting to it. */
  readonly chosenByUser: boolean;
  /** Persists a deliberate user selection, and marks it as one. */
  readonly choose: (choice: TranslationChoice) => Promise<void>;
  /** Drops the current choice and resolves a fresh default. Used by unavailable-edition recovery. */
  readonly resetToDefault: () => Promise<void>;
  readonly retry: () => void;
};

export function useTranslationPreference(): UseTranslationPreference {
  const { quran } = useFaithRepositories();
  const { preferences, ready, update } = useFaithPreferences();
  const [status, setStatus] = useState<TranslationPreferenceStatus>('resolving');
  const [attempt, setAttempt] = useState(0);

  /**
   * Guards against a second resolution running while the first is in flight.
   *
   * A ref rather than state: it is written by an effect and read by the same effect, never rendered.
   * Without it, any re-render between starting a resolution and persisting its result — a navigation,
   * a preference write from another screen — would start a second catalogue read and a second set of
   * probe requests, against a vendor whose rate limit NoorLife shares across every user.
   */
  const resolving = useRef(false);

  useEffect(() => {
    if (!ready) {
      return;
    }
    if (preferences.translation !== null) {
      /*
        Nothing to set. The returned `status` is derived from `preferences.translation` below, so a
        resolved edition already reads as `ready` — assigning it here was a second source of truth
        for the same fact, and a setState inside an effect this project's lint rules reject.
      */
      return;
    }
    if (resolving.current) {
      return;
    }

    resolving.current = true;
    let active = true;

    void (async () => {
      const outcome = await resolveDefaultTranslation(quran);
      resolving.current = false;
      if (!active) {
        return;
      }
      if (outcome.kind === 'resolved') {
        /**
         * Persisted with `translationChosenByUser: false`.
         *
         * That is what keeps a *future* correction possible: a default NoorLife picked may be
         * re-picked if the edition is ever retired, whereas a user's own selection may not.
         */
        await update({ translation: outcome.choice, translationChosenByUser: false });
        return;
      }
      setStatus(outcome.kind);
    })();

    return () => {
      active = false;
    };
  }, [ready, preferences.translation, quran, update, attempt]);

  const choose = useCallback(
    async (choice: TranslationChoice) => {
      await update({ translation: choice, translationChosenByUser: true });
    },
    [update],
  );

  const resetToDefault = useCallback(async () => {
    await update({ translation: null, translationChosenByUser: false });
  }, [update]);

  const retry = useCallback(() => {
    resolving.current = false;
    setStatus('resolving');
    setAttempt((count) => count + 1);
  }, []);

  return {
    translation: preferences.translation,
    ready,
    status: preferences.translation === null ? status : 'ready',
    chosenByUser: preferences.translationChosenByUser,
    choose,
    resetToDefault,
    retry,
  };
}
