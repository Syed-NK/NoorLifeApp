import { useCallback, useEffect, useState } from 'react';

import {
  ayahNumber,
  readingProgress,
  surahNumber,
  type ReadingPosition,
} from '../data/quran-content.repository';
import {
  faithStorageKeys,
  hasNumber,
  hasString,
  isRecord,
  readJson,
  removeKey,
  writeJson,
} from '../storage/faith-storage';

/**
 * Where the user stopped reading.
 *
 * ── Why this is a hook over storage rather than a repository method ─────────
 * The reading position is the app's own state, not content. It has no server behind it even after
 * Quran Foundation approval — a position is meaningless to the content API — so putting it in
 * `QuranContentRepository` would mean one method of that interface never gets a real
 * implementation.
 *
 * ── Three things this used to do that were not true ─────────────────────────
 * It seeded a position of Al-Kahf verse 32 at 55% on first run, so a user who had never opened the
 * reader was shown their own progress through a surah they had not read. There is **no seed now**:
 * `position` is `null` until the user reads something, and the cards that display it render a
 * "start reading" affordance instead of a fabricated one.
 *
 * It resolved the surah's name from `mockSurahsForTest` — fixture data on a production screen. The
 * name is now written into the stored position at save time, from the live catalogue.
 *
 * And its `progress` was whatever the caller passed, which in practice was the literal `0.55` for
 * every verse in every surah. It is now derived from the ayah and the surah's length, so the bar
 * measures something.
 */

/**
 * A stored position, validated.
 *
 * `surahName` and `ayahCount` are required, which deliberately invalidates every position written
 * by a build that predates them. A stored blob with no surah name cannot render the card's label,
 * and dropping it costs the user one tap to resume — where accepting it would mean rendering
 * "undefined • verse 32". The next save writes a complete record.
 */
function isPosition(value: unknown): value is ReadingPosition {
  return (
    isRecord(value) &&
    hasNumber(value, 'surah') &&
    hasNumber(value, 'ayah') &&
    hasNumber(value, 'ayahCount') &&
    hasNumber(value, 'progress') &&
    hasString(value, 'surahName')
  );
}

/** "Al-Kahf • verse 32". The one place the resume label is worded. */
export function formatPosition(position: ReadingPosition): string {
  return `${position.surahName} • verse ${position.ayah}`;
}

/** "32 of 110 verses". Absent when the surah's length was not recorded. */
export function formatPositionProgress(position: ReadingPosition): string | null {
  return position.ayahCount > 0 ? `${position.ayah} of ${position.ayahCount} verses` : null;
}

export type SavePosition = {
  readonly surah: number;
  readonly surahName: string;
  readonly ayah: number;
  readonly ayahCount: number;
};

export type UseContinueReading = {
  /** `null` while loading and when the user has never read. The two are told apart by `ready`. */
  readonly position: ReadingPosition | null;
  /** False until storage has answered. Lets a card avoid flashing its empty state. */
  readonly ready: boolean;
  readonly resumeLabel: string | null;
  readonly save: (position: SavePosition) => Promise<void>;
  /** Forgets the position. Used by the reading-data reset. */
  readonly clear: () => Promise<void>;
};

export function useContinueReading(): UseContinueReading {
  const [position, setPosition] = useState<ReadingPosition | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void readJson<ReadingPosition | null>(
      faithStorageKeys.readingPosition,
      null,
      (value): value is ReadingPosition | null => value === null || isPosition(value),
    ).then((stored) => {
      if (active) {
        setPosition(stored);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (next: SavePosition) => {
    const record: ReadingPosition = {
      surah: surahNumber(next.surah),
      surahName: next.surahName,
      ayah: ayahNumber(next.ayah),
      ayahCount: next.ayahCount,
      progress: readingProgress(next.ayah, next.ayahCount),
      updatedAt: new Date().toISOString(),
    };
    await writeJson(faithStorageKeys.readingPosition, record);
    setPosition(record);
  }, []);

  const clear = useCallback(async () => {
    // Removed rather than overwritten with null, so a reset leaves no record behind at all.
    await removeKey(faithStorageKeys.readingPosition);
    setPosition(null);
  }, []);

  return {
    position,
    ready,
    resumeLabel: position === null ? null : formatPosition(position),
    save,
    clear,
  };
}
