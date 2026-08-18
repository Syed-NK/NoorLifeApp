import type { Dua, DuaCategory, DuaRepository } from '../dua.repository';
import type { FaithPage, FaithPageRequest, FaithResult } from '../faith-result';
import { MOCK_SOURCE, delay, matches, paginate } from './mock-support';

/** Local supplication fixtures. Every entry is unverified sample content. */

const CATEGORIES: readonly DuaCategory[] = [
  {
    id: 'morning-evening',
    name: 'Morning & Evening',
    description: 'Adhkar for the start and close of the day.',
    duaCount: 2,
  },
  {
    id: 'daily',
    name: 'Daily Life',
    description: 'Eating, travelling, entering the home.',
    duaCount: 2,
  },
  {
    id: 'difficulty',
    name: 'In Difficulty',
    description: 'Supplications for hardship and anxiety.',
    duaCount: 2,
  },
];

const DUAS: readonly Dua[] = [
  {
    id: 'morning-1',
    categoryId: 'morning-evening',
    title: 'Upon waking',
    arabic: 'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ',
    transliteration: 'Alhamdu lillahi alladhi ahyana ba‘da ma amatana wa ilayhi an-nushur',
    translation: 'All praise is for Allah who gave us life after death, and to Him is the return.',
    reference: 'Sahih al-Bukhari 6312',
    source: MOCK_SOURCE,
  },
  {
    id: 'evening-1',
    categoryId: 'morning-evening',
    title: 'Evening remembrance',
    arabic: 'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ',
    transliteration: 'Amsayna wa amsal-mulku lillah',
    translation: 'We have reached the evening, and with it all dominion belongs to Allah.',
    reference: 'Sahih Muslim 2723',
    repetitions: 1,
    source: MOCK_SOURCE,
  },
  {
    id: 'daily-1',
    categoryId: 'daily',
    title: 'Before eating',
    arabic: 'بِسْمِ اللَّهِ',
    transliteration: 'Bismillah',
    translation: 'In the name of Allah.',
    reference: 'Sunan Abi Dawud 3767',
    source: MOCK_SOURCE,
  },
  {
    id: 'daily-2',
    categoryId: 'daily',
    title: 'Leaving the home',
    arabic: 'بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ',
    transliteration: 'Bismillahi tawakkaltu ‘ala Allah',
    translation: 'In the name of Allah, I place my trust in Allah.',
    reference: 'Sunan at-Tirmidhi 3426',
    source: MOCK_SOURCE,
  },
  {
    id: 'difficulty-1',
    categoryId: 'difficulty',
    title: 'In distress',
    arabic: 'لَا إِلَٰهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ',
    transliteration: 'La ilaha illa Allah al-‘Azim al-Halim',
    translation: 'There is no deity except Allah, the Magnificent, the Forbearing.',
    reference: 'Sahih al-Bukhari 6346',
    source: MOCK_SOURCE,
  },
  {
    id: 'difficulty-2',
    categoryId: 'difficulty',
    title: 'For anxiety',
    arabic: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ',
    transliteration: 'Allahumma inni a‘udhu bika min al-hammi wal-hazan',
    translation: 'O Allah, I seek refuge in You from anxiety and sorrow.',
    reference: 'Sahih al-Bukhari 6369',
    source: MOCK_SOURCE,
  },
];

export function createMockDuaRepository(): DuaRepository {
  return {
    async listCategories(): Promise<FaithResult<readonly DuaCategory[]>> {
      return delay({ kind: 'ok' as const, data: CATEGORIES });
    },

    async listByCategory(
      categoryId: string,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<Dua>>> {
      const items = DUAS.filter((item) => item.categoryId === categoryId);
      if (items.length === 0) {
        return delay({ kind: 'empty' as const });
      }
      return delay({ kind: 'ok' as const, data: paginate(items, page) });
    },

    async getDua(id: string): Promise<FaithResult<Dua>> {
      const found = DUAS.find((item) => item.id === id);
      return delay(
        found === undefined
          ? { kind: 'error' as const, code: 'not-found' as const }
          : { kind: 'ok' as const, data: found },
      );
    },

    async search(query: string, page?: FaithPageRequest): Promise<FaithResult<FaithPage<Dua>>> {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return delay({ kind: 'no-results' as const, query: trimmed }, 60);
      }
      const hits = DUAS.filter(
        (item) => matches(item.title, trimmed) || matches(item.translation, trimmed),
      );
      if (hits.length === 0) {
        return delay({ kind: 'no-results' as const, query: trimmed });
      }
      return delay({ kind: 'ok' as const, data: paginate(hits, page) });
    },
  };
}

export const mockDuasForTest = DUAS;
