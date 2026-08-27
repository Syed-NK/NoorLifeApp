import {
  createHadeethEncRepository,
  HADEETHENC_LANGUAGE,
  mapHadeethEncGrade,
  parseHadeethEncDetail,
  parseHadeethEncPage,
  parseHadeethEncTopics,
  type HadeethEncEndpoint,
  type HadeethEncRequest,
} from '../data/hadeethenc';

const DETAIL = {
  id: '5907',
  title: 'A title supplied by the provider',
  hadeeth: 'A translation supplied by the provider.',
  hadeeth_ar: 'arabic-probe',
  hadeeth_intro: 'A narrator introduction supplied by the provider.',
  attribution: 'Agreed upon',
  grade: 'Authentic',
  explanation: 'An explanation supplied by the provider.',
  hints: ['A benefit supplied by the provider.'],
  categories: ['39'],
};

function endpoint(answer: (request: HadeethEncRequest) => unknown): {
  readonly value: HadeethEncEndpoint;
  readonly requests: HadeethEncRequest[];
} {
  const requests: HadeethEncRequest[] = [];
  return {
    requests,
    value: {
      request: async (request) => {
        requests.push(request);
        return { kind: 'ok', data: answer(request) };
      },
    },
  };
}

function repository(fake: HadeethEncEndpoint) {
  const value = createHadeethEncRepository({
    endpoint: fake,
    permission: {
      status: 'approved',
      evidenceDate: '2026-08-20',
      translationVersion: 'test-version',
    },
  });
  if (value === null) throw new Error('approved test repository was not constructed');
  return value;
}

describe('HadeethEnc adapter', () => {
  it('parses the provider topic vocabulary without calling topics collections', () => {
    expect(
      parseHadeethEncTopics([
        { id: '5', title: 'Virtues and Manners', hadeeths_count: '751', parent_id: null },
      ]),
    ).toEqual([{ id: '5', title: 'Virtues and Manners', hadithCount: 751, parentId: null }]);
    expect(
      parseHadeethEncTopics([{ id: '5', title: '', hadeeths_count: '751', parent_id: null }]),
    ).toBeNull();
  });

  it('validates the complete pagination envelope', () => {
    expect(
      parseHadeethEncPage({
        data: [{ id: '5907', title: 'Provider title', translations: ['ar', 'en'] }],
        meta: { current_page: '1', last_page: 2, total_items: 3, per_page: '1' },
      }),
    ).toEqual({
      items: [{ id: '5907', title: 'Provider title', translations: ['ar', 'en'] }],
      page: 1,
      lastPage: 2,
      total: 3,
      perPage: 1,
    });
    expect(parseHadeethEncPage({ data: [], meta: { current_page: 3, last_page: 2 } })).toBeNull();
  });

  it('requires Arabic, translation, attribution, grade and provenance-bearing detail fields', () => {
    expect(parseHadeethEncDetail(DETAIL)).toMatchObject({
      id: '5907',
      arabic: 'arabic-probe',
      providerGrade: 'Authentic',
      grade: 'sahih',
      topicIds: ['39'],
    });
    for (const field of [
      'hadeeth',
      'hadeeth_ar',
      'hadeeth_intro',
      'attribution',
      'grade',
      'explanation',
      'hints',
      'categories',
    ] as const) {
      expect(parseHadeethEncDetail({ ...DETAIL, [field]: null })).toBeNull();
    }
  });

  it.each([
    ['Authentic', 'sahih'],
    ['Good', 'hasan'],
    ['Good Authentic', 'hasan'],
    ['Weak', 'daif'],
    ['Fabricated', 'mawdu'],
    ['Unrecognised provider wording', 'unknown'],
  ] as const)('maps the provider grade %s conservatively', (wire, domain) => {
    expect(mapHadeethEncGrade(wire)).toBe(domain);
  });

  it('maps one validated detail while retaining the provider wording and attribution boundary', async () => {
    const fake = endpoint(() => DETAIL);
    const result = await repository(fake.value).getHadith('5907');
    expect(fake.requests).toEqual([
      { operation: 'get_hadith', language: HADEETHENC_LANGUAGE, id: '5907' },
    ]);
    expect(result).toEqual({
      kind: 'ok',
      data: {
        id: '5907',
        collectionId: 'HadeethEnc.com',
        reference: 'HadeethEnc 5907',
        arabic: 'arabic-probe',
        translation: 'A translation supplied by the provider.',
        narrator: 'A narrator introduction supplied by the provider.',
        grade: 'sahih',
        topics: ['39'],
        source: {
          name: 'HadeethEnc.com',
          edition: 'en:test-version',
          attribution: 'Agreed upon',
          verified: true,
        },
      },
    });
  });

  it('fetches each listed detail and carries the provider cursor forward', async () => {
    const fake = endpoint((request) =>
      request.operation === 'list_topic_hadiths'
        ? {
            data: [{ id: '5907', title: 'Provider title', translations: ['ar', 'en'] }],
            meta: { current_page: '1', last_page: 2, total_items: 2, per_page: '1' },
          }
        : DETAIL,
    );
    const result = await repository(fake.value).listByTopic('5', { limit: 1 });
    expect(result).toMatchObject({
      kind: 'ok',
      data: { nextCursor: '2', total: 2, items: [{ id: '5907' }] },
    });
    expect(fake.requests.map((request) => request.operation)).toEqual([
      'list_topic_hadiths',
      'get_hadith',
    ]);
  });

  it('fails closed on malformed identifiers, responses and endpoint failures', async () => {
    const fake = endpoint(() => ({ unexpected: true }));
    const adapter = repository(fake.value);
    await expect(adapter.getHadith('../5907')).resolves.toEqual({
      kind: 'error',
      code: 'not-found',
    });
    await expect(adapter.getHadith('5907')).resolves.toEqual({ kind: 'error', code: 'unknown' });

    const offline = repository({
      request: async () => ({ kind: 'error', failure: 'offline' }),
    });
    await expect(offline.listTopics()).resolves.toEqual({ kind: 'offline' });
  });

  it('cannot construct a repository while written permission is pending', () => {
    const fake = endpoint(() => DETAIL);
    expect(
      createHadeethEncRepository({
        endpoint: fake.value,
        permission: { status: 'pending-written-confirmation' },
      }),
    ).toBeNull();
    expect(fake.requests).toEqual([]);
  });

  it('refuses an approval with no dated evidence or translation version', () => {
    const fake = endpoint(() => DETAIL);
    for (const permission of [
      { status: 'approved', evidenceDate: 'tomorrow', translationVersion: 'v1' },
      { status: 'approved', evidenceDate: '2026-08-20', translationVersion: ' ' },
    ] as const) {
      expect(createHadeethEncRepository({ endpoint: fake.value, permission })).toBeNull();
    }
    expect(fake.requests).toEqual([]);
  });
});
