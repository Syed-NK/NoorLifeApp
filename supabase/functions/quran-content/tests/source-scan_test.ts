import { AUDIO_BASE_URL, AUDIO_HOST_ALLOWLIST } from '../contract.ts';
import { assert, assertEquals } from './assert.ts';

/**
 * The source scans — every claim about this function that is the *absence* of something.
 *
 * ── Why a scan rather than a behavioural test ────────────────────────────────
 * A behavioural test can only prove a path it thought to exercise. "No file reads a Quran Foundation
 * secret outside the entry point" is not provable by pressing buttons — it is provable by reading
 * every file and finding no read of one. The same instrument the repository already uses for
 * `auth-callback-source-scan_test.ts`, `privacy-security-source-scan_test.ts` and the `noor-ai`
 * function, applied to the things a vendor-credential proxy could smuggle.
 *
 * Every scan below runs against **executable text only**: comments are stripped first, so a comment
 * explaining why a value must never appear is not what makes the scan fail. That distinction matters
 * here more than usual, because these files document their own prohibitions at length.
 */

const FUNCTION_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FUNCTIONS_ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

type SourceFile = {
  readonly name: string;
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
    files.push({ name, raw, code: stripComments(raw), isTest: name.startsWith('tests/') });
  }
  return files;
}

const ALL = collect(FUNCTION_ROOT);

/**
 * The three scopes, and why the scans do not all use the same one.
 *
 * `PRODUCTION` is the modules that are deployed and executed. A capability scan — no second network
 * call site, no second vendor host, no environment read outside the entry point — belongs here,
 * because it is a statement about what the deployed function *can do*.
 *
 * `ALL` is used where a test file is as dangerous as a production file: anything shaped like a real
 * credential. A secret pasted into a fixture is committed key material regardless of the directory it
 * landed in.
 *
 * `SCANNABLE` excludes this file from the phrase scans, for the obvious reason: the file that
 * enumerates forbidden strings necessarily contains every forbidden string.
 */
const PRODUCTION = ALL.filter((file) => !file.isTest);
const SCANNABLE = ALL.filter((file) => file.name !== 'tests/source-scan_test.ts');

/**
 * The two deliberate exceptions, named once.
 *
 * Exactly two modules may reach Quran Foundation: the one that exchanges the credential for a token,
 * and the one that reads content with it. Every affected scan below is an **exact-equality**
 * assertion naming them, which is strictly stronger than an absolute: a third file gaining vendor
 * reach fails, and so does either of these two losing it.
 */
const TOKEN_STORE = 'token-store.ts';
const CONTENT_CLIENT = 'quran-foundation-client.ts';

function offenders(pattern: RegExp, files: readonly SourceFile[]): readonly string[] {
  return files.filter((file) => pattern.test(file.code)).map((file) => file.name);
}

Deno.test('the scan is actually reading the function', () => {
  // A scan over an empty file list passes every assertion below and proves nothing. This is the guard.
  assert(PRODUCTION.length >= 9, `production files: ${PRODUCTION.map((f) => f.name).join(', ')}`);
  assert(ALL.length > PRODUCTION.length, 'and test files were found too');
  for (
    const required of [
      'index.ts',
      'handler.ts',
      'production.ts',
      'ports.ts',
      'contract.ts',
      'request-schema.ts',
      'normalize.ts',
      TOKEN_STORE,
      CONTENT_CLIENT,
    ]
  ) {
    assert(PRODUCTION.some((file) => file.name === required), `${required} is in the scan`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// No credential, anywhere, in any shape
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('no file contains anything shaped like a committed credential', () => {
  /**
   * The scan is on *shapes*, not on a known value, because the value is precisely what must not exist
   * to compare against. `QF_CLIENT_ID` and `QF_CLIENT_SECRET` are set with `supabase secrets set` and
   * exist in no file, no fixture, no `.env` and no snapshot.
   */
  assertEquals(offenders(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, ALL), [], 'no embedded JWT');
  assertEquals(offenders(/sb_secret_[A-Za-z0-9]{20,}/, ALL), [], 'no Supabase secret key');
  assertEquals(offenders(/sk-[A-Za-z0-9_-]{16,}/, ALL), [], 'no provider-shaped key');
  assertEquals(offenders(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, ALL), [], 'no private key block');
  /**
   * A Basic credential, pre-encoded. `Basic ` followed by a long base64 run is what a pasted
   * `base64(id:secret)` looks like, and it would be invisible to every pattern above.
   */
  assertEquals(
    offenders(/Basic [A-Za-z0-9+/]{24,}={0,2}/, ALL),
    [],
    'no pre-encoded Basic credential',
  );
  /**
   * And no long opaque literal that could be half a credential. The two synthetic values the tests
   * use are named for what they are and are well under this length.
   */
  assertEquals(
    offenders(
      /['"`](?=[A-Za-z0-9_-]{40,}['"`])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{40,}['"`]/,
      ALL,
    ),
    [],
    'no 40-character opaque literal anywhere, tests included',
  );
});

Deno.test('every environment read is named, and both secrets are read in one place', () => {
  const reads = PRODUCTION.flatMap((file) =>
    [...file.code.matchAll(/Deno\.env\.get\(\s*'([^']+)'/g)].map((match) => match[1])
  );
  assertEquals(
    [...new Set(reads)].sort(),
    ['QF_CLIENT_ID', 'QF_CLIENT_SECRET', 'SUPABASE_JWKS', 'SUPABASE_URL'],
    'exactly four environment reads, of which exactly two are secrets',
  );

  /**
   * Each is read at the entry point and handed straight on. No handler, verifier, normaliser or
   * response module can see either, which is what makes "it cannot reach a log line or a response
   * body" structural rather than careful.
   */
  for (const secret of ['QF_CLIENT_ID', 'QF_CLIENT_SECRET']) {
    const readers = PRODUCTION.filter((file) =>
      new RegExp(`Deno\\.env\\.get\\(\\s*'${secret}'`).test(file.code)
    );
    assertEquals(readers.map((file) => file.name), ['index.ts'], `${secret}: entry point only`);
    assertEquals(offenders(new RegExp(secret), PRODUCTION), ['index.ts'], `${secret}: named once`);
  }

  // And nothing reads a variable that could retarget either vendor host.
  assertEquals(
    offenders(/QF_API_URL|QF_BASE_URL|QF_OAUTH_URL|QURAN_API_|PRELIVE|prelive/, SCANNABLE),
    [],
    'no configuration that could point this function at a different host',
  );
});

Deno.test('the token store is the only module that touches the client secret', () => {
  const store = PRODUCTION.find((file) => file.name === TOKEN_STORE);
  assert(store !== undefined, 'the token store is in the scan');

  // Written to exactly one place: the Basic Authorization header of the token exchange.
  const interpolations = [...store.code.matchAll(/\$\{credential\}/g)];
  assertEquals(interpolations.length, 1, 'the credential is interpolated in exactly one place');
  assertEquals(
    /Basic \$\{credential\}/.test(store.code),
    true,
    'and that place is the Basic header',
  );

  assertEquals(
    /console\s*\.\s*[a-z]+\s*\(|throw new/.test(store.code),
    false,
    'the module that holds the secret cannot log or throw a message of its own',
  );
  /**
   * The secret's *name* reaches exactly three modules: the entry point that reads it, the graph that
   * passes it on, and the two adapters — the content client, which only forwards it, and the token
   * store, which is the one place it is written to anything. An exact-equality assertion catches a
   * fourth module gaining it as surely as it catches the token store losing it.
   */
  assertEquals(
    [...offenders(/[Cc]lientSecret/, PRODUCTION)].sort(),
    ['index.ts', 'production.ts', CONTENT_CLIENT, TOKEN_STORE].sort(),
    'the secret is named in exactly four modules, and the entry point and graph only pass it on',
  );
  // The content client receives it and passes it on; it must never write it anywhere.
  const client = PRODUCTION.find((file) => file.name === CONTENT_CLIENT);
  assert(client !== undefined, 'the content client is in the scan');
  assertEquals(
    /\$\{clientSecret\}|headers[^\n]*clientSecret/.test(client.code),
    false,
    'the content client never puts the secret on the wire',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor reach: two modules, two hosts, no third
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('exactly two modules can reach the network, and they name exactly two hosts', () => {
  /**
   * `\bfetch\b` rather than `fetch\s*\(`: both adapters alias the function so a test can drive them
   * without a network, and a call-shaped pattern would quietly pass over a module built to make HTTP
   * requests. Matching the identifier catches the capability however it is spelled.
   */
  assertEquals(
    [...offenders(/\bfetch\b/, PRODUCTION)].sort(),
    [CONTENT_CLIENT, TOKEN_STORE].sort(),
    'exactly two production files reference fetch',
  );
  assertEquals(
    offenders(
      /XMLHttpRequest|WebSocket|EventSource|Deno\.(connect|connectTls|createHttpClient)/,
      SCANNABLE,
    ),
    [],
    'and no other transport exists, in production or in a test',
  );
  assertEquals(offenders(/\bimport\s*\(/, PRODUCTION), [], 'no dynamic import');

  const urls = PRODUCTION.flatMap((file) =>
    [...file.code.matchAll(/https?:\/\/[^'"`\s]*/g)].map((match) => match[0])
  );
  /**
   * Three URL literals now, and the third is a different kind of thing.
   *
   * The first two are hosts this function **calls**: the content API and the OAuth server, named in
   * the only two modules that reference `fetch` — which is what the assertion above pins.
   *
   * `AUDIO_BASE_URL` is not called by anything here. It is the fixed base that a *relative* audio
   * path from an upstream response is resolved against before being handed to the client, and it
   * lives in `contract.ts`, a module with no transport in it at all. Its being a literal in this
   * repository is the security property rather than a hole in one: resolving against a constant is
   * what stops a relative path escaping the allow-list, and resolving against anything taken from
   * the response would be the vulnerability.
   *
   * The `fetch` assertion above is what keeps this distinction honest — a module that both named a
   * host and could reach the network would fail there first.
   */
  assertEquals(
    [...new Set(urls)].sort(),
    [
      'https://apis.quran.foundation',
      'https://oauth2.quran.foundation',
      'https://verses.quran.foundation/',
    ],
    'two hosts this function calls, and one base it resolves relative audio paths against',
  );
  assertEquals(
    AUDIO_HOST_ALLOWLIST.includes(new URL(AUDIO_BASE_URL).hostname),
    true,
    'the audio base is itself on the allow-list, so a resolved relative path always passes',
  );
  assertEquals(
    offenders(/http:\/\//, SCANNABLE),
    [],
    'and nothing plaintext, in production or in a test',
  );
  assertEquals(offenders(/Deno\.serve/, PRODUCTION), ['index.ts'], 'one inbound listener');
});

Deno.test('neither host is configurable, and neither adapter reads the environment', () => {
  for (const name of [TOKEN_STORE, CONTENT_CLIENT]) {
    const file = PRODUCTION.find((entry) => entry.name === name);
    assert(file !== undefined, `${name} is in the scan`);
    assertEquals(/Deno\.env/.test(file.code), false, `${name} reads no environment variable`);
    assertEquals(
      /baseUrl|baseURL|origin\s*[:=]\s*(config|options|environment)/.test(file.code),
      false,
      `${name} has no configurable origin of any spelling`,
    );
    // A redirect would replay the credential to a host the vendor chose.
    assertEquals(/redirect:\s*'error'/.test(file.code), true, `${name} refuses redirects`);
  }

  const store = PRODUCTION.find((file) => file.name === TOKEN_STORE);
  const client = PRODUCTION.find((file) => file.name === CONTENT_CLIENT);
  assert(store !== undefined && client !== undefined, 'both adapters are in the scan');
  assertEquals(
    /QF_OAUTH_ORIGIN = 'https:\/\/oauth2\.quran\.foundation'/.test(store.code),
    true,
    'the OAuth origin is a fixed HTTPS literal',
  );
  assertEquals(
    /QF_API_ORIGIN = 'https:\/\/apis\.quran\.foundation'/.test(client.code),
    true,
    'the API origin is a fixed HTTPS literal',
  );
});

Deno.test('the approved scope is the only scope, and unapproved APIs are unreachable', () => {
  /**
   * Quran Foundation approved **Content API access only** on 2026-08-10. Search, the OAuth user APIs
   * and every user-feature endpoint remain unapproved, and this asserts that none of them is named in
   * executable code anywhere in the function.
   */
  const store = PRODUCTION.find((file) => file.name === TOKEN_STORE);
  assert(store !== undefined, 'the token store is in the scan');
  assertEquals(/QF_SCOPE = 'content'/.test(store.code), true, 'the requested scope is content');
  assertEquals(
    /scope=\$\{QF_SCOPE\}/.test(store.code),
    true,
    'and the request body takes it from that constant rather than restating it',
  );
  assertEquals(
    offenders(/scope=user|'user'|\bopenid\b|\boffline_access\b/, PRODUCTION),
    [],
    'no user or OIDC scope is requested',
  );

  assertEquals(
    offenders(
      /\/search|search_apis|\/bookmarks|\/notes|reading_sessions|\/collections|quran-reflect/,
      PRODUCTION,
    ),
    [],
    'no unapproved route is named in executable code',
  );
  assertEquals(
    offenders(/resources\/sync|resources\/snapshots|content-sync/, PRODUCTION),
    [],
    'and no Content Sync route, which exists to maintain a long-lived local copy',
  );
});

Deno.test('there is no refresh-token path, because a client-credentials flow has none', () => {
  assertEquals(offenders(/refresh_token|refreshToken/, PRODUCTION), [], 'none');
  const store = PRODUCTION.find((file) => file.name === TOKEN_STORE);
  assert(store !== undefined, 'the token store is in the scan');
  assertEquals(
    [...new Set([...store.code.matchAll(/grant_type=([a-z_]+)/g)].map((match) => match[1]))],
    ['client_credentials'],
    'exactly one grant type is ever requested',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// No arbitrary proxying
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('the validated query has no field a path, host or URL could occupy', () => {
  /**
   * The structural half of "this is not an arbitrary upstream proxy". Every member of `QuranQuery` is
   * an operation name plus integers, so a request that names an address is not something the handler
   * refuses — it is something the type system cannot express.
   */
  const ports = PRODUCTION.find((file) => file.name === 'ports.ts');
  assert(ports !== undefined, 'ports.ts is in the scan');
  const union = /export type QuranQuery =([\s\S]*?)\n\n/.exec(ports.code)?.[1] ?? '';
  assert(union.includes('list_recitation_resources'), 'the whole union was captured');

  for (
    const forbidden of ['path', 'url', 'host', 'origin', 'endpoint', 'query:', 'params', 'headers']
  ) {
    assertEquals(union.includes(forbidden), false, `QuranQuery has no ${forbidden} field`);
  }
  // Every declared field is a number, a nullable number, or the operation literal.
  const fields = [...union.matchAll(/readonly ([a-zA-Z]+):\s*([^;\n}]+)/g)]
    .filter((match) => match[1] !== 'operation')
    .map((match) => (match[2] ?? '').trim());
  assert(fields.length > 0, 'fields were found');
  for (const type of fields) {
    assertEquals(
      type === 'number' || type === 'number | null',
      true,
      `every non-operation field is numeric, found: ${type}`,
    );
  }
});

Deno.test('paths are built in exactly one function, from literals and integers', () => {
  const client = PRODUCTION.find((file) => file.name === CONTENT_CLIENT);
  assert(client !== undefined, 'the content client is in the scan');

  const table =
    /export function routeFor\(query: QuranQuery\): Route \{([\s\S]*?)\n\}/.exec(client.code)
      ?.[1] ??
      '';
  assert(table.length > 0, 'the route table was found');

  /**
   * Every interpolation inside a path template is a bounded integer from the validated query. A
   * string interpolation here would be the hole the whole allow-list exists to close.
   */
  const interpolations = [...table.matchAll(/path: `[^`]*`/g)].flatMap((match) =>
    [...(match[0] ?? '').matchAll(/\$\{([^}]+)\}/g)].map((inner) => (inner[1] ?? '').trim())
  );
  assertEquals(
    [...new Set(interpolations)].sort(),
    ['query.ayah', 'query.recitationId', 'query.surah', 'query.translationId'],
    'only validated integers are interpolated into a path',
  );

  /**
   * Two other production modules construct a URL, and both do it to *refuse* one.
   *
   * `handler.ts` checks its own request path. `normalize.ts` parses the audio URLs an upstream
   * returned, so it can drop anything that is not `https:` on an allow-listed host — parsing is the
   * only way to answer that question, and a substring check on a URL is how host validation gets
   * bypassed. Neither module can *reach* a URL: the `fetch` assertion earlier in this file pins
   * network capability to exactly two other files.
   */
  assertEquals(
    offenders(
      /new URL\(|URLSearchParams/,
      PRODUCTION.filter((file) => file.name !== CONTENT_CLIENT),
    ),
    ['handler.ts', 'normalize.ts'],
    'only the client, the handler’s path check, and the audio URL validator construct a URL',
  );
});

Deno.test('the request schema names no identity, credential or address field', () => {
  const contract = PRODUCTION.find((file) => file.name === 'contract.ts');
  const schema = PRODUCTION.find((file) => file.name === 'request-schema.ts');
  assert(
    contract !== undefined && schema !== undefined,
    'the contract and the request schema are in the scan',
  );

  const accepted =
    /export const ACCEPTED_REQUEST_FIELDS = \[([\s\S]*?)\]/.exec(contract.code)?.[1] ?? '';
  const fields = [...accepted.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  assertEquals(fields, [
    'contract_version',
    'operation',
    'page',
    'per_page',
    'recitation_id',
    'surah',
    'translation_id',
    'verse',
  ], 'the whole accepted schema, by exact name');

  for (
    const forbidden of [
      'user_id',
      'subject_id',
      'session_id',
      'sub',
      'access_token',
      'authorization',
      'apikey',
      'api_key',
      'client_id',
      'client_secret',
      'url',
      'path',
      'host',
      'endpoint',
    ]
  ) {
    assertEquals(
      new RegExp(`'${forbidden}'`).test(`${contract.code}\n${schema.code}`),
      false,
      `${forbidden} is not an accepted request field, so a client cannot supply one`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Qur'an content integrity
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('nothing in the function normalises, transliterates or generates scripture', () => {
  /**
   * The structural half of the immutability rule. `normalize_test.ts` proves byte preservation for
   * the fixtures it drives; this proves there is no code that *could* alter a verse on any path.
   */
  assertEquals(
    offenders(/\.normalize\s*\(/, PRODUCTION),
    [],
    'no Unicode normalisation anywhere in production',
  );
  assertEquals(
    offenders(/transliterat/i, PRODUCTION),
    [],
    'no transliteration is produced or requested',
  );
  assertEquals(
    offenders(/translate\s*\(|machineTranslat|autoTranslat/i, SCANNABLE),
    [],
    'nothing machine-translates anything',
  );

  /**
   * The scripture field is bound once, by copy, and travels by shorthand.
   *
   * `const arabic = verse.text_uthmani` and then `{ ..., arabic }` is the whole of it: there is no
   * expression between the vendor's string and the response, so a transformation would have to be
   * added as a visible new statement. The assertion pins both halves — the copy is present, and no
   * string method is ever applied to the binding.
   */
  const normalizer = PRODUCTION.find((file) => file.name === 'normalize.ts');
  assert(normalizer !== undefined, 'normalize.ts is in the scan');
  assertEquals(
    /const arabic = verse\.text_uthmani;/.test(normalizer.code),
    true,
    'the Arabic is bound by a bare copy of the vendor field',
  );
  assertEquals(
    /\barabic\s*[:,]\s*[^,\n}]*[.(]/.test(normalizer.code),
    false,
    'and nothing is computed on the way into the payload',
  );
  assertEquals(
    /\barabic\s*\.\s*(replace|trim|normalize|slice|substring|toLowerCase|toUpperCase|split|padStart|padEnd|concat|repeat)/
      .test(normalizer.code),
    false,
    'no transforming string method is ever applied to scripture',
  );

  /**
   * The markup stripper exists and is applied to translations only. Naming the call sites by exact
   * count is what stops it from ever being pointed at a verse.
   */
  const strippedFields = [...normalizer.code.matchAll(/stripTranslationMarkup\((\w+)\)/g)].map(
    (match) => match[1],
  );
  assertEquals(
    [...new Set(strippedFields)],
    ['rawText'],
    'markup removal is applied to translation text and to nothing else',
  );
});

Deno.test('no fixture, sample or fallback scripture exists in this function', () => {
  /**
   * The rule that stops a proxy shipping invented verses. A fallback source of scripture in the
   * production graph is one misconfigured deployment away from a user reading it and believing it.
   */
  assertEquals(
    offenders(
      /\b(createFake|fakeUpstream|mockUpstream|stubUpstream|SAMPLE_|FIXTURE_|FALLBACK_)\b/,
      PRODUCTION,
    ),
    [],
    'no fake or fixture is defined in production',
  );
  const importingFakes = PRODUCTION.filter((file) =>
    /from\s+['"][^'"]*(tests?\/|fakes|mocks?)/.test(file.code)
  );
  assertEquals(importingFakes.map((file) => file.name), [], 'no production file imports test code');

  // No Arabic literal in production at all: every verse this function serves came from the vendor.
  const withArabic = PRODUCTION.filter((file) => /[؀-ۿ]/.test(file.code));
  assertEquals(withArabic.map((file) => file.name), [], 'no Arabic text is embedded in production');

  assertEquals(
    offenders(/USE_FAKE|FAKE_UPSTREAM|MOCK_QURAN|QURAN_SOURCE|CONTENT_MODE/, SCANNABLE),
    [],
    'and no flag that could select a different content source',
  );
});

Deno.test('nothing persists Qur’an content beyond the response', () => {
  /**
   * The developer terms forbid caching QF content longer than a week and forbid extracting, scraping
   * or indexing it outside the API responses. This function keeps no copy at all — the client's
   * bounded, expiring cache is the only one — so there is no store here to outlive anything.
   */
  assertEquals(
    offenders(
      /Deno\.openKv|Deno\.writeTextFile|Deno\.writeFile|localStorage|sessionStorage/,
      SCANNABLE,
    ),
    [],
    'no persistence of any kind',
  );
  assertEquals(
    offenders(/@supabase\/supabase-js|createClient\s*\(|\bfrom\s*\(\s*['"]/, SCANNABLE),
    [],
    'no database client and no query builder',
  );
  /**
   * Scoped to production: `jwt-parity_test.ts` names `service_role` on purpose, because the check it
   * pins is that a correctly signed token bearing that role is *refused*, and a test asserting the
   * refusal necessarily names it.
   */
  assertEquals(
    offenders(/service_role|serviceRole|SERVICE_ROLE/, PRODUCTION),
    [],
    'no elevated role',
  );

  /**
   * Exactly one keyed store exists, and it is the translation catalogue.
   *
   * ── Narrowed from an absolute, and why that is still a real guard ───────────
   * This asserted that **no** module held a `Map` or a `Set`, on the reasoning that a content cache
   * could not then be added unnoticed. Attribution made one necessary: Quran Foundation marks
   * per-entry `resource_name` optional and omits it live, so the only way to credit a translator
   * without inventing one is to look the edition up in `/resources/translations` — and looking it up
   * per request would be a vendor call per page.
   *
   * The exact-equality form keeps the property that mattered. A second module gaining a keyed store
   * fails, and so does this one losing it, so "the only thing cached here is a catalogue of edition
   * names" stays a fact a reviewer can check rather than a claim in a comment. The assertions below
   * pin *what* it may contain.
   */
  assertEquals(
    // `<...>` is optional in the pattern because a type argument would otherwise slip the scan.
    [...offenders(/\bnew (?:Map|Set|WeakMap|WeakSet)\s*(?:<[^>]*>)?\s*\(/, PRODUCTION)].sort(),
    [CONTENT_CLIENT],
    'the only keyed store in the function is the client’s catalogue cache',
  );

  /**
   * And the catalogue holds names, never content.
   *
   * The developer terms forbid retaining QF **content** beyond the caching window; an edition's title
   * and its translator's name are catalogue metadata, which is what `/resources/translations` exists
   * to publish. This asserts the cached shape cannot hold a verse: nothing on the path that fills it
   * touches `text`, `text_uthmani` or a translation body.
   */
  const client = PRODUCTION.find((file) => file.name === CONTENT_CLIENT);
  assert(client !== undefined, 'the content client is in the scan');
  const catalogueReader = /function readCatalogue\([\s\S]*?\n}/.exec(client.code)?.[0] ?? '';
  assert(catalogueReader.length > 0, 'the catalogue reader was found');
  for (const forbidden of ['text_uthmani', 'text', 'verse', 'translations[0]', 'arabic']) {
    assertEquals(
      new RegExp(`\\b${forbidden.replace(/[[\]]/g, '\\$&')}\\b`).test(
        catalogueReader.replace('translations', ''),
      ),
      false,
      `the catalogue cache cannot hold ${forbidden}`,
    );
  }
  assertEquals(
    [...offenders(/\blet\s+cached\b/, PRODUCTION)].sort(),
    [TOKEN_STORE],
    'the only cached value in the whole function is the access token',
  );
});

Deno.test('the one-week ceiling is enforced at the point a response declares its age', () => {
  const responses = PRODUCTION.find((file) => file.name === 'responses.ts');
  const contract = PRODUCTION.find((file) => file.name === 'contract.ts');
  assert(
    responses !== undefined && contract !== undefined,
    'responses.ts and contract.ts are in the scan',
  );

  assertEquals(
    /Math\.min\(declared, MAX_CACHE_AGE_MS\)/.test(responses.code),
    true,
    'the declared age is clamped rather than trusted',
  );
  assertEquals(
    /MAX_CACHE_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000/.test(contract.code),
    true,
    'and the ceiling is one week, as a literal a reviewer can read',
  );
  assertEquals(
    /MAX_CACHE_AGE_MS[^\n]*Deno\.env/.test(contract.code),
    false,
    'it is not read from the environment',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('there is exactly one console call in the production source', () => {
  const withConsole = PRODUCTION.filter((file) => /console\s*\.\s*[a-z]+\s*\(/.test(file.code));
  assertEquals(withConsole.map((file) => file.name), ['production.ts'], 'only the logger logs');

  const calls = [...(withConsole[0]?.code ?? '').matchAll(/console\s*\.\s*[a-z]+\s*\(/g)];
  assertEquals(calls.length, 1, 'and it does so once');
});

Deno.test('no log call can carry a credential, a token, a URL or a verse', () => {
  const logger = PRODUCTION.find((file) => file.name === 'production.ts');
  assert(logger !== undefined, 'production.ts is in the scan');
  const call = /console\s*\.\s*[a-z]+\s*\(([\s\S]*?)\n\s{4}\);/.exec(logger.code)?.[1] ??
    logger.code;

  for (
    const forbidden of [
      'token',
      'accessToken',
      'clientId',
      'clientSecret',
      'authorization',
      'headers',
      'body',
      'url',
      'arabic',
      'text',
      'verse',
      'surah',
      'userId',
      'sessionId',
      'claims',
    ]
  ) {
    assertEquals(
      new RegExp(`\\b${forbidden}\\b`).test(call),
      false,
      `the log call must not reference ${forbidden}`,
    );
  }
  // `token_renewed` is a boolean about NoorLife's own behaviour and is not a token.
  assert(/token_renewed/.test(logger.code), 'the renewal flag is logged');
});

Deno.test('the modules that touch a credential or a verse log nothing at all', () => {
  for (
    const name of [
      TOKEN_STORE,
      CONTENT_CLIENT,
      'normalize.ts',
      'request-schema.ts',
      'responses.ts',
      'handler.ts',
      'jwt-verifier.ts',
      'claims.ts',
    ]
  ) {
    const file = PRODUCTION.find((candidate) => candidate.name === name);
    assert(file !== undefined, `${name} is present`);
    assertEquals(/console\s*\.\s*[a-z]+\s*\(/.test(file.code), false, `${name} logs nothing`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The boundaries this function must not cross into the app
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('the mobile bundle names no vendor host, credential or direct request', () => {
  /**
   * The complement of every scan above, read from the other side of the boundary. It is asserted in
   * the Jest suite too — which is the one a developer runs by habit — and here as well, so a leak is
   * caught even if only one of the two suites is run that day.
   */
  const forbidden =
    /quran\.foundation|QF_CLIENT_ID|QF_CLIENT_SECRET|x-auth-token|oauth2\/token|client_credentials/;
  const offending: string[] = [];

  /**
   * ── What "shipped" excludes, and why `test-support` had to be added to it ───
   * `__tests__` was always skipped: a suite asserting that an allow-listed audio host is accepted
   * has to name that host, and a scan that forbade it would forbid testing the allow-list at all.
   *
   * `src/test-support/` is the same category in a different place. `faith-reader.tsx` there is the
   * Qur'an reader's shared harness and carries two `verses.quran.foundation` recitation URLs, because
   * the fixture has to be a URL the audio host allow-list actually accepts — a fixture on some other
   * host would exercise the rejection path instead of the one under test.
   *
   * ── Why skipping it is not a hole ───────────────────────────────────────────
   * Because the thing that makes it safe is asserted rather than assumed, immediately below: nothing
   * under `src/app` or `src/features` imports `test-support`, so Metro cannot reach it from any
   * bundle root and none of it is in the shipped bundle. The exclusion is only ever as wide as that
   * property, and the moment a production module imports the harness this test fails — which is the
   * behaviour a bare skip would have lost.
   *
   * Note also what the hostname is: a public audio host the *device* is designed to fetch directly,
   * on the one operation whose response carries a URL. It is not a credential and it is not a secret.
   * The credentials — `QF_CLIENT_ID`, `QF_CLIENT_SECRET` — remain forbidden everywhere in `src`,
   * including here, because nothing in the app has any business naming them.
   */
  const notShipped = new Set(['__tests__', 'node_modules', 'test-support']);

  const walk = (directory: string): void => {
    for (const entry of Deno.readDirSync(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        if (notShipped.has(entry.name)) {
          continue;
        }
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }
      if (forbidden.test(stripComments(Deno.readTextFileSync(path)))) {
        offending.push(path.slice(REPO_ROOT.length));
      }
    }
  };
  walk(`${REPO_ROOT}src`);

  assertEquals(offending, [], 'no shipped app module names the vendor or its credentials');

  /**
   * The property the `test-support` exclusion above rests on.
   *
   * Asserted here, in the same test, so the two cannot drift apart: a future import of the harness
   * from a production module would put its vendor URLs into the bundle, and the skip would have made
   * that invisible. This is what keeps the skip honest.
   */
  const reachesTestSupport: string[] = [];
  const walkProduction = (directory: string): void => {
    for (const entry of Deno.readDirSync(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') {
          continue;
        }
        walkProduction(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }
      const code = stripComments(Deno.readTextFileSync(path));
      if (/from\s+['"][^'"]*test-support|require\(\s*['"][^'"]*test-support/.test(code)) {
        reachesTestSupport.push(path.slice(REPO_ROOT.length));
      }
    }
  };
  walkProduction(`${REPO_ROOT}src/app`);
  walkProduction(`${REPO_ROOT}src/features`);

  assertEquals(reachesTestSupport, [], 'no production module imports the test-only harnesses');
});

Deno.test('the function is declared with verify_jwt in version control', () => {
  /**
   * A public `quran-content` would be NoorLife's approved Quran Foundation credential proxied for the
   * open internet. The declaration is asserted here rather than trusted to the dashboard default,
   * because a default is something somebody can change without a diff.
   */
  const config = Deno.readTextFileSync(`${REPO_ROOT}supabase/config.toml`);
  const header = '[functions.quran-content]';
  const start = config.indexOf(header);
  assert(start >= 0, 'the function is declared in config.toml');
  // Everything from the header to the next table, so a `verify_jwt` belonging to another function
  // cannot satisfy this assertion.
  const declaration = config.slice(start + header.length).split('\n[')[0] ?? '';
  assertEquals(/verify_jwt = true/.test(declaration), true, 'and JWT verification is on');
  assertEquals(/enabled = true/.test(declaration), true, 'and the function is enabled');
  assertEquals(/verify_jwt = false/.test(config), false, 'no function in this project disables it');
});

Deno.test('this function is registered in the Deno test and check tasks', () => {
  // A suite nobody runs is a suite that passes. This asserts the wiring rather than assuming it.
  const config = Deno.readTextFileSync(`${FUNCTIONS_ROOT}deno.json`);
  assert(config.includes('quran-content/tests'), 'the tests are included');
  assert(config.includes('quran-content/index.ts'), 'the entry point is type-checked');
});
