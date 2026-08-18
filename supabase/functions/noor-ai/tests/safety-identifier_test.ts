import {
  createSafetyIdentifierDeriver,
  isActiveSafetyIdentifier,
  SAFETY_IDENTIFIER_ACTIVE_VERSION,
  SAFETY_IDENTIFIER_DIGEST_CHARS,
  SAFETY_IDENTIFIER_DOMAIN,
  SAFETY_IDENTIFIER_KEY_BYTES,
  SAFETY_IDENTIFIER_PATTERN,
  SAFETY_IDENTIFIER_SECRET_NAME,
  safetyIdentifierPrefix,
} from '../safety-identifier.ts';
import { assert, assertEquals } from './assert.ts';
import { fixtureKey, fixtureKeyBytes, randomFixtureKey, TEST_USER_ID } from './fakes.ts';

/**
 * B10 — the per-user safety-identifier derivation, at the unit level.
 *
 * ── What is under test, and what is deliberately not printed ─────────────────
 * Every assertion below is about a *property* of the construction: determinism, separation, format,
 * and the exact set of stored key representations that are refused. **Nothing here prints a fixture
 * key, decoded key bytes, an HMAC message containing a uuid, a derived identifier, or a raw user
 * uuid.** Where a value has to be compared, it is compared with a boolean and a message that names the
 * property rather than the value — an assertion that prints its operand on failure is an assertion
 * that puts that operand in CI output.
 *
 * **No real key exists.** No secret was generated for production, none is provisioned, and none is
 * read here: every key in this file is built in test memory from a small numeric formula or from Web
 * Crypto, lives for the lifetime of one test process, and is never written anywhere.
 *
 * ── Official authority ───────────────────────────────────────────────────────
 * `https://developers.openai.com/api/docs/guides/safety-best-practices`, retrieved 2026-08-09, states
 * that safety identifiers "are recommended for products where individual users interact with a model,
 * but they are not required", that one "should be a string that uniquely identifies each user", and
 * that a developer should "[h]ash the username or email address in order to avoid sending us any
 * identifying information". The keyed construction, the uuid input, the prefix and the rotation design
 * are **NoorLife decisions**, and nothing below should be read as an OpenAI requirement.
 */

const KEY = fixtureKey(1);
const OTHER_KEY = fixtureKey(2);
const V1 = SAFETY_IDENTIFIER_ACTIVE_VERSION;

function deriver(secret: string | undefined, version: string = V1) {
  return createSafetyIdentifierDeriver({ version, secret });
}

async function derive(
  secret: string | undefined,
  subject: string = TEST_USER_ID,
  version: string = V1,
): Promise<string | null> {
  const outcome = await deriver(secret, version).derive(subject);
  return outcome.kind === 'derived' ? outcome.identifier : null;
}

/** Unpadded base64url, written locally so no assertion has to depend on the module under test. */
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * An independent reference implementation of the documented construction.
 *
 * It imports the key itself, encodes the message itself and encodes the digest itself, so a matching
 * result is evidence about the construction rather than about a shared helper. It exists to answer one
 * question — "is the thing being computed the thing that was specified" — and it is also what makes
 * the domain-separation assertion meaningful, because changing the domain here must change the digest.
 */
async function referenceDigest(
  keyBytes: Uint8Array<ArrayBuffer>,
  domain: string,
  version: string,
  subject: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${domain}:${version}\0${subject}`),
  );
  return base64Url(new Uint8Array(signature));
}

/** The digest half of an identifier, without ever naming the identifier in a failure message. */
function digestOf(identifier: string, version: string = V1): string {
  return identifier.slice(safetyIdentifierPrefix(version).length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1–11 — the stored key representation
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('1/2 — a missing or empty secret yields unavailable, and never a fallback identifier', async () => {
  for (const secret of [undefined, '']) {
    const outcome = await deriver(secret).derive(TEST_USER_ID);
    assertEquals(
      outcome,
      { kind: 'unavailable' },
      'no key means no identifier, and no default one',
    );
  }
});

Deno.test('3–9 — every rejected stored representation, each for its own reason', async () => {
  /**
   * The value is never trimmed, never re-alphabeted and never padded on NoorLife's behalf. Each case
   * below is a *different* configuration accident, and all of them fail closed rather than being
   * repaired into something that looks like a working key.
   */
  const thirtyTwo = fixtureKeyBytes(3);
  const canonical = base64Url(thirtyTwo);

  const rejected: readonly { readonly why: string; readonly secret: string }[] = [
    { why: 'leading whitespace', secret: ` ${canonical}` },
    { why: 'trailing whitespace', secret: `${canonical} ` },
    { why: 'a trailing newline', secret: `${canonical}\n` },
    { why: 'internal whitespace', secret: `${canonical.slice(0, 8)} ${canonical.slice(9)}` },
    { why: 'base64 padding', secret: `${canonical}=` },
    { why: 'the standard alphabet (+)', secret: `+${canonical.slice(1)}` },
    { why: 'the standard alphabet (/)', secret: `/${canonical.slice(1)}` },
    { why: 'a character outside base64url', secret: `${canonical.slice(0, 42)}*` },
    { why: 'a prefix in front of the key', secret: `key:${canonical}` },
    { why: 'extra text after the key', secret: `${canonical}extra` },
    { why: 'a 31-byte decoded key', secret: base64Url(fixtureKeyBytes(3, 31)) },
    { why: 'a 33-byte decoded key', secret: base64Url(fixtureKeyBytes(3, 33)) },
    { why: 'an all-zero 32-byte key', secret: base64Url(new Uint8Array(32)) },
    { why: 'a uuid', secret: TEST_USER_ID },
    { why: 'a hex string of the right byte count', secret: 'a'.repeat(64) },
    { why: 'a passphrase', secret: 'correct-horse-battery-staple' },
  ];

  for (const { why, secret } of rejected) {
    const outcome = await deriver(secret).derive(TEST_USER_ID);
    assertEquals(outcome, { kind: 'unavailable' }, `refused: ${why}`);
  }
});

Deno.test('9b — a non-canonical spelling of a valid key is refused, so a secret has one form', async () => {
  /**
   * The last two bits of a 43-character base64url string are dropped when 32 bytes are read back, so
   * more than one string can decode to the same key. Accepting both would mean a secret with two
   * spellings — and a later "is this the configured key" check that could disagree with itself.
   */
  const canonical = fixtureKey(4);
  const last = canonical[canonical.length - 1] ?? '';
  const alternatives = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const swapped = alternatives.split('').find((candidate) => {
    if (candidate === last) {
      return false;
    }
    const encoded = `${canonical.slice(0, -1)}${candidate}`;
    return atob(encoded.replace(/-/g, '+').replace(/_/g, '/')) ===
      atob(canonical.replace(/-/g, '+').replace(/_/g, '/'));
  });
  assert(swapped !== undefined, 'a non-canonical spelling of the same 32 bytes exists');

  const outcome = await deriver(`${canonical.slice(0, -1)}${swapped}`).derive(TEST_USER_ID);
  assertEquals(outcome, { kind: 'unavailable' }, 'only the canonical encoding is a valid key');
});

Deno.test('10 — a valid 32-byte runtime-generated key is accepted', async () => {
  const identifier = await derive(randomFixtureKey());
  assert(identifier !== null, 'a genuinely random 32-byte key derives an identifier');
  assert(SAFETY_IDENTIFIER_PATTERN.test(identifier), 'in the exact public format');
  assertEquals(SAFETY_IDENTIFIER_KEY_BYTES, 32, 'and 32 bytes is the only accepted length');
});

Deno.test('11 — no secret value reaches a thrown error, a console call or a returned value', async () => {
  /**
   * Two halves. First, nothing throws at all: every failure is the `unavailable` member, so there is no
   * message for a value to be interpolated into. Second, the module writes nothing to the console —
   * asserted by capturing every console method for the duration of the calls, rather than by reading
   * the source, because a scan proves what the file says and this proves what it did.
   */
  const captured: string[] = [];
  const originals = { ...console } as Record<string, unknown>;
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    // deno-lint-ignore no-explicit-any
    (console as any)[method] = (...args: unknown[]) => {
      captured.push(args.map((value) => String(value)).join(' '));
    };
  }

  const secret = fixtureKey(5);
  try {
    const outcomes = [
      await deriver(undefined).derive(TEST_USER_ID),
      await deriver(`${secret}=`).derive(TEST_USER_ID),
      await deriver(secret).derive('not-a-uuid'),
      await deriver(secret).derive(TEST_USER_ID),
      await deriver(secret, 'V1').derive(TEST_USER_ID),
    ];
    for (const outcome of outcomes) {
      const serialised = JSON.stringify(outcome);
      assert(!serialised.includes(secret), 'no outcome carries the key');
      assert(!serialised.includes(TEST_USER_ID), 'and none carries the raw subject');
    }
  } finally {
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      // deno-lint-ignore no-explicit-any
      (console as any)[method] = originals[method];
    }
  }

  assertEquals(captured.length, 0, 'the module logs nothing, on any path');
});

// ─────────────────────────────────────────────────────────────────────────────
// 12–25 — the derivation
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('12 — the same subject and key derive the same identifier every time', async () => {
  const first = await derive(KEY);
  const second = await derive(KEY);
  const third = await deriver(KEY).derive(TEST_USER_ID);
  assert(first !== null && second !== null, 'both derivations succeeded');
  assert(first === second, 'two separate derivers agree');
  assert(third.kind === 'derived' && third.identifier === first, 'and a third call agrees too');
});

Deno.test('13 — a different subject derives a different identifier', async () => {
  const mine = await derive(KEY, TEST_USER_ID);
  const theirs = await derive(KEY, '55555555-5555-4555-8555-555555555555');
  assert(mine !== null && theirs !== null, 'both derived');
  assert(mine !== theirs, 'two users are two subjects, which is the whole point of the parameter');
});

Deno.test('14 — a different key derives a different identifier for the same subject', async () => {
  const withKey = await derive(KEY);
  const withOther = await derive(OTHER_KEY);
  assert(withKey !== null && withOther !== null, 'both derived');
  assert(withKey !== withOther, 'the key is load-bearing, not decoration');
});

Deno.test('15 — changing the domain changes the digest, in an independent calculation', async () => {
  /**
   * The domain separation, checked against a reference implementation rather than against the module.
   * If the namespace were not in the signed message, these two would be equal — which is exactly the
   * property that stops this key producing a colliding value for some other purpose.
   */
  const keyBytes = fixtureKeyBytes(1);
  const asSpecified = await referenceDigest(keyBytes, SAFETY_IDENTIFIER_DOMAIN, V1, TEST_USER_ID);
  const otherDomain = await referenceDigest(
    keyBytes,
    'noorlife:some-other-purpose',
    V1,
    TEST_USER_ID,
  );
  assert(asSpecified !== otherDomain, 'a different domain is a different digest');

  const otherVersion = await referenceDigest(
    keyBytes,
    SAFETY_IDENTIFIER_DOMAIN,
    'v2',
    TEST_USER_ID,
  );
  assert(asSpecified !== otherVersion, 'and the version inside the message separates too');
});

Deno.test('16/17/18/19 — the public format is exact: prefix, length, alphabet, no padding', async () => {
  const identifier = await derive(KEY);
  assert(identifier !== null, 'derived');

  assert(identifier.startsWith('nl_osi_v1_'), 'the version-1 prefix, exactly');
  assertEquals(safetyIdentifierPrefix(V1), 'nl_osi_v1_', 'and the helper agrees with the literal');

  const digest = digestOf(identifier);
  assertEquals(digest.length, 43, 'exactly 43 base64url characters');
  assertEquals(SAFETY_IDENTIFIER_DIGEST_CHARS, 43, 'which is the documented digest length');
  assert(/^[A-Za-z0-9_-]+$/.test(digest), 'only the approved alphabet');
  assert(!digest.includes('='), 'no padding');
  assert(!digest.includes('+') && !digest.includes('/'), 'and not the standard alphabet');
  assert(SAFETY_IDENTIFIER_PATTERN.test(identifier), 'the whole value matches the strict pattern');
});

Deno.test('20 — the raw uuid is absent from the output, in every spelling', async () => {
  const identifier = await derive(KEY);
  assert(identifier !== null, 'derived');
  for (
    const spelling of [
      TEST_USER_ID,
      TEST_USER_ID.toUpperCase(),
      TEST_USER_ID.replace(/-/g, ''),
      TEST_USER_ID.slice(0, 8),
    ]
  ) {
    assert(!identifier.includes(spelling), 'no fragment of the subject survives into the output');
  }
});

Deno.test('21 — an email, a phone number or any other arbitrary string is refused as input', async () => {
  const refused: readonly string[] = [
    'user@example.invalid',
    '+441234567890',
    'a-username',
    '',
    '   ',
    `{${TEST_USER_ID}}`,
    ` ${TEST_USER_ID}`,
    `${TEST_USER_ID} `,
    `urn:uuid:${TEST_USER_ID}`,
    TEST_USER_ID.replace(/-/g, ''),
    TEST_USER_ID.slice(0, 35),
    `${TEST_USER_ID}0`,
    '11111111-1111-9111-8111-111111111111',
    '11111111-1111-4111-c111-111111111111',
    'gggggggg-1111-4111-8111-111111111111',
  ];
  for (const value of refused) {
    const outcome = await deriver(KEY).derive(value);
    assertEquals(outcome.kind, 'unavailable', 'only a well-formed verified uuid is an input');
  }
});

Deno.test('22 — the canonical uuid rule: uppercase hexadecimal folds to the same identity', async () => {
  /**
   * `claims.ts` matches `sub` case-insensitively, so an uppercase uuid is a value the existing
   * verified-claims type can legitimately produce. Two spellings of one person must not become two
   * subjects, so the hexadecimal is folded to lowercase before signing — and the canonical form is the
   * lowercase one, which is what RFC 4122 itself emits.
   */
  const lower = await derive(KEY, TEST_USER_ID.toLowerCase());
  const upper = await derive(KEY, TEST_USER_ID.toUpperCase());
  const mixed = await derive(KEY, '11111111-1111-4111-8111-11111111111A');

  assert(lower !== null && upper !== null, 'both spellings derive');
  assert(lower === upper, 'and they are the same identity');
  assert(mixed !== null && mixed !== lower, 'a genuinely different uuid is still a different one');
});

Deno.test('23 — an independent Web Crypto reference vector matches the implementation', async () => {
  const identifier = await derive(KEY);
  assert(identifier !== null, 'derived');
  const expected = await referenceDigest(
    fixtureKeyBytes(1),
    SAFETY_IDENTIFIER_DOMAIN,
    V1,
    TEST_USER_ID.toLowerCase(),
  );
  assert(
    digestOf(identifier) === expected,
    'the digest is HMAC-SHA-256 over the specified message',
  );
});

Deno.test('24 — the key is imported non-extractably, for signing only, as HMAC-SHA-256', async () => {
  /**
   * Asserted by observing the actual call rather than by reading the source. `extractable: false` is
   * what makes "the raw key bytes cannot be recovered from this object" a property the runtime
   * enforces, and `['sign']` is what stops the same handle being used to verify, encrypt or derive.
   */
  const calls: unknown[][] = [];
  const original = SubtleCrypto.prototype.importKey;
  SubtleCrypto.prototype.importKey = function (
    this: SubtleCrypto,
    ...args: unknown[]
  ): Promise<CryptoKey> {
    calls.push(args);
    // deno-lint-ignore no-explicit-any
    return (original as any).apply(this, args);
  } as typeof original;

  try {
    const identifier = await derive(fixtureKey(6));
    assert(identifier !== null, 'the key imported and derived');
  } finally {
    SubtleCrypto.prototype.importKey = original;
  }

  assertEquals(calls.length, 1, 'the key is imported exactly once per deriver');
  const [format, , algorithm, extractable, usages] = calls[0] ?? [];
  assertEquals(format, 'raw', 'raw key bytes');
  assertEquals(algorithm, { name: 'HMAC', hash: 'SHA-256' }, 'HMAC-SHA-256');
  assertEquals(extractable, false, 'non-extractable — the runtime will refuse to export it');
  assertEquals(usages, ['sign'], 'and sign is the only permitted usage');
});

Deno.test('24b — one import serves many derivations, and the returned object exposes only derive', async () => {
  const original = SubtleCrypto.prototype.importKey;
  let imports = 0;
  SubtleCrypto.prototype.importKey = function (
    this: SubtleCrypto,
    ...args: unknown[]
  ): Promise<CryptoKey> {
    imports += 1;
    // deno-lint-ignore no-explicit-any
    return (original as any).apply(this, args);
  } as typeof original;

  let exposed: readonly string[] = [];
  try {
    const built = deriver(fixtureKey(7));
    exposed = Object.keys(built);
    await built.derive(TEST_USER_ID);
    await built.derive('55555555-5555-4555-8555-555555555555');
    await built.derive(TEST_USER_ID);
  } finally {
    SubtleCrypto.prototype.importKey = original;
  }

  assertEquals(imports, 1, 'the import happens once, not per request');
  assertEquals(exposed, ['derive'], 'and no key material is reachable on the object');
});

Deno.test('25 — nothing is persisted, and no derivation influences another', async () => {
  /**
   * There is no map from uuid to identifier and no cache keyed by subject — the value is recomputed
   * every time from the key and the input. Interleaving two subjects and re-asking for the first is
   * the cheapest way to show a stateful shortcut would fail: a cache keyed by anything else, or a
   * mutable "last subject", would return the wrong value on the third call.
   */
  const built = deriver(KEY);
  const a1 = await built.derive(TEST_USER_ID);
  const b1 = await built.derive('55555555-5555-4555-8555-555555555555');
  const a2 = await built.derive(TEST_USER_ID);
  const b2 = await built.derive('55555555-5555-4555-8555-555555555555');

  assert(a1.kind === 'derived' && a2.kind === 'derived', 'both A derivations succeeded');
  assert(b1.kind === 'derived' && b2.kind === 'derived', 'and both B derivations');
  assert(a1.identifier === a2.identifier, 'A is stable across an interleaved B');
  assert(b1.identifier === b2.identifier, 'and B is stable across an interleaved A');
  assert(a1.identifier !== b1.identifier, 'while remaining distinct from one another');

  // And an interleaved failure leaves nothing behind either.
  await built.derive('not-a-uuid');
  const a3 = await built.derive(TEST_USER_ID);
  assert(a3.kind === 'derived' && a3.identifier === a1.identifier, 'a refusal changes no state');
});

// ─────────────────────────────────────────────────────────────────────────────
// 58–62 — versioning and rotation
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('46 — the active version is a source constant, and it is v1', () => {
  assertEquals(SAFETY_IDENTIFIER_ACTIVE_VERSION, 'v1', 'version 1 is the initial active version');
  assertEquals(
    SAFETY_IDENTIFIER_SECRET_NAME,
    `NOOR_AI_SAFETY_HMAC_KEY_${SAFETY_IDENTIFIER_ACTIVE_VERSION.toUpperCase()}`,
    'and the reserved secret name is coupled to it, so a bump cannot forget the key',
  );
  assertEquals(SAFETY_IDENTIFIER_SECRET_NAME, 'NOOR_AI_SAFETY_HMAC_KEY_V1', 'by exact name');
});

Deno.test('46b — the active-version check accepts only the active version, and follows the constant', async () => {
  /**
   * `SAFETY_IDENTIFIER_PATTERN` is a **shape** check: it accepts every version this module could ever
   * produce, `v1` through `v999`. That is correct for what it is and wrong as an outbound gate, because
   * an identifier under an inactive version is one derived with a key nobody has reviewed into service.
   * `isActiveSafetyIdentifier` is the question the provider boundary asks instead, and it reads the
   * source constant rather than a literal.
   */
  const active = await derive(KEY);
  assert(active !== null, 'derived under the active version');
  assert(isActiveSafetyIdentifier(active), 'and the active-version check accepts it');

  const digest = digestOf(active);
  for (const version of ['v2', 'v3', 'v9', 'v10', 'v999']) {
    if (version === SAFETY_IDENTIFIER_ACTIVE_VERSION) {
      continue;
    }
    const candidate = `${safetyIdentifierPrefix(version)}${digest}`;
    assert(
      SAFETY_IDENTIFIER_PATTERN.test(candidate),
      `${version} passes the shape check — which is exactly why the shape check is not the gate`,
    );
    assertEquals(
      isActiveSafetyIdentifier(candidate),
      false,
      `${version} is refused because it is not the active version`,
    );
  }

  // The two checks are genuinely different functions, not one spelled twice.
  assertEquals(
    safetyIdentifierPrefix(SAFETY_IDENTIFIER_ACTIVE_VERSION),
    'nl_osi_v1_',
    'the accepted prefix is the active constant’s own',
  );

  // Non-strings, malformed digests and identity-shaped values are refused here too.
  for (
    const refused of [
      undefined,
      null,
      42,
      '',
      digest,
      `nl_osi_${digest}`,
      `${safetyIdentifierPrefix(SAFETY_IDENTIFIER_ACTIVE_VERSION)}${digest.slice(1)}`,
      `${safetyIdentifierPrefix(SAFETY_IDENTIFIER_ACTIVE_VERSION)}${digest}x`,
      ` ${active}`,
      `${active} `,
      TEST_USER_ID,
    ]
  ) {
    assertEquals(isActiveSafetyIdentifier(refused), false, 'refused by the active-version check');
  }
});

Deno.test('58 — v1 and v2 derive different identifiers for the same user', async () => {
  /**
   * Rotation is a **discontinuity**, and this is the assertion that says so out loud. Because OpenAI
   * accepts one safety identifier per request, changing the key or the version changes every user's
   * identifier at once. NoorLife keeps no uuid-to-old-identifier mapping, sends no second value, and
   * creates no historical table — so provider-side continuity for the old value ends at the rotation.
   *
   * Version 2 is exercised here as a **fixture only**. No v2 secret exists, no v2 secret name is read
   * by any production module, and provisioning one is a separately approved step.
   */
  const sameKeyOtherVersion = await derive(KEY, TEST_USER_ID, 'v2');
  const v1 = await derive(KEY, TEST_USER_ID, 'v1');
  assert(v1 !== null && sameKeyOtherVersion !== null, 'both derived');
  assert(v1 !== sameKeyOtherVersion, 'the version separates even when the key does not');

  const otherKeyOtherVersion = await derive(OTHER_KEY, TEST_USER_ID, 'v2');
  assert(otherKeyOtherVersion !== null, 'a v2 key derives too');
  assert(otherKeyOtherVersion !== v1, 'and a real rotation changes the value');
});

Deno.test('59 — the version constant controls the emitted prefix', async () => {
  const active = await derive(KEY, TEST_USER_ID, SAFETY_IDENTIFIER_ACTIVE_VERSION);
  assert(active !== null, 'derived');
  assert(
    active.startsWith(safetyIdentifierPrefix(SAFETY_IDENTIFIER_ACTIVE_VERSION)),
    'the emitted prefix is the one the active-version constant names',
  );

  const next = await derive(KEY, TEST_USER_ID, 'v2');
  assert(next !== null && next.startsWith('nl_osi_v2_'), 'and a v2 deriver emits the v2 prefix');
});

Deno.test('60 — one derivation yields exactly one identifier, never two', async () => {
  const outcome = await deriver(KEY).derive(TEST_USER_ID);
  assert(outcome.kind === 'derived', 'derived');
  assertEquals(
    Object.keys(outcome).sort(),
    ['identifier', 'kind'],
    'one value and its discriminant',
  );
  assertEquals(
    (outcome.identifier.match(/nl_osi_/g) ?? []).length,
    1,
    'and the value itself carries a single identifier, not a pair',
  );
});

Deno.test('62 — an unknown or malformed version fails closed', async () => {
  /**
   * A version label is `v` plus a decimal ordinal, and nothing else. A deriver built for anything else
   * refuses **before** it looks at the key, so a typo in a rotation deployment cannot emit values under
   * a label nobody can attribute.
   */
  for (
    const version of ['', 'v', 'V1', 'v0', 'v01', '1', 'v1 ', ' v1', 'v1.1', 'latest', 'v1000']
  ) {
    const outcome = await deriver(KEY, version).derive(TEST_USER_ID);
    assertEquals(outcome, { kind: 'unavailable' }, `refused version: ${JSON.stringify(version)}`);
  }
});

Deno.test('61 — the deriver stores no backward mapping, and offers no way to ask for one', async () => {
  /**
   * The absence is structural: `SafetyIdentifierDeriver` has one method, it takes a subject and
   * returns an identifier, and there is no inverse. Recovering a subject from an identifier requires
   * the key plus a candidate list, which is the threat model the runbook records — not a lookup this
   * code offers.
   */
  const built = deriver(KEY);
  assertEquals(Object.keys(built), ['derive'], 'one method, one direction');
  const outcome = await built.derive(TEST_USER_ID);
  assert(outcome.kind === 'derived', 'derived');
  assertEquals(
    Object.keys(outcome).sort(),
    ['identifier', 'kind'],
    'and the result carries no subject',
  );
});
