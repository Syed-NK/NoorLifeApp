import { assert, assertEquals } from './assert.ts';
import { createJwtClaimsVerifier, extractBearerToken, parseKeySet } from '../jwt-verifier.ts';
import { checkClaims } from '../claims.ts';

/**
 * The two copied security modules, pinned to their originals.
 *
 * ── What this test is for ────────────────────────────────────────────────────
 * `claims.ts` and `jwt-verifier.ts` are **byte-identical** copies of the modules in
 * `supabase/functions/noor-ai/`. A Supabase function is deployed as a unit, and a security control
 * living in a sibling function's folder is a control whose review and whose deployment belong to
 * something else — so each function carries its own. Moving them to a shared module was the other
 * option and was not available: it would have edited `noor-ai`, which this work is not authorised to
 * touch.
 *
 * Duplicated security code has one real cost: a fix lands in one copy and not the other. This test is
 * what converts that cost into a failing build. It compares the committed bytes, so *any* divergence
 * fails — an added comment as surely as a changed check — and the fix is always to make the two the
 * same rather than to relax the assertion.
 *
 * `noor-ai/tests/jwt-verifier_test.ts` and `handler-auth_test.ts` already exercise the cryptography
 * itself against real key material. Re-running that here would duplicate the test suite as well as
 * the module; equality is the stronger and cheaper claim.
 */

const HERE = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const NOOR_AI = new URL('../../noor-ai/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Line endings are normalised before comparing.
 *
 * `core.autocrlf` is true on Windows, so a checkout can differ on every line by an invisible byte
 * nobody typed. Comparing raw would make this test fail after a `git checkout` — a *restore*, which
 * is the opposite of the edit it exists to catch. Everything else stays byte-exact: a changed space,
 * a reordered import or a reworded comment all still fail.
 */
function normalise(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

for (const name of ['claims.ts', 'jwt-verifier.ts']) {
  Deno.test(`${name} is byte-identical to the noor-ai original`, () => {
    const here = normalise(Deno.readTextFileSync(`${HERE}${name}`));
    const original = normalise(Deno.readTextFileSync(`${NOOR_AI}${name}`));
    assert(here.length > 1000, `${name} is a real module, not an empty file`);
    assertEquals(
      here === original,
      true,
      `${name} has diverged from supabase/functions/noor-ai/${name}. Make the two identical rather ` +
        'than relaxing this assertion: the whole point of the copy is that it is a copy.',
    );
  });
}

Deno.test('the copies are wired in, not merely present', () => {
  /**
   * A pair of unused files would pass the equality assertions above and prove nothing about this
   * function. These drive both modules directly, so the copies are known to be the ones doing the
   * work — and the one check this handler depends on above all others is asserted here rather than
   * inherited by assumption.
   */
  assertEquals(extractBearerToken(null), null);
  assertEquals(extractBearerToken('Bearer '), null);
  assertEquals(extractBearerToken('Bearer a.b.c'), 'a.b.c');
  // Two credentials presented at once arrive joined by a comma, which a compact JWS cannot contain.
  assertEquals(extractBearerToken('Bearer a.b.c, Bearer d.e.f'), null);

  assertEquals(parseKeySet(undefined), null);
  assertEquals(parseKeySet('{"keys":[]}'), null);

  const policy = {
    issuer: 'https://project.supabase.co/auth/v1',
    audience: 'authenticated',
    clockSkewSeconds: 5,
  };
  const base = {
    exp: 2_000,
    aud: 'authenticated',
    iss: 'https://project.supabase.co/auth/v1',
    role: 'authenticated',
    sub: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
  };

  assertEquals(checkClaims(base, policy, 1_000).ok, true, 'a well-formed user token is accepted');

  /**
   * The single most important check in the file: a correctly signed `anon` or `service_role` token is
   * a valid token for this project and passes every other test. This is the only line that stops it,
   * and it is the difference between "the token verified" and "a signed-in person is calling".
   */
  for (const role of ['anon', 'service_role', '', 'authenticated ']) {
    const outcome = checkClaims({ ...base, role }, policy, 1_000);
    assertEquals(outcome.ok, false, `role ${JSON.stringify(role)} is refused`);
    if (!outcome.ok) {
      assertEquals(outcome.reason, 'role');
    }
  }

  assertEquals(checkClaims({ ...base, exp: 500 }, policy, 1_000).ok, false, 'an expired token');
  assertEquals(checkClaims({ ...base, iss: 'https://elsewhere/auth/v1' }, policy, 1_000).ok, false);
  assertEquals(checkClaims({ ...base, aud: 'anon' }, policy, 1_000).ok, false);
  assertEquals(checkClaims({ ...base, sub: 'not-a-uuid' }, policy, 1_000).ok, false);
  assertEquals(checkClaims({ ...base, session_id: undefined }, policy, 1_000).ok, false);
});

Deno.test('a verifier with no usable key material is unavailable, not unauthenticated', async () => {
  /**
   * A statement about the server rather than about the caller, which is why the handler answers `503`
   * for it. Answering `401` would tell a signed-in user their session was bad and hide an operator
   * problem behind a user-facing one.
   */
  const verifier = createJwtClaimsVerifier({
    keySet: undefined,
    claims: {
      issuer: 'https://project.supabase.co/auth/v1',
      audience: 'authenticated',
      clockSkewSeconds: 5,
    },
    nowSeconds: () => 1_000,
  });

  const outcome = await verifier.verify('Bearer a.b.c');
  assertEquals(outcome.ok, false);
  if (!outcome.ok) {
    assertEquals(outcome.reason, 'verifier-unavailable');
  }
});
