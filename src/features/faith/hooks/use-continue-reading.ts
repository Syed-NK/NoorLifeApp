import { useCallback, useEffect, useState } from 'react';

import { ayahNumber, surahNumber, type ReadingPosition } from '../data/quran-content.repository';
import { mockSurahsForTest } from '../data/mock/mock-quran.repository';
import {
  faithStorageKeys,
  hasNumber,
  isRecord,
  readJson,
  writeJson,
} from '../storage/faith-storage';

/**
 * Where the user stopped reading.
 *
 * ── Why this is a hook over storage rather than a repository method ─────────
 * The reading position is the app's own state, not content. It has no server behind it
 * even after Quran Foundation approval — a position is meaningless to the content API —
 * so putting it in `QuranContentRepository` would mean one method of that interface never
 * gets a real implementation.
 *
 * It seeds from the approved reference (Al-Kahf, verse 32) on first run so the home
 * screen's Continue-Quran card is populated before the user has read anything, matching
 * `03-faith.png`. Once they read, their own position replaces it.
 */

const SEED: ReadingPosition = {
  surah: surahNumber(18),
  ayah: ayahNumber(32),
  progress: 0.55,
  updatedAt: new Date(0).toISOString(),
};

function isPosition(value: unknown): value is ReadingPosition {
  return (
    isRecord(value) &&
    hasNumber(value, 'surah') &&
    hasNumber(value, 'ayah') &&
    hasNumber(value, 'progress')
  );
}

/** "Surah Al-Kahf • Verse 32", as the approved card shows it. */
export function formatPosition(position: ReadingPosition): string {
  const surah = mockSurahsForTest.find((item) => item.number === position.surah);
  const name = surah?.name ?? `Surah ${position.surah}`;
  return `Surah ${name} • Verse ${position.ayah}`;
}

export type UseContinueReading = {
  readonly position: ReadingPosition | null;
  readonly resumeLabel: string;
  readonly save: (surah: number, ayah: number, progress: number) => Promise<void>;
};

export function useContinueReading(): UseContinueReading {
  const [position, setPosition] = useState<ReadingPosition | null>(null);

  useEffect(() => {
    let active = true;
    void readJson(faithStorageKeys.readingPosition, SEED, isPosition).then((stored) => {
      if (active) {
        setPosition(stored);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (surah: number, ayah: number, progress: number) => {
    const next: ReadingPosition = {
      surah: surahNumber(surah),
      ayah: ayahNumber(ayah),
      progress: Math.max(0, Math.min(1, progress)),
      updatedAt: new Date().toISOString(),
    };
    await writeJson(faithStorageKeys.readingPosition, next);
    setPosition(next);
  }, []);

  return {
    position,
    resumeLabel: position === null ? 'Loading…' : formatPosition(position),
    save,
  };
}
