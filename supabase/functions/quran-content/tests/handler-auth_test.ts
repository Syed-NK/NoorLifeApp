import { assert, assertEquals } from './assert.ts';
import { createQuranContentHandler } from '../handler.ts';
import {
  acceptingVerifier,
  dependencies,
  jsonRequest,
  recordingLogger,
  refusingVerifier,
  scriptedUpstream,
} from './fakes.ts';

/**
 * The authenticated-user requirement, and the two things it must never become.
 *
 * The endpoint must never be public, and it must never accept an identity from the request. Both are
 * asserted here as behaviour; `source-scan_test.ts` asserts the structural halves — that no request
 * field can name a user, and that `verify_jwt = true` is declared in `supabase/config.toml`.
 */

const CHAPTERS = { chapters: [] };

function handlerWith(overrides: Parameters<typeof dependencies>[0] = {}) {
  const upstream = scriptedUpstream({
    kind: 'ok',
    body: CHAPTERS,
    attempts: 1,
    tokenRenewed: false,
  });
  const logger = recordingLogger();
  const deps = dependencies({ upstream, logger, ...overrides });
  return { handle: createQuranContentHandler(deps), upstream, logger, deps };
}

Deno.test('an unauthenticated request is refused and reaches no vendor', async () => {
  const { handle, upstream } = handlerWith({ verifier: refusingVerifier('missing') });

  const response = await handle(jsonRequest({ contract_version: 1, operation: 'list_chapters' }));

  assertEquals(response.status, 401);
  assertEquals(upstream.queries.length, 0, 'no Quran Foundation request was made');
});

Deno.test('every authentication failure produces the same body', async () => {
  /**
   * Distinguishing them tells a prober how far it got. The reason survives only into the operational
   * log, where it is a closed enum rather than a claim value.
   */
  const bodies: string[] = [];
  for (
    const reason of [
      'missing',
      'malformed',
      'signature',
      'expired',
      'time-claims',
      'audience',
      'issuer',
      'role',
      'subject',
      'session',
    ] as const
  ) {
    const { handle } = handlerWith({ verifier: refusingVerifier(reason) });
    const response = await handle(jsonRequest({ contract_version: 1, operation: 'list_chapters' }));
    assertEquals(response.status, 401, reason);
    const body = await response.json();
    // The request id differs per call by design; everything else must not.
    bodies.push(JSON.stringify({ ...body, request_id: '<redacted>' }));
  }
  assertEquals(new Set(bodies).size, 1, 'one body for every refusal reason');
});

Deno.test('a token this function cannot verify is the server’s problem, not the caller’s', async () => {
  /**
   * `verifier-unavailable` means no usable key material — a statement about the server. Answering
   * `401` would tell a signed-in user their session was bad and hide an operator problem behind a
   * user-facing one.
   */
  const { handle, upstream, logger } = handlerWith({
    verifier: refusingVerifier('verifier-unavailable'),
  });

  const response = await handle(jsonRequest({ contract_version: 1, operation: 'list_chapters' }));

  assertEquals(response.status, 503);
  assertEquals(upstream.queries.length, 0);
  assertEquals(logger.entries[0]?.auth_reason, 'verifier-unavailable');
});

Deno.test('authentication runs before the body is read', async () => {
  /**
   * A body that would fail validation, sent by a caller who is not authenticated. If parsing ran
   * first the answer would be `400`, which tells an unauthenticated prober that its payload shape was
   * wrong — and means the function did work on bytes from a stranger.
   */
  const { handle } = handlerWith({ verifier: refusingVerifier('signature') });

  const response = await handle(jsonRequest({ nonsense: true }));

  assertEquals(response.status, 401);
});

Deno.test('the handler asks the verifier for the raw Authorization header', async () => {
  const verifier = acceptingVerifier();
  const { handle } = handlerWith({ verifier });

  await handle(jsonRequest({ contract_version: 1, operation: 'list_chapters' }));

  assertEquals(verifier.seen.length, 1, 'verified exactly once');
  assert(verifier.seen[0] !== null, 'and it was given the header rather than a pre-parsed token');
});

Deno.test('a preflight is answered without authentication and without a log line', async () => {
  const { handle, logger } = handlerWith({ verifier: refusingVerifier('missing') });

  const response = await handle(
    jsonRequest({}, { method: 'OPTIONS', headers: {}, body: null }),
  );

  assertEquals(response.status, 204);
  assertEquals(logger.entries.length, 0, 'nothing was authenticated and nothing was asked');
});

Deno.test('no response or log line carries a user identifier', async () => {
  /**
   * This function reads public scripture. It has no per-user state, so a user identifier anywhere in
   * its output would be a record of what somebody reads, kept for no operational gain at all.
   */
  const { handle, logger } = handlerWith();

  const response = await handle(jsonRequest({ contract_version: 1, operation: 'list_chapters' }));
  const text = await response.text();

  for (const forbidden of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222']) {
    assertEquals(text.includes(forbidden), false, 'not in the response body');
    assertEquals(
      JSON.stringify(logger.entries).includes(forbidden),
      false,
      'not in the log record',
    );
  }
});

Deno.test('a client-supplied identity is a 400, not an override', async () => {
  /**
   * The request schema is closed by name, so `user_id` is refused as an unknown field before anything
   * looks at it. There is no code path in which a body-supplied identity is consulted, and this is the
   * behavioural half of that; `source-scan_test.ts` asserts the field names are absent from the schema.
   */
  const { handle, upstream } = handlerWith();

  for (const field of ['user_id', 'sub', 'subject_id', 'session_id', 'access_token']) {
    const response = await handle(
      jsonRequest({
        contract_version: 1,
        operation: 'list_chapters',
        [field]: '11111111-1111-4111-8111-111111111111',
      }),
    );
    assertEquals(response.status, 400, field);
  }
  assertEquals(upstream.queries.length, 0, 'and none of them reached the vendor');
});
