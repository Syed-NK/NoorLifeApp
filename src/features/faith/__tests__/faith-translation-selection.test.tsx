import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import React, { type ReactElement } from 'react';

import type { FaithRepositories } from '../data';
import type { FaithResult } from '../data/faith-result';
import { createMockFaithRepositories } from '../data/mock';
import type {
  AyahTranslation,
  ReciterEdition,
  SurahNumber,
  TranslationEdition,
  TranslationId,
} from '../data/quran-content.repository';
import { ayahNumber, surahNumber } from '../data/quran-content.repository';
import {
  isPreferredTranslator,
  rankEnglishCandidates,
  resolveDefaultTranslation,
  validateTranslation,
} from '../data/translation-default';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { ReciterScreen, orderReciters, styleFiltersFor } from '../screens/reciter-screen';
import {
  DEFAULT_LANGUAGE_FILTER,
  TranslationScreen,
  matchesLanguageFilter,
  matchesQuery,
  orderEditions,
} from '../screens/translation-screen';
import {
  DEFAULT_RECITER_ID,
  DEFAULT_TRANSLATION_CHOICE,
  defaultFaithPreferences,
  migratePreferences,
  readFaithPreferences,
  RETIRED_TRANSLATION_IDS,
} from '../storage/faith-preferences';

/**
 * The translation and reciter selection experience.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this suite exists to close ───────────────────────────────────
 * One preferences screen rendered the vendor's *entire* translation catalogue and its entire
 * recitation catalogue in two unfiltered runs — hundreds of rows across every language published,
 * with no search and no filter. The practical result was a user whose selected edition was Bosnian,
 * with no way to tell how it got there and no realistic way to change it.
 *
 * Underneath sat a second, quieter defect: the default was the constant `'131'`, taken from the one
 * `resource_id` the vendor's specification names by example. That id is real, is listed in the
 * catalogue, and on NoorLife's credentials returns `200` with **zero rows and no attribution** — an
 * edition that exists and renders nothing. Catalogue membership is not availability, and the default
 * is now resolved from the live catalogue and probed before it is accepted.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Real timers, and only the first mount paid for in `beforeAll`.
 *
 * Not `installMockLatencyTimers`: these two screens settle through a **promise chain** — the
 * catalogue read and the preference read — rather than through a timer. Under fake timers `waitFor`
 * advances its simulated budget to exhaustion in microseconds, before those microtasks have run, so
 * every `findBy*` fails on a tree that is about to be correct. `mock-latency-timers.ts` documents
 * the same trade-off for `faith-interactions`.
 */
warmUpFirstMount(() => withRepositories(<TranslationScreen key="warm-up" />));

beforeEach(async () => {
  await AsyncStorage.clear();
});

async function withRepositories(element: ReactElement, repositories?: Partial<FaithRepositories>) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), ...repositories }}>
      {element}
    </FaithRepositoryProvider>,
  );
  return screen;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — a catalogue shaped like the live one, i.e. many languages
// ─────────────────────────────────────────────────────────────────────────────

const ABDEL_HALEEM: TranslationEdition = {
  id: '85',
  language: 'english',
  name: 'The Qur’an: A New Translation',
  translator: 'M.A.S. Abdel Haleem',
};

const SAHEEH: TranslationEdition = {
  id: '20',
  language: 'english',
  name: 'Saheeh International',
  translator: 'Saheeh International',
};

const BOSNIAN: TranslationEdition = {
  id: '126',
  language: 'bosnian',
  name: 'Besim Korkut',
  translator: 'Besim Korkut',
};

/** The edition that answers `200` with nothing. Present in the catalogue, and unusable. */
const EMPTY_EDITION: TranslationEdition = {
  id: '131',
  language: 'english',
  name: 'Dr. Mustafa Khattab, the Clear Quran',
  translator: 'Dr. Mustafa Khattab',
};

const URDU: TranslationEdition = {
  id: '234',
  language: 'urdu',
  name: 'Bayan-ul-Quran',
  translator: 'Dr. Israr Ahmad',
};

const SWAHILI: TranslationEdition = {
  id: '400',
  language: 'swahili',
  name: 'Ali Muhsin Al-Barwani',
  translator: 'Ali Muhsin Al-Barwani',
};

const CATALOGUE: readonly TranslationEdition[] = [
  BOSNIAN,
  EMPTY_EDITION,
  SAHEEH,
  ABDEL_HALEEM,
  URDU,
  SWAHILI,
];

function translatedRow(translationId: TranslationId, attribution: string | undefined) {
  const row: AyahTranslation = {
    surah: surahNumber(1),
    ayah: ayahNumber(1),
    translationId,
    text: 'In the name of God, the Lord of Mercy, the Giver of Mercy.',
    source: {
      name: 'Quran Foundation Content API',
      verified: true,
      ...(attribution === undefined ? {} : { attribution }),
    },
  };
  return row;
}

/**
 * A Qur'an repository whose translation catalogue and per-edition behaviour a case can dictate.
 *
 * `empty` is the `131` case: a successful page carrying no rows. `unattributed` is the fail-closed
 * case: rows, but nobody to credit.
 */
function quranWith(options: {
  readonly catalogue?: readonly TranslationEdition[];
  readonly empty?: readonly TranslationId[];
  readonly unattributed?: readonly TranslationId[];
  readonly catalogueFails?: boolean;
  readonly reciters?: readonly ReciterEdition[];
}) {
  const base = createMockFaithRepositories().quran;
  return {
    ...base,
    async availableTranslations(): Promise<FaithResult<readonly TranslationEdition[]>> {
      return options.catalogueFails === true
        ? { kind: 'error', code: 'unavailable' }
        : { kind: 'ok', data: options.catalogue ?? CATALOGUE };
    },
    async availableReciters(): Promise<FaithResult<readonly ReciterEdition[]>> {
      return { kind: 'ok', data: options.reciters ?? [] };
    },
    async listTranslations(_surah: SurahNumber, translationId: TranslationId) {
      if (options.empty?.includes(translationId) === true) {
        return { kind: 'ok' as const, data: { items: [], nextCursor: null } };
      }
      const attribution = options.unattributed?.includes(translationId)
        ? undefined
        : 'M.A.S. Abdel Haleem';
      return {
        kind: 'ok' as const,
        data: { items: [translatedRow(translationId, attribution)], nextCursor: null },
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The default: resolved from the live catalogue, and validated
// ─────────────────────────────────────────────────────────────────────────────

describe('the default translation', () => {
  it('is the resolver’s own validated answer, recorded rather than recomputed', async () => {
    /**
     * ── What changed here, and what deliberately did not ────────────────────────
     * This used to assert that a fresh install stored **no** translation until the live catalogue
     * answered. That was the right correction to `131` — a specification example that was never
     * checked and returns nothing on NoorLife's credentials — and it was expensive in the one place
     * it is felt: every install re-derived the same answer across one catalogue read and up to five
     * sequential single-verse probes, on the path that gates the reader's first paint.
     *
     * So the resolver is kept and the rediscovery is not. `85` is not a guess in the way `131` was:
     * it is what `resolveDefaultTranslation` returns, and the test below it still proves the
     * resolver reaches that answer from a live catalogue. Recording a validated result is different
     * from inventing one.
     */
    const prefs = await readFaithPreferences();
    expect(prefs.translation).toEqual(DEFAULT_TRANSLATION_CHOICE);
    expect(prefs.translation?.id).toBe('85');
    // Still NoorLife's choice rather than the user's, so it remains replaceable.
    expect(prefs.translationChosenByUser).toBe(false);
    expect(defaultFaithPreferences.translation).toEqual(DEFAULT_TRANSLATION_CHOICE);
  });

  it('prefers M.A.S. Abdel Haleem when the live edition renders', async () => {
    const outcome = await resolveDefaultTranslation(quranWith({}));
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') {
      return;
    }
    expect(outcome.choice.id).toBe(ABDEL_HALEEM.id);
    expect(outcome.choice.language).toBe('english');
    expect(outcome.choice.translator).toBe('M.A.S. Abdel Haleem');
    expect(outcome.choice.name).toBe(ABDEL_HALEEM.name);
  });

  it('falls back to the first valid English edition when the preferred one does not render', async () => {
    /**
     * "Otherwise use the first valid English translation returned by the catalogue" — with the
     * ordering made deterministic by name, so two installs on the same day cannot disagree about
     * what the default is because the vendor changed its row order.
     */
    const outcome = await resolveDefaultTranslation(
      quranWith({ empty: [ABDEL_HALEEM.id, EMPTY_EDITION.id] }),
    );
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') {
      return;
    }
    expect(outcome.choice.id).toBe(SAHEEH.id);
  });

  it('never selects a non-English edition as the default', async () => {
    // Only Bosnian and Urdu render; neither may become NoorLife's default.
    const outcome = await resolveDefaultTranslation(
      quranWith({ catalogue: [BOSNIAN, URDU], empty: [] }),
    );
    expect(outcome.kind).toBe('no-valid-english');
  });

  it('reports an unreachable catalogue distinctly from a catalogue with nothing usable', async () => {
    expect((await resolveDefaultTranslation(quranWith({ catalogueFails: true }))).kind).toBe(
      'catalogue-unavailable',
    );
    expect((await resolveDefaultTranslation(quranWith({ catalogue: [BOSNIAN] }))).kind).toBe(
      'no-valid-english',
    );
  });
});

describe('validating an edition before it is accepted', () => {
  it('treats a 200 with zero rows as unavailable, not as a successful empty translation', async () => {
    /**
     * The `131` case, stated exactly as the brief does. An empty page is a legitimate answer at the
     * *end* of a surah; for page one of Al-Fatihah it means the edition has no content, and a reader
     * would render that as "this surah has no translation" — a claim about scripture.
     */
    const repo = quranWith({ empty: [EMPTY_EDITION.id] });
    expect(await validateTranslation(repo, EMPTY_EDITION)).toBe(false);
    expect(await validateTranslation(repo, ABDEL_HALEEM)).toBe(true);
  });

  it('fails closed when the rows carry no attribution', async () => {
    const repo = quranWith({ unattributed: [SAHEEH.id] });
    expect(await validateTranslation(repo, SAHEEH)).toBe(false);
  });

  it('excludes retired ids from the candidates without spending a request on them', async () => {
    expect(RETIRED_TRANSLATION_IDS.has('131')).toBe(true);
    const ranked = rankEnglishCandidates(CATALOGUE);
    expect(ranked.map((edition) => edition.id)).not.toContain('131');
    // And the preferred translator still sorts first among what remains.
    expect(ranked[0]?.id).toBe(ABDEL_HALEEM.id);
  });

  it('spends no probe slot on a duplicated resource id', async () => {
    /**
     * Not hypothetical. A verification run against the deployed function listed resource `85`
     * **twice**, and without this the same edition would consume two of the five probe slots — and
     * fail twice for the same reason — pushing a genuinely different candidate out of the budget.
     */
    const duplicated = [ABDEL_HALEEM, { ...ABDEL_HALEEM }, SAHEEH];
    const ranked = rankEnglishCandidates(duplicated);
    expect(ranked.map((edition) => edition.id)).toEqual([ABDEL_HALEEM.id, SAHEEH.id]);

    // And the first occurrence is the one kept, so the preferred-translator ranking survives.
    const reordered = rankEnglishCandidates([SAHEEH, ABDEL_HALEEM, { ...ABDEL_HALEEM }]);
    expect(reordered[0]?.id).toBe(ABDEL_HALEEM.id);
    expect(reordered).toHaveLength(2);
  });

  it('probes each distinct edition at most once when the catalogue repeats one', async () => {
    const probed: string[] = [];
    const base = quranWith({ catalogue: [ABDEL_HALEEM, { ...ABDEL_HALEEM }, SAHEEH] });
    const repo = {
      ...base,
      listTranslations: async (surah: SurahNumber, translationId: TranslationId) => {
        probed.push(translationId);
        return await base.listTranslations(surah, translationId);
      },
    };

    const outcome = await resolveDefaultTranslation(repo);
    expect(outcome.kind).toBe('resolved');
    expect(probed).toEqual([ABDEL_HALEEM.id]);
  });

  it('matches the preferred translator across the spellings the vendor has used', () => {
    expect(isPreferredTranslator(ABDEL_HALEEM)).toBe(true);
    expect(isPreferredTranslator({ ...ABDEL_HALEEM, translator: 'Abdul Haleem' })).toBe(true);
    expect(isPreferredTranslator(SAHEEH)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration
// ─────────────────────────────────────────────────────────────────────────────

describe('migrating a stored preference', () => {
  it('migrates an accidental Bosnian default to the validated English one', () => {
    /**
     * The user never chose it — the old screen listed every language at once with no filter, so a
     * stored value with no record of a deliberate choice is NoorLife's own default or a mis-tap.
     * Rejecting it is unchanged; what replaces it is now the validated default rather than `null`,
     * because there is a known-good edition to name and re-deriving it costs six round trips.
     */
    const migrated = migratePreferences({ translationId: '126', reciterId: '1' });
    expect(migrated.translation).toEqual(DEFAULT_TRANSLATION_CHOICE);
    expect(migrated.translationChosenByUser).toBe(false);
  });

  it('migrates the invalid 131 default when it was NoorLife’s own choice', () => {
    const migrated = migratePreferences({
      translation: { ...EMPTY_EDITION },
      translationChosenByUser: false,
    });
    expect(migrated.translation).toEqual(DEFAULT_TRANSLATION_CHOICE);
    // The point of the migration is unchanged: the edition that renders nothing does not survive.
    expect(migrated.translation?.id).not.toBe('131');
  });

  it('leaves a cleared choice cleared once the install has been seeded', () => {
    /**
     * The case a seeded default must not swallow, and the reason `translationDefaultSeeded` exists.
     *
     * `resetToDefault` writes `null` after the reader reports `edition-unavailable`. Re-seeding that
     * would hand back the edition that had just failed, on every read, and make the recovery path
     * unreachable — so a seeded install keeps `null` and the live resolver runs.
     */
    const migrated = migratePreferences({
      translation: null,
      translationChosenByUser: false,
      translationDefaultSeeded: true,
    });
    expect(migrated.translation).toBeNull();
  });

  it('preserves a deliberate valid non-English selection', () => {
    /**
     * The requirement that pulls against the two above, and the reason `translationChosenByUser`
     * exists at all: nothing about a stored id distinguishes "the user reads Bosnian" from "the old
     * default was Bosnian". Only the moment of choosing can record that.
     */
    const migrated = migratePreferences({
      translation: { ...BOSNIAN },
      translationChosenByUser: true,
    });
    expect(migrated.translation?.id).toBe(BOSNIAN.id);
    expect(migrated.translationChosenByUser).toBe(true);
  });

  it('preserves a deliberate selection even of the edition NoorLife retired', () => {
    // Their choice, their reading. NoorLife corrects its own defaults, not the user's decisions.
    const migrated = migratePreferences({
      translation: { ...EMPTY_EDITION },
      translationChosenByUser: true,
    });
    expect(migrated.translation?.id).toBe('131');
  });

  it('keeps every unrelated preference while correcting the translation', () => {
    const migrated = migratePreferences({
      translationId: '126',
      calculationMethod: 'egyptian',
      locationLabel: 'Manchester',
      showTransliteration: false,
    });
    expect(migrated.calculationMethod).toBe('egyptian');
    expect(migrated.locationLabel).toBe('Manchester');
    expect(migrated.showTransliteration).toBe(false);
  });

  it('defaults the reciter to Sudais, resource id 3', () => {
    expect(DEFAULT_RECITER_ID).toBe('3');
    expect(migratePreferences({}).reciterId).toBe('3');
    expect(migratePreferences({ reciterId: 'mock.ar.reciter' }).reciterId).toBe('3');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Filtering, search and ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('translation filtering and search', () => {
  it('starts on the English filter', () => {
    expect(DEFAULT_LANGUAGE_FILTER).toBe('english');
  });

  it('filters by language, and routes an unlisted language to Other', () => {
    expect(matchesLanguageFilter(ABDEL_HALEEM, 'english')).toBe(true);
    expect(matchesLanguageFilter(BOSNIAN, 'english')).toBe(false);
    expect(matchesLanguageFilter(URDU, 'urdu')).toBe(true);
    // Swahili has no chip of its own, so it must still be reachable.
    expect(matchesLanguageFilter(SWAHILI, 'other')).toBe(true);
    expect(matchesLanguageFilter(URDU, 'other')).toBe(false);
    expect(matchesLanguageFilter(BOSNIAN, 'all')).toBe(true);
  });

  it('searches by name, translator and language, case-insensitively', () => {
    expect(matchesQuery(ABDEL_HALEEM, 'new translation')).toBe(true);
    expect(matchesQuery(ABDEL_HALEEM, 'ABDEL HALEEM')).toBe(true);
    expect(matchesQuery(BOSNIAN, 'bosnian')).toBe(true);
    expect(matchesQuery(BOSNIAN, 'urdu')).toBe(false);
    expect(matchesQuery(SAHEEH, '')).toBe(true);
  });

  it('puts the selected edition first, then orders by name', () => {
    const ordered = orderEditions(CATALOGUE, 'all', '', BOSNIAN.id);
    expect(ordered[0]?.id).toBe(BOSNIAN.id);

    const english = orderEditions(CATALOGUE, 'english', '', null);
    const names = english.map((edition) => edition.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(english.every((edition) => edition.language === 'english')).toBe(true);
  });
});

describe('reciter filtering and search', () => {
  const SUDAIS: ReciterEdition = { id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' };
  const MINSHAWI: ReciterEdition = {
    id: '9',
    name: 'Mohamed Siddiq al-Minshawi',
    style: 'Mujawwad',
  };
  const NO_STYLE: ReciterEdition = { id: '12', name: 'Khalil Al-Husary' };

  it('offers style chips only when the catalogue supplies more than one style', () => {
    expect(styleFiltersFor([SUDAIS, NO_STYLE])).toEqual([]);
    const filters = styleFiltersFor([SUDAIS, MINSHAWI, NO_STYLE]);
    expect(filters[0]?.id).toBe('all');
    expect(filters.map((filter) => filter.label)).toContain('Mujawwad');
    expect(filters.map((filter) => filter.label)).toContain('Murattal');
  });

  it('searches by name and style, and puts the selected reciter first', () => {
    const list = [MINSHAWI, SUDAIS, NO_STYLE];
    expect(orderReciters(list, 'all', 'sudais', null).map((r) => r.id)).toEqual(['3']);
    expect(orderReciters(list, 'all', 'MUJAWWAD', null).map((r) => r.id)).toEqual(['9']);
    expect(orderReciters(list, 'all', '', SUDAIS.id)[0]?.id).toBe('3');
    expect(orderReciters(list, 'mujawwad', '', null).map((r) => r.id)).toEqual(['9']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The screens
// ─────────────────────────────────────────────────────────────────────────────

describe('the translation screen', () => {
  it('renders its own catalogue, filtered to English, with no reciters on it', async () => {
    const view = await withRepositories(<TranslationScreen />, {
      quran: quranWith({ reciters: [{ id: '3', name: 'Abdur-Rahman as-Sudais' }] }),
    });

    expect(await view.findByTestId('faith-translations-list')).toBeTruthy();
    // English editions are present…
    expect(await view.findByTestId(`faith-translations-row-${ABDEL_HALEEM.id}`)).toBeTruthy();
    // …and a Bosnian one is not, because the English filter is selected on open.
    expect(view.queryByTestId(`faith-translations-row-${BOSNIAN.id}`)).toBeNull();
    // A reciter must never appear on this screen.
    expect(view.queryByTestId('faith-translations-row-3')).toBeNull();
  });

  it('narrows to a language when its chip is pressed', async () => {
    const view = await withRepositories(<TranslationScreen />, { quran: quranWith({}) });

    /*
      Bosnian has no chip of its own — the row is English, Arabic, Urdu, Bengali, Russian, Other,
      All — so `Other` is the chip that must reach it. That is the property worth asserting: a
      language without a chip is still reachable, which is what stops the chip row from becoming the
      same wall of options the unfiltered list was.
    */
    fireEvent.press(await view.findByTestId('faith-translations-filter-other'));
    expect(await view.findByTestId(`faith-translations-row-${BOSNIAN.id}`)).toBeTruthy();
    expect(view.queryByTestId(`faith-translations-row-${ABDEL_HALEEM.id}`)).toBeNull();

    // And Urdu, which does have a chip, is reached by its own.
    fireEvent.press(await view.findByTestId('faith-translations-filter-urdu'));
    expect(await view.findByTestId(`faith-translations-row-${URDU.id}`)).toBeTruthy();
  });

  it('searches across languages by translator', async () => {
    const view = await withRepositories(<TranslationScreen />, { quran: quranWith({}) });

    fireEvent.press(await view.findByTestId('faith-translations-filter-all'));
    fireEvent.changeText(await view.findByTestId('faith-translations-search'), 'korkut');
    expect(await view.findByTestId(`faith-translations-row-${BOSNIAN.id}`)).toBeTruthy();
    expect(view.queryByTestId(`faith-translations-row-${SAHEEH.id}`)).toBeNull();
  });

  it('shows a no-results state rather than an empty screen', async () => {
    const view = await withRepositories(<TranslationScreen />, { quran: quranWith({}) });

    fireEvent.changeText(
      await view.findByTestId('faith-translations-search'),
      'zzzz-no-such-edition',
    );
    expect(await view.findByTestId('faith-translations-no-results')).toBeTruthy();
  });

  it('reports an unreachable catalogue with a retry rather than an empty list', async () => {
    const view = await withRepositories(<TranslationScreen />, {
      quran: quranWith({ catalogueFails: true }),
    });
    expect(await view.findByTestId('faith-translations-body-error')).toBeTruthy();
  });

  it('does not display the technical source notice above the list', async () => {
    const view = await withRepositories(<TranslationScreen />, { quran: quranWith({}) });
    await view.findByTestId('faith-translations-list');
    expect(view.queryByText(/Quran Foundation Content API/i)).toBeNull();
  });
});

describe('the reciter screen', () => {
  it('renders only reciters, and marks the selected one', async () => {
    const view = await withRepositories(<ReciterScreen />, {
      quran: quranWith({
        reciters: [
          { id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' },
          { id: '9', name: 'Mohamed Siddiq al-Minshawi', style: 'Mujawwad' },
        ],
      }),
    });

    expect(await view.findByTestId('faith-reciters-row-3')).toBeTruthy();
    expect(await view.findByTestId('faith-reciters-selected-3')).toBeTruthy();
    // No translation edition may appear here.
    expect(view.queryByTestId(`faith-reciters-row-${ABDEL_HALEEM.id}`)).toBeNull();
  });

  it('filters by search', async () => {
    const view = await withRepositories(<ReciterScreen />, {
      quran: quranWith({
        reciters: [
          { id: '3', name: 'Abdur-Rahman as-Sudais' },
          { id: '9', name: 'Mohamed Siddiq al-Minshawi' },
        ],
      }),
    });

    fireEvent.changeText(await view.findByTestId('faith-reciters-search'), 'minshawi');
    expect(await view.findByTestId('faith-reciters-row-9')).toBeTruthy();
    expect(view.queryByTestId('faith-reciters-row-3')).toBeNull();
  });

  it('does not display the technical source notice above the list', async () => {
    const view = await withRepositories(<ReciterScreen />, {
      quran: quranWith({ reciters: [{ id: '3', name: 'Abdur-Rahman as-Sudais' }] }),
    });
    await view.findByTestId('faith-reciters-list');
    expect(view.queryByText(/Quran Foundation Content API/i)).toBeNull();
  });
});
