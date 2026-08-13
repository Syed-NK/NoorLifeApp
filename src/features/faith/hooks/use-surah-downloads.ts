import { useCallback, useEffect, useState } from 'react';

import { downloadedBytes, type SurahDownloadIndex } from '../storage/faith-audio-downloads';
import { useRecitationAudio } from '../di/recitation-audio-context';

/**
 * The user's deliberate recitation downloads, for the screens that describe and manage them.
 *
 * ── Why the service is not React state, and what this hook does about it ────
 * `RecitationAudio` owns transfers in flight, cancellation handles and a pin registry. None of that
 * can live in React state — a download must survive the screen that started it being unmounted, and
 * a cancellation handle in state would be replaced on every render. So the service is a mutable
 * object, and this hook is the seam that turns "something changed in it" into a re-render.
 *
 * The re-read is explicit rather than subscribed. A subscription would mean the service knowing
 * about React, and the changes worth reacting to are few and all of them are initiated here: a
 * download the user started, one they cancelled, one they removed.
 */
export function useSurahDownloads(): {
  readonly downloads: SurahDownloadIndex;
  readonly totalBytes: number;
  readonly ready: boolean;
  readonly refresh: () => void;
  readonly remove: (reciterId: string, surah: number, ayahCount: number) => Promise<void>;
} {
  const audio = useRecitationAudio();
  const [downloads, setDownloads] = useState<SurahDownloadIndex>([]);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void audio.downloads().then((index) => {
      if (active) {
        setDownloads(index);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [audio, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  const remove = useCallback(
    async (reciterId: string, surah: number, ayahCount: number) => {
      await audio.removeDownload(reciterId, surah, ayahCount);
      setTick((value) => value + 1);
    },
    [audio],
  );

  return {
    downloads,
    totalBytes: downloadedBytes(downloads),
    ready,
    refresh,
    remove,
  };
}
