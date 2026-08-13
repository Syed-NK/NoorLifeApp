import { useCallback, useEffect, useState } from 'react';

import {
  clearReadingLog,
  emptyReadingLog,
  readReadingLog,
  recordReading,
  setDailyGoal,
  type ReadingLog,
} from '../storage/faith-reading-log';

/**
 * The user's reading log, with write-through updates.
 *
 * Starts from `emptyReadingLog` rather than null so a screen never has to guard against "not loaded
 * yet" — an empty log is a valid log, and it renders as the honest first-run state: nothing read,
 * no days recorded. `ready` distinguishes "loading" from "genuinely empty" for the one card that
 * needs to, which is the one that would otherwise flash an empty state on every mount.
 */

export type UseReadingLog = {
  readonly log: ReadingLog;
  readonly ready: boolean;
  /** Records reaching a verse. Returns what the log became. */
  readonly record: (surah: number, ayah: number) => Promise<void>;
  readonly setGoal: (goal: number) => Promise<void>;
  /** Destructive. The caller must have confirmed with the user. */
  readonly reset: () => Promise<void>;
};

/** Today, as the device's own calendar day. The one place the log's date comes from. */
export function todayIsoDate(now: Date = new Date()): string {
  // Local, not UTC: a user reading at 11pm has read *today*, and `toISOString` would file it under
  // tomorrow for anyone east of Greenwich.
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useReadingLog(): UseReadingLog {
  const [log, setLog] = useState<ReadingLog>(emptyReadingLog);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void readReadingLog().then((stored) => {
      if (active) {
        setLog(stored);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const record = useCallback(async (surah: number, ayah: number) => {
    setLog(await recordReading(surah, ayah, todayIsoDate()));
  }, []);

  const setGoal = useCallback(async (goal: number) => {
    setLog(await setDailyGoal(goal));
  }, []);

  const reset = useCallback(async () => {
    setLog(await clearReadingLog());
  }, []);

  return { log, ready, record, setGoal, reset };
}
