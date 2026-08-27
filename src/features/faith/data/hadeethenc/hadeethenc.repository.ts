import type { FaithPage, FaithPageRequest, FaithResult } from '../faith-result';
import type { Hadith } from '../hadith.repository';
import {
  HADEETHENC_LANGUAGE,
  HADEETHENC_SOURCE_NAME,
  parseHadeethEncDetail,
  parseHadeethEncPage,
  parseHadeethEncTopics,
  type HadeethEncEndpoint,
  type HadeethEncFailure,
  type HadeethEncTopic,
} from './hadeethenc.contract';

export type HadeethEncRepository = {
  listTopics(): Promise<FaithResult<readonly HadeethEncTopic[]>>;
  listByTopic(topicId: string, page?: FaithPageRequest): Promise<FaithResult<FaithPage<Hadith>>>;
  getHadith(id: string): Promise<FaithResult<Hadith>>;
};

export type HadeethEncPermission =
  | { readonly status: 'pending-written-confirmation' }
  | {
      readonly status: 'approved';
      readonly evidenceDate: string;
      readonly translationVersion: string;
    };

export type HadeethEncRepositoryConfig = {
  readonly endpoint: HadeethEncEndpoint;
  readonly permission: HadeethEncPermission;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function failure(reason: HadeethEncFailure): FaithResult<never> {
  switch (reason) {
    case 'not-configured':
      return { kind: 'error', code: 'not-configured' };
    case 'offline':
      return { kind: 'offline' };
    case 'timed-out':
      return { kind: 'error', code: 'timeout' };
    case 'rate-limited':
      return { kind: 'error', code: 'rate-limited' };
    case 'not-found':
      return { kind: 'error', code: 'not-found' };
    case 'unavailable':
      return { kind: 'error', code: 'unavailable' };
    case 'invalid-response':
      return { kind: 'error', code: 'unknown' };
  }
}

function paging(request?: FaithPageRequest): { readonly page: number; readonly perPage: number } {
  const rawPage = Number.parseInt(request?.cursor ?? '', 10);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const requested = request?.limit;
  const perPage =
    typeof requested === 'number' && Number.isFinite(requested)
      ? Math.min(Math.max(Math.floor(requested), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  return { page, perPage };
}

export function createHadeethEncRepository(
  config: HadeethEncRepositoryConfig,
): HadeethEncRepository | null {
  if (config.permission.status !== 'approved') return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(config.permission.evidenceDate) ||
    config.permission.translationVersion.trim() === ''
  ) {
    return null;
  }
  const { endpoint, permission } = config;
  const getHadith: HadeethEncRepository['getHadith'] = async (id) => {
    if (!/^\d+$/.test(id)) return { kind: 'error', code: 'not-found' };
    const result = await endpoint.request({
      operation: 'get_hadith',
      language: HADEETHENC_LANGUAGE,
      id,
    });
    if (result.kind === 'error') return failure(result.failure);
    const detail = parseHadeethEncDetail(result.data);
    if (detail === null) return failure('invalid-response');
    return {
      kind: 'ok',
      data: {
        id: detail.id,
        collectionId: HADEETHENC_SOURCE_NAME,
        reference: `HadeethEnc ${detail.id}`,
        arabic: detail.arabic,
        translation: detail.translation,
        narrator: detail.narratorIntroduction,
        grade: detail.grade,
        topics: detail.topicIds,
        source: {
          name: HADEETHENC_SOURCE_NAME,
          edition: `${HADEETHENC_LANGUAGE}:${permission.translationVersion}`,
          attribution: detail.attribution,
          /* Derived from the dated permission object; this adapter never mints approval itself. */
          verified: permission.status === 'approved',
        },
      },
    };
  };

  return {
    async listTopics() {
      const result = await endpoint.request({
        operation: 'list_root_topics',
        language: HADEETHENC_LANGUAGE,
      });
      if (result.kind === 'error') return failure(result.failure);
      const topics = parseHadeethEncTopics(result.data);
      if (topics === null) return failure('invalid-response');
      return topics.length === 0 ? { kind: 'empty' } : { kind: 'ok', data: topics };
    },

    async listByTopic(topicId, request) {
      if (!/^\d+$/.test(topicId)) return { kind: 'error', code: 'not-found' };
      const pageRequest = paging(request);
      const result = await endpoint.request({
        operation: 'list_topic_hadiths',
        language: HADEETHENC_LANGUAGE,
        topicId,
        ...pageRequest,
      });
      if (result.kind === 'error') return failure(result.failure);
      const page = parseHadeethEncPage(result.data);
      if (page === null) return failure('invalid-response');
      if (page.items.length === 0) return { kind: 'empty' };

      const details = await Promise.all(page.items.map((item) => getHadith(item.id)));
      const hadiths: Hadith[] = [];
      for (const detail of details) {
        if (detail.kind !== 'ok') {
          return detail.kind === 'stale' ? { kind: 'error', code: 'unknown' } : detail;
        }
        hadiths.push(detail.data);
      }
      return {
        kind: 'ok',
        data: {
          items: hadiths,
          nextCursor: page.page < page.lastPage ? String(page.page + 1) : null,
          total: page.total,
        },
      };
    },

    getHadith,
  };
}
