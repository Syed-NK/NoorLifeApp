import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import React from 'react';
import { Text, View } from 'react-native';

import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { MAX_SETTLE_TURNS, settleUntilLoaded } from '@/test-support/settle-until-loaded';

import { setRouteParams } from '../../../../jest.setup';
import type { FaithPage, FaithPageRequest, FaithResult } from '../data/faith-result';
import { createMockFaithRepositories } from '../data/mock';
import {
  ayahNumber,
  surahNumber,
  type AyahText,
  type AyahTranslation,
  type QuranContentRepository,
  type SurahSummary,
  type TranslationId,
} from '../data/quran-content.repository';
import { AyahBlock } from '../components/reader/ayah-block';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { ReaderScreen } from '../screens/reader-screen';

/**
 * The deep-link suite's own harness, under test — issue #55.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong, measured ────────────────────────────────────────────────
 * `quran-ayah-deep-link.test.tsx` timed out intermittently under full-suite load, in two separate
 * work streams, and passed 28/28 alone every time. It was never a hang: nine of its cases open a
 * target inside Al-Baqarah, the reader walks the surah in fifty-verse pages because cursors are
 * opaque, and it then renders **286 verse rows** with `items.map` inside a `ScrollView`. That render
 * costs about a second on an idle machine, so the case had a two-to-four-fold margin against Jest's
 * five-second default — and worker contention plus garbage collection is enough to consume it.
 *
 * On top of that, `openReader` spun a fixed twelve turns of `setTimeout(0)` after `render`. Measured,
 * the reader is already settled when `render` resolves, so every one of those turns was spent after
 * the fact at ~15 ms each: ~180 ms per case of pure waiting, taken out of the margin that ran out.
 *
 * ── What this file proves ───────────────────────────────────────────────────
 * The harness properties the timing fix rests on. The deep-link behaviour itself stays asserted in
 * its own suite; nothing here duplicates or replaces it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SUITE = join(__dirname, 'quran-ayah-deep-link.test.tsx');
const HELPER = join(__dirname, '..', '..', '..', 'test-support', 'settle-until-loaded.ts');
const READER = join(__dirname, '..', 'screens', 'reader-screen.tsx');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** `code`, split for guards that must distinguish a real statement from a quoted copy of one. */
function lines(path: string): readonly string[] {
  return code(path).split('\n');
}

const AL_BAQARAH_AYAT = 286;
const SURAHS: readonly SurahSummary[] = [
  {
    number: surahNumber(2),
    name: 'Al-Baqarah',
    arabicName: 'البقرة',
    meaning: 'The Cow',
    ayahCount: AL_BAQARAH_AYAT,
    revelation: 'medinan',
  },
];
const SOURCE = { name: 'Harness test source', verified: true } as const;

function paginate<T>(items: readonly T[], page?: FaithPageRequest): FaithPage<T> {
  const limit = page?.limit ?? 20;
  const from = page?.cursor === undefined ? 0 : Number.parseInt(page.cursor, 10);
  const start = Number.isNaN(from) ? 0 : from;
  return {
    items: items.slice(start, start + limit),
    nextCursor: start + limit < items.length ? String(start + limit) : null,
    total: items.length,
  };
}

/** A repository that records every read, and can be made to never answer. */
function createRecordingQuran(
  base: QuranContentRepository,
  log: string[],
  options: { readonly stall?: boolean } = {},
): QuranContentRepository {
  const text: readonly AyahText[] = Array.from({ length: AL_BAQARAH_AYAT }, (_, index) => ({
    surah: surahNumber(2),
    ayah: ayahNumber(index + 1),
    arabic: `verse-2-${index + 1}`,
    source: SOURCE,
  }));
  const translations = (translationId: TranslationId): readonly AyahTranslation[] =>
    Array.from({ length: AL_BAQARAH_AYAT }, (_, index) => ({
      surah: surahNumber(2),
      ayah: ayahNumber(index + 1),
      translationId,
      text: `meaning-2-${index + 1}`,
      source: { ...SOURCE, attribution: 'A Translator' },
    }));
  const never = new Promise<never>(() => undefined);

  return {
    ...base,
    source: SOURCE,
    async listSurahs(): Promise<FaithResult<readonly SurahSummary[]>> {
      return { kind: 'ok', data: SURAHS };
    },
    async getSurah(surah): Promise<FaithResult<SurahSummary>> {
      const found = SURAHS.find((item) => item.number === surah);
      return found === undefined
        ? { kind: 'error', code: 'not-found' }
        : { kind: 'ok', data: found };
    },
    async listAyahs(surah, page): Promise<FaithResult<FaithPage<AyahText>>> {
      log.push(`ayahs:${page?.cursor ?? 'none'}`);
      if (options.stall === true) {
        await never;
      }
      return { kind: 'ok', data: paginate(text, page) };
    },
    async listTranslations(
      surah,
      translationId,
      page,
    ): Promise<FaithResult<FaithPage<AyahTranslation>>> {
      log.push(`tr:${page?.cursor ?? 'none'}`);
      return { kind: 'ok', data: paginate(translations(translationId), page) };
    },
    async listRecitations(): Promise<FaithResult<FaithPage<AyahTranslation>>> {
      return { kind: 'empty' };
    },
  } as QuranContentRepository;
}

async function mountReader(
  params: Record<string, string>,
  log: string[],
  options: { readonly stall?: boolean } = {},
) {
  setRouteParams(params);
  const base = createMockFaithRepositories();
  return await render(
    <FaithRepositoryProvider
      repositories={{ ...base, quran: createRecordingQuran(base.quran, log, options) }}
    >
      <ReaderScreen />
    </FaithRepositoryProvider>,
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
});

/*
  This file mounts the 286-row reader in five of its cases, so it pays the same one-off compile cost
  the suite it polices pays — and it was paying it *inside* the first timed case: 1795 ms against
  153 ms for the next comparable one, a twelve-fold cold-start spread. That is the very defect the
  'warms the expensive path' guard below was written to prevent, one file over, which is why #55 kept
  recurring after the suite itself was fixed. Warming the same 286-verse path moves the cost into
  `beforeAll`, where it has its own budget and no case is charged for it.
*/
warmUpFirstMount(() => mountReader({ surah: '2', ayah: '286' }, []));

describe('readiness is a state transition, not elapsed time', () => {
  it('returns on the turn the loading marker is already gone', async () => {
    /*
      The measurement the fix rests on: RNTL's `render` awaits the whole load, so the reader is settled
      before the helper is even called. The helper must therefore spend **zero** turns — the twelve the
      suite used to spin were all after the fact.
    */
    const log: string[] = [];
    await mountReader({ surah: '2', ayah: '286' }, log);
    const turns = await settleUntilLoaded('faith-reader-body-loading');

    expect(turns).toBe(0);
    expect(screen.getByText('verse-2-286')).toBeTruthy();
  });

  it('is idempotent, so a second call costs nothing', async () => {
    const log: string[] = [];
    await mountReader({ surah: '2', ayah: '12' }, log);

    expect(await settleUntilLoaded('faith-reader-body-loading')).toBe(0);
    expect(await settleUntilLoaded('faith-reader-body-loading')).toBe(0);
  });

  it('names the marker and calls a hang a hang rather than waiting for the timeout', async () => {
    /*
      A screen that never settles must fail *by name*, not by a missing element several assertions
      later — and it must do so well inside the five-second default rather than consuming it. The
      marker here is one that is never removed, so the ceiling is reached.
    */
    await render(
      <View>
        <Text testID="never-settles-loading">loading forever</Text>
      </View>,
    );

    await expect(settleUntilLoaded('never-settles-loading')).rejects.toThrow(
      /"never-settles-loading" was still in the tree after \d+ turns/,
    );
  });

  it('has a bounded ceiling, so it can never spin indefinitely', () => {
    expect(MAX_SETTLE_TURNS).toBeGreaterThan(0);
    expect(MAX_SETTLE_TURNS).toBeLessThanOrEqual(64);
    // The loop must test the marker, not a counter, before deciding it is done.
    const helper = code(HELPER);
    expect(helper).toContain('if (screen.queryByTestId(loadingTestId) === null)');
    expect(helper).toContain('return turn;');
  });
});

describe('nothing from one case leaks into the next', () => {
  it('stops reading once the tree is unmounted', async () => {
    /*
      Requirement: no promise started by one case resolves into a later one. The reader's load is a
      single async function that commits state once at the end, so the check is that unmounting stops
      further reads — and that draining the loop afterwards produces none.
    */
    const log: string[] = [];
    await mountReader({ surah: '2', ayah: '286' }, log);
    await settleUntilLoaded('faith-reader-body-loading');
    const readsWhileMounted = log.length;
    expect(readsWhileMounted).toBeGreaterThan(2);

    await cleanup();
    for (let turn = 0; turn < MAX_SETTLE_TURNS; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(log).toHaveLength(readsWhileMounted);
  });

  it('does not update React after unmount, even mid-load', async () => {
    /*
      The stalling repository never answers its first page, so the load is genuinely in flight when the
      tree goes away. React logs "update ... on an unmounted component" or an act warning if stale work
      lands; this asserts the console stayed quiet.
    */
    const errors: unknown[][] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    try {
      const log: string[] = [];
      await mountReader({ surah: '2', ayah: '286' }, log, { stall: true });
      await cleanup();
      for (let turn = 0; turn < MAX_SETTLE_TURNS; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      spy.mockRestore();
    }

    const relevant = errors
      .map((args) => args.map(String).join(' '))
      .filter((line) => /not wrapped in act|unmounted component|overlapping act/i.test(line));
    expect(relevant).toEqual([]);
  });

  it('starts each case with storage cleared and its own request log', async () => {
    // The shared state this suite depends on, asserted rather than assumed.
    const keys = await AsyncStorage.getAllKeys();
    // `beforeEach` clears storage and then seeds exactly the translation preference.
    expect(keys.length).toBeLessThanOrEqual(1);

    const log: string[] = [];
    expect(log).toEqual([]);
    await mountReader({ surah: '2', ayah: '12' }, log);
    await settleUntilLoaded('faith-reader-body-loading');
    expect(log[0]).toBe('ayahs:none');
  });
});

describe('the verse list renders once, not once per unrelated commit', () => {
  /*
    The other half of #55, and the half that was production behaviour rather than test setup.

    Opening a deep link into Al-Baqarah committed three passes over the 286-row list: the mount, then
    two more as the transport settled and pointed itself at the target. No row displays anything that
    changed in those passes. Measured on the suite’s heaviest case, rendering rows is over 80% of it
    (about 815 ms of 1000), so the two wasted passes were most of the margin that ran out under load.
  */

  it('gives every row one shared handler rather than a closure each', () => {
    /*
      This is the regression, and it has to be read off the call site: RNTL 14 exposes only the host
      tree, so a composite prop cannot be queried back out of a mounted reader.

      The call site read `onOpenActions={() => onSelect(item)}`, which handed every row a function
      rebuilt on each parent render. Memoising the row would then have compared a fresh prop 286 times
      and re-rendered anyway — the memo below is only worth anything while this stays stable.
    */
    const reader = code(READER);

    expect(reader).toContain('onOpenActions={openActionsFor}');
    // The exact reverted shape; Prettier keeps this spacing, so a literal is enough.
    expect(reader).not.toContain('onOpenActions={() =>');
  });

  it('is memoised, so those passes are skipped rather than merely cheap', () => {
    // Stable prop identity buys nothing if the row itself never compares.
    const component = AyahBlock as unknown as { readonly $$typeof: symbol };
    expect(component.$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('still opens the actions for the verse actually pressed', async () => {
    /*
      Sharing one handler is only safe if it can still tell the rows apart: it now takes the verse
      number the row passes in. A handler that closed over the wrong verse, or ignored it, would open
      the sheet on verse one from anywhere in the surah.
    */
    await mountReader({ surah: '2', ayah: '286' }, []);
    await fireEvent.press(screen.getByTestId('faith-reader-ayah-number-2-12'));

    const sheet = await screen.findByTestId('faith-reader-ayah-actions');
    expect(within(sheet).getByText('Aya 2:12')).toBeTruthy();
  });
});

describe('the deep-link suite keeps the shape this fix depends on', () => {
  const suite = code(SUITE);

  it('waits on the loading marker instead of a fixed turn count', () => {
    /*
      The regression guard. Restoring the twelve-turn drain — or any unconditional loop of
      `setTimeout(0)` after `render` — puts back the ~180 ms per case that this issue was about, so the
      shape is pinned: the suite must call the helper and must not spin a counted loop of its own.
    */
    expect(suite).toContain("settleUntilLoaded('faith-reader-body-loading')");
    expect(suite).not.toMatch(/for \(let turn = 0; turn < \d+; turn \+= 1\)/);
    expect(suite).not.toMatch(/await new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\)/);
  });

  it('warms the expensive path rather than the cheap one', () => {
    /*
      `warmUpFirstMount` exists to move a one-off compile cost into `beforeAll`. Warming a seven-verse
      surah compiled the provider stack but never the 286-row list, so the first heavy case still paid
      for it — measured as a slowest-case spread of 1267–2333 ms before, against 928–1165 ms after.
    */
    expect(suite).toContain("warmUpFirstMount(() => openReader({ surah: '2', ayah: '286' }))");
  });

  it('holds every deep-link file that mounts the reader to that same warm-up', () => {
    /*
      The guard above policed one file. This one mounts the same 286-row reader in five of its cases
      and was not held to the rule, so it paid the cold mount inside its first timed case and #55 kept
      recurring after the suite itself had been fixed. The rule is therefore pinned to *every* file
      here that mounts the reader, which is what stops a third one reintroducing it.

      Only a **top-level** registration counts. Matching the name anywhere in the file made this guard
      pass by finding the sibling guard's own quoted copy of the call above — it stayed green with the
      warm-up deleted until that was found, which is the second way a source-shape guard can lie.
    */
    const inThisFolder = readdirSync(__dirname).filter(
      (name) => name.startsWith('quran-ayah-deep-link') && name.endsWith('.test.tsx'),
    );
    const mounting = inThisFolder.filter((name) =>
      lines(join(__dirname, name)).some(
        (line) => line.startsWith('import') && line.includes('ReaderScreen'),
      ),
    );

    /*
      Naming the two known files proves the filter still matches something — a bare loop over an empty
      list passes vacuously. The loop itself is left open-ended so a *third* file that mounts the
      reader is covered the day it is added, with no list to remember to update.
    */
    expect(mounting).toContain('quran-ayah-deep-link.test.tsx');
    expect(mounting).toContain('quran-ayah-deep-link-harness.test.tsx');
    for (const name of mounting) {
      const registration = lines(join(__dirname, name)).find((line) =>
        line.startsWith('warmUpFirstMount('),
      );
      expect(`${name} registers a warm-up: ${registration !== undefined}`).toBe(
        `${name} registers a warm-up: true`,
      );
      // And warms the expensive path, not a seven-verse surah that compiles no long list.
      expect(`${name} warms 286: ${registration?.includes("ayah: '286'") === true}`).toBe(
        `${name} warms 286: true`,
      );
    }
  });

  it('needs no timeout of its own', () => {
    /*
      The fix must not be a bigger budget. Neither this suite nor the helper may set one, and the
      project's five-second default has to remain what every case here runs under.
    */
    expect(suite).not.toContain('jest.setTimeout');
    expect(code(HELPER)).not.toContain('jest.setTimeout');
    // No per-case timeout argument either — `it('…', fn, 30000)`.
    expect(suite).not.toMatch(/\}\s*,\s*\d{4,}\s*\)\s*;/);
  });

  it('still covers all 28 cases and every deep-link assertion', () => {
    // Coverage must not have been traded for speed.
    const cases = suite.match(/\n\s{2}it(?:\.each)?\(/g) ?? [];
    expect(cases.length).toBeGreaterThanOrEqual(28);
    for (const assertion of [
      "getByText('verse-2-286')",
      "getByText('verse-2-255')",
      'Opened at verse 286',
      'Opened at verse 255',
    ]) {
      expect(suite).toContain(assertion);
    }
  });
});
