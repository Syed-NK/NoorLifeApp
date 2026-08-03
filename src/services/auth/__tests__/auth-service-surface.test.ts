import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AUTH_CALLBACK_URL } from '../auth-callback.config';
import * as authService from '../auth.service';

/**
 * The guarantee that replaces `auth.service.ts`'s byte-for-byte lock.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `protected-files.test.ts` compared this service against the branch point byte for byte. Phase 6C-3C
 * had to change it — the phase brief instructs that the three email actions supply the approved
 * callback redirect from central configuration, and this file owned that redirect for two of them. The
 * lock was lifted through the repository's existing `REOPENED_ON_REQUEST` mechanism, with the reason
 * recorded there.
 *
 * A lifted lock with nothing in its place is how a file starts drifting. So this asserts the two
 * properties the lock was actually protecting:
 *
 *   1. the **exported surface** is exactly what it was at the branch point — nothing added, removed or
 *      renamed, so no new capability entered the authentication service under cover of a redirect edit;
 *   2. the change is **confined to callback wiring** — the diff against the branch point touches only
 *      the redirect helper and its import, and the file still handles no credential it did not already.
 *
 * Property 2 is checked as a real diff rather than as a description of one, because a description is
 * the thing that goes stale.
 */

const BASE_REF = 'feature/core-module-framework';
const FILE = 'src/services/auth/auth.service.ts';
const ROOT = join(__dirname, '..', '..', '..', '..');

function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function baseExists(): boolean {
  return git(['rev-parse', '--verify', BASE_REF]) !== null;
}

const available = baseExists();
const baseline = available ? git(['show', `${BASE_REF}:${FILE}`]) : null;
const current = readFileSync(join(ROOT, FILE), 'utf8');

/**
 * The file's executable text, with comments removed.
 *
 * Needed because the doc comment on `redirectTo` explains what the helper *used* to be — it quotes
 * `AuthSession.makeRedirectUri({ scheme: 'noorlifeapp' })` and says why that value was wrong. That
 * explanation is the most useful thing in the file and it must not be what makes a test fail. So the
 * "no scheme literal, no environment-resolved redirect" assertions read the code, and the comments are
 * free to describe the history.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Exported names, read out of the source rather than from the module, so types count too. */
function exportedNames(source: string): readonly string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm,
  )) {
    names.add(match[1] as string);
  }
  return [...names].sort();
}

describe('the exported surface', () => {
  it('can resolve the base ref to compare against', () => {
    // A protection test that quietly does nothing is worse than none, so this is asserted.
    expect(available).toBe(true);
    expect(baseline).not.toBeNull();
  });

  it('is identical to the branch point', () => {
    expect(exportedNames(current)).toEqual(exportedNames(baseline as string));
  });

  it('still exports every function the application depends on', () => {
    // Belt as well as braces: the list above is derived from text, this is the module itself.
    for (const name of [
      'signUpWithEmail',
      'signInWithEmail',
      'signOut',
      'sendPasswordReset',
      'updatePassword',
      'resendVerificationEmail',
      'verifyOtp',
      'exchangeCodeForSession',
      'signInWithGoogle',
      'signInWithApple',
      'getSession',
      'subscribeToAuthChanges',
      'getProfile',
      'setOnboardingCompleted',
      'getRedirectUri',
      'toAuthErrorCode',
    ]) {
      expect(typeof (authService as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

describe('the diff against the branch point', () => {
  /** Changed lines only, without the diff's own context and headers. */
  function changedLines(): readonly string[] {
    const diff = git(['diff', '--unified=0', BASE_REF, '--', FILE]);
    if (diff === null) {
      return [];
    }
    return diff
      .split('\n')
      .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
      .map((line) => line.slice(1).trim())
      .filter((line) => line.length > 0);
  }

  it('touches only the redirect helper, its import and the comment explaining both', () => {
    const changed = changedLines();
    expect(changed.length).toBeGreaterThan(0);

    /**
     * Every changed line must be one of these.
     *
     * A comment, the two import lines, or something inside the `redirectTo` helper. Anything else — a
     * new call, a changed error mapping, an added log — fails, which is the point: the recorded reason
     * for lifting the lock was callback wiring, and this is what holds the change to it.
     */
    const permitted = (line: string): boolean =>
      line.startsWith('*') ||
      line.startsWith('/*') ||
      line.startsWith('//') ||
      line === '*/' ||
      line === '}' ||
      /^import \* as AuthSession from 'expo-auth-session';$/.test(line) ||
      /^import \{ authCallbackRedirectUrl \} from '\.\/auth-callback\.config';$/.test(line) ||
      /^let cachedRedirect/.test(line) ||
      /^function redirectTo\(\): string \{$/.test(line) ||
      /^if \(cachedRedirect === null\) \{$/.test(line) ||
      /^cachedRedirect = AuthSession\.makeRedirectUri/.test(line) ||
      /^return cachedRedirect;$/.test(line) ||
      /^return authCallbackRedirectUrl\(\);$/.test(line);

    expect(changed.filter((line) => !permitted(line))).toEqual([]);
  });
});

describe('the callback redirect', () => {
  it('comes from central configuration rather than a literal', () => {
    expect(current).toContain("import { authCallbackRedirectUrl } from './auth-callback.config'");
    // The scheme is declared once, in the config. A second copy here is the drift this prevents.
    expect(code(current)).not.toContain('noorlifeapp');
  });

  it('is what the three email actions and the setup checklist all report', () => {
    expect(authService.getRedirectUri()).toBe(AUTH_CALLBACK_URL);
  });

  it('no longer resolves the redirect from the execution environment', () => {
    // `makeRedirectUri` returns a LAN address under Expo Go, which cannot be allow-listed in the
    // Supabase Dashboard honestly. See `auth-callback.config.ts`.
    expect(code(current)).not.toContain('makeRedirectUri');
    expect(code(current)).not.toContain('expo-auth-session');
  });
});

describe('what the service still never does', () => {
  it('holds no service-role key, JWT or provider secret', () => {
    expect(current).not.toMatch(/service_role|SERVICE_ROLE/i);
    expect(current).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(current).not.toMatch(/GOCSPX-/);
  });

  it('logs no credential, token or code', () => {
    /**
     * Every `console` call in the file, checked for a forbidden interpolation.
     *
     * The service's own diagnostic logs an operation name, a status, a provider code and a message.
     * What must never appear is a password, a session, a token or an authorization code — and a log
     * line is the easiest place for one to escape.
     */
    for (const match of current.matchAll(/console\.[a-z]+\(([\s\S]{0,400}?)\);/g)) {
      const call = match[1] as string;
      expect(call).not.toMatch(/\b(password|access_token|refresh_token|session|nonce|token)\b/);
      expect(call).not.toMatch(/\bcode\b(?!=\$\{)/);
    }
  });
});
