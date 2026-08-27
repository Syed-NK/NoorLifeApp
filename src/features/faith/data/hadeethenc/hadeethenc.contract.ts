import type { HadithGrade } from '../hadith.repository';

export const HADEETHENC_PROVIDER_ID = 'hadeethenc';
export const HADEETHENC_SOURCE_NAME = 'HadeethEnc.com';
export const HADEETHENC_LANGUAGE = 'en';

export type HadeethEncTopic = {
  readonly id: string;
  readonly title: string;
  readonly hadithCount: number;
  readonly parentId: string | null;
};

export type HadeethEncListItem = {
  readonly id: string;
  readonly title: string;
  readonly translations: readonly string[];
};

export type HadeethEncDetail = {
  readonly id: string;
  readonly title: string;
  readonly arabic: string;
  readonly translation: string;
  readonly narratorIntroduction: string;
  readonly attribution: string;
  readonly providerGrade: string;
  readonly grade: HadithGrade;
  readonly explanation: string;
  readonly benefits: readonly string[];
  readonly topicIds: readonly string[];
};

export type HadeethEncPage = {
  readonly items: readonly HadeethEncListItem[];
  readonly page: number;
  readonly lastPage: number;
  readonly total: number;
  readonly perPage: number;
};

export type HadeethEncRequest =
  | { readonly operation: 'list_root_topics'; readonly language: typeof HADEETHENC_LANGUAGE }
  | {
      readonly operation: 'list_topic_hadiths';
      readonly language: typeof HADEETHENC_LANGUAGE;
      readonly topicId: string;
      readonly page: number;
      readonly perPage: number;
    }
  | {
      readonly operation: 'get_hadith';
      readonly language: typeof HADEETHENC_LANGUAGE;
      readonly id: string;
    };

export type HadeethEncFailure =
  | 'not-configured'
  | 'offline'
  | 'timed-out'
  | 'rate-limited'
  | 'not-found'
  | 'unavailable'
  | 'invalid-response';

export type HadeethEncOutcome =
  | { readonly kind: 'ok'; readonly data: unknown }
  | { readonly kind: 'error'; readonly failure: HadeethEncFailure };

export type HadeethEncEndpoint = {
  request(request: HadeethEncRequest): Promise<HadeethEncOutcome>;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function integer(value: unknown, minimum: number): number | null {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= minimum
    ? parsed
    : null;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value.map(nonEmptyString);
  return values.every((entry): entry is string => entry !== null) ? values : null;
}

/** HadeethEnc's English grade, retained verbatim beside this conservative domain mapping. */
export function mapHadeethEncGrade(value: string): HadithGrade {
  switch (value.trim().toLowerCase()) {
    case 'authentic':
      return 'sahih';
    case 'good':
    case 'good authentic':
      return 'hasan';
    case 'weak':
      return 'daif';
    case 'fabricated':
      return 'mawdu';
    default:
      return 'unknown';
  }
}

export function parseHadeethEncTopics(payload: unknown): readonly HadeethEncTopic[] | null {
  if (!Array.isArray(payload)) return null;
  const topics: HadeethEncTopic[] = [];
  for (const value of payload) {
    const item = record(value);
    if (item === null) return null;
    const id = nonEmptyString(item.id);
    const title = nonEmptyString(item.title);
    const hadithCount = integer(item.hadeeths_count, 0);
    const parentId = item.parent_id === null ? null : nonEmptyString(item.parent_id);
    if (
      id === null ||
      title === null ||
      hadithCount === null ||
      (parentId === null && item.parent_id !== null)
    ) {
      return null;
    }
    topics.push({ id, title, hadithCount, parentId });
  }
  return topics;
}

export function parseHadeethEncPage(payload: unknown): HadeethEncPage | null {
  const root = record(payload);
  const meta = record(root?.meta);
  if (root === null || meta === null || !Array.isArray(root.data)) return null;
  const items: HadeethEncListItem[] = [];
  for (const value of root.data) {
    const item = record(value);
    if (item === null) return null;
    const id = nonEmptyString(item.id);
    const title = nonEmptyString(item.title);
    const translations = stringArray(item.translations);
    if (id === null || title === null || translations === null) return null;
    items.push({ id, title, translations });
  }
  const page = integer(meta.current_page, 1);
  const lastPage = integer(meta.last_page, 1);
  const total = integer(meta.total_items, 0);
  const perPage = integer(meta.per_page, 1);
  if (page === null || lastPage === null || total === null || perPage === null || page > lastPage) {
    return null;
  }
  return { items, page, lastPage, total, perPage };
}

export function parseHadeethEncDetail(payload: unknown): HadeethEncDetail | null {
  const item = record(payload);
  if (item === null) return null;
  const id = nonEmptyString(item.id);
  const title = nonEmptyString(item.title);
  const arabic = nonEmptyString(item.hadeeth_ar);
  const translation = nonEmptyString(item.hadeeth);
  const narratorIntroduction = nonEmptyString(item.hadeeth_intro);
  const attribution = nonEmptyString(item.attribution);
  const providerGrade = nonEmptyString(item.grade);
  const explanation = nonEmptyString(item.explanation);
  const benefits = stringArray(item.hints);
  const topicIds = stringArray(item.categories);
  if (
    id === null ||
    title === null ||
    arabic === null ||
    translation === null ||
    narratorIntroduction === null ||
    attribution === null ||
    providerGrade === null ||
    explanation === null ||
    benefits === null ||
    topicIds === null
  ) {
    return null;
  }
  return {
    id,
    title,
    arabic,
    translation,
    narratorIntroduction,
    attribution,
    providerGrade,
    grade: mapHadeethEncGrade(providerGrade),
    explanation,
    benefits,
    topicIds,
  };
}
