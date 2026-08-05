import { assert, assertEquals } from './assert.ts';

/**
 * The source scans — every AI-2 acceptance claim that is about the *absence* of something.
 *
 * §J's acceptance line for this phase: "Acceptance for AI-2 is every AI-2 row passing **plus** an assertion
 * that the function source contains no provider key, no `service_role` reference, and no network call outside
 * the injected provider interface. `PRE_RELEASE_BACKLOG.md`'s existing source-scan pattern is the model for
 * that check."
 *
 * ── Why a scan rather than a behavioural test ────────────────────────────────
 * A behavioural test can only prove a path it thought to exercise. "No file reads an OpenAI key" is not
 * provable by pressing buttons — it is provable by reading every file and finding no read of one. The same
 * instrument the repository already uses for `auth-callback-source-scan_test.ts` and
 * `privacy-security-source-scan_test.ts`, applied to the things an AI endpoint could smuggle.
 *
 * Every scan below runs against **executable text only**: comments are stripped first, so a comment
 * explaining why `api.openai.com` must not appear is not what makes the scan fail. That distinction matters
 * here more than usual, because these files document their own prohibitions at length.
 */

const FUNCTION_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

type SourceFile = {
  readonly name: string;
  readonly path: string;
  readonly raw: string;
  /** Executable text: block and line comments removed. */
  readonly code: string;
  readonly isTest: boolean;
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function collect(directory: string, prefix = ''): readonly SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of Deno.readDirSync(directory)) {
    const path = `${directory}/${entry.name}`;
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory) {
      files.push(...collect(path, `${name}/`));
      continue;
    }
    if (!entry.name.endsWith('.ts')) {
      continue;
    }
    const raw = Deno.readTextFileSync(path);
    files.push({ name, path, raw, code: stripComments(raw), isTest: name.startsWith('tests/') });
  }
  return files;
}

const ALL = collect(FUNCTION_ROOT);

/**
 * The three scopes, and why the scans do not all use the same one.
 *
 * `PRODUCTION` is what §J's acceptance line means by "the function source": the modules that are deployed and
 * executed. A capability scan — no OpenAI SDK, no `service_role`, no database client, no `fetch` — belongs here,
 * because it is a statement about what the deployed function *can do*.
 *
 * `ALL` is used for the one scan where a test file is just as dangerous as a production file: anything shaped
 * like a real secret. §B.2 reads **Never** for the repository, not "never outside `tests/`", and a key pasted
 * into a fixture is committed key material regardless of which directory it landed in.
 *
 * `SCANNABLE` excludes this file from the phrase scans, for the obvious reason: the file that enumerates
 * forbidden strings necessarily contains every forbidden string. Excluding it is not a loophole — every pattern
 * here appears in `source-scan_test.ts` as a *pattern*, and the assertions above and below cover everything
 * else.
 */
const PRODUCTION = ALL.filter((file) => !file.isTest);
const SCANNABLE = ALL.filter((file) => file.name !== 'tests/source-scan_test.ts');

function offenders(pattern: RegExp, files: readonly SourceFile[]): readonly string[] {
  return files.filter((file) => pattern.test(file.code)).map((file) => file.name);
}

Deno.test('the scan is actually reading the function', () => {
  // A scan over an empty file list passes every assertion below and proves nothing. This is the guard.
  assert(
    PRODUCTION.length >= 10,
    `production files found: ${PRODUCTION.map((f) => f.name).join(', ')}`,
  );
  assert(ALL.length > PRODUCTION.length, 'and test files were found too');
  for (
    const required of ['index.ts', 'handler.ts', 'production.ts', 'ports.ts', 'jwt-verifier.ts']
  ) {
    assert(PRODUCTION.some((file) => file.name === required), `${required} is in the scan`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// No provider key, anywhere, in any shape
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('no file contains anything shaped like a provider secret', () => {
  /**
   * §B.2's OpenAI-key row reads **Never** for the repository, and the production-best-practices guidance is to
   * store keys in a secret manager, "never in code or public repositories".
   *
   * The scan is on *shapes*, not on a known value, because the value is precisely what must not exist to
   * compare against. `sk-` followed by key-length material covers the current and legacy OpenAI formats;
   * `sb_secret_` covers Supabase's new secret key.
   */
  assertEquals(offenders(/sk-[A-Za-z0-9_-]{16,}/, ALL), [], 'no OpenAI-shaped key');
  // Qualified with trailing key material, so the pattern does not match its own literal in this file and the
  // scan can stay scoped to `ALL` rather than needing an exemption.
  assertEquals(offenders(/sk-proj-[A-Za-z0-9_-]{8,}/, ALL), [], 'no project-scoped OpenAI key');
  /**
   * Length-qualified, like the OpenAI patterns above and for the same two reasons: a real Supabase key of either
   * generation carries a long run of key material after the prefix, and qualifying it means the pattern matches
   * actual credentials rather than the short, obviously-inert placeholders the auth tests use to prove that a
   * non-JWT credential is refused (`jwt-verifier_test.ts`, §D.4 row 2).
   */
  assertEquals(offenders(/sb_secret_[A-Za-z0-9]{20,}/, ALL), [], 'no Supabase secret key');
  assertEquals(
    offenders(/sb_publishable_[A-Za-z0-9]{20,}/, ALL),
    [],
    'no publishable key value either',
  );
  assertEquals(offenders(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, ALL), [], 'no embedded JWT');
});

Deno.test('§B.2 — nothing reads an OpenAI key, and no AI-2 file reads any secret from the environment', () => {
  /**
   * §K: AI-2 completes with "**no key exists anywhere**", and AI-3 is the phase that sets one — "key set via
   * `supabase secrets set` only".
   *
   * The second half of this scan is the one that matters more: not just that `OPENAI_API_KEY` is unread, but
   * that the *only* environment variables this function reads at all are the two platform-injected non-secret
   * ones. A list of permitted reads is a stronger claim than a list of forbidden ones.
   */
  assertEquals(offenders(/OPENAI_API_KEY/, SCANNABLE), [], 'no OpenAI key is read');
  assertEquals(
    offenders(/OPENAI_ORG|OPENAI_PROJECT|OPENAI_BASE_URL/, SCANNABLE),
    [],
    'nor any OpenAI configuration',
  );
  assertEquals(
    offenders(/SAFETY_IDENTIFIER_SALT|NOOR_AI_SALT|\bSALT\b/, SCANNABLE),
    [],
    '§12.6’s salt does not exist yet',
  );

  const reads = PRODUCTION.flatMap((file) =>
    [...file.code.matchAll(/Deno\.env\.get\(\s*'([^']+)'/g)].map(
      (match) => match[1],
    )
  );
  assertEquals(
    [...new Set(reads)].sort(),
    ['SUPABASE_JWKS', 'SUPABASE_URL'],
    'exactly two environment reads, both platform-injected and neither a secret',
  );
});

Deno.test('§B.2 — no service-role or secret key is referenced or used', () => {
  /**
   * §B.2's service-role row: "It bypasses RLS. AI-1 needs no privileged database access at all, so AI-2 must
   * not wire it in 'for later'." §12.10 adds that whoever needs it "is opening a review with a threat model, a
   * least-privilege access story, and an answer for what happens when the check itself fails; they are not
   * adding a line to a handler."
   *
   * Scoped to production, because the test tier references the string `service_role` on purpose — §J.2d2 requires
   * a token bearing that role to be *refused*, and a test that asserts the refusal necessarily names it.
   */
  assertEquals(offenders(/service_role/, PRODUCTION), [], 'no service_role reference');
  assertEquals(
    offenders(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/, SCANNABLE),
    [],
    'no privileged key read, in production or in a test',
  );
  assertEquals(
    offenders(/supabaseAdmin|createAdminClient|auth\s*\.\s*admin/, SCANNABLE),
    [],
    'no admin client anywhere',
  );
  assertEquals(offenders(/serviceRole|SERVICE_ROLE/, PRODUCTION), [], 'in no spelling');
});

// ─────────────────────────────────────────────────────────────────────────────
// No provider SDK, no provider endpoint, no network
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§F.1 — nothing imports an OpenAI SDK or names the provider endpoint', () => {
  /**
   * Scoped to production. The test tier names `api.openai.com` in one place — the §I.6 assertion that a provider
   * host never appears in a response body — and a scan that failed on that would be a scan that punished the test
   * for checking the thing.
   */
  assertEquals(offenders(/api\.openai\.com/, PRODUCTION), [], 'no OpenAI host');
  assertEquals(offenders(/from\s+['"](npm:)?openai/, SCANNABLE), [], 'no OpenAI package import');
  assertEquals(
    offenders(/@ai-sdk|langchain|@anthropic-ai|@google\/gen(erative-)?ai/, SCANNABLE),
    [],
    'no other SDK, in production or in a test',
  );
  assertEquals(
    offenders(/v1\/(responses|chat\/completions|assistants|moderations)/, PRODUCTION),
    [],
    'no provider route',
  );
});

Deno.test('§F.2 — no model is named anywhere', () => {
  /**
   * §F.2: "This document deliberately does **not** name a model", and AI-3 "selects it and records the
   * selection with its rationale". A model name in AI-2 would be that selection made by whoever typed it.
   */
  assertEquals(offenders(/\bgpt-[0-9a-z.]/i, PRODUCTION), [], 'no GPT model');
  assertEquals(offenders(/\bo[1-9](-(mini|preview|pro))?\b/, PRODUCTION), [], 'no reasoning model');
  assertEquals(
    offenders(/omni-moderation|text-embedding-|claude-|gemini-/i, PRODUCTION),
    [],
    'no other model id',
  );
});

Deno.test('nothing in the production graph can make a network call', () => {
  /**
   * The strongest single statement this phase makes. There is no `fetch`, no `XMLHttpRequest`, no WebSocket, no
   * `Deno.connect`, and no dynamic import in any production file — so "it must never call the network except
   * the reviewed Supabase/JWT authentication mechanism" is not a policy the code follows, it is a capability the
   * code does not have.
   *
   * The JWT authentication mechanism needs no call: the platform injects `SUPABASE_JWKS`, so the verification
   * keys are already in the environment. That is why this scan can be an absolute rather than an exception.
   *
   * `Deno.serve` is the inbound listener rather than an outbound call, and it is confined to `index.ts`.
   */
  assertEquals(offenders(/\bfetch\s*\(/, PRODUCTION), [], 'no fetch call');
  assertEquals(
    offenders(/XMLHttpRequest|WebSocket|EventSource/, PRODUCTION),
    [],
    'no other transport',
  );
  assertEquals(
    offenders(/Deno\.(connect|connectTls|listen|createHttpClient)/, PRODUCTION),
    [],
    'no socket',
  );
  assertEquals(offenders(/\bimport\s*\(/, PRODUCTION), [], 'no dynamic import');
  assertEquals(
    offenders(/https?:\/\//, PRODUCTION),
    [],
    'no URL literal of any kind in executable code',
  );
  assertEquals(
    offenders(/Deno\.serve/, PRODUCTION),
    ['index.ts'],
    'the inbound listener is only in index.ts',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// No database access, no persistence, no tools
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§A.2 / §J.11 — nothing can read or write a module record', () => {
  /**
   * §J.11 requires "**No database read of any kind occurs** — asserted, not assumed", and §A.2 defers module
   * reads to AI-6 because no module tables exist. The assertion is that there is no client, no query builder
   * and no SQL — so the refusal in `handler-policy_test.ts` is a statement about copy, and this is the
   * statement about capability.
   */
  assertEquals(
    offenders(/@supabase\/supabase-js|@supabase\/server|createClient\s*\(/, SCANNABLE),
    [],
    'no client anywhere, including in a test',
  );
  assertEquals(offenders(/\bfrom\s*\(\s*['"]/, SCANNABLE), [], 'no query builder call');
  assertEquals(
    offenders(/\b(select|insert|update|delete|upsert)\s*\(\s*['"]/i, SCANNABLE),
    [],
    'no query methods',
  );
  assertEquals(
    offenders(/\b(INSERT INTO|UPDATE .* SET|DELETE FROM|SELECT .* FROM)\b/, PRODUCTION),
    [],
    'no SQL',
  );
  assertEquals(
    offenders(/auth\.sessions|auth\.users/, PRODUCTION),
    [],
    '§D.3 / §12.10 — no auth schema read',
  );
});

Deno.test('§H.5 — nothing persists a conversation', () => {
  // `AI_CONVERSATION_STORAGE_EXISTS` is `false` in `src/`, and §H.5 defers persistence to AI-8. A store here
  // would make that constant a stale promise rather than an asserted fact.
  assertEquals(
    offenders(/localStorage|sessionStorage|Deno\.writeTextFile|Deno\.writeFile/, SCANNABLE),
    [],
    'no writes — the whole tier is read-only, tests included',
  );
  assertEquals(offenders(/Deno\.openKv|\bkv\s*\.\s*(set|get)\s*\(/, SCANNABLE), [], 'no KV store');
  assertEquals(
    offenders(/previous_response_id|conversation_id/, PRODUCTION),
    [],
    '§F.6 — no provider state',
  );
});

Deno.test('§F.4 — there is no tool registry and nothing that could execute one', () => {
  /**
   * §F.4: "A handler that 'just handles' an unexpected tool call has quietly added a capability nobody
   * reviewed." The negative behavioural assertion lives in `handler-provider_test.ts`; this is the structural
   * one — there is nothing in the source that could dispatch a call even if one arrived.
   */
  assertEquals(
    offenders(/tool_choice|function_call|\btoolRegistry\b|\bdispatchTool\b/, PRODUCTION),
    [],
    'none',
  );
  assertEquals(
    offenders(/\bnew Function\b|\beval\s*\(/, SCANNABLE),
    [],
    'and no dynamic evaluation at all',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// No fake in production
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('no production file imports a test fake, and no fake lives outside tests/', () => {
  /**
   * The rule that stops a skeleton phase shipping a canned answer. A fake provider in the production module
   * graph is one misconfigured deployment away from a user reading an invented answer and believing it.
   */
  const importingFakes = PRODUCTION.filter((file) =>
    /from\s+['"][^'"]*(tests?\/|fakes|mocks?)/.test(file.code)
  );
  assertEquals(importingFakes.map((file) => file.name), [], 'no production file imports test code');

  const fakeShaped = PRODUCTION.filter((file) =>
    /\b(createFake|fakeProvider|mockProvider|stubProvider|cannedAnswer|FIXTURE_ANSWER)\b/.test(
      file.code,
    )
  );
  assertEquals(fakeShaped.map((file) => file.name), [], 'and none defines a fake of its own');
});

Deno.test('nothing selects a provider from request input or an environment flag', () => {
  /**
   * The other half of the same rule. Even with no fake to select, a selection mechanism is the hole a future
   * fake would arrive through — so there must not be one.
   */
  assertEquals(
    offenders(/USE_FAKE|FAKE_PROVIDER|MOCK_PROVIDER|NOOR_AI_PROVIDER|PROVIDER_MODE/, SCANNABLE),
    [],
    'no flag',
  );
  assertEquals(
    offenders(/body\s*\.\s*provider|request\s*\.\s*provider|\.provider\s*===/, PRODUCTION),
    [],
    'no field',
  );
  assertEquals(
    offenders(/Deno\.env\.get\(\s*'(?!SUPABASE_URL|SUPABASE_JWKS)/, PRODUCTION),
    [],
    'and no environment read beyond the two permitted ones',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§H.3 — there is exactly one console call in the production source', () => {
  /**
   * §H.3: "Structured logging only, one JSON object per request, and never bare `console.log` of an object whose
   * shape a future change might widen." One call site is what makes the redaction reviewable — and it is in the
   * logger, whose input is the closed `OperationalLogRecord`.
   */
  const withConsole = PRODUCTION.filter((file) => /console\s*\.\s*[a-z]+\s*\(/.test(file.code));
  assertEquals(withConsole.map((file) => file.name), ['production.ts'], 'only the logger logs');

  const calls = [...(withConsole[0]?.code ?? '').matchAll(/console\s*\.\s*[a-z]+\s*\(/g)];
  assertEquals(calls.length, 1, 'and it does so once');
});

Deno.test('§H.3 — no log call can carry a prompt, an answer, a header or a body', () => {
  /**
   * The scan is on what a `console` call *contains*, following the pattern
   * `auth-callback-source-scan_test.ts` established. The forbidden identifiers are the ones §H.3 names: the
   * message text, the answer text, the Authorization header, the raw body of either hop.
   */
  const logger = PRODUCTION.find((file) => file.name === 'production.ts');
  assert(logger !== undefined, 'the logger file is present');
  const call = /console\s*\.\s*[a-z]+\s*\(([\s\S]*?)\n\s{4}\);/.exec(logger.code)?.[1] ??
    logger.code;

  for (
    const forbidden of [
      'message',
      'userInput',
      'instructions',
      'answer',
      'text',
      'token',
      'authorization',
      'headers',
      'body',
      'prompt',
      'userId',
      'sessionId',
      'claims',
    ]
  ) {
    assertEquals(
      new RegExp(`\\b${forbidden}\\b`).test(call),
      false,
      `§H.3 — the log call must not reference ${forbidden}`,
    );
  }
  // `message_length` is permitted and is not `message`: §H.3 calls it "metadata, not content".
  assert(/message_length/.test(logger.code), 'the length metadata is logged');
});

Deno.test('§H.3 — the modules that touch a credential or the message log nothing at all', () => {
  /**
   * The same rule `auth-callback-source-scan_test.ts` applies to the callback parser: the file that first
   * touches an untrusted or secret string must have no logging statement in it, so the string physically
   * cannot escape from there.
   */
  for (
    const name of [
      'jwt-verifier.ts',
      'claims.ts',
      'request-schema.ts',
      'policy.ts',
      'responses.ts',
      'handler.ts',
    ]
  ) {
    const file = PRODUCTION.find((candidate) => candidate.name === name);
    assert(file !== undefined, `${name} is present`);
    assertEquals(/console\s*\.\s*[a-z]+\s*\(/.test(file.code), false, `${name} logs nothing`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The claims this phase must not overstate
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§D.3 / §J.2c — nothing claims the session was verified live or immediately revocable', () => {
  /**
   * §J.2c requires the suite to assert "that no response, log line, or copy anywhere claims the session was
   * verified as live", and §12.10 forbids describing the cost controls "as if" they converted a revoked session
   * into a rejected request.
   *
   * This scan runs over the **raw** text including comments, deliberately: an overclaim in a doc comment is
   * exactly the kind of statement that survives into a review summary and then into a release note.
   *
   * Scoped to production. Test prose necessarily describes the boundary — `handler-auth_test.ts` has to say that
   * a revoked session is indistinguishable from a live one in order to pin §J.2c — and a scan that failed on the
   * test *documenting* the gap would be a scan that discouraged documenting it.
   */
  const overclaims = [
    /session (is |was )?(still )?(live|active|valid)/i,
    /revocation (is )?(implemented|enforced|supported)/i,
    /immediately revoke/i,
    /verif(y|ied|ies) (the )?session (exists|is live)/i,
    /sessions? (lookup|check) against auth\.sessions/i,
  ];

  for (const pattern of overclaims) {
    const found = PRODUCTION.filter((file) => pattern.test(file.raw)).map((file) => file.name);
    assertEquals(found, [], `no production file may claim ${String(pattern)}`);
  }
});

Deno.test('§D.3 / §K — the handler restates the acceptance boundary where it cannot be lost', () => {
  /**
   * §K's AI-2 exit criteria include "§D.3's boundary restated in the handler's own doc comment so it cannot be
   * lost". This asserts the restatement is present and says the load-bearing part, so a future edit that
   * deletes the comment fails a test rather than quietly removing the only warning.
   */
  const handler = PRODUCTION.find((file) => file.name === 'handler.ts');
  assert(handler !== undefined, 'handler.ts is present');
  for (
    const required of [
      'may remain accepted',
      'until it expires',
      'not implemented',
      'auth.sessions',
      '§12.10',
    ]
  ) {
    assert(handler.raw.includes(required), `the handler's boundary note must state "${required}"`);
  }
});

Deno.test('nothing in the function claims NoorLife is production-ready or private', () => {
  /**
   * §H.4: "NoorLife must not claim zero retention", and §12.3 makes the privacy copy a release blocker coupled
   * to `PRE_RELEASE_BACKLOG.md` §3.1–3.4, all still open. §13 ends with "No claim that NoorLife is
   * production-ready. It is not."
   */
  for (
    const pattern of [/production[- ]ready/i, /zero (data )?retention/i, /fully (secure|private)/i]
  ) {
    assertEquals(
      SCANNABLE.filter((file) => pattern.test(file.raw)).map((file) => file.name),
      [],
      String(pattern),
    );
  }
});

Deno.test('no in-memory counter is presented as rate limiting', () => {
  /**
   * §12.7 and §I.1: an in-memory counter in an ephemeral isolate "is not a rate limit". The production limiter
   * holds no state at all, which is what makes its `unavailable` answer honest — so the scan is for state, in
   * the file that would hold it.
   */
  const production = PRODUCTION.find((file) => file.name === 'production.ts');
  assert(production !== undefined, 'production.ts is present');
  assertEquals(
    /new Map\(|new Set\(|\blet\s+\w*(count|counter|hits|window)/i.test(production.code),
    false,
    'no counter',
  );
});
