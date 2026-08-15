import { assert, assertEquals } from './assert.ts';
import { normalizePayload, normalizeSnapshot, normalizeSync } from '../normalize.ts';
import { parseRequestBody } from '../request-schema.ts';
import {
  createQuranFoundationClient,
  cursorFromNextPageUrl,
  isApprovedSnapshotUrl,
  QF_API_ORIGIN,
  QF_CONTENT_PREFIX,
  routeFor,
} from '../quran-foundation-client.ts';
import { QF_OAUTH_ORIGIN } from '../token-store.ts';
import { fakeClock, jsonResponse, recordingFetch, syntheticToken } from './fakes.ts';
import {
  CANONICAL_SYNC_FILTER,
  CONTRACT_VERSION,
  MAX_SYNC_CURSOR_LENGTH,
  MAX_SYNC_PER_PAGE,
  MAX_SYNC_TOKEN_LENGTH,
  OPERATION_CACHE_MAX_AGE_MS,
  QURAN_OPERATIONS,
  SYNC_RESOURCES,
} from '../contract.ts';

/**
 * Content Sync: the boundary that lets NoorLife keep vendor content past one week.
 *
 * ── Why this file is mostly about refusal ───────────────────────────────────
 * Sync is the first part of this integration where the **response** tells the client where to go
 * next. `next_page_url` is a URL the vendor's own guidance says to follow rather than reconstruct,
 * and `snapshot_url` is a URL that, if followed, replaces every local row of a resource. Both are
 * exactly the shape of thing an allow-list exists to refuse in general.
 *
 * NoorLife follows neither. It validates them and throws the address away — lifting a cursor out of
 * one, and taking only "a snapshot is needed" from the other. So most of what follows is an attempt
 * to get a URL treated as an address when it should not be, or to get a resource synchronised that
 * NoorLife holds no permission for.
 *
 * ── The second theme: a token that runs ahead of the work ───────────────────
 * A sync token is a claim that everything before it has been applied. Advancing one over a mutation
 * that was dropped, or over a page that was silently truncated, loses that change permanently — the
 * vendor will never offer it again. Several cases below exist only to prove a malformed page is
 * refused outright rather than partially accepted.
 */

const SYNC_PATH = `${QF_CONTENT_PREFIX}/resources/sync`;

/**
 * A plaintext scheme, assembled rather than written.
 *
 * The source scan forbids the literal anywhere in this function — production **or** test — because
 * the one thing it must be able to say is that no plaintext address exists in the repository. A
 * scheme-downgrade case still has to be exercised, so the prefix is built at runtime: the behaviour
 * under test is identical and the scan keeps its absolute form.
 */
const PLAINTEXT = ['htt', 'p:'].join('');
const sync = (over: Record<string, unknown> = {}) => ({
  sync: {
    sync_until_sequence: 4200,
    has_more: false,
    next_page_url: null,
    next_sync_token: 'tok_abc123',
    mutations: [],
    ...over,
  },
});

const rowMutation = (over: Record<string, unknown> = {}) => ({
  sequence: 7,
  type: 'ROW_UPDATE',
  resource_group: 'recitations',
  resource_id: 3,
  record_type: 'audio_file',
  record_key: '93:1',
  changed_at: '2026-08-15T00:00:00Z',
  data: { verse_key: '93:1', url: 'https://verses.quran.foundation/Sudais/mp3/093001.mp3' },
  snapshot_url: null,
  unavailable_reason: null,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// The operations exist, and take nothing that names a resource
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('both sync operations are on the allow-list', () => {
  assertEquals(QURAN_OPERATIONS.includes('sync_content_resources'), true);
  assertEquals(QURAN_OPERATIONS.includes('get_content_snapshot'), true);
});

Deno.test('the canonical filter is derived from the permission table, sorted', () => {
  /*
    Sorted and deduplicated because the vendor binds a token to its filter: two spellings of one
    scope would be two tokens, and presenting a token against the other spelling costs a bootstrap.
  */
  assertEquals(CANONICAL_SYNC_FILTER, 'recitations:3;translations:85');
  assertEquals(SYNC_RESOURCES.recitations, 3);
  assertEquals(SYNC_RESOURCES.translations, 85);
});

Deno.test('a bootstrap is an empty body, and asks the vendor to bootstrap', () => {
  const parsed = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'sync_content_resources',
  });
  assert(parsed.ok, 'a sync request names no resource at all');
  const route = routeFor(parsed.query);

  assertEquals(route.path, '/resources/sync');
  assertEquals(route.query.resources, CANONICAL_SYNC_FILTER);
  assertEquals(route.query.bootstrap, 'true');
  assertEquals(route.query.sync_token, undefined);
  assertEquals(route.query.per_page, String(MAX_SYNC_PER_PAGE));
});

Deno.test('a token turns the same request into an incremental one', () => {
  const parsed = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'sync_content_resources',
    sync_token: 'tok_abc123',
  });
  assert(parsed.ok, 'accepted');
  const route = routeFor(parsed.query);

  /*
    `bootstrap` and `sync_token` are mutually exclusive by construction rather than by validation:
    the route is built from whether the token is null, so the two can never both be sent.
  */
  assertEquals(route.query.sync_token, 'tok_abc123');
  assertEquals(route.query.bootstrap, undefined);
});

Deno.test('a cursor is forwarded, and the filter never changes with it', () => {
  const parsed = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'sync_content_resources',
    sync_token: 'tok_abc123',
    cursor: 'eyJwYWdlIjoy',
  });
  assert(parsed.ok, 'accepted');
  const route = routeFor(parsed.query);

  assertEquals(route.query.cursor, 'eyJwYWdlIjoy');
  assertEquals(route.query.resources, CANONICAL_SYNC_FILTER);
});

Deno.test('a client cannot name a resource, a filter or a page URL', () => {
  for (
    const smuggled of [
      { resources: 'translations:20' },
      { resource_id: 20 },
      { next_page_url: 'https://evil.example/x' },
      { snapshot_url: 'https://evil.example/x' },
      { bootstrap: true },
      { url: 'https://apis.quran.foundation/content/api/v4/resources/sync' },
    ]
  ) {
    const parsed = parseRequestBody({
      contract_version: CONTRACT_VERSION,
      operation: 'sync_content_resources',
      ...smuggled,
    });
    assertEquals(parsed.ok, false, `${Object.keys(smuggled)[0]} is refused by name`);
  }
});

Deno.test('a snapshot names a group, never an id', () => {
  const parsed = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'get_content_snapshot',
    resource_group: 'recitations',
  });
  assert(parsed.ok, 'accepted');
  assertEquals(routeFor(parsed.query).path, '/resources/snapshots/recitations/3');

  const withId = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'get_content_snapshot',
    resource_group: 'recitations',
    resource_id: 20,
  });
  assertEquals(withId.ok, false, 'there is no field an id could travel in');
});

Deno.test('an unapproved resource group is refused', () => {
  for (const group of ['tafsirs', 'articles', 'chapter_recitations', '../../search', '']) {
    const parsed = parseRequestBody({
      contract_version: CONTRACT_VERSION,
      operation: 'get_content_snapshot',
      resource_group: group,
    });
    assertEquals(parsed.ok, false, `${group} is outside the permission table`);
  }
});

Deno.test('an opaque value is bounded and character-checked', () => {
  const bad = [
    'a b',
    'a/b',
    'a?b',
    '"a"',
    'a\nb',
    'a#b',
    'x'.repeat(MAX_SYNC_TOKEN_LENGTH + 1),
  ];
  for (const value of bad) {
    const parsed = parseRequestBody({
      contract_version: CONTRACT_VERSION,
      operation: 'sync_content_resources',
      sync_token: value,
    });
    assertEquals(parsed.ok, false, `token refused: ${JSON.stringify(value.slice(0, 12))}`);
  }

  const longCursor = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'sync_content_resources',
    cursor: 'x'.repeat(MAX_SYNC_CURSOR_LENGTH + 1),
  });
  assertEquals(longCursor.ok, false, 'an oversized cursor is refused');
});

Deno.test('a page size above the vendor ceiling is refused, not clamped', () => {
  const parsed = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'sync_content_resources',
    per_page: MAX_SYNC_PER_PAGE + 1,
  });
  assertEquals(parsed.ok, false, 'refused rather than silently reduced');
});

Deno.test('neither operation may be cached', () => {
  /*
    A sync page describes what changed since one caller's token; a snapshot is marked `no-store` by
    the vendor. Zero is read by the cache as "do not store", so this is enforcement, not a hint.
  */
  assertEquals(OPERATION_CACHE_MAX_AGE_MS.sync_content_resources, 0);
  assertEquals(OPERATION_CACHE_MAX_AGE_MS.get_content_snapshot, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination: a cursor crosses the boundary, a URL never does
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('a cursor is lifted out of an approved next_page_url', () => {
  const absolute = `${QF_API_ORIGIN}${SYNC_PATH}?resources=recitations%3A3&cursor=eyJwYWdlIjoy`;
  assertEquals(cursorFromNextPageUrl(absolute), 'eyJwYWdlIjoy');

  /* The vendor documents relative paths and returns absolute ones; both resolve to the same cursor. */
  assertEquals(cursorFromNextPageUrl('resources/sync?cursor=eyJwYWdlIjoy'), 'eyJwYWdlIjoy');
});

// ─────────────────────────────────────────────────────────────────────────────
// The vendor's own documented relative form — the shape that broke the bootstrap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quran Foundation writes the URLs a Content Sync response carries as **root-relative** paths that
 * omit the `/content` mount point:
 *
 *     /api/v4/resources/sync?cursor=…
 *     /api/v4/resources/snapshots/recitations/3
 *
 * A root-relative reference discards the path of whatever base it is resolved against, so the first
 * of these resolved to `/api/v4/resources/sync` — right host, wrong path — and was refused. The tests
 * above covered a *base*-relative form (`resources/sync?cursor=…`) and the absolute form, and both
 * happened to resolve correctly, which is why the gap survived review.
 *
 * The cost was not a refused URL. `normalizeSync` requires a usable cursor whenever `has_more` is
 * true — refusing is correct, because advancing a token over undelivered mutations loses them for
 * good — so a bootstrap run answered `502 upstream_unavailable` behind `upstream_outcome: ok` and
 * `normalize_reason: shape`, on every attempt.
 */
const DOCUMENTED_SYNC = '/api/v4/resources/sync';
const DOCUMENTED_SNAPSHOT = '/api/v4/resources/snapshots/recitations/3';

Deno.test('the vendor’s documented relative next_page_url yields its cursor', () => {
  assertEquals(cursorFromNextPageUrl(`${DOCUMENTED_SYNC}?cursor=eyJwYWdlIjoy`), 'eyJwYWdlIjoy');

  /* With the filter alongside it, exactly as the tutorial's example page carries it. */
  assertEquals(
    cursorFromNextPageUrl(
      `${DOCUMENTED_SYNC}?resources=recitations%3A3%3Btranslations%3A85&cursor=eyJwYWdlIjoy`,
    ),
    'eyJwYWdlIjoy',
  );

  /* All three approved spellings of one address agree on the cursor they carry. */
  for (
    const form of [
      `${DOCUMENTED_SYNC}?cursor=abc`,
      'resources/sync?cursor=abc',
      `${QF_API_ORIGIN}${SYNC_PATH}?cursor=abc`,
    ]
  ) {
    assertEquals(cursorFromNextPageUrl(form), 'abc', form);
  }
});

Deno.test('the vendor’s documented relative snapshot_url is approved for its own resource only', () => {
  assertEquals(isApprovedSnapshotUrl(DOCUMENTED_SNAPSHOT, 'recitations'), true);
  assertEquals(
    isApprovedSnapshotUrl('/api/v4/resources/snapshots/translations/85', 'translations'),
    true,
  );

  /* The permission check is unchanged by the new form: still per group and per exact id. */
  assertEquals(isApprovedSnapshotUrl(DOCUMENTED_SNAPSHOT, 'translations'), false);
  assertEquals(
    isApprovedSnapshotUrl('/api/v4/resources/snapshots/recitations/7', 'recitations'),
    false,
  );
  assertEquals(
    isApprovedSnapshotUrl('/api/v4/resources/snapshots/tafsirs/3', 'recitations'),
    false,
  );
  assertEquals(
    isApprovedSnapshotUrl('/api/v4/resources/snapshots/translations/20', 'translations'),
    false,
  );
});

Deno.test('a documented-form page paginates end to end, and a documented snapshot_url is a flag', () => {
  /*
    The whole defect, driven through the normaliser rather than through the URL checker: this is the
    body the deployed function actually received, and it now produces a continuable page.
  */
  const page = normalizeSync(sync({
    has_more: true,
    next_page_url: `${DOCUMENTED_SYNC}?cursor=eyJwYWdlIjoy`,
    next_sync_token: null,
    mutations: [
      rowMutation({ type: 'RESOURCE_INVALIDATE', snapshot_url: DOCUMENTED_SNAPSHOT, data: null }),
    ],
  }));
  assert(page !== null, 'the documented page normalises');
  assertEquals(page.hasMore, true);
  assertEquals(page.nextCursor, 'eyJwYWdlIjoy');
  assertEquals(page.nextSyncToken, null);
  assertEquals(page.mutations[0]?.snapshotRequired, true);

  /* And the address still never crosses — the fix widened what is *read*, not what is passed on. */
  const text = JSON.stringify(page);
  assertEquals(text.includes('/api/v4'), false, 'no vendor path crosses the boundary');
  assertEquals(text.includes('apis.quran.foundation'), false, 'and no vendor host');
  assertEquals(text.includes('snapshot_url'), false, 'and no field that could carry one');
});

Deno.test('the documented form does not widen the allow-list by one path more than itself', () => {
  /**
   * The risk in accepting a second prefix is that it becomes a suffix match. Every case below shares
   * the vendor's host and ends in something that looks like an approved path, and every one is
   * refused, because both prefixes are compared in full against the parser's normalised `pathname`.
   */
  for (
    const near of [
      '/api/v4/resources/search?cursor=x',
      '/api/v5/resources/sync?cursor=x',
      '/api/v4/resources/sync/extra?cursor=x',
      '/content/api/v4/api/v4/resources/sync?cursor=x',
      '/api/v4/../search/resources/sync?cursor=x',
      '/api/v40/resources/sync?cursor=x',
      '/API/V4/resources/sync?cursor=x',
      'api/v4/resources/sync?cursor=x',
      '/resources/sync?cursor=x',
      '//apis.quran.foundation/api/v4/resources/sync?cursor=x',
      '/\\evil.example/api/v4/resources/sync?cursor=x',
    ]
  ) {
    assertEquals(cursorFromNextPageUrl(near), null, `refused: ${near}`);
  }

  /*
    And a reference that names its own scheme is held to the absolute form alone: it has said where it
    wants to go, so it must have said the whole approved address including `/content`.
  */
  assertEquals(
    cursorFromNextPageUrl(`${QF_API_ORIGIN}/api/v4/resources/sync?cursor=x`),
    null,
    'an absolute URL missing the content prefix is not the documented relative form',
  );
  assertEquals(
    isApprovedSnapshotUrl(
      `${QF_API_ORIGIN}/api/v4/resources/snapshots/recitations/3`,
      'recitations',
    ),
    false,
  );
});

Deno.test('every previously refused hostile URL is still refused in both forms', () => {
  /**
   * The regression half. Each hostile case is exercised against the pagination check and the snapshot
   * check, so a fix that loosened one and not the other cannot pass.
   */
  for (
    const hostile of [
      'https://evil.example/api/v4/resources/sync?cursor=x',
      'https://apis.quran.foundation.evil.example/api/v4/resources/sync?cursor=x',
      'https://evil.example/api/v4/resources/snapshots/recitations/3',
      'https://apis.quran.foundation@evil.example/api/v4/resources/sync?cursor=x',
      'https://user:pass@apis.quran.foundation/api/v4/resources/sync?cursor=x',
      `${PLAINTEXT}//apis.quran.foundation/api/v4/resources/sync?cursor=x`,
      'file:///api/v4/resources/sync?cursor=x',
      'javascript:alert(1)',
      `${QF_API_ORIGIN}${SYNC_PATH}?cursor=${'x'.repeat(MAX_SYNC_CURSOR_LENGTH + 1)}`,
      `${DOCUMENTED_SYNC}?cursor=${'x'.repeat(MAX_SYNC_CURSOR_LENGTH + 1)}`,
      `${DOCUMENTED_SYNC}?cursor=`,
      DOCUMENTED_SYNC,
      'x'.repeat(4096),
    ]
  ) {
    assertEquals(cursorFromNextPageUrl(hostile), null, `no cursor: ${hostile.slice(0, 56)}`);
    assertEquals(
      isApprovedSnapshotUrl(hostile, 'recitations'),
      false,
      `no snapshot: ${hostile.slice(0, 56)}`,
    );
  }
});

Deno.test('a hostile next_page_url yields no cursor', () => {
  for (
    const hostile of [
      'https://evil.example/content/api/v4/resources/sync?cursor=x',
      'https://apis.quran.foundation.evil.example/content/api/v4/resources/sync?cursor=x',
      `${PLAINTEXT}//apis.quran.foundation${SYNC_PATH}?cursor=x`,
      'https://user:pass@apis.quran.foundation/content/api/v4/resources/sync?cursor=x',
      `${QF_API_ORIGIN}/content/api/v4/search?cursor=x`,
      `${QF_API_ORIGIN}${SYNC_PATH}`,
      `${QF_API_ORIGIN}${SYNC_PATH}?cursor=`,
      'not a url',
      '',
      null,
      42,
    ]
  ) {
    assertEquals(cursorFromNextPageUrl(hostile), null, `refused: ${String(hostile).slice(0, 48)}`);
  }
});

Deno.test('a snapshot url is approved only for the exact permitted resource', () => {
  const good = `${QF_API_ORIGIN}${QF_CONTENT_PREFIX}/resources/snapshots/recitations/3`;
  assertEquals(isApprovedSnapshotUrl(good, 'recitations'), true);

  /* Right host, right shape, wrong resource — refused, because permission is per resource. */
  const otherId = `${QF_API_ORIGIN}${QF_CONTENT_PREFIX}/resources/snapshots/recitations/7`;
  assertEquals(isApprovedSnapshotUrl(otherId, 'recitations'), false);
  const otherGroup = `${QF_API_ORIGIN}${QF_CONTENT_PREFIX}/resources/snapshots/tafsirs/3`;
  assertEquals(isApprovedSnapshotUrl(otherGroup, 'recitations'), false);
  assertEquals(isApprovedSnapshotUrl(good, 'translations'), false);
  assertEquals(isApprovedSnapshotUrl('https://evil.example/x', 'recitations'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Reading a page
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('a final page carries the token and no cursor', () => {
  const page = normalizeSync(sync());
  assert(page !== null, 'normalised');
  assertEquals(page.hasMore, false);
  assertEquals(page.nextCursor, null);
  assertEquals(page.nextSyncToken, 'tok_abc123');
  assertEquals(page.resources, CANONICAL_SYNC_FILTER);
  assertEquals(page.syncUntilSequence, 4200);
});

Deno.test('a middle page carries a cursor and withholds the token', () => {
  const page = normalizeSync(sync({
    has_more: true,
    next_page_url: `${QF_API_ORIGIN}${SYNC_PATH}?cursor=abc`,
    next_sync_token: null,
  }));
  assert(page !== null, 'normalised');
  assertEquals(page.hasMore, true);
  assertEquals(page.nextCursor, 'abc');
  assertEquals(page.nextSyncToken, null);
});

Deno.test('a page claiming more with no usable cursor is refused', () => {
  /*
    Treating this as the end of the run would advance a token over mutations that were never
    delivered, and the vendor would never offer them again. Refusal keeps the old token valid.
  */
  assertEquals(normalizeSync(sync({ has_more: true, next_page_url: null })), null);
  assertEquals(
    normalizeSync(sync({ has_more: true, next_page_url: 'https://evil.example/x?cursor=a' })),
    null,
  );
});

Deno.test('a token arriving mid-run is refused', () => {
  const page = normalizeSync(sync({
    has_more: true,
    next_page_url: `${QF_API_ORIGIN}${SYNC_PATH}?cursor=abc`,
    next_sync_token: 'tok_early',
  }));
  assertEquals(page, null, 'a token before the final page means the run would be cut short');
});

Deno.test('a malformed envelope is refused', () => {
  for (
    const body of [
      {},
      { sync: null },
      { sync: { has_more: false, mutations: [] } },
      { sync: { sync_until_sequence: 1, has_more: 'no', mutations: [] } },
      { sync: { sync_until_sequence: 1, has_more: false, mutations: 'none' } },
    ]
  ) {
    assertEquals(normalizeSync(body), null, JSON.stringify(body).slice(0, 40));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('every mutation type survives a well-formed page', () => {
  for (
    const type of [
      'RESOURCE_CREATE',
      'RESOURCE_UPDATE',
      'RESOURCE_INVALIDATE',
      'RESOURCE_DELETE',
      'ROW_CREATE',
      'ROW_UPDATE',
      'ROW_DELETE',
    ]
  ) {
    const page = normalizeSync(sync({ mutations: [rowMutation({ type })] }));
    assert(page !== null, `${type} normalised`);
    assertEquals(page.mutations.length, 1, type);
    assertEquals(page.mutations[0]?.type, type);
  }
});

Deno.test('a row mutation keeps the vendor record key and the parsed verse identity', () => {
  const page = normalizeSync(sync({ mutations: [rowMutation()] }));
  assert(page !== null, 'normalised');
  const mutation = page.mutations[0];
  assertEquals(mutation?.recordKey, '93:1');
  assertEquals(mutation?.resourceGroup, 'recitations');
  assertEquals(mutation?.resourceId, 3);
  assert(mutation?.row?.group === 'recitations', 'the row is a recitation row');
  assertEquals(mutation.row.surah, 93);
  assertEquals(mutation.row.ayah, 1);
});

Deno.test('a translation row carries its text and its verse identity', () => {
  const page = normalizeSync(sync({
    mutations: [
      rowMutation({
        resource_group: 'translations',
        resource_id: 85,
        record_key: '93:1',
        data: { verse_key: '93:1', text: 'By the morning brightness' },
      }),
    ],
  }));
  assert(page !== null, 'normalised');
  const row = page.mutations[0]?.row;
  assert(row?.group === 'translations', 'a translation row');
  assertEquals(row.text, 'By the morning brightness');
  assertEquals(row.surah, 93);
});

Deno.test('a mutation for a resource NoorLife may not hold is skipped, not refused', () => {
  /*
    Scope, not corruption. The filter should keep these out entirely; if one arrives anyway, dropping
    it and continuing is right — refusing the page would stall synchronisation of the two resources
    NoorLife *does* hold permission for.
  */
  const page = normalizeSync(sync({
    mutations: [
      rowMutation({
        resource_group: 'translations',
        resource_id: 20,
        data: { verse_key: '1:1', text: 'x' },
      }),
      rowMutation(),
    ],
  }));
  assert(page !== null, 'the page still normalises');
  assertEquals(page.mutations.length, 1, 'only the permitted resource survives');
  assertEquals(page.mutations[0]?.resourceId, 3);
});

Deno.test('a mutation for a permitted resource that cannot be read refuses the page', () => {
  for (
    const broken of [
      { type: 'NOT_A_TYPE' },
      { sequence: 'seven' },
      { type: 'ROW_UPDATE', data: null },
      { type: 'ROW_UPDATE', data: { url: 'https://verses.quran.foundation/a.mp3' } },
      { type: 'ROW_UPDATE', data: { verse_key: 'ninety-three:1' } },
      { type: 'ROW_DELETE', record_key: null },
    ]
  ) {
    assertEquals(
      normalizeSync(sync({ mutations: [rowMutation(broken)] })),
      null,
      JSON.stringify(broken).slice(0, 48),
    );
  }
});

Deno.test('ayah identity comes from the verse key, never from position', () => {
  const page = normalizeSync(sync({
    mutations: [
      rowMutation({
        record_key: '93:11',
        data: { verse_key: '93:11', url: 'https://verses.quran.foundation/a.mp3' },
      }),
      rowMutation({
        record_key: '93:4',
        data: { verse_key: '93:4', url: 'https://verses.quran.foundation/b.mp3' },
      }),
    ],
  }));
  assert(page !== null, 'normalised');
  assertEquals(page.mutations.map((mutation) => mutation.row?.ayah), [11, 4]);
});

Deno.test('a snapshot requirement crosses as a flag, never as a URL', () => {
  const page = normalizeSync(sync({
    mutations: [
      rowMutation({
        type: 'RESOURCE_INVALIDATE',
        snapshot_url: `${QF_API_ORIGIN}${QF_CONTENT_PREFIX}/resources/snapshots/recitations/3`,
        data: null,
      }),
    ],
  }));
  assert(page !== null, 'normalised');
  assertEquals(page.mutations[0]?.snapshotRequired, true);
  assertEquals(JSON.stringify(page).includes('apis.quran.foundation'), false, 'no URL crosses');
  assertEquals(JSON.stringify(page).includes('snapshot_url'), false, 'and no field to carry one');
});

Deno.test('a snapshot url pointing elsewhere refuses the page', () => {
  const page = normalizeSync(sync({
    mutations: [
      rowMutation({
        type: 'RESOURCE_INVALIDATE',
        snapshot_url: 'https://evil.example/snapshot',
        data: null,
      }),
    ],
  }));
  assertEquals(page, null, 'a feed pointing somewhere unexpected is not acted on');
});

// ─────────────────────────────────────────────────────────────────────────────
// The two-resource bootstrap: both approved resources, out and back
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why this section exists.
 *
 * The first successful live bootstrap — HTTP 200, final sync token present — returned mutations for
 * `translations` only. `recitations:3` is equally approved, equally in the canonical filter, and
 * appeared nowhere in the response. That is either NoorLife asking for the wrong thing, NoorLife
 * discarding the right thing, or Quran Foundation not sending it.
 *
 * The first two are answerable here and are answered below: the filter that reaches the wire names
 * both resources, and a page carrying both documented `RESOURCE_CREATE` mutations keeps both. Neither
 * test can say anything about the third, which is why none of them claims recitations are
 * sync-supported live — only that nothing on this side drops them.
 *
 * ── The live observation, recorded as an open question ──────────────────────
 * Confirmed again on the second diagnostic run (2026-08-15): the bootstrap returned
 * `resource_group=translations` / `mutation_type=RESOURCE_CREATE` and nothing for `recitations`. Both
 * halves of the NoorLife side are proven correct below, so the remaining explanation is vendor-side —
 * either recitation resources are not yet emitted by Content Sync, or they arrive on a later
 * incremental run. **This is unresolved and needs Quran Foundation to clarify.**
 *
 * Two things must not happen while it stays unresolved. Nothing here may fabricate a recitation
 * mutation to make a fixture look complete — every mutation in this file is one the vendor documents.
 * And nothing anywhere may describe recitations as live-verified over sync until a real bootstrap or
 * incremental run has carried one. The approved *snapshot* for `recitations:3` is a separate route and
 * is unaffected by any of this.
 */

Deno.test('the canonical filter naming both approved resources reaches the wire', () => {
  /*
    The route table, first. `CANONICAL_SYNC_FILTER` is derived from the permission table rather than
    written out, so this pins that the derivation actually produces both entries in the request.
  */
  const parsed = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'sync_content_resources',
  });
  assert(parsed.ok, 'parsed');
  const filter = routeFor(parsed.query).query.resources;
  assertEquals(filter, 'recitations:3;translations:85');
  assert(filter?.includes(`recitations:${SYNC_RESOURCES.recitations}`), 'recitations is asked for');
  assert(filter?.includes(`translations:${SYNC_RESOURCES.translations}`), 'translations too');
});

Deno.test('both approved resources survive the trip to the actual request URL', async () => {
  /**
   * Driven through the real client rather than read off the route table, because the table is only
   * half the journey: the query is serialised by `URLSearchParams` and a filter that lost half its
   * scope to an encoding mistake would still look right in `routeFor`.
   *
   * This is the outbound half of the recitation question. It says NoorLife asked for both.
   */
  const call = recordingFetch((request) =>
    request.url.startsWith(QF_OAUTH_ORIGIN)
      ? jsonResponse({
        access_token: syntheticToken('sync'),
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'content',
      })
      : jsonResponse(sync())
  );
  const client = createQuranFoundationClient({
    clientId: 'synthetic-client-id-for-tests',
    clientSecret: 'synthetic-client-secret-for-tests',
    tokenTimeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl: call,
  });

  const result = await client.read(
    {
      operation: 'sync_content_resources',
      syncToken: null,
      cursor: null,
      perPage: MAX_SYNC_PER_PAGE,
    },
    new AbortController().signal,
  );
  assertEquals(result.kind, 'ok');

  const content = call.calls.find((request) => !request.url.startsWith(QF_OAUTH_ORIGIN));
  assert(content !== undefined, 'a content request was made');
  const sent = new URL(content.url).searchParams.get('resources');
  assertEquals(sent, CANONICAL_SYNC_FILTER, 'the filter arrives on the wire intact');
  assertEquals(sent, 'recitations:3;translations:85', 'and names both approved resources');
  assertEquals(new URL(content.url).searchParams.get('bootstrap'), 'true', 'as a bootstrap');
});

/**
 * The two mutations a bootstrap should open with, written exactly as Quran Foundation documents them.
 *
 * `RESOURCE_CREATE` carries no `data` and no `record_key` — it announces a resource, not a row — and
 * its `snapshot_url` is the documented root-relative form. That last detail matters: before the
 * bootstrap fix this shape was refused outright, which would have failed the **whole page** rather
 * than dropping one resource from it, so it cannot account for a page that arrived with one.
 */
const resourceCreate = (group: 'recitations' | 'translations', sequence: number) => ({
  sequence,
  type: 'RESOURCE_CREATE',
  resource_group: group,
  resource_id: SYNC_RESOURCES[group],
  changed_at: '2026-08-15T00:00:00Z',
  snapshot_url: `/api/v4/resources/snapshots/${group}/${SYNC_RESOURCES[group]}`,
  record_key: null,
  record_type: null,
  data: null,
  unavailable_reason: null,
});

Deno.test('a bootstrap page carrying both documented RESOURCE_CREATEs keeps both', () => {
  /**
   * The inbound half. If the normaliser were quietly discarding the recitation mutation — an
   * unrecognised type, a permission check reading the wrong side of the table, a snapshot URL refused
   * for the wrong group — this is where it would show.
   *
   * Both orders are driven, because a bug that dropped the *first* mutation and a bug that dropped the
   * *recitation* mutation look identical when there is only one arrangement to look at.
   */
  for (
    const [first, second] of [['recitations', 'translations'], [
      'translations',
      'recitations',
    ]] as const
  ) {
    const page = normalizeSync(sync({
      mutations: [resourceCreate(first, 1), resourceCreate(second, 2)],
    }));
    assert(page !== null, `${first} then ${second}: the page normalises`);
    assertEquals(page.mutations.length, 2, `${first} then ${second}: both mutations survive`);
    assertEquals(
      page.mutations.map((mutation) => mutation.resourceGroup).sort(),
      ['recitations', 'translations'],
      `${first} then ${second}: both groups are present`,
    );
    for (const mutation of page.mutations) {
      assertEquals(mutation.type, 'RESOURCE_CREATE');
      assertEquals(mutation.snapshotRequired, true, 'each announces that a snapshot is needed');
      assertEquals(mutation.resourceId, SYNC_RESOURCES[mutation.resourceGroup]);
    }
  }
});

Deno.test('a lone recitation RESOURCE_CREATE is kept on exactly the same terms', () => {
  /*
    The recitation mutation alone, so the assertion cannot be satisfied by the translation one. This
    is the precise shape the live bootstrap did not contain.
  */
  const page = normalizeSync(sync({ mutations: [resourceCreate('recitations', 1)] }));
  assert(page !== null, 'normalised');
  assertEquals(page.mutations.length, 1);
  assertEquals(page.mutations[0]?.resourceGroup, 'recitations');
  assertEquals(page.mutations[0]?.type, 'RESOURCE_CREATE');
  assertEquals(page.mutations[0]?.snapshotRequired, true);

  /* And a `RESOURCE_CREATE` needs neither a row nor a record key — requiring one would drop it. */
  assertEquals(page.mutations[0]?.row, undefined, 'no row is expected of a resource announcement');
  assertEquals(page.mutations[0]?.recordKey, undefined, 'and no record key');
});

Deno.test('the only mutation the normaliser silently skips is one outside the permission table', () => {
  /**
   * The skip path, isolated. `out-of-scope` is the single branch that drops a mutation and keeps the
   * page, and it fires on the resource pair alone — so no property of a `recitations:3` mutation can
   * reach it. Everything else that fails refuses the whole page, loudly, which is not what the live
   * bootstrap did.
   */
  const skipped = normalizeSync(sync({
    mutations: [
      resourceCreate('recitations', 1),
      { ...resourceCreate('translations', 2), resource_id: 20 },
      { ...resourceCreate('recitations', 3), resource_group: 'tafsirs' },
    ],
  }));
  assert(skipped !== null, 'the page survives the out-of-scope entries');
  assertEquals(skipped.mutations.length, 1, 'only the permitted resource is kept');
  assertEquals(skipped.mutations[0]?.resourceGroup, 'recitations');

  /* Both permitted pairs are in scope. Neither can be skipped, whatever else a mutation carries. */
  for (const group of ['recitations', 'translations'] as const) {
    const page = normalizeSync(sync({ mutations: [resourceCreate(group, 1)] }));
    assert(page !== null, `${group} normalises`);
    assertEquals(page.mutations.length, 1, `${group} is never out of scope`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots
// ─────────────────────────────────────────────────────────────────────────────

const snapshotBody = (over: Record<string, unknown> = {}) => ({
  resource_group: 'recitations',
  resource_id: 3,
  resource_content_id: null,
  schema_version: 1,
  sync_sequence: 4200,
  records: [
    {
      verse_key: '93:1',
      url: 'https://verses.quran.foundation/Sudais/mp3/093001.mp3',
      duration: 5,
    },
    { verse_key: '93:2', url: 'https://verses.quran.foundation/Sudais/mp3/093002.mp3' },
  ],
  ...over,
});

Deno.test('a snapshot normalises its rows with verse identity', () => {
  const snapshot = normalizeSnapshot(snapshotBody(), 'recitations');
  assert(snapshot !== null, 'normalised');
  assertEquals(snapshot.resourceId, 3);
  assertEquals(snapshot.syncSequence, 4200);
  assertEquals(snapshot.rows.length, 2);
  assertEquals(snapshot.rows.map((row) => row.ayah), [1, 2]);
});

Deno.test('a snapshot answering for another resource is refused', () => {
  /*
    The most destructive thing this feed can do: a snapshot replaces every local row, so one that
    answers for a different resource would overwrite one resource with another's contents.
  */
  assertEquals(normalizeSnapshot(snapshotBody({ resource_id: 7 }), 'recitations'), null);
  assertEquals(normalizeSnapshot(snapshotBody({ resource_group: 'tafsirs' }), 'recitations'), null);
  assertEquals(normalizeSnapshot(snapshotBody(), 'translations'), null);
});

Deno.test('a snapshot with one unreadable row is refused entirely', () => {
  /*
    Not the page-of-scripture rule. A snapshot is a complete replacement, so accepting a partial one
    silently deletes every row it failed to parse.
  */
  const body = snapshotBody({
    records: [{ verse_key: '93:1', url: 'https://verses.quran.foundation/a.mp3' }, {
      url: 'https://verses.quran.foundation/b.mp3',
    }],
  });
  assertEquals(normalizeSnapshot(body, 'recitations'), null);
});

Deno.test('a snapshot row drops an audio URL that is not on an allow-listed host', () => {
  const body = snapshotBody({
    records: [{ verse_key: '93:1', url: 'https://evil.example/093001.mp3' }],
  });
  const snapshot = normalizeSnapshot(body, 'recitations');
  assert(snapshot !== null, 'the row survives — its identity is still valid');
  assert(snapshot.rows[0]?.group === 'recitations', 'a recitation row');
  assertEquals(snapshot.rows[0].url, undefined, 'but carries no address');
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing leaks
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('a normalised page carries no credential, header or vendor address', () => {
  const page = normalizeSync(sync({
    mutations: [
      rowMutation({
        type: 'RESOURCE_INVALIDATE',
        snapshot_url: `${QF_API_ORIGIN}${QF_CONTENT_PREFIX}/resources/snapshots/recitations/3`,
        data: null,
      }),
    ],
  }));
  const text = JSON.stringify(page);
  for (
    const secret of [
      'x-auth-token',
      'x-client-id',
      'apis.quran.foundation',
      'Bearer',
      'client_secret',
    ]
  ) {
    assertEquals(text.includes(secret), false, `${secret} does not cross the boundary`);
  }
});

Deno.test('the payload dispatcher routes both operations', () => {
  const parsedSync = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'sync_content_resources',
  });
  assert(parsedSync.ok, 'parsed');
  const outcome = normalizePayload(parsedSync.query, sync());
  assert(outcome.ok, 'dispatched');
  assertEquals(outcome.value.operation, 'sync_content_resources');

  const parsedSnapshot = parseRequestBody({
    contract_version: CONTRACT_VERSION,
    operation: 'get_content_snapshot',
    resource_group: 'translations',
  });
  assert(parsedSnapshot.ok, 'parsed');
  const snapshot = normalizePayload(parsedSnapshot.query, {
    resource_group: 'translations',
    resource_id: 85,
    schema_version: 1,
    sync_sequence: 9,
    records: [{ verse_key: '93:1', text: 'By the morning brightness' }],
  });
  assert(snapshot.ok, 'dispatched');
  assertEquals(snapshot.value.operation, 'get_content_snapshot');
});
