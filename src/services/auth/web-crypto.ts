import * as Crypto from 'expo-crypto';

/**
 * The four globals `supabase-js` needs before PKCE can use S256, installed from official Expo APIs.
 *
 * ── The problem, read out of the installed SDK rather than assumed ───────────
 * `@supabase/auth-js@2.111.0`, `lib/helpers.js`:
 *
 *     const hasCryptoSupport = typeof crypto !== 'undefined' &&
 *         typeof crypto.subtle !== 'undefined' &&
 *         typeof TextEncoder !== 'undefined';
 *     if (!hasCryptoSupport) {
 *       console.warn('WebCrypto API is not supported. Code challenge method will default to use plain instead of sha256.');
 *       return verifier;
 *     }
 *
 * and, immediately after, `codeChallengeMethod = codeVerifier === codeChallenge ? 'plain' : 's256'`.
 *
 * `react-native@0.86.0` installs no `crypto` global — `Libraries/Core/setUpGlobals.js` sets `window`,
 * `self` and `process` and nothing cryptographic — and no installed package polyfills one:
 * `react-native-url-polyfill` ships only `URL` and `URLSearchParams`. So on Hermes the branch above
 * was taken on every launch and **the app sent `code_challenge_method=plain`**.
 *
 * That is not a cosmetic warning. A `plain` challenge *is* the verifier, so PKCE stops protecting
 * anything: whoever can observe the authorization request can complete the exchange. Every email
 * confirmation and password recovery link in this project is a PKCE flow, which is why this file
 * exists and why it is imported before the client is created.
 *
 * ── Why a shim rather than a different flow ─────────────────────────────────
 * `flowType` is the only lever `supabase-js` offers, and its alternative is the implicit flow, which
 * puts access and refresh tokens in the redirect. Swapping a weak challenge for tokens-in-the-URL
 * would be a worse trade. The supported fix is to give the SDK the WebCrypto surface it looks for,
 * backed by the platform's own cryptography.
 *
 * ── Why each global is installed only when it is missing ────────────────────
 * `installWebCrypto` never replaces an implementation that already exists. On web, and under Jest's
 * Node environment, `crypto.subtle`, `TextEncoder` and `btoa` are all real and standards-compliant;
 * overwriting them with these narrower versions would be a downgrade, and would make the test
 * environment stop resembling the browser it stands in for. Only the gaps are filled.
 *
 * ── What this file does not do ──────────────────────────────────────────────
 * It handles no secret of its own. It hashes and encodes whatever it is given, holds nothing, logs
 * nothing, and has no knowledge of codes, tokens or verifiers — those live inside `supabase-js`. The
 * only thing it exports besides the installer is a report of which challenge method the resulting
 * environment will produce.
 */

/**
 * The subset of `globalThis` this module writes to.
 *
 * Declared as a parameter rather than reached for directly so the installer is testable: a suite can
 * hand it an object with no crypto at all and observe what gets installed, which is the Hermes case
 * and the one that cannot be reproduced by running the test in Node.
 */
export type CryptoGlobals = {
  crypto?: {
    getRandomValues?: (array: Uint8Array) => Uint8Array;
    subtle?: { digest?: (algorithm: string, data: BufferSource) => Promise<ArrayBuffer> };
  };
  TextEncoder?: unknown;
  btoa?: (data: string) => string;
};

/** The digest and randomness primitives, injectable so the installer can be tested without natives. */
export type CryptoBackend = {
  digest(algorithm: Crypto.CryptoDigestAlgorithm, data: BufferSource): Promise<ArrayBuffer>;
  getRandomValues<T extends Uint8Array>(array: T): T;
};

const expoBackend: CryptoBackend = {
  digest: (algorithm, data) => Crypto.digest(algorithm, data),
  getRandomValues: (array) => Crypto.getRandomValues(array),
};

/** What `supabase-js` will end up sending as `code_challenge_method`. */
export type PkceChallengeMethod = 's256' | 'plain';

/**
 * A minimal UTF-8 encoder.
 *
 * Only `encode` is implemented, because that is the only method `supabase-js` calls
 * (`new TextEncoder().encode(randomString)`). A fuller implementation would be dead code pretending
 * to be a standard; `encodeInto` and the `encoding` property are deliberately absent so a future
 * caller expecting the full interface fails loudly here rather than silently getting a wrong answer.
 *
 * The verifier `supabase-js` generates is ASCII, so in practice only the one-byte branch runs. The
 * multi-byte branches are still correct rather than approximate — an encoder that is right only for
 * the input you expected is the kind that produces a hash mismatch nobody can explain.
 */
class MinimalTextEncoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    const bytes: number[] = [];
    for (let index = 0; index < input.length; index += 1) {
      let point = input.charCodeAt(index);

      // A surrogate pair is one code point spread over two UTF-16 units. Encoding each unit on its
      // own would produce CESU-8, which hashes differently from UTF-8.
      if (point >= 0xd800 && point <= 0xdbff && index + 1 < input.length) {
        const low = input.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          point = (point - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
          index += 1;
        }
      }

      if (point < 0x80) {
        bytes.push(point);
      } else if (point < 0x800) {
        bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
      } else if (point < 0x10000) {
        bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      } else {
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
      }
    }
    return new Uint8Array(bytes);
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * A minimal `btoa`.
 *
 * `supabase-js` calls `btoa(hashed)` where `hashed` is a binary string — one character per byte,
 * built by `String.fromCharCode` over the digest. So every code unit is in 0–255 by construction.
 * A value outside that range means the caller passed text rather than bytes, which would silently
 * produce the wrong base64; it throws instead, the same way the platform's own `btoa` does.
 */
function minimalBtoa(data: string): string {
  let output = '';
  for (let index = 0; index < data.length; index += 3) {
    const bytes = [0, 1, 2].map((offset) => {
      const code = index + offset < data.length ? data.charCodeAt(index + offset) : 0;
      if (code > 0xff) {
        throw new Error('btoa received a character outside the Latin-1 range.');
      }
      return code;
    }) as [number, number, number];

    const triple = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
    const available = data.length - index;
    output += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    output += available > 1 ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    output += available > 2 ? BASE64_ALPHABET[triple & 0x3f] : '=';
  }
  return output;
}

/** Which globals a call to `installWebCrypto` actually had to add. Returned for tests and reporting. */
export type InstallReport = {
  readonly getRandomValues: boolean;
  readonly digest: boolean;
  readonly textEncoder: boolean;
  readonly btoa: boolean;
};

/**
 * Fills in the missing globals. Idempotent, and never overwrites an existing implementation.
 *
 * `expo-crypto`'s `digest` is a native call and returns a real `ArrayBuffer`, which is exactly what
 * `crypto.subtle.digest` is specified to resolve to — so `new Uint8Array(hash)` on the SDK's side
 * behaves identically to the browser path.
 *
 * Only SHA-256 is accepted. `supabase-js` asks for nothing else, and quietly mapping an unknown
 * algorithm onto SHA-256 would answer a question that was not asked; an unsupported algorithm
 * rejects.
 */
export function installWebCrypto(
  target: CryptoGlobals = globalThis as unknown as CryptoGlobals,
  backend: CryptoBackend = expoBackend,
): InstallReport {
  const report = { getRandomValues: false, digest: false, textEncoder: false, btoa: false };

  if (target.crypto === undefined) {
    target.crypto = {};
  }
  const nativeCrypto = target.crypto;

  if (typeof nativeCrypto.getRandomValues !== 'function') {
    nativeCrypto.getRandomValues = (array) => backend.getRandomValues(array);
    report.getRandomValues = true;
  }

  if (nativeCrypto.subtle === undefined) {
    nativeCrypto.subtle = {};
  }
  if (typeof nativeCrypto.subtle.digest !== 'function') {
    nativeCrypto.subtle.digest = async (algorithm, data) => {
      const name = typeof algorithm === 'string' ? algorithm.toUpperCase() : '';
      if (name !== 'SHA-256') {
        throw new Error(`Unsupported digest algorithm: ${String(algorithm)}`);
      }
      return backend.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
    };
    report.digest = true;
  }

  if (typeof target.TextEncoder !== 'function') {
    target.TextEncoder = MinimalTextEncoder;
    report.textEncoder = true;
  }

  if (typeof target.btoa !== 'function') {
    target.btoa = minimalBtoa;
    report.btoa = true;
  }

  return report;
}

/**
 * The challenge method the current environment will actually produce.
 *
 * Applies `supabase-js`'s own `hasCryptoSupport` test to the globals as they now stand, so this is a
 * report on the environment rather than a claim about this file. Called after `installWebCrypto`, it
 * must say `s256`; if it ever says `plain`, PKCE is not protecting the email-link flows and the build
 * is not production-ready. `web-crypto.test.ts` asserts the post-install answer, and the value is
 * captured on device for the phase's evidence.
 */
export function describePkceChallengeMethod(
  target: CryptoGlobals = globalThis as unknown as CryptoGlobals,
): PkceChallengeMethod {
  const hasCryptoSupport =
    target.crypto !== undefined &&
    target.crypto.subtle !== undefined &&
    typeof target.crypto.subtle.digest === 'function' &&
    typeof target.TextEncoder === 'function' &&
    typeof target.btoa === 'function';
  return hasCryptoSupport ? 's256' : 'plain';
}

/**
 * Installed on import.
 *
 * `src/lib/supabase.ts` imports this module for its side effect before it calls `createClient`,
 * because `getCodeChallengeAndMethod` reads these globals at call time and a client constructed
 * against a half-installed environment would mint a `plain` challenge for the first flow of the
 * session. Running it here rather than asking every entry point to remember is what makes that
 * ordering a property of the import graph.
 */
installWebCrypto();
