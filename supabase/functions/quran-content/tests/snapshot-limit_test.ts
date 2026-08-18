import { assert, assertEquals } from './assert.ts';
import {
  createQuranFoundationClient,
  MAX_RESPONSE_BYTES,
  MAX_SNAPSHOT_RESPONSE_BYTES,
  routeFor,
} from '../quran-foundation-client.ts';
import { QF_OAUTH_ORIGIN } from '../token-store.ts';
import { normalizePayload } from '../normalize.ts';
import { SYNC_RESOURCES, type SyncResourceGroup } from '../contract.ts';
import type { QuranQuery } from '../ports.ts';
import { fakeClock, jsonResponse, recordingFetch, syntheticToken } from './fakes.ts';

/**
 * The snapshot-only read bound: 8 MiB on one route, 1 MiB on every other.
 *
 * ── Where the number came from ──────────────────────────────────────────────
 * Two authenticated diagnostic runs measured the live snapshots as doubling bands —
 * `recitations:3` at `over_4_to_8_mib` and `translations:85` at `over_2_to_4_mib`. Eight mebibytes is
 * the upper bound of the larger observed band, so it is the smallest limit that admits both, and it is
 * that figure exactly rather than that figure plus a margin. The measuring apparatus is gone: nothing
 * in the function still counts past a bound, and no size vocabulary remains in the log.
 *
 * ── What this file has to prove ─────────────────────────────────────────────
 * Three things, and the third is worth the most care:
 *
 *   • the new bound admits exactly 8 MiB and refuses 8 MiB plus one byte, cancelling the stream;
 *   • both approved resource groups get that same bound, from the same route definition;
 *   • **no other route moved.** A per-route allowance is only as good as its containment, so the
 *     ordinary content routes and `/resources/sync` are driven at exactly one byte over 1 MiB and
 *     must still refuse — proven from the producer's side, by watching the stream get cancelled.
 */

const CLIENT_ID = 'synthetic-client-id-for-tests';
const CLIENT_SECRET = 'synthetic-client-secret-for-tests';

const SNAPSHOT: QuranQuery = { operation: 'get_content_snapshot', resourceGroup: 'recitations' };
const CHAPTERS: QuranQuery = { operation: 'list_chapters' };
const VERSES: QuranQuery = { operation: 'list_verses', surah: 18, page: 1, perPage: 50 };
const SYNC: QuranQuery = {
  operation: 'sync_content_resources',
  syncToken: null,
  cursor: null,
  perPage: 100,
};

const ONE_MIB = 1_048_576;

function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

function isTokenCall(url: string): boolean {
  return url.startsWith(QF_OAUTH_ORIGIN);
}

function clientWith(fetchImpl: typeof fetch) {
  return createQuranFoundationClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tokenTimeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl,
  });
}

/**
 * A stream that generates bytes **on demand** and records how many it was actually asked for.
 *
 * `pull` rather than a pre-built body is the whole point: `produced` then measures what the consumer
 * really drew, so "the reader stopped at the bound" is an observable fact rather than an inference
 * from the outcome. `cancel` records the consumer giving up early.
 *
 * ── `closeAtEnd`, and why the boundary cases turn it off ────────────────────
 * A stream that closes as soon as it has delivered its last byte is already finished by the time a
 * reader one byte past the bound gives up, and cancelling a finished stream never reaches the
 * source's `cancel` — so `cancelled` would read `false` for a reader that behaved perfectly. That is
 * an artefact of the fixture, not of the client.
 *
 * `closeAtEnd: false` models the real case instead: a connection still open with the vendor free to
 * send more. The reader must then actively cancel to finish, which is exactly the behaviour the
 * boundary tests are there to prove.
 */
function countingStream(
  totalBytes: number,
  { chunkBytes = 256 * 1024, closeAtEnd = true } = {},
) {
  const state = { produced: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.produced >= totalBytes) {
        if (!closeAtEnd) {
          // The connection is open and nothing further has arrived. Only a cancel ends this.
          return new Promise<void>(() => {});
        }
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - state.produced);
      state.produced += size;
      controller.enqueue(new Uint8Array(size));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

/**
 * A body delivered as a stream, so the response carries **no** `Content-Length`.
 *
 * The distinction matters for the boundary cases: handing `new Response` a string makes the runtime
 * declare a length, which the reader refuses without reading. Streaming forces the case under test —
 * the bound being reached mid-read.
 */
function streamOf(text: string, chunkBytes = 256 * 1024): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkBytes, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

/** Answers the token hop, then hands the content hop whatever body the case needs. */
function upstreamServing(body: BodyInit | null, headers: Record<string, string> = {}) {
  return recordingFetch((request) =>
    isTokenCall(request.url)
      ? jsonResponse({
        access_token: syntheticToken('limit'),
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'content',
      })
      : new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json', ...headers },
      })
  );
}

/**
 * A byte-exact snapshot body of a chosen size, built from rows the normaliser already accepts.
 *
 * Padding a **valid** body rather than filling a buffer with nothing is what makes the size cases
 * meaningful: they exercise the same path a real snapshot takes, right through to parsing, instead of
 * proving only that a large blob is refused. Assembled as text rather than by re-serialising a growing
 * array, which would be quadratic at these sizes.
 */
function snapshotBodyOfSize(group: SyncResourceGroup, targetBytes: number): string {
  const head =
    `{"resource_group":"${group}","resource_id":${SYNC_RESOURCES[group]},"schema_version":1,` +
    `"sync_sequence":4200,"records":[`;
  const tail = ']}';
  const padPrefix = '{"verse_key":"1:1","text":"';
  const padSuffix = '"}';

  const row = (index: number) =>
    group === 'recitations'
      ? JSON.stringify({
        verse_key: `${(index % 114) + 1}:${(index % 200) + 1}`,
        url: `https://verses.quran.foundation/Sudais/mp3/${String(index).padStart(6, '0')}.mp3`,
        duration: 5,
        file_size: 40_000,
      })
      : JSON.stringify({
        verse_key: `${(index % 114) + 1}:${(index % 200) + 1}`,
        text: `Padding row ${index} standing in for a translated verse.`,
      });

  /* Room reserved for the separator and the empty padding row that lands the total on the byte. */
  const reserved = 1 + padPrefix.length + padSuffix.length;
  const parts: string[] = [];
  let length = head.length + tail.length;
  for (let index = 0; length + row(index).length + 1 + reserved <= targetBytes; index += 1) {
    const serialised = row(index);
    length += serialised.length + (parts.length === 0 ? 0 : 1);
    parts.push(serialised);
  }

  const separator = parts.length === 0 ? 0 : 1;
  const filler = targetBytes - length - separator - padPrefix.length - padSuffix.length;
  assert(filler >= 0, `the padding row fits within ${targetBytes} bytes`);
  parts.push(`${padPrefix}${'x'.repeat(filler)}${padSuffix}`);

  const body = `${head}${parts.join(',')}${tail}`;
  assertEquals(new TextEncoder().encode(body).byteLength, targetBytes, 'the fixture is byte-exact');
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// The two limits, and the exact boundary between accepted and refused
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('the two limits are exactly one and eight mebibytes', () => {
  assertEquals(MAX_RESPONSE_BYTES, 1_048_576, 'the ordinary bound is unchanged at 1 MiB');
  assertEquals(MAX_SNAPSHOT_RESPONSE_BYTES, 8_388_608, 'the snapshot bound is exactly 8 MiB');
  assertEquals(
    MAX_SNAPSHOT_RESPONSE_BYTES,
    8 * MAX_RESPONSE_BYTES,
    'and it is the measured band’s ceiling, not that ceiling plus a margin',
  );
});

Deno.test('a snapshot of exactly eight mebibytes is accepted by the bounded reader', async () => {
  /**
   * The inclusive edge, twice over. A bound that refused the byte it is set to would make the measured
   * band `over_4_to_8_mib` insufficient by one byte — the exact failure this correction exists to end.
   *
   * First a real body of exactly that size, which must come back `ok`. Then the same size as opaque
   * padding, which lets the producer be watched: the whole stream is drawn, nothing is cancelled, and
   * the refusal comes from the **parser** rather than the bound.
   */
  const exact = snapshotBodyOfSize('recitations', MAX_SNAPSHOT_RESPONSE_BYTES);
  const served = await clientWith(upstreamServing(streamOf(exact))).read(SNAPSHOT, neverAborted());
  assertEquals(served.kind, 'ok', 'a snapshot of exactly the bound is read and parsed');

  const { stream, state } = countingStream(MAX_SNAPSHOT_RESPONSE_BYTES);
  const padded = await clientWith(upstreamServing(stream)).read(SNAPSHOT, neverAborted());

  assertEquals(state.produced, MAX_SNAPSHOT_RESPONSE_BYTES, 'the whole body was drawn');
  assertEquals(state.cancelled, false, 'and the stream closed rather than being cancelled');
  assert(padded.kind === 'malformed', 'padding bytes are not a body');
  assertEquals(padded.reason, 'invalid_json', 'refused by the parser, not by the bound');
});

Deno.test('a snapshot of eight mebibytes and one byte is refused and the stream cancelled', async () => {
  const { stream, state } = countingStream(MAX_SNAPSHOT_RESPONSE_BYTES + 1, { closeAtEnd: false });
  const result = await clientWith(upstreamServing(stream)).read(SNAPSHOT, neverAborted());

  assert(result.kind === 'malformed', 'refused');
  assertEquals(result.reason, 'streamed_too_large', 'the bound is what refused it');
  assertEquals(state.cancelled, true, 'the reader cancelled rather than draining');
  assert(
    state.produced <= MAX_SNAPSHOT_RESPONSE_BYTES + ONE_MIB,
    `stopped at the bound, drew ${state.produced} bytes`,
  );
});

Deno.test('nothing continues reading past the snapshot bound', async () => {
  /**
   * The measurement pass is gone, and this is what its absence looks like from outside: a body far
   * larger than the bound is not drained to find out how large, it is cancelled at the bound like any
   * other. A regression that reinstated the drain would show up here as a producer drawn to 40 MiB.
   */
  const { stream, state } = countingStream(40 * ONE_MIB);
  const result = await clientWith(upstreamServing(stream)).read(SNAPSHOT, neverAborted());

  assert(result.kind === 'malformed', 'refused');
  assertEquals(result.reason, 'streamed_too_large');
  assertEquals(state.cancelled, true);
  assert(
    state.produced <= MAX_SNAPSHOT_RESPONSE_BYTES + ONE_MIB,
    `stopped at the bound, drew ${state.produced} of 40 MiB`,
  );
  /* And the outcome carries no size vocabulary of any kind — the whole value, field for field. */
  assertEquals(
    JSON.stringify(result),
    JSON.stringify({
      kind: 'malformed',
      reason: 'streamed_too_large',
      attempts: 1,
      tokenRenewed: false,
    }),
  );
});

Deno.test('a snapshot declaring more than the bound is refused unread', async () => {
  const call = upstreamServing('{}', { 'content-length': String(MAX_SNAPSHOT_RESPONSE_BYTES + 1) });
  const result = await clientWith(call).read(SNAPSHOT, neverAborted());

  assert(result.kind === 'malformed', 'refused');
  assertEquals(result.reason, 'declared_too_large');

  /* And one declaring less than the bound but more than the ordinary limit is read normally. */
  const within = snapshotBodyOfSize('recitations', 2 * ONE_MIB);
  const withinSnapshot = upstreamServing(within, { 'content-length': String(2 * ONE_MIB) });
  assertEquals((await clientWith(withinSnapshot).read(SNAPSHOT, neverAborted())).kind, 'ok');
});

// ─────────────────────────────────────────────────────────────────────────────
// Containment: every other route is still bounded at one mebibyte
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('ordinary content routes and the sync feed still refuse just over one mebibyte', async () => {
  /**
   * The containment property, driven at the exact byte rather than at a comfortable multiple. Each
   * route is handed `MAX_RESPONSE_BYTES + 1` and must refuse it — so a change that let the snapshot
   * allowance leak onto another route fails here even if it leaked by a single byte.
   */
  for (const query of [CHAPTERS, VERSES, SYNC] as const) {
    const { stream, state } = countingStream(MAX_RESPONSE_BYTES + 1, {
      chunkBytes: 64 * 1024,
      closeAtEnd: false,
    });
    const result = await clientWith(upstreamServing(stream)).read(query, neverAborted());

    assert(result.kind === 'malformed', query.operation);
    assertEquals(result.reason, 'streamed_too_large', query.operation);
    assertEquals(state.cancelled, true, `${query.operation} cancelled the stream`);
  }
});

Deno.test('ordinary routes are cancelled at one mebibyte, not at eight', async () => {
  /*
    Driven with a body that would be perfectly acceptable on the snapshot route. If the bound were
    shared, the producer would be drawn to the full 6 MiB; it must stop just past 1 MiB instead.
  */
  for (const query of [CHAPTERS, SYNC] as const) {
    const { stream, state } = countingStream(6 * ONE_MIB);
    const result = await clientWith(upstreamServing(stream)).read(query, neverAborted());

    assert(result.kind === 'malformed', query.operation);
    assertEquals(result.reason, 'streamed_too_large', query.operation);
    assert(
      state.produced <= 2 * ONE_MIB,
      `${query.operation} stopped at the ordinary bound, drew ${state.produced} bytes`,
    );
    assert(state.produced < 6 * ONE_MIB, `${query.operation} did not read a snapshot's worth`);
  }
});

Deno.test('the enlarged allowance is attached to exactly one route definition', () => {
  /**
   * Read off the route table itself. Every route but one leaves `maxResponseBytes` absent — which the
   * reader resolves to `MAX_RESPONSE_BYTES` — and the snapshot route is the only entry that names a
   * bound of its own.
   */
  const withBound: string[] = [];
  const queries: readonly QuranQuery[] = [
    CHAPTERS,
    VERSES,
    SYNC,
    { operation: 'get_chapter', surah: 18 },
    { operation: 'get_verse', surah: 94, ayah: 6, translationId: null },
    { operation: 'list_translation_resources' },
    { operation: 'list_recitation_resources' },
    { operation: 'list_verse_translations', surah: 18, translationId: 85, page: 1, perPage: 50 },
    { operation: 'list_verse_recitations', surah: 18, recitationId: 3, page: 1, perPage: 50 },
    { operation: 'get_content_snapshot', resourceGroup: 'recitations' },
    { operation: 'get_content_snapshot', resourceGroup: 'translations' },
  ];

  for (const query of queries) {
    const route = routeFor(query);
    if (route.maxResponseBytes !== undefined) {
      withBound.push(query.operation);
      assertEquals(
        route.maxResponseBytes,
        MAX_SNAPSHOT_RESPONSE_BYTES,
        `${query.operation} uses the snapshot bound`,
      );
    }
  }

  assertEquals(
    [...new Set(withBound)],
    ['get_content_snapshot'],
    'only the snapshot operation carries a bound of its own',
  );
});

Deno.test('both approved resource groups get the same snapshot bound', () => {
  const recitations = routeFor({ operation: 'get_content_snapshot', resourceGroup: 'recitations' });
  const translations = routeFor({
    operation: 'get_content_snapshot',
    resourceGroup: 'translations',
  });

  assertEquals(recitations.maxResponseBytes, MAX_SNAPSHOT_RESPONSE_BYTES);
  assertEquals(translations.maxResponseBytes, MAX_SNAPSHOT_RESPONSE_BYTES);
  assertEquals(recitations.maxResponseBytes, translations.maxResponseBytes, 'one bound, not two');

  /* The permission table still decides the id, and the paths are still the approved two. */
  assertEquals(recitations.path, '/resources/snapshots/recitations/3');
  assertEquals(translations.path, '/resources/snapshots/translations/85');
});

// ─────────────────────────────────────────────────────────────────────────────
// A live-shaped snapshot reaches normalisation, with the schema untouched
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('a live-shaped snapshot larger than the old bound is read and normalised', async () => {
  /**
   * The whole point of the correction, end to end and for both groups: a body of the size the live
   * snapshots actually are — well past the old 1 MiB limit, inside the new one — is read, parsed and
   * accepted by `normalizePayload` **as the schema already stands**.
   *
   * Nothing in `normalize.ts` was touched for this. Every row carries a real `verse_key` and either a
   * real `url` on the allow-listed host or real text, and the envelope carries the `resource_group`
   * and `resource_id` the request asked for — because the fix is a read bound, not a looser contract.
   * If a live payload ever fails here, the correct answer is the closed `normalize_reason` it produces
   * and a separate decision about it, not a relaxed check.
   */
  for (
    const [group, bytes] of [
      ['recitations', 5 * ONE_MIB],
      ['translations', 3 * ONE_MIB],
    ] as const
  ) {
    const query: QuranQuery = { operation: 'get_content_snapshot', resourceGroup: group };
    const body = snapshotBodyOfSize(group, bytes);
    const result = await clientWith(upstreamServing(streamOf(body))).read(query, neverAborted());

    assert(result.kind === 'ok', `${group}: a ${bytes / ONE_MIB} MiB snapshot is read`);
    const normalized = normalizePayload(query, result.body);
    assert(normalized.ok, `${group}: and it normalises without loosening anything`);
    assert(
      normalized.value.operation === 'get_content_snapshot',
      `${group}: dispatched as a snapshot`,
    );
    assertEquals(normalized.value.resourceGroup, group);
    assertEquals(normalized.value.resourceId, SYNC_RESOURCES[group]);
    assert(normalized.value.rows.length > 1_000, `${group}: every row survived`);
  }
});

Deno.test('the same body one byte past the bound never reaches normalisation', async () => {
  /*
    The complement. Fail-closed means the parser is never handed a partial snapshot — a snapshot
    replaces every local row, so a truncated one is the most destructive thing this feed could apply.
  */
  const oversized = `${snapshotBodyOfSize('recitations', MAX_SNAPSHOT_RESPONSE_BYTES)} `;
  const result = await clientWith(upstreamServing(streamOf(oversized)))
    .read(SNAPSHOT, neverAborted());

  assert(result.kind === 'malformed', 'refused');
  assertEquals(result.reason, 'streamed_too_large');
  assertEquals('body' in result, false, 'nothing partial is carried forward');
});
