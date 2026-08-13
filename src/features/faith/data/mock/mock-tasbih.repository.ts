import type { FaithResult } from '../faith-result';
import { MAX_TASBIH_TARGET, MIN_TASBIH_TARGET } from '../tasbih.repository';
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
  /**
   * Mutations run one at a time, in the order they were requested.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── The race this closes, and why it is the important one here ──────────────
   * Every mutation is a read-modify-write across an `await`: load the session, apply the change,
   * write it back. Two taps arriving before the first write lands both read the *same* stored
   * session, both compute a count of one, and both write it. The second tap is silently lost.
   *
   * Which is exactly the defining use of a tasbih. Somebody counting a hundred repetitions taps as
   * fast as their thumb moves — that is not an edge case, it is the feature — and a counter that
   * drops beads under fast tapping is a counter that miscounts an act of worship. It was found by a
   * test that pressed the target stepper thirty-two times without waiting, and it applies equally to
   * `increment`, where it matters far more.
   *
   * A serial queue is the smallest fix that is actually correct: each mutation awaits the previous
   * one, so every one of them reads what the last one wrote. Ordering is preserved, no work is
   * dropped, and nothing needs to know about anything else.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  let pending: Promise<unknown> = Promise.resolve();

  async function mutate(
    change: (session: TasbihSession) => TasbihSession,
  ): Promise<FaithResult<TasbihSession>> {
    const run = pending.then(async (): Promise<FaithResult<TasbihSession>> => {
      const current = (await loadSession()) ?? freshSession(PRESETS[0]!.id);
      const next = change(current);
      const written = await writeChecked(faithStorageKeys.tasbihSession, next);
      if (!written) {
        return { kind: 'error', code: 'unavailable', detail: 'tasbih write failed' };
      }
      return { kind: 'ok', data: next };
    });
    // The queue must survive a failed mutation, so the chain is advanced by a promise that cannot
    // reject. A rejection here would wedge every later tap.
    pending = run.catch(() => undefined);
    return run;
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

    async adjustTarget(delta: number): Promise<FaithResult<TasbihSession>> {
      if (!Number.isFinite(delta)) {
        return { kind: 'error', code: 'unknown' };
      }
      /*
        The count survives a target change. The taps already made were real, and discarding them
        because somebody adjusted their intention mid-session would be the counter deciding their
        dhikr did not happen. A target set below the current count simply completes the round on the
        next tap.
      */
      return mutate((session) => ({
        ...session,
        // Clamped after applying, so pressing past a bound stops there rather than failing.
        target: Math.min(
          Math.max(Math.round(session.target + delta), MIN_TASBIH_TARGET),
          MAX_TASBIH_TARGET,
        ),
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
