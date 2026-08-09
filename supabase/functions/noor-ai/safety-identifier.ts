import { isUuid } from './claims.ts';
import type { SafetyIdentifierDeriver, SafetyIdentifierOutcome } from './ports.ts';

/**
 * B10 — the per-user OpenAI `safety_identifier`, derived server-side from the verified subject.
 *
 * ── Documentation this file is written against ───────────────────────────────
 * `https://developers.openai.com/api/docs/guides/safety-best-practices`, retrieved **2026-08-09**.
 * Three statements from it, quoted rather than paraphrased:
 *
 *   • "Safety identifiers are recommended for products where individual users interact with a model,
 *     but they are not required."
 *   • "A safety identifier should be a string that uniquely identifies each user."
 *   • "Hash the username or email address in order to avoid sending us any identifying information."
 *
 * Everything else below is a **NoorLife security decision**, not an OpenAI requirement. OpenAI does
 * not require HMAC, does not require a uuid input, does not specify a prefix, and has no view on
 * NoorLife's rotation design. The parameter itself is optional; NoorLife chooses to send one.
 *
 * ── Why a keyed construction rather than the unkeyed hash the guidance suggests ──
 * The source's wording and NoorLife's privacy classification are deliberately kept apart below,
 * because collapsing them is how a hash gets described as anonymisation.
 *
 * **What the guidance says:** hash the username or email address "in order to avoid sending us any
 * identifying information". Read as a recommendation, that is: do not send the raw identifier.
 *
 * **What a plain digest actually achieves:** it removes the directly readable username, email address
 * or uuid from the outbound value. It does **not** anonymise the person. The digest is a *stable
 * pseudonymous identifier* — the same user produces the same value on every request, which is the
 * whole reason the parameter is useful — and it can be matched back to a person by anyone who holds
 * the candidate set: hash every candidate, compare. That is a dictionary attack against a known set,
 * not a weakness of SHA-256, and it applies to usernames and email addresses just as it does to uuids.
 * Those are frequently predictable and enumerable in their own right; the difference is not input
 * entropy, it is **who holds the list**. NoorLife holds its own user table.
 *
 * **What NoorLife does about it:** key the digest with a secret held outside the database. That
 * prevents candidate-list matching **by parties that do not possess the HMAC key** — holding the whole
 * user table yields nothing to compare against without it.
 *
 * **What that does not achieve, stated so it is not assumed:** the output remains **pseudonymous, not
 * anonymous**. It is account-linked personal data for privacy and store-disclosure purposes. NoorLife
 * can still recompute it — it holds both the key and the uuid, by design — so this is not a control
 * against NoorLife itself. And it does not defeat matching by an attacker who obtains **both** the key
 * and the user table; it raises the requirement from one of those to both.
 *
 * HMAC is NoorLife's stricter security decision. OpenAI does not require it.
 *
 * ── The construction, in full ────────────────────────────────────────────────
 *
 *   algorithm  HMAC-SHA-256
 *   key        one dedicated random 256-bit secret, used for this purpose and nothing else
 *   message    `noorlife:openai-safety-identifier:<version>` + NUL + `<canonical lowercase uuid>`
 *   output     `nl_osi_<version>_` + unpadded base64url of the 32-byte digest (43 characters)
 *
 * The domain separation is the NUL-delimited namespace. Without it, the same key used for a second
 * purpose could be made to produce a colliding digest by choosing the other purpose's input, and a NUL
 * is the one byte a canonical uuid cannot contain — so the namespace and the subject cannot be
 * confused for one another however either is chosen. The version is *inside* the message as well as in
 * the prefix, so v1 and v2 differ even if the same key were ever, wrongly, configured for both.
 *
 * The prefix and version are **public metadata, not secrets**. They tell an operator reading a
 * provider dashboard which construction produced a value, which is what makes a rotation legible.
 *
 * ── Key separation ───────────────────────────────────────────────────────────
 * The HMAC key is completely independent of the OpenAI API key, the Supabase service-role key, the JWT
 * signing keys, the quota-store credentials, password and recovery material, any Vault or encryption
 * key, and any other NoorLife hash or HMAC purpose. No key is reused across domains. `docs/
 * NOOR_AI_B10_SAFETY_IDENTIFIER_RUNBOOK.md` records the generation, storage, access, rotation and
 * emergency procedures; nothing here reads, prints or stores a value.
 *
 * ── What this module does not do ─────────────────────────────────────────────
 * It reads no database, never sees an email or a phone number, keeps no map from uuid to identifier,
 * writes nothing anywhere, logs nothing at all, and throws nothing across the port. There is no
 * `console` call in this file and no `throw` statement; a failure is the `unavailable` member.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The version, and the one secret name it selects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The active construction version — a **source constant**, deliberately not an environment value.
 *
 * Switching it changes every user's identifier at once (see the runbook's rotation section), which is
 * not something an environment variable should be able to do silently. As a constant it is a one-line
 * diff a reviewer sees, attached to a deployment, in the same place §I.2's kill switch lives.
 */
export const SAFETY_IDENTIFIER_ACTIVE_VERSION = 'v1';

/**
 * The reserved server-only Supabase Edge Function secret name for the active version.
 *
 * **Name only.** No value has been generated, none is provisioned, none exists in any environment, and
 * none appears in this repository. The name is coupled to the active version by an assertion in
 * `tests/safety-identifier_test.ts`, so a version bump that forgets the secret name fails a test.
 *
 * The version-2 name is deliberately absent from this file and from every other production module: it
 * is written down only in the runbook and exercised only as a rotation test fixture, so nothing in the
 * deployed function can read a key that has not been reviewed into service.
 */
export const SAFETY_IDENTIFIER_SECRET_NAME = 'NOOR_AI_SAFETY_HMAC_KEY_V1';

/** The namespace half of the domain-separated message. Public, and never a secret. */
export const SAFETY_IDENTIFIER_DOMAIN = 'noorlife:openai-safety-identifier';

/** 256 bits. Not configurable — a variable-length key is a key nobody has reviewed the strength of. */
export const SAFETY_IDENTIFIER_KEY_BYTES = 32;

/** Unpadded base64url of a 32-byte digest is exactly 43 characters. */
export const SAFETY_IDENTIFIER_DIGEST_CHARS = 43;

/**
 * A version label: `v` followed by a decimal ordinal with no leading zero.
 *
 * Bounded to three digits so the label cannot become an arbitrary string smuggled into the message.
 * Anything else — `V1`, `v0`, `1`, `v1 `, an empty string — is not a version this module recognises,
 * and a deriver built for one fails closed rather than emitting a value nobody can attribute.
 */
const VERSION_LABEL = /^v[1-9][0-9]{0,2}$/;

/**
 * The **syntactic** public format: any version this module could have produced.
 *
 * It is a shape check and nothing more. It deliberately does **not** answer "may this value be sent",
 * because a syntactically perfect `nl_osi_v9_…` is a value produced under a key nobody reviewed into
 * service. `isActiveSafetyIdentifier` below is the question the outbound boundary must ask.
 */
export const SAFETY_IDENTIFIER_PATTERN = /^nl_osi_v[1-9][0-9]{0,2}_[A-Za-z0-9_-]{43}$/;

/** The digest half, on its own. */
const DIGEST = /^[A-Za-z0-9_-]{43}$/;

/** The public prefix for a version. `nl_osi` is "NoorLife opaque safety identifier". */
export function safetyIdentifierPrefix(version: string): string {
  return `nl_osi_${version}_`;
}

/**
 * Whether a value is an identifier of the **currently active** version — the only kind that may leave
 * NoorLife.
 *
 * ── Why the outbound boundary needs this and not `SAFETY_IDENTIFIER_PATTERN` ─
 * `createSafetyIdentifierDeriver` accepts an explicit version so a rotation can be built and tested
 * before it is activated, which means values under an inactive version are constructible. The shape
 * check cannot tell those apart from the live one: `nl_osi_v2_…` and `nl_osi_v999_…` are both
 * syntactically valid. Sending one would mean emitting an identifier under a key that
 * `SAFETY_IDENTIFIER_ACTIVE_VERSION` has not put into service — silently splitting or merging users'
 * provider-side identity outside the reviewed deployment that is supposed to decide it.
 *
 * So the answer is derived from the active-version constant, here, once. The provider adapter imports
 * this function rather than restating `v1`, because a second independently written literal is a second
 * thing a rotation has to remember to change — and the one it forgets is the one that keeps sending
 * the old version.
 *
 * A malformed active-version constant matches nothing, which fails closed in the same direction as
 * every other configuration fault in this module.
 */
export function isActiveSafetyIdentifier(value: unknown): value is string {
  if (typeof value !== 'string' || !VERSION_LABEL.test(SAFETY_IDENTIFIER_ACTIVE_VERSION)) {
    return false;
  }
  const prefix = safetyIdentifierPrefix(SAFETY_IDENTIFIER_ACTIVE_VERSION);
  return value.startsWith(prefix) && DIGEST.test(value.slice(prefix.length));
}

// ─────────────────────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────────────────────

/** The only alphabet accepted or produced: unpadded base64url. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes unpadded base64url, or answers `null`.
 *
 * `null` for: the standard alphabet's `+` and `/`, an `=` pad, whitespace anywhere including at the
 * ends, any other character, and a length that cannot be a whole number of bytes. The caller adds the
 * byte-count and canonical-encoding checks.
 */
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(value) || value.length % 4 === 1) {
    return null;
  }
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    // Not decodable. Nothing about the input is captured, and nothing is thrown onward.
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// The stored key representation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The accepted stored form, and every way it is refused.
 *
 * Accepted: unpadded base64url that decodes to **exactly** 32 bytes and re-encodes to the identical
 * string. Refused, each on its own: missing, empty, surrounded by whitespace, padded, standard-alphabet,
 * otherwise invalid, decoding to 31 or 33 bytes, or all-zero.
 *
 * ── Why the round trip, and why the all-zero check ───────────────────────────
 * A 43-character base64url string carries 258 bits, of which the last two are dropped when 32 bytes are
 * read back. Two different strings can therefore decode to the same key, and accepting both would mean
 * a secret with more than one spelling — a rotation check comparing "is this the configured key" could
 * disagree with itself. Re-encoding and comparing admits exactly one spelling.
 *
 * All-zero is refused because it is what a truncated file, a cleared buffer or a placeholder produces,
 * and a key of thirty-two zero bytes is a key an attacker guesses first. It is not a cryptographic
 * weakness of HMAC; it is a configuration accident that must not be allowed to look like success.
 *
 * The value is never trimmed. Trimming would silently accept a secret pasted with a trailing newline
 * and make the stored form ambiguous, which is the same problem as the round trip above.
 */
function readKeyMaterial(secret: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (secret === undefined || secret === '') {
    return null;
  }
  const bytes = decodeBase64Url(secret);
  if (bytes === null || bytes.length !== SAFETY_IDENTIFIER_KEY_BYTES) {
    return null;
  }
  if (encodeBase64Url(bytes) !== secret) {
    return null;
  }
  if (bytes.every((byte) => byte === 0)) {
    return null;
  }
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// The verified subject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The canonical identity, or `null`.
 *
 * `isUuid` is `claims.ts`'s own check — the same one §D.4 row 7 applies to `sub` — so this module
 * cannot drift into accepting a shape the verifier rejects, or rejecting one it accepts. Braces,
 * surrounding whitespace, a `urn:uuid:` prefix, a 32-character unhyphenated form, an email, a phone
 * number, a session id and any other arbitrary string all fail it.
 *
 * ── Why lowercasing is a canonicalisation and not a convenience ──────────────
 * `claims.ts` matches the uuid case-insensitively, so a token carrying `AAAAAAAA-…` in `sub` is one
 * the existing verified-claims type can legitimately produce. Two spellings of one identity must not
 * produce two identifiers — that would split one person's abuse-signal history in half on a detail
 * nobody controls — so the hexadecimal is folded to lowercase before it is signed. RFC 4122's own
 * output form is lowercase, which is why that is the direction chosen.
 */
function canonicalSubject(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The deriver
// ─────────────────────────────────────────────────────────────────────────────

export type SafetyIdentifierConfig = {
  /** The construction version this deriver emits. Production passes the active source constant. */
  readonly version: string;
  /** The stored secret, exactly as the environment held it. Never logged, never returned. */
  readonly secret: string | undefined;
};

/**
 * Builds a deriver, or one that can only report `unavailable`.
 *
 * ── The key never becomes a value this object can hand back ──────────────────
 * The bytes exist for as long as it takes `crypto.subtle.importKey` to copy them, and are overwritten
 * immediately afterwards. What is retained is a `CryptoKey` imported **non-extractably** with `sign`
 * as its only usage, so the runtime will refuse to export it and will refuse to verify, encrypt or
 * derive with it. The returned object exposes one method and no property that could reach either.
 *
 * ── An honest note on memory ─────────────────────────────────────────────────
 * `material.fill(0)` overwrites one typed array. It does **not** zeroize the secret: the environment
 * handed the value over as a JavaScript string, strings are immutable, `atob` produced a second one,
 * and both live until the collector reclaims them — which may be never, and may leave copies behind
 * when it does. This is best effort on the one buffer that can be overwritten, and nothing here should
 * be read as a claim of cryptographic erasure. The real containment is that the process boundary is
 * the trust boundary: the value exists only inside the Edge Function isolate.
 *
 * The import is started eagerly and its rejection is handled at the same moment, so a runtime that
 * refuses the key cannot surface as an unhandled rejection carrying a message somebody wrote about it.
 */
export function createSafetyIdentifierDeriver(
  config: SafetyIdentifierConfig,
): SafetyIdentifierDeriver {
  const { version } = config;
  const material = VERSION_LABEL.test(version) ? readKeyMaterial(config.secret) : null;
  const prefix = safetyIdentifierPrefix(version);
  const message = `${SAFETY_IDENTIFIER_DOMAIN}:${version}\0`;

  const imported: Promise<CryptoKey | null> = material === null ? Promise.resolve(null) : crypto
    .subtle
    .importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((key) => {
      material.fill(0);
      return key;
    })
    .catch(() => {
      material.fill(0);
      return null;
    });

  const unavailable: SafetyIdentifierOutcome = { kind: 'unavailable' };

  return {
    derive: async (verifiedSubjectUuid: string): Promise<SafetyIdentifierOutcome> => {
      const subject = canonicalSubject(verifiedSubjectUuid);
      if (subject === null) {
        return unavailable;
      }
      const key = await imported;
      if (key === null) {
        return unavailable;
      }
      try {
        const signature = await crypto.subtle.sign(
          'HMAC',
          key,
          new TextEncoder().encode(`${message}${subject}`),
        );
        return {
          kind: 'derived',
          identifier: `${prefix}${encodeBase64Url(new Uint8Array(signature))}`,
        };
      } catch {
        // A runtime failure inside the primitive. Nothing about it is captured or re-thrown: an
        // exception raised while holding key material is an exception that may describe it.
        return unavailable;
      }
    },
  };
}

/**
 * The production deriver — the one place the active secret name is read.
 *
 * ── Why the read is here and not in `index.ts` ───────────────────────────────
 * The two secrets the entry point reads are *handed through* it to a module that uses them, and the
 * entry point holds neither. This one is different in kind: the key is used inside this file, by this
 * file, and by nothing else. Reading it here means the name, the validation, the import and the single
 * use all sit in one reviewable module, and `tests/source-scan_test.ts` pins that by exact equality —
 * no other production file may name it, and this file may read no other environment variable.
 *
 * **No such secret exists.** It is set in no environment, so this read yields `undefined`, the deriver
 * is unavailable, and every authenticated request fails closed with §I.5's stable `503` before a
 * reservation is taken or a provider is reached.
 */
export function createProductionSafetyIdentifierDeriver(): SafetyIdentifierDeriver {
  return createSafetyIdentifierDeriver({
    version: SAFETY_IDENTIFIER_ACTIVE_VERSION,
    secret: Deno.env.get('NOOR_AI_SAFETY_HMAC_KEY_V1'),
  });
}
