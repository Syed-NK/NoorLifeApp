import { createNoorAIHandler } from '../handler.ts';
import { createJwtClaimsVerifier, extractBearerToken, parseKeySet } from '../jwt-verifier.ts';
import { claimsPolicyFor } from '../production.ts';
import { assert, assertEquals } from './assert.ts';
import {
  createForbiddenProvider,
  createHarness,
  createSigningFixture,
  jsonRequest,
  TEST_USER_ID,
  validClaimSet,
} from './fakes.ts';

/**
 * The production verifier, against real cryptography.
 *
 * ── Why this file generates keys instead of injecting a fake verifier ────────
 * §D.2 exists because "Decoding it proves nothing": an attacker writes
 * `{"sub": "<any uuid>", "role": "authenticated", "exp": <far future>}`, base64url-encodes it, "appends any
 * signature", and a server that decodes rather than verifies "has just been handed whatever identity was
 * asked for. There is no secret involved in producing that string, so there is no attacker cost to it."
 *
 * A suite that only injected `{ ok: true }` could never catch a verifier that did exactly that. So this file
 * generates a real ES256 key pair in-process, signs genuine tokens with it, and — the assertion that matters
 * — checks that a token signed by a *different* pair is refused.
 *
 * No key is provisioned, requested, printed, stored or committed. The pair exists for the lifetime of one
 * test process and its private half never leaves the process. ES256 is used because it is one of the two
 * algorithms Supabase Auth issues that this verifier accepts.
 */

const NOW_SECONDS = 1_800_000_000;
const POLICY = claimsPolicyFor('https://project.supabase.co');

function verifierFor(jwks: string | null | undefined) {
  return createJwtClaimsVerifier({ keySet: jwks, claims: POLICY, nowSeconds: () => NOW_SECONDS });
}

Deno.test('§D.4 rows 3–8 — a genuinely signed, correctly scoped token verifies', async () => {
  const keys = await createSigningFixture();
  const token = await keys.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));

  const outcome = await verifierFor(keys.jwks).verify(`Bearer ${token}`);
  assert(outcome.ok, 'the token verifies end to end');
  assertEquals(
    outcome.ok && outcome.claims.userId,
    TEST_USER_ID,
    'and sub comes from the verified token',
  );
});

Deno.test('§D.2 — a token signed by a different key is refused', async () => {
  /**
   * The single most important assertion about the cryptography. The payload is identical to the one that
   * verified above; only the signing key differs.
   */
  const project = await createSigningFixture();
  const attacker = await createSigningFixture();
  const forged = await attacker.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));

  const outcome = await verifierFor(project.jwks).verify(`Bearer ${forged}`);
  assert(
    !outcome.ok && outcome.reason === 'signature',
    'a foreign signature is refused as a signature',
  );
});

Deno.test('§D.2 / §J.2e — an unsigned token naming another user is refused', async () => {
  /**
   * §J.2e's forged-`sub` row, at the handler level: "no log line anywhere attributes anything to that uuid".
   *
   * The token is constructed by hand — a real header, a real payload, and a signature that is simply the word
   * `forged` — which is exactly the attack §D.2 describes.
   */
  const project = await createSigningFixture();
  const victim = '99999999-9999-4999-8999-999999999999';
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = [
    encode({ alg: 'ES256', typ: 'JWT', kid: project.kid }),
    encode(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer, sub: victim })),
    'forgedsignature',
  ].join('.');

  const harness = createHarness({ provider: createForbiddenProvider() });
  const deps = { ...harness.deps, verifier: verifierFor(project.jwks) };
  const response = await createNoorAIHandler(deps)(
    jsonRequest({ contract_version: 1, message: 'Who am I?' }, {
      authorization: `Bearer ${forged}`,
    }),
  );

  assertEquals(response.status, 401, 'refused');
  assertEquals(harness.provider.calls.length, 0, 'no provider call');
  assertEquals(harness.logger.text().includes(victim), false, 'and the uuid is nowhere in the log');
  assertEquals((await response.text()).includes(victim), false, 'nor in the response');
});

Deno.test('§D.2 — alg: none and unsupported algorithms are refused', async () => {
  /**
   * The classic JWT failure. `alg: "none"` is refused because it is not on the allow-list, and HS256 is
   * refused for the same reason — which also means there is no code path that could treat a published public
   * key as an HMAC secret. Algorithm confusion is unexpressible here rather than merely guarded against.
   */
  const project = await createSigningFixture();
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const claims = validClaimSet(NOW_SECONDS, { iss: POLICY.issuer });

  for (const alg of ['none', 'HS256', 'HS512', 'RS512', 'PS256']) {
    const token = `${encode({ alg, typ: 'JWT', kid: project.kid })}.${encode(claims)}.x`;
    const outcome = await verifierFor(project.jwks).verify(`Bearer ${token}`);
    assert(!outcome.ok, `alg ${alg} must not verify`);
    assertEquals(
      outcome.ok ? null : outcome.reason,
      'signature',
      `alg ${alg} is a signature failure`,
    );
  }
});

Deno.test('§D.2 — a kid that matches no published key is refused, so revocation works', async () => {
  /**
   * Key rotation is the documented reason the discovery endpoint exists — it allows rotating and revoking keys
   * "without needing to deploy new versions of your app's backend infrastructure". Trying the other published
   * keys when the `kid` matches none would defeat exactly that.
   */
  const project = await createSigningFixture('current-key');
  const token = await project.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }), {
    kid: 'retired-key',
  });

  const outcome = await verifierFor(project.jwks).verify(`Bearer ${token}`);
  assert(
    !outcome.ok && outcome.reason === 'signature',
    'a retired kid does not fall back to another key',
  );
});

Deno.test('the verifier fails closed when the platform supplies no usable key', async () => {
  /**
   * The legacy-HS256 case, and the honest AI-2 answer to it.
   *
   * The documentation states the JWKS discovery endpoint "does not return any keys if you are not using
   * asymmetric JWT signing keys". Verifying an HS256 token would need the project's legacy JWT **secret**, and
   * §K requires that "**no key exists anywhere**" in AI-2. So the verifier declines rather than guessing, and
   * `verifier-unavailable` is a server state (`503`) rather than a caller state (`401`).
   */
  const keys = await createSigningFixture();
  const token = await keys.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));

  for (
    const jwks of [undefined, null, '', '   ', 'not json', '{}', '{"keys":[]}', '{"keys":"nope"}']
  ) {
    const outcome = await verifierFor(jwks).verify(`Bearer ${token}`);
    assert(
      !outcome.ok && outcome.reason === 'verifier-unavailable',
      `a key set of ${JSON.stringify(jwks)} must fail closed, not fail open`,
    );
  }
});

Deno.test('the unavailable answer does not depend on caller input', async () => {
  // It is a statement about the server, so it must be the same for a good token and a nonsense one — otherwise
  // a caller could probe the project's signing configuration by watching which status came back.
  const good = await (async () => {
    const keys = await createSigningFixture();
    return keys.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));
  })();
  const verifier = verifierFor(null);

  const first = await verifier.verify(`Bearer ${good}`);
  const second = await verifier.verify('Bearer aaaa.bbbb.cccc');
  assertEquals(
    first.ok ? null : first.reason,
    'verifier-unavailable',
    'the same for a valid token',
  );
  assertEquals(second.ok ? null : second.reason, 'verifier-unavailable', 'and for a nonsense one');
});

// ─────────────────────────────────────────────────────────────────────────────
// The signature representation — ES256 is a wire format, not just an algorithm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why this section exists at all.
 *
 * The tests above sign with WebCrypto and verify with WebCrypto, so on the question of *encoding* they are
 * a tautology: if this runtime spoke DER, they would still pass, and the endpoint would still reject every
 * real Supabase token. "ES256 verifies" is therefore not the same claim as "a JOSE ES256 token verifies",
 * and only the second one is worth anything in production.
 *
 * ── The two encodings, and why they are not interchangeable ──────────────────
 * An ECDSA signature is a pair of integers, (r, s). There are two ways to put that pair on a wire:
 *
 *   • **JOSE / JWS** — RFC 7518 §3.4: "Turn R and S into octet sequences in big-endian order, with each
 *     array being be 32 octets long", then "Concatenate the two octet sequences in the order R and then S",
 *     and "The resulting 64-octet sequence is the JWS Signature value". Fixed width, always 64 octets, no
 *     framing. RFC 7518 §3.1 defines `ES256` as "ECDSA using P-256 and SHA-256".
 *   • **DER / ASN.1** — a `SEQUENCE` of two `INTEGER`s, which is what OpenSSL, X.509 and most non-JOSE
 *     tooling produce. It is self-framing and **variable length**, because an `INTEGER` drops leading zero
 *     octets and gains a `0x00` pad whenever the top bit would otherwise read as a sign bit. For P-256 it
 *     lands between roughly 68 and 72 octets and changes from signature to signature.
 *
 * Feed one to a verifier expecting the other and every signature fails. That failure is fail-closed rather
 * than dangerous — but it would take the endpoint down for every authenticated user, so it has to be
 * established rather than assumed.
 *
 * ── What is established below, and how ───────────────────────────────────────
 * The three tests are shaped to be decisive rather than reassuring. Between them they rule the DER
 * hypothesis out instead of merely failing to notice it:
 *
 *   1. Every signature this runtime produces is *exactly* 64 octets across many distinct messages —
 *      including ones whose R has its high bit set, which DER is obliged to lengthen. A constant 64 is
 *      inconsistent with DER and is exactly RFC 7518 §3.4's fixed-width pair.
 *   2. A DER re-encoding of a signature that verifies is **refused**. This is the discriminating test: it
 *      passes only under the JOSE hypothesis and fails under the DER one.
 *   3. Swapping the two halves is refused, so the 64 octets are read positionally as R then S rather than
 *      as an opaque blob.
 *
 * Nothing here is a fixed vector. The key pair is generated per test and its private half never leaves the
 * process, so there is no committed key material, no committed token and no project identifier.
 */

/** The base64url alphabet, unpadded — the only serialisation a compact JWS uses. */
function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(
    /=+$/,
    '',
  );
}

function decodeBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Replaces a token's signature segment, leaving the signed input byte-identical. */
function withSignature(token: string, signature: Uint8Array): string {
  const [header, payload] = token.split('.');
  return `${header}.${payload}.${encodeBase64Url(signature)}`;
}

/**
 * Re-encodes a JOSE R‖S pair as the DER `SEQUENCE { INTEGER r, INTEGER s }` that non-JOSE tooling emits.
 *
 * Written out rather than imported so the contrast is visible: the leading-zero strip and the sign-bit pad
 * below are precisely the rules that make DER variable-length and JOSE fixed-length.
 */
function joseToDer(raw: Uint8Array): Uint8Array {
  const integer = (component: Uint8Array): readonly number[] => {
    let start = 0;
    while (start < component.length - 1 && component[start] === 0) {
      start += 1;
    }
    const trimmed = component.subarray(start);
    const body = (trimmed[0] ?? 0) & 0x80 ? [0, ...trimmed] : [...trimmed];
    return [0x02, body.length, ...body];
  };
  const r = integer(raw.subarray(0, 32));
  const s = integer(raw.subarray(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

Deno.test('§D.4 row 3 — the dashboard’s ECC (P-256) key is an ES256 key, by RFC 7518’s definition', async () => {
  /**
   * The mapping this endpoint depends on, asserted rather than asserted-in-prose.
   *
   * The dashboard names a signing key by its *key* type — "ECC (P-256)". A JWT header names the same thing
   * by its *signature* type — `alg: "ES256"`. RFC 7518 §3.1 is what joins them: `ES256` is "ECDSA using
   * P-256 and SHA-256". So a project whose current key is ECC (P-256) issues ES256 tokens, and `selectKey`
   * is written to that identity: ES256 selects `kty: "EC"` with `crv: "P-256"`, and nothing else.
   */
  const fixture = await createSigningFixture();
  const published = parseKeySet(fixture.jwks);
  assert(published !== null, 'the fixture publishes a usable key set');
  const key = published[0] as Record<string, unknown>;

  assertEquals(key.kty, 'EC', 'ECC, in JWK terms');
  assertEquals(key.crv, 'P-256', 'on the P-256 curve');
  assertEquals(key.alg, 'ES256', 'which is the ES256 signature algorithm');
  assertEquals(key.use, 'sig', 'published for signature verification');
  // §B.2 — only the public half is ever exposed, here or anywhere.
  assertEquals('d' in key, false, 'no private component is published in the key set');

  const token = await fixture.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));
  assertEquals(
    JSON.parse(new TextDecoder().decode(decodeBase64Url(token.split('.')[0] ?? ''))).alg,
    'ES256',
    'and the token it signs declares ES256',
  );
  assert((await verifierFor(fixture.jwks).verify(`Bearer ${token}`)).ok, 'and it verifies');
});

Deno.test('RFC 7518 §3.4 — the runtime emits the fixed 64-octet R‖S pair, not DER', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  /**
   * Distinct messages, not repeated signings of one. This runtime's ECDSA is deterministic — the same key
   * and the same input give the same signature every time — so signing one message in a loop would sample
   * a single (r, s) pair and prove nothing about the length distribution.
   */
  const lengths = new Set<number>();
  let highBitSet = 0;
  for (let index = 0; index < 64; index += 1) {
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(`representation-probe-${index}`),
      ),
    );
    lengths.add(signature.length);
    if (((signature[0] ?? 0) & 0x80) !== 0) {
      highBitSet += 1;
    }
  }

  assertEquals(
    [...lengths],
    [64],
    'every signature is exactly the 64 octets RFC 7518 §3.4 specifies',
  );
  /**
   * The part that actually excludes DER. A DER `INTEGER` whose leading octet has the high bit set gains a
   * `0x00` pad, so these signatures could not have shared a length with the others under DER. The odds of
   * no sample landing here are 2⁻⁶⁴, so a failure means the representation changed, not that the run was
   * unlucky.
   */
  assert(highBitSet > 0, 'and some R values have the high bit DER would have had to pad');
});

Deno.test('§D.2 — a DER-encoded signature is refused: DER and JOSE are not interchangeable', async () => {
  /**
   * The discriminating test. The signature below is *cryptographically correct* — same key, same signed
   * input, same (r, s) — and differs from the accepted one only in how the integer pair is framed. A
   * verifier that took DER here would be a verifier that rejects every genuine Supabase token.
   */
  const fixture = await createSigningFixture();
  const token = await fixture.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));
  const verifier = verifierFor(fixture.jwks);

  const raw = decodeBase64Url(token.split('.')[2] ?? '');
  assertEquals(raw.length, 64, 'the accepted signature is the 64-octet JOSE pair');
  assert((await verifier.verify(`Bearer ${token}`)).ok, 'and it verifies as JOSE');

  const der = joseToDer(raw);
  assert(der.length !== 64, 'the DER re-encoding is a different length, as DER always is');
  assertEquals(der[0], 0x30, 'and it is an ASN.1 SEQUENCE');

  const outcome = await verifier.verify(`Bearer ${withSignature(token, der)}`);
  assert(
    !outcome.ok && outcome.reason === 'signature',
    'the same signature in DER framing is refused',
  );
});

Deno.test('§D.2 — the 64 octets are positional: R‖S swapped is refused', async () => {
  // Proves the pair is read as R then S rather than as an opaque 64-byte blob. Both halves are present and
  // both are correct values; only their order is wrong.
  const fixture = await createSigningFixture();
  const token = await fixture.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));
  const raw = decodeBase64Url(token.split('.')[2] ?? '');
  const swapped = Uint8Array.from([...raw.subarray(32), ...raw.subarray(0, 32)]);

  const outcome = await verifierFor(fixture.jwks).verify(`Bearer ${withSignature(token, swapped)}`);
  assert(!outcome.ok && outcome.reason === 'signature', 'S‖R is not R‖S');
});

Deno.test('§D.2 — tampered payloads and mutilated signatures are refused, never crashed on', async () => {
  /**
   * The rest of the §J.2a surface, against real cryptography. Every case here is a token that a naive
   * implementation could plausibly let through or blow up on: the payload edit is the actual escalation
   * attempt, and the length cases are the ones that reach `crypto.subtle` with something it will not parse.
   *
   * `malformed` versus `signature` is deliberate, not incidental. A segment that is not base64url at all is
   * a statement about the *credential's shape*, which §D.4 row 2 catches before any key is touched; a
   * segment that decodes but does not verify is a statement about the *signature*. Neither leaks which.
   */
  const fixture = await createSigningFixture();
  const verifier = verifierFor(fixture.jwks);
  const token = await fixture.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));
  const [header, payload, signature] = token.split('.') as [string, string, string];
  const raw = decodeBase64Url(signature);

  // A payload edited after signing — the whole point of checking a signature.
  const escalated = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer, exp: NOW_SECONDS + 86_400 })),
    ),
  );
  assert(escalated !== payload, 'the tampered payload really differs');
  const tamperedPayload = await verifier.verify(`Bearer ${header}.${escalated}.${signature}`);
  assert(
    !tamperedPayload.ok && tamperedPayload.reason === 'signature',
    'a payload edited after signing is refused',
  );

  // A single flipped bit in the signature.
  const flipped = Uint8Array.from(raw);
  flipped[0] = (flipped[0] ?? 0) ^ 0x01;
  const bitFlip = await verifier.verify(`Bearer ${withSignature(token, flipped)}`);
  assert(!bitFlip.ok && bitFlip.reason === 'signature', 'one flipped bit is refused');

  // Wrong lengths, on both sides of 64.
  for (
    const [label, bytes] of [
      ['truncated to 63 octets', raw.subarray(0, 63)],
      ['truncated to 32 octets — R alone', raw.subarray(0, 32)],
      ['padded to 65 octets', Uint8Array.from([...raw, 0])],
      ['a single zero octet', Uint8Array.from([0])],
    ] as const
  ) {
    const outcome = await verifier.verify(`Bearer ${withSignature(token, bytes)}`);
    assert(
      !outcome.ok && outcome.reason === 'signature',
      `a signature ${label} is refused, not accepted and not thrown`,
    );
  }

  // Not base64url at all. `atob` rejects a length ≡ 1 (mod 4), which must surface as an outcome.
  const undecodable = await verifier.verify(`Bearer ${header}.${payload}.aaaaa`);
  assert(!undecodable.ok, 'an undecodable signature segment is refused');

  // An empty signature segment is not a compact JWS at all, so it never reaches the key.
  const empty = await verifier.verify(`Bearer ${header}.${payload}.`);
  assertEquals(empty.ok ? null : empty.reason, 'malformed', 'an empty segment is a shape failure');
});

// ─────────────────────────────────────────────────────────────────────────────
// The signing-key transition — a current ES256 key beside an unexpired HS256 past
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the project's dashboard shows, and what it means here.
 *
 * The current JWT signing key is **ECC (P-256)** — ES256 — and it is the key Auth signs new tokens with.
 * A **previous HS256 key remains listed** for the moment, because access tokens already issued under it
 * are still inside their `exp` window and something has to be able to verify them until they age out.
 *
 * That produces one transitional case, and these tests pin it so nobody has to reason about it twice:
 *
 *   • A token signed by the **current ES256 key** verifies here. That is the steady state, and it is
 *     already covered by the first test in this file.
 *   • A token signed by the **previous HS256 key** is refused here with `signature` → `401`. The gateway
 *     may well have accepted it — `verify_jwt` is documented as validating "legacy HS256 JWTs" — but this
 *     handler cannot verify it independently, because doing so needs the project's legacy JWT **secret**
 *     and §K requires that "**no key exists anywhere**" in AI-2.
 *
 * The refusal is the correct outcome and the only available one. It is fail-closed: an unverifiable
 * credential is refused rather than trusted on the gateway's word, so there is no bypass and no path by
 * which an HS256 token is treated as authenticated. What it is **not** is a security achievement — it is a
 * temporary **availability** limitation, and it costs a real signed-in user a 401 until their old token
 * expires. It ends by itself when the last pre-rotation token passes its `exp`; nothing has to be
 * migrated, revoked or configured, and AI-2 adds, reads and depends on no legacy secret to reach it.
 */

Deno.test('the transition — a genuine HS256 token is refused, fail-closed, with the ES256 key present', async () => {
  /**
   * A *real* HMAC signature, not a placeholder. The earlier `alg`-allow-list test proves an HS256 **header**
   * is refused; this proves that a token which is correct in every other respect — genuinely signed,
   * unexpired, `role: "authenticated"`, right issuer and audience — is still refused. The secret is
   * generated here and discarded with the process; no legacy secret is read, referenced or provisioned.
   */
  const current = await createSigningFixture('current-ecc-p256');
  const legacySecret = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32))),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const header = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
  );
  const payload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }))),
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      legacySecret,
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  );
  const hs256Token = `${header}.${payload}.${encodeBase64Url(mac)}`;

  const outcome = await verifierFor(current.jwks).verify(`Bearer ${hs256Token}`);
  assert(
    !outcome.ok,
    'an HS256 token is never authenticated here, however well formed',
  );
  assertEquals(
    outcome.ok ? null : outcome.reason,
    'signature',
    'and it is refused as a signature failure, not answered',
  );

  // The whole way through the handler: 401, no provider call, no bypass.
  const harness = createHarness({ provider: createForbiddenProvider() });
  const response = await createNoorAIHandler({
    ...harness.deps,
    verifier: verifierFor(current.jwks),
  })(
    jsonRequest({ contract_version: 1, message: 'Where do I change my reminder sound?' }, {
      authorization: `Bearer ${hs256Token}`,
    }),
  );
  assertEquals(response.status, 401, 'the handler fails closed');
  assertEquals(harness.provider.calls.length, 0, 'and no provider call is made');
});

Deno.test('the transition — a listed HS256 key cannot be pressed into service for verification', async () => {
  /**
   * The adversarial half of the transition, and the reason algorithm confusion is unexpressible here.
   *
   * The key set below carries both generations at once: the current EC P-256 key and an `oct` entry
   * standing in for a listed symmetric one. Two things must hold simultaneously, and a verifier that
   * tried to be accommodating would break exactly one of them:
   *
   *   • the current ES256 key still verifies a current token — the transition must not take the endpoint
   *     down for everyone;
   *   • the symmetric entry is never selected, never imported and never used as an HMAC secret, so no
   *     token can be verified against it.
   *
   * `SUPPORTED_ALGORITHMS` refuses the HS256 header before key selection, and `selectKey` then requires
   * `kty: "EC"` with `crv: "P-256"`, so the `oct` entry is unreachable by two independent rules.
   */
  const current = await createSigningFixture('current-ecc-p256');
  const currentKey = JSON.parse(current.jwks).keys[0];
  const mixedKeySet = JSON.stringify({
    keys: [
      currentKey,
      // A stand-in for a listed symmetric key. `k` is a placeholder, not key material: §B.2 keeps real
      // secrets out of the repository and the point is that this entry is never reached at all.
      { kty: 'oct', alg: 'HS256', use: 'sig', kid: 'previous-symmetric', k: 'x' },
    ],
  });

  const verifier = verifierFor(mixedKeySet);

  const currentToken = await current.sign(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer }));
  assert(
    (await verifier.verify(`Bearer ${currentToken}`)).ok,
    'the current ES256 key still verifies current tokens while the previous key is listed',
  );

  // Naming the symmetric key's own kid must not select it, whatever algorithm is claimed.
  for (const alg of ['HS256', 'ES256']) {
    const forged = [
      encodeBase64Url(
        new TextEncoder().encode(JSON.stringify({ alg, typ: 'JWT', kid: 'previous-symmetric' })),
      ),
      encodeBase64Url(
        new TextEncoder().encode(
          JSON.stringify(validClaimSet(NOW_SECONDS, { iss: POLICY.issuer })),
        ),
      ),
      'AA',
    ].join('.');
    const outcome = await verifier.verify(`Bearer ${forged}`);
    assert(
      !outcome.ok && outcome.reason === 'signature',
      `a token naming the symmetric key with alg ${alg} is refused`,
    );
  }
});

Deno.test('parseKeySet accepts both the wrapped and bare shapes and rejects the rest', () => {
  assert(parseKeySet('{"keys":[{"kty":"EC"}]}') !== null, 'the documented wrapped shape');
  assert(parseKeySet('[{"kty":"EC"}]') !== null, 'a bare array, defensively');
  assertEquals(parseKeySet('{"keys":[1,2]}'), null, 'non-object entries are not keys');
  assertEquals(parseKeySet('{"nope":true}'), null, 'no keys member');
});

// ─────────────────────────────────────────────────────────────────────────────
// §D.4 row 2 — the credential itself
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§D.4 row 2 — Authorization must be present, single, Bearer and a compact JWS', async () => {
  assertEquals(extractBearerToken(null), null, 'a missing header');
  assertEquals(extractBearerToken(''), null, 'an empty header');
  assertEquals(extractBearerToken('Bearer'), null, 'a scheme with no token');
  assertEquals(extractBearerToken('Bearer '), null, 'an empty token');
  assertEquals(extractBearerToken('Basic aaa.bbb.ccc'), null, 'the wrong scheme');
  assertEquals(extractBearerToken('aaa.bbb.ccc'), null, 'no scheme at all');
  assertEquals(extractBearerToken('Bearer aaa.bbb'), null, 'two segments is not a JWS');
  assertEquals(
    extractBearerToken('Bearer aaa.bbb.ccc.ddd'),
    null,
    'four segments is not a JWS either',
  );

  /**
   * §D.1's "more than one credential presented → `401`". `Headers.get` joins repeated headers with `", "`, so
   * two `Authorization` headers arrive as one comma-bearing string — which a compact JWS never is.
   */
  assertEquals(
    extractBearerToken('Bearer aaa.bbb.ccc, Bearer ddd.eee.fff'),
    null,
    'two credentials',
  );

  assertEquals(extractBearerToken('Bearer aaa.bbb.ccc'), 'aaa.bbb.ccc', 'the accepted shape');
  assertEquals(
    extractBearerToken('bearer aaa.bbb.ccc'),
    'aaa.bbb.ccc',
    'the scheme is case-insensitive',
  );

  /**
   * §D.4's key-shape table: an `sb_publishable_*` key is not a JWT, and the documentation states that sending
   * one as a bearer token makes the platform "parse it as a JWT and reject the request with `Invalid JWT`".
   * §J.2d is therefore a *gateway* row — but the handler must refuse it too, and refuse it as malformed rather
   * than as an unauthorized role.
   *
   * The placeholders carry one character after the prefix, deliberately. §B.2 keeps real key material out of the
   * repository, and `source-scan_test.ts` scans for either prefix followed by a run of key-length material — so a
   * more realistic-looking fixture would be a fixture that failed the secret scan.
   */
  assertEquals(
    extractBearerToken('Bearer sb_publishable_x'),
    null,
    'a publishable key is not a JWS',
  );
  assertEquals(extractBearerToken('Bearer sb_secret_x'), null, 'nor a secret key');

  const verifier = verifierFor((await createSigningFixture()).jwks);
  const outcome = await verifier.verify('Bearer sb_publishable_x');
  assertEquals(
    outcome.ok ? null : outcome.reason,
    'malformed',
    'refused as a malformed credential',
  );
});
