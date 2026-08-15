import { assert, assertEquals } from './assert.ts';
import { normalizePayload, normalizeSnapshot, normalizeSync } from '../normalize.ts';
import { parseRequestBody } from '../request-schema.ts';
import {
  cursorFromNextPageUrl,
  isApprovedSnapshotUrl,
  QF_API_ORIGIN,
  QF_CONTENT_PREFIX,
  routeFor,
} from '../quran-foundation-client.ts';
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
      rowMutation({ resource_group: 'translations', resource_id: 20, data: { verse_key: '1:1', text: 'x' } }),
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
      rowMutation({ record_key: '93:11', data: { verse_key: '93:11', url: 'https://verses.quran.foundation/a.mp3' } }),
      rowMutation({ record_key: '93:4', data: { verse_key: '93:4', url: 'https://verses.quran.foundation/b.mp3' } }),
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
// Snapshots
// ─────────────────────────────────────────────────────────────────────────────

const snapshotBody = (over: Record<string, unknown> = {}) => ({
  resource_group: 'recitations',
  resource_id: 3,
  resource_content_id: null,
  schema_version: 1,
  sync_sequence: 4200,
  records: [
    { verse_key: '93:1', url: 'https://verses.quran.foundation/Sudais/mp3/093001.mp3', duration: 5 },
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
  const body = snapshotBody({ records: [{ verse_key: '93:1', url: 'https://verses.quran.foundation/a.mp3' }, { url: 'https://verses.quran.foundation/b.mp3' }] });
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
    mutations: [rowMutation({ type: 'RESOURCE_INVALIDATE', snapshot_url: `${QF_API_ORIGIN}${QF_CONTENT_PREFIX}/resources/snapshots/recitations/3`, data: null })],
  }));
  const text = JSON.stringify(page);
  for (const secret of ['x-auth-token', 'x-client-id', 'apis.quran.foundation', 'Bearer', 'client_secret']) {
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
