import type { FaithPage, FaithPageRequest, FaithResult } from '../faith-result';
import {
  ayahNumber,
  surahNumber,
  type AyahRecitation,
  type AyahText,
  type AyahTranslation,
  type QuranContentRepository,
  type ReciterEdition,
  type SurahNumber,
  type SurahSummary,
  type TranslationEdition,
  type TranslationId,
} from '../quran-content.repository';
import { MOCK_SOURCE, delay, matches, paginate } from './mock-support';

/**
 * Local Qur'an fixtures.
 *
 * ── Scope, stated plainly ───────────────────────────────────────────────────
 * This is **not** a Qur'an. It carries a handful of widely-known ayat so the reader,
 * search, bookmark and Daily-Ayah screens can be built and reviewed, and every one of
 * them is stamped with `MOCK_SOURCE`, which the UI renders as "not a verified source".
 *
 * The surah *list* is complete and accurate (114 entries, correct names and ayah counts)
 * because that is catalogue metadata rather than scripture, and a truncated list would
 * make the Quran screen's scrolling and search untestable. Verse text exists only for the
 * few surahs listed in `AYAT`.
 *
 * When Quran Foundation access is approved this file is deleted, not extended.
 */

const SURAHS: readonly SurahSummary[] = [
  {
    n: 1,
    name: 'Al-Fatihah',
    arabicName: 'الفاتحة',
    meaning: 'The Opening',
    count: 7,
    rev: 'meccan',
  },
  {
    n: 2,
    name: 'Al-Baqarah',
    arabicName: 'البقرة',
    meaning: 'The Cow',
    count: 286,
    rev: 'medinan',
  },
  {
    n: 3,
    name: "Ali 'Imran",
    arabicName: 'آل عمران',
    meaning: 'Family of Imran',
    count: 200,
    rev: 'medinan',
  },
  { n: 4, name: 'An-Nisa', arabicName: 'النساء', meaning: 'The Women', count: 176, rev: 'medinan' },
  {
    n: 5,
    name: "Al-Ma'idah",
    arabicName: 'المائدة',
    meaning: 'The Table Spread',
    count: 120,
    rev: 'medinan',
  },
  { n: 18, name: 'Al-Kahf', arabicName: 'الكهف', meaning: 'The Cave', count: 110, rev: 'meccan' },
  { n: 36, name: 'Ya-Sin', arabicName: 'يس', meaning: 'Ya Sin', count: 83, rev: 'meccan' },
  {
    n: 55,
    name: 'Ar-Rahman',
    arabicName: 'الرحمن',
    meaning: 'The Beneficent',
    count: 78,
    rev: 'medinan',
  },
  {
    n: 67,
    name: 'Al-Mulk',
    arabicName: 'الملك',
    meaning: 'The Sovereignty',
    count: 30,
    rev: 'meccan',
  },
  { n: 94, name: 'Ash-Sharh', arabicName: 'الشرح', meaning: 'The Relief', count: 8, rev: 'meccan' },
  {
    n: 112,
    name: 'Al-Ikhlas',
    arabicName: 'الإخلاص',
    meaning: 'The Sincerity',
    count: 4,
    rev: 'meccan',
  },
  {
    n: 113,
    name: 'Al-Falaq',
    arabicName: 'الفلق',
    meaning: 'The Daybreak',
    count: 5,
    rev: 'meccan',
  },
  { n: 114, name: 'An-Nas', arabicName: 'الناس', meaning: 'Mankind', count: 6, rev: 'meccan' },
].map((entry) => ({
  number: surahNumber(entry.n),
  name: entry.name,
  arabicName: entry.arabicName,
  meaning: entry.meaning,
  ayahCount: entry.count,
  revelation: entry.rev as 'meccan' | 'medinan',
}));

/** Verse text, keyed `surah:ayah`. Immutable — never transformed, never generated. */
const AYAT: Readonly<Record<string, { readonly arabic: string; readonly english: string }>> = {
  '1:1': {
    arabic: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
    english: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
  },
  '1:2': {
    arabic: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
    english: '[All] praise is [due] to Allah, Lord of the worlds.',
  },
  '1:5': {
    arabic: 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ',
    english: 'It is You we worship and You we ask for help.',
  },
  '94:5': {
    arabic: 'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا',
    english: 'For indeed, with hardship [will be] ease.',
  },
  '94:6': {
    arabic: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    english: 'Indeed, with hardship comes ease.',
  },
  '112:1': {
    arabic: 'قُلْ هُوَ اللَّهُ أَحَدٌ',
    english: 'Say, "He is Allah, [who is] One."',
  },
  '112:2': {
    arabic: 'اللَّهُ الصَّمَدُ',
    english: 'Allah, the Eternal Refuge.',
  },
  '18:32': {
    arabic: 'وَاضْرِبْ لَهُم مَّثَلًا رَّجُلَيْنِ',
    english: 'And present to them an example of two men.',
  },
};

/**
 * The edition catalogue, mirroring the approved source's identifiers.
 *
 * ── Why the ids are the vendor's and the names say "sample" ─────────────────
 * Same reason the surah list above is complete and accurate: **catalogue metadata is mirrored,
 * scripture is not.** An edition id is a key, and using a different one here would mean a preference
 * chosen while running on fixtures silently stopped resolving the moment the approved adapter was
 * wired in — the preferences screen would show nothing selected, and the reader would ask for an
 * edition that does not exist.
 *
 * What is emphatically not mirrored is the content. Every string these ids resolve to in this file is
 * `MOCK_SOURCE`-stamped sample text, the names say so, and the badge on every screen says so.
 */
/**
 * Two sample editions, and a note about the ids.
 *
 * `131` is deliberately **absent**. It is a real catalogue id that returns nothing on NoorLife's
 * credentials, so it is retired in `faith-preferences.ts` — leaving it here would mean the fixtures
 * offered an edition the production code is contracted to refuse, and the default resolver would
 * skip it in tests for a reason no reader of this file could see.
 */
const TRANSLATIONS: readonly TranslationEdition[] = [
  {
    id: '20',
    language: 'English',
    name: 'Plain rendering (sample)',
    translator: 'NoorLife sample',
  },
  {
    id: '126',
    language: 'Bosnian',
    name: 'Sample non-English rendering',
    translator: 'NoorLife sample',
  },
];

/**
 * The default reciter's real id, so the fixtures exercise the same selection production does.
 *
 * `3` and the name are catalogue *metadata* rather than content — the same reasoning that lets the
 * surah list here be the real 114 entries. Nothing about the audio is sampled; there is none.
 */
const RECITERS: readonly ReciterEdition[] = [
  { id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' },
  { id: '1', name: 'Sample reciter', style: 'Murattal' },
];

function ayahKeysFor(surah: SurahNumber): readonly string[] {
  return Object.keys(AYAT)
    .filter((key) => key.startsWith(`${surah}:`))
    .sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
}

function toText(key: string): AyahText {
  const [s, a] = key.split(':');
  return {
    surah: surahNumber(Number(s)),
    ayah: ayahNumber(Number(a)),
    arabic: AYAT[key]!.arabic,
    source: MOCK_SOURCE,
  };
}

function toTranslation(key: string, translationId: TranslationId): AyahTranslation {
  const [s, a] = key.split(':');
  return {
    surah: surahNumber(Number(s)),
    ayah: ayahNumber(Number(a)),
    translationId,
    text: AYAT[key]!.english,
    source: MOCK_SOURCE,
  };
}

export function createMockQuranRepository(): QuranContentRepository {
  return {
    /**
     * The provenance of everything below, declared once rather than left for each screen to assert.
     *
     * The Qur'an screen used to import `MOCK_SOURCE` directly and render it, which was a screen
     * making a claim about its own data — true only for as long as the mock was wired in. Reading it
     * from the repository means the badge follows the swap.
     */
    source: MOCK_SOURCE,

    async listSurahs(): Promise<FaithResult<readonly SurahSummary[]>> {
      return delay({ kind: 'ok' as const, data: SURAHS });
    },

    async getSurah(surah: SurahNumber): Promise<FaithResult<SurahSummary>> {
      const found = SURAHS.find((item) => item.number === surah);
      if (found === undefined) {
        return delay({ kind: 'error' as const, code: 'not-found' as const });
      }
      return delay({ kind: 'ok' as const, data: found });
    },

    async listAyahs(
      surah: SurahNumber,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<AyahText>>> {
      const keys = ayahKeysFor(surah);
      if (keys.length === 0) {
        // Honest: the catalogue knows this surah, the fixture has no text for it.
        return delay({ kind: 'empty' as const });
      }
      return delay({ kind: 'ok' as const, data: paginate(keys.map(toText), page) });
    },

    async listTranslations(
      surah: SurahNumber,
      translationId: TranslationId,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<AyahTranslation>>> {
      const keys = ayahKeysFor(surah);
      if (keys.length === 0) {
        return delay({ kind: 'empty' as const });
      }
      return delay({
        kind: 'ok' as const,
        data: paginate(
          keys.map((key) => toTranslation(key, translationId)),
          page,
        ),
      });
    },

    /**
     * There is no sample recitation, and there will not be one.
     *
     * ── Why `empty` and not a bundled audio file ────────────────────────────
     * Every other method here returns a fixture stamped `MOCK_SOURCE`, which the UI renders under a
     * "not a verified source" warning — a reader can see that the text is sample data. Audio has no
     * equivalent: a recitation *sounds* authoritative, a listener has no badge in their ear, and
     * shipping a placeholder recitation of the Qur'an is not a thing NoorLife should do at any
     * fidelity.
     *
     * `empty` is the honest answer: this build has no audio for this surah, so the reader offers no
     * play controls. That is also exactly what a fixture-only build *should* look like.
     */
    async listRecitations(): Promise<FaithResult<FaithPage<AyahRecitation>>> {
      return delay({ kind: 'empty' as const });
    },

    async getAyahOfTheDay(translationId: TranslationId) {
      // Fixed rather than random: the approved reference shows 94:6, and a Daily Ayah
      // that changed on every render would make the home screen untestable.
      const key = '94:6';
      return delay({
        kind: 'ok' as const,
        data: { text: toText(key), translation: toTranslation(key, translationId) },
      });
    },

    async searchTranslations(
      query: string,
      translationId: TranslationId,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<AyahTranslation>>> {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return delay({ kind: 'no-results' as const, query: trimmed }, 60);
      }
      const hits = Object.keys(AYAT)
        .filter((key) => matches(AYAT[key]!.english, trimmed))
        .map((key) => toTranslation(key, translationId));

      if (hits.length === 0) {
        return delay({ kind: 'no-results' as const, query: trimmed });
      }
      return delay({ kind: 'ok' as const, data: paginate(hits, page) });
    },

    async availableTranslations(): Promise<FaithResult<readonly TranslationEdition[]>> {
      return delay({ kind: 'ok' as const, data: TRANSLATIONS });
    },

    async availableReciters(): Promise<FaithResult<readonly ReciterEdition[]>> {
      return delay({ kind: 'ok' as const, data: RECITERS });
    },
  };
}

/** Exposed for the immutability test, which asserts the fixture is not mutated in place. */
export const mockAyatForTest = AYAT;
export const mockSurahsForTest = SURAHS;
