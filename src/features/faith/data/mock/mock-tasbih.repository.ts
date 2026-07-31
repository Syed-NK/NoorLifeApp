import type { FaithResult } from '../faith-result';
import type {
  DhikrPreset,
  TasbihHistoryEntry,
  TasbihRepository,
  TasbihSession,
} from '../tasbih.repository';
import {
  faithStorageKeys,
  hasNumber,
  hasString,
  isRecord,
  readJson,
  writeChecked,
  writeJson,
} from '../../storage/faith-storage';
import { nowIso } from './mock-support';

/**
 * The tasbih counter — genuinely working and genuinely persistent.
 *
 * ── No artificial latency here ──────────────────────────────────────────────
 * Every other mock delays to make loading states visible. This one does not: a counter
 * that lagged 280 ms behind the tap would feel broken, and the phase asks for a *working*
 * counter. Reads and writes go straight to AsyncStorage, which is fast enough that the
 * button responds immediately.
 *
 * ── Why `increment` reports a failed write ──────────────────────────────────
 * `writeChecked` returns a boolean and this method surfaces it as an `error` result. The
 * alternative — incrementing in memory and hoping the write landed — shows the user a
 * count that silently vanishes on restart. For a worship counter that is the one failure
 * mode worth being loud about.
 */

const PRESETS: readonly DhikrPreset[] = [
  {
    id: 'subhanallah',
    arabic: 'سُبْحَانَ اللَّهِ',
    transliteration: 'SubhanAllah',
    translation: 'Glory be to Allah',
    target: 33,
  },
  {
    id: 'alhamdulillah',
    arabic: 'الْحَمْدُ لِلَّهِ',
    transliteration: 'Alhamdulillah',
    translation: 'All praise is for Allah',
    target: 33,
  },
  {
    id: 'allahuakbar',
    arabic: 'اللَّهُ أَكْبَرُ',
    transliteration: 'Allahu Akbar',
    translation: 'Allah is the Greatest',
    target: 34,
  },
  {
    id: 'astaghfirullah',
    arabic: 'أَسْتَغْفِرُ اللَّهَ',
    transliteration: 'Astaghfirullah',
    translation: 'I seek forgiveness from Allah',
    target: 100,
  },
  {
    id: 'la-ilaha',
    arabic: 'لَا إِلَٰهَ إِلَّا اللَّهُ',
    transliteration: 'La ilaha illa Allah',
    translation: 'There is no deity except Allah',
    target: 100,
  },
];

function isSession(value: unknown): value is TasbihSession {
  return (
    isRecord(value) &&
    hasString(value, 'presetId') &&
    hasNumber(value, 'count') &&
    hasNumber(value, 'rounds') &&
    hasNumber(value, 'target')
  );
}

function isHistory(value: unknown): value is TasbihHistoryEntry[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && hasNumber(item, 'count'));
}

function freshSession(presetId: string): TasbihSession {
  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0]!;
  return {
    presetId: preset.id,
    count: 0,
    rounds: 0,
    target: preset.target,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
}

async function loadSession(): Promise<TasbihSession | null> {
  const stored = await readJson<TasbihSession | null>(
    faithStorageKeys.tasbihSession,
    null,
    (value): value is TasbihSession | null => value === null || isSession(value),
  );
  return stored;
}

async function archive(session: TasbihSession): Promise<void> {
  if (session.count === 0) {
    return;
  }
  const history = await readJson(
    faithStorageKeys.tasbihHistory,
    [] as TasbihHistoryEntry[],
    isHistory,
  );
  const entry: TasbihHistoryEntry = {
    presetId: session.presetId,
    count: session.count,
    rounds: session.rounds,
    completedAt: nowIso(),
  };
  await writeJson(faithStorageKeys.tasbihHistory, [entry, ...history].slice(0, 50));
}

export function createMockTasbihRepository(): TasbihRepository {
  async function mutate(
    change: (session: TasbihSession) => TasbihSession,
  ): Promise<FaithResult<TasbihSession>> {
    const current = (await loadSession()) ?? freshSession(PRESETS[0]!.id);
    const next = change(current);
    const written = await writeChecked(faithStorageKeys.tasbihSession, next);
    if (!written) {
      return { kind: 'error', code: 'unavailable', detail: 'tasbih write failed' };
    }
    return { kind: 'ok', data: next };
  }

  return {
    async listPresets(): Promise<FaithResult<readonly DhikrPreset[]>> {
      return { kind: 'ok', data: PRESETS };
    },

    async getSession(): Promise<FaithResult<TasbihSession>> {
      const stored = await loadSession();
      if (stored === null) {
        return { kind: 'empty' };
      }
      return { kind: 'ok', data: stored };
    },

    async startSession(presetId: string): Promise<FaithResult<TasbihSession>> {
      const current = await loadSession();
      if (current !== null && current.presetId !== presetId) {
        await archive(current);
      }
      const next = freshSession(presetId);
      const written = await writeChecked(faithStorageKeys.tasbihSession, next);
      if (!written) {
        return { kind: 'error', code: 'unavailable', detail: 'tasbih write failed' };
      }
      return { kind: 'ok', data: next };
    },

    async increment(): Promise<FaithResult<TasbihSession>> {
      return mutate((session) => {
        const count = session.count + 1;
        // A completed round rolls the count back to zero and banks the round, which is
        // how a physical tasbih behaves.
        const completed = count >= session.target;
        return {
          ...session,
          count: completed ? 0 : count,
          rounds: completed ? session.rounds + 1 : session.rounds,
          updatedAt: nowIso(),
        };
      });
    },

    async decrement(): Promise<FaithResult<TasbihSession>> {
      return mutate((session) => ({
        ...session,
        count: Math.max(0, session.count - 1),
        updatedAt: nowIso(),
      }));
    },

    async reset(): Promise<FaithResult<TasbihSession>> {
      const current = await loadSession();
      if (current !== null) {
        await archive(current);
      }
      const next = freshSession(current?.presetId ?? PRESETS[0]!.id);
      const written = await writeChecked(faithStorageKeys.tasbihSession, next);
      if (!written) {
        return { kind: 'error', code: 'unavailable', detail: 'tasbih reset failed' };
      }
      return { kind: 'ok', data: next };
    },

    async getHistory(limit = 20): Promise<FaithResult<readonly TasbihHistoryEntry[]>> {
      const history = await readJson(
        faithStorageKeys.tasbihHistory,
        [] as TasbihHistoryEntry[],
        isHistory,
      );
      if (history.length === 0) {
        return { kind: 'empty' };
      }
      return { kind: 'ok', data: history.slice(0, limit) };
    },
  };
}

export const dhikrPresetsForTest = PRESETS;
