import type { FaithPage, FaithPageRequest, FaithResult } from '../faith-result';
import type { Hadith, HadithCollection, HadithRepository } from '../hadith.repository';
import { MOCK_HADITH_SOURCE, delay, matches, paginate } from './mock-support';

/**
 * Local Hadith fixtures.
 *
 * Collections are named accurately so the UI reads realistically, but every narration
 * carries `MOCK_HADITH_SOURCE` with `verified: false` — the text has not been checked
 * against a critical edition and the screen says so. Grades are present on all of them
 * because the interface requires it; they are the commonly-reported grades, not an
 * independent assessment.
 */

const COLLECTIONS: readonly HadithCollection[] = [
  {
    id: 'bukhari',
    name: 'Sahih al-Bukhari',
    arabicName: 'صحيح البخاري',
    compiler: 'Imam al-Bukhari',
    narrationCount: 7563,
  },
  {
    id: 'muslim',
    name: 'Sahih Muslim',
    arabicName: 'صحيح مسلم',
    compiler: 'Imam Muslim',
    narrationCount: 7470,
  },
  {
    id: 'nawawi40',
    name: 'Forty Hadith of an-Nawawi',
    arabicName: 'الأربعون النووية',
    compiler: 'Imam an-Nawawi',
    narrationCount: 42,
  },
];

const HADITHS: readonly Hadith[] = [
  {
    id: 'bukhari-1',
    collectionId: 'bukhari',
    reference: 'Book 1, Hadith 1',
    arabic: 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ',
    translation: 'Actions are judged by intentions.',
    narrator: 'Umar ibn al-Khattab',
    grade: 'sahih',
    topics: ['intention', 'sincerity'],
    source: MOCK_HADITH_SOURCE,
  },
  {
    id: 'bukhari-6464',
    collectionId: 'bukhari',
    reference: 'Book 81, Hadith 6464',
    translation:
      'The deeds most beloved to Allah are those done consistently, even if they are few.',
    narrator: 'Aisha',
    grade: 'sahih',
    topics: ['consistency', 'worship'],
    source: MOCK_HADITH_SOURCE,
  },
  {
    id: 'muslim-2699',
    collectionId: 'muslim',
    reference: 'Book 48, Hadith 2699',
    translation:
      'Whoever treads a path seeking knowledge, Allah makes easy for him a path to Paradise.',
    narrator: 'Abu Hurayrah',
    grade: 'sahih',
    topics: ['knowledge', 'learning'],
    source: MOCK_HADITH_SOURCE,
  },
  {
    id: 'nawawi40-13',
    collectionId: 'nawawi40',
    reference: 'Hadith 13',
    translation:
      'None of you truly believes until he loves for his brother what he loves for himself.',
    narrator: 'Anas ibn Malik',
    grade: 'sahih',
    topics: ['brotherhood', 'character'],
    source: MOCK_HADITH_SOURCE,
  },
  {
    id: 'nawawi40-16',
    collectionId: 'nawawi40',
    reference: 'Hadith 16',
    translation: 'Do not become angry.',
    narrator: 'Abu Hurayrah',
    grade: 'sahih',
    topics: ['character', 'patience'],
    source: MOCK_HADITH_SOURCE,
  },
];

export function createMockHadithRepository(): HadithRepository {
  return {
    async listCollections(): Promise<FaithResult<readonly HadithCollection[]>> {
      return delay({ kind: 'ok' as const, data: COLLECTIONS });
    },

    async listByCollection(
      collectionId: string,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<Hadith>>> {
      const items = HADITHS.filter((item) => item.collectionId === collectionId);
      if (items.length === 0) {
        return delay({ kind: 'empty' as const });
      }
      return delay({ kind: 'ok' as const, data: paginate(items, page) });
    },

    async getHadith(id: string): Promise<FaithResult<Hadith>> {
      const found = HADITHS.find((item) => item.id === id);
      return delay(
        found === undefined
          ? { kind: 'error' as const, code: 'not-found' as const }
          : { kind: 'ok' as const, data: found },
      );
    },

    async search(query: string, page?: FaithPageRequest): Promise<FaithResult<FaithPage<Hadith>>> {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return delay({ kind: 'no-results' as const, query: trimmed }, 60);
      }
      const hits = HADITHS.filter(
        (item) =>
          matches(item.translation, trimmed) ||
          matches(item.narrator, trimmed) ||
          item.topics.some((topic) => matches(topic, trimmed)),
      );
      if (hits.length === 0) {
        return delay({ kind: 'no-results' as const, query: trimmed });
      }
      return delay({ kind: 'ok' as const, data: paginate(hits, page) });
    },

    async getDailyHadith(): Promise<FaithResult<Hadith>> {
      // The narration the approved reference quotes on the Faith AI insight card.
      return delay({ kind: 'ok' as const, data: HADITHS[1]! });
    },
  };
}

export const mockHadithsForTest = HADITHS;
