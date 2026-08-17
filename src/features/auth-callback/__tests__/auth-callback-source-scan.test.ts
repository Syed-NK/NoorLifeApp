import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  AUTH_CALLBACK_PATH,
  AUTH_CALLBACK_SCHEME,
  AUTH_CALLBACK_URL,
  REQUIRED_SUPABASE_REDIRECT_URLS,
} from '@services/auth/auth-callback.config';

/**
 * Six things that must not exist anywhere in the callback layer, checked by reading the source.
 *
 * ── Why a grep is the right instrument ──────────────────────────────────────
 * Every rule here is about the *absence* of something, and a behavioural test can only prove a path it
 * thought to exercise. "No file logs an authorization code" is not provable by pressing buttons — it is
 * provable by reading every file and finding no logging of one. That is what this does, over the whole
 * of `src`, so a future screen inherits the guarantee without anybody remembering to write a test.
 *
 * It follows the pattern `privacy-security-source-scan.test.ts` established for passwords, applied to
 * the things a deep link can carry.
 */

const SRC_ROOT = join(__dirname, '..', '..', '..');
const ROOT = join(SRC_ROOT, '..');

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.endsWith('.ts') || entry.endsWith('.tsx') ? [path] : [];
  });
}

const ALL_SOURCE = sourceFiles(SRC_ROOT);

function relative(file: string): string {
  return file.replace(SRC_ROOT, '');
}

/** A file's executable text, so a comment explaining a rule cannot be what breaks it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every `console.*` call in a file, as source text. */
function consoleCalls(source: string): readonly string[] {
  return [...code(source).matchAll(/console\s*\.\s*[a-z]+\(([\s\S]{0,600}?)\)\s*;/g)].map(
    (match) => match[1] as string,
  );
}

describe('the callback URL is declared exactly once', () => {
  const CONFIG = join(SRC_ROOT, 'services', 'auth', 'auth-callback.config.ts');

  it('is the only file in src that spells the scheme in executable code', () => {
    /**
     * The value has to match a Supabase Dashboard allow-list entry exactly, and it is read by the
     * parser, three email actions, the setup checklist and the ADB commands used to verify all of it.
     * A string typed at five call sites is five strings after the next edit, and the failure mode is a
     * link that lands nowhere with nothing in the app looking wrong.
     */
    const offenders = ALL_SOURCE.filter(
      (file) => file !== CONFIG && code(readFileSync(file, 'utf8')).includes(AUTH_CALLBACK_SCHEME),
    ).map(relative);

    expect(offenders).toEqual([]);
  });

  it('is the only file that spells the callback path in executable code', () => {
    // `auth-callback-routes.ts` holds the *router* path as an Expo Router `Href`, which is a different
    // contract and is checked against this one by `callback-routing.test.tsx`.
    const ROUTES = join(SRC_ROOT, 'features', 'auth-callback', 'auth-callback-routes.ts');
    const offenders = ALL_SOURCE.filter(
      (file) =>
        file !== CONFIG &&
        file !== ROUTES &&
        code(readFileSync(file, 'utf8')).includes(AUTH_CALLBACK_PATH),
    ).map(relative);

    expect(offenders).toEqual([]);
  });

  it('is the value the phase documentation tells the operator to allow-list', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'PHASE_6C_3C_AUTH_CALLBACK_CONTRACT.md'), 'utf8');
    for (const entry of REQUIRED_SUPABASE_REDIRECT_URLS) {
      expect(doc).toContain(entry);
    }
    expect(doc).toContain(AUTH_CALLBACK_URL);
  });
});

describe('callback secrets are never logged', () => {
  it('no console call interpolates a code, token, flow id or callback URL', () => {
    /**
     * The check is on what a `console` call *contains*, not on which files log. A log line is the
     * easiest place for a credential to escape, and the one in `auth-callback.service.ts` is
     * deliberately narrow: `[auth-callback] code=<mapped>` where the value is a state word.
     *
     * `code=${code}` is permitted precisely because `code` there is the mapped `AuthCallbackErrorCode`.
     * What is forbidden is any interpolation of the authorization code, a token, the flow id, a
     * server-authored description or a URL.
     */
    const forbidden =
      /\$\{[^}]*\b(authCode|auth_code|accessToken|access_token|refreshToken|refresh_token|providerToken|flowId|sb_flow_id|errorDescription|error_description|verifier|codeVerifier|nonce)\b[^}]*\}/;

    const offenders = ALL_SOURCE.filter((file) =>
      consoleCalls(readFileSync(file, 'utf8')).some((call) => forbidden.test(call)),
    ).map(relative);

    expect(offenders).toEqual([]);
  });

  it('no console call logs a whole URL or a parsed callback object', () => {
    const forbidden =
      /\$\{[^}]*\b(url|href|callbackUrl|initialUrl|parsed|captured|callback)\b[^}]*\}/;

    const offenders = ALL_SOURCE.filter((file) =>
      consoleCalls(readFileSync(file, 'utf8')).some((call) => forbidden.test(call)),
    ).map(relative);

    expect(offenders).toEqual([]);
  });

  it('the parser and the config log nothing at all', () => {
    // The parser is the first thing an attacker-controllable string touches. No `console` in the file
    // means the URL it was handed physically cannot escape from there.
    for (const file of [
      'auth-callback-url.ts',
      'auth-callback.config.ts',
      'auth-callback.contract.ts',
    ]) {
      const source = readFileSync(join(SRC_ROOT, 'services', 'auth', file), 'utf8');
      expect(consoleCalls(source)).toEqual([]);
    }
  });

  it('the pending-destination filter logs nothing', () => {
    // Logging a refused value would be logging the thing that module exists to distrust.
    const source = readFileSync(
      join(SRC_ROOT, 'application', 'navigation', 'pending-destination.ts'),
      'utf8',
    );
    expect(consoleCalls(source)).toEqual([]);
  });
});

describe('implicit-flow tokens have no consumer', () => {
  it('nothing in the application calls setSession', () => {
    /**
     * The single highest-value thing a deep link could smuggle. Supporting a fragment-token callback
     * would mean taking an access and refresh token off an untrusted input and installing them as the
     * session, for a flow `flowType: 'pkce'` means this app never requests.
     *
     * The parser refuses such links, and this asserts there is nothing that could consume one even if a
     * future edit let it through.
     */
    /**
     * Matched on `auth.setSession(`, not on the bare name.
     *
     * `setSession` is also an ordinary `useState` setter — Faith's tasbih hook has one for a dhikr
     * session — and flagging those would be a scan that fails for reasons unrelated to what it is
     * checking, which is how a scan gets deleted.
     */
    const offenders = ALL_SOURCE.filter((file) =>
      /\bauth\s*\.\s*setSession\s*\(/.test(code(readFileSync(file, 'utf8'))),
    ).map(relative);

    expect(offenders).toEqual([]);
  });

  it('nothing reads an access or refresh token out of a URL', () => {
    const offenders = ALL_SOURCE.filter((file) => {
      const source = code(readFileSync(file, 'utf8'));
      return (
        /searchParams\s*\.\s*get\(\s*['"](access_token|refresh_token)['"]/.test(source) ||
        /getQueryParam\(\s*['"](access_token|refresh_token)['"]/.test(source)
      );
    }).map(relative);

    expect(offenders).toEqual([]);
  });
});

describe('the presentation layer never holds the Supabase client', () => {
  it('no file under features/auth-callback imports it', () => {
    // The same rule `profile-isolation.test.ts` applies to Profile, applied to this feature: screens
    // consume a port and never the client, which is what keeps the client on the service side.
    const featureFiles = sourceFiles(join(SRC_ROOT, 'features', 'auth-callback'));
    const offenders = featureFiles
      .filter((file) => {
        const source = code(readFileSync(file, 'utf8'));
        return (
          source.includes("from '@/lib/supabase'") ||
          source.includes('@supabase/supabase-js') ||
          /\bsupabase\s*\./.test(source)
        );
      })
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it('no app route file under app/auth does either', () => {
    const routeFiles = sourceFiles(join(SRC_ROOT, 'app', 'auth'));
    expect(routeFiles.length).toBeGreaterThan(0);
    for (const file of routeFiles) {
      const source = code(readFileSync(file, 'utf8'));
      expect(source).not.toContain('@/lib/supabase');
      expect(source).not.toContain('@supabase/supabase-js');
    }
  });
});

describe('the copy carries no secret and no invented claim', () => {
  /**
   * The strings, without the comments that explain the rules about them.
   *
   * The file's own documentation says why `error_description` is discarded and why "updated" would be
   * the wrong word on a pending state. Those sentences are the most useful part of it and must not be
   * what fails a scan looking for the words in the *copy*.
   */
  const copy = code(
    readFileSync(join(SRC_ROOT, 'features', 'auth-callback', 'auth-callback-copy.ts'), 'utf8'),
  );

  it('contains no URL, code or token placeholder', () => {
    // A "quote this reference to support" affordance was considered and rejected: the only reference
    // available is the code itself, and putting it on screen puts it in a screenshot.
    expect(copy).not.toContain('://');
    expect(copy).not.toMatch(/\berror_description\b/);
    expect(copy).not.toMatch(/\baccess_token\b/);
    expect(copy).not.toMatch(/\bsb_flow_id\b/);
  });

  it('never claims an email change is complete while one side is pending', () => {
    /**
     * "Updated" on a pending state would leave the user unable to sign in with the address they were
     * told they now use.
     *
     * The slice stops before `emailUnknown`, whose text legitimately contains "has changed" — as part of
     * "*nothing* about your account has changed", which is the opposite claim. Scanning past it would
     * fail on the one string that is being most careful.
     */
    const pendingSection = copy.slice(
      copy.indexOf('emailPendingTitle'),
      copy.indexOf('emailUnknown'),
    );
    expect(pendingSection.length).toBeGreaterThan(0);
    expect(pendingSection).not.toMatch(/is updated|is now|has changed|now sign in with/);
    // And the confirmed wording, which may say it, is not in this section at all.
    expect(pendingSection).not.toContain('emailChangedTitle');
  });

  it('reads the support address from configuration rather than restating it', () => {
    expect(copy).toContain('supportConfig.email');
    expect(copy).not.toContain('@nkdigitalworks.com');
  });
});

describe('account deletion is still nowhere', () => {
  it('is not introduced by this phase', () => {
    // Explicitly out of scope for 6C-3C, and a callback flow is exactly the kind of place a
    // "close my account" link would be quietly added.
    const featureFiles = sourceFiles(join(SRC_ROOT, 'features', 'auth-callback'));
    const serviceFiles = [
      'auth-callback.service.ts',
      'auth-callback-url.ts',
      'auth-callback.config.ts',
    ].map((name) => join(SRC_ROOT, 'services', 'auth', name));

    for (const file of [...featureFiles, ...serviceFiles]) {
      const source = code(readFileSync(file, 'utf8'));
      expect(source).not.toMatch(/\bdeleteUser\s*\(/);
      expect(source).not.toMatch(/auth\s*\.\s*admin\b/);
    }
  });
});
