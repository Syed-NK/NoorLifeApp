import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * The source scan: five things that must not exist anywhere in this application.
 *
 * ── Why a grep is the right instrument here ─────────────────────────────────
 * Every rule below is about the *absence* of something, and a behavioural test can only prove a
 * path it thought to exercise. "No screen logs a password" is not provable by pressing buttons —
 * it is provable by reading every file and finding no logging of a password. That is what this
 * does, over the whole of `src`, so a future screen inherits the guarantee without anybody
 * remembering to write a test for it.
 */

const SRC_ROOT = join(__dirname, '..', '..', '..');
const PRESENTATION_ROOTS = ['features', 'app'].map((entry) => join(SRC_ROOT, entry));

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
const PRESENTATION_SOURCE = PRESENTATION_ROOTS.flatMap((root) => sourceFiles(root));

function relative(file: string): string {
  return file.replace(SRC_ROOT, '');
}

describe('the service-role key', () => {
  it('appears nowhere in the application', () => {
    // It bypasses Row Level Security entirely. Anything prefixed EXPO_PUBLIC_ is inlined into the
    // bundle and readable by anyone who unzips the APK, so one literal here is a total compromise.
    const offenders = ALL_SOURCE.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        source.includes('service_role') ||
        source.includes('serviceRoleKey') ||
        source.includes('SERVICE_ROLE') ||
        /SUPABASE_SECRET/i.test(source)
      );
    }).map(relative);

    expect(offenders).toEqual([]);
  });

  it('is not referenced by the environment example either', () => {
    const example = readFileSync(join(SRC_ROOT, '..', '.env.example'), 'utf8');
    expect(example).not.toMatch(/service_role|SERVICE_ROLE/i);
  });
});

describe('auth admin APIs', () => {
  it('are never called from the client', () => {
    // `auth.admin.deleteUser` is the shortcut this phase exists to refuse. It needs the
    // service-role key, and it is how a mobile client would delete an account it has no right to.
    const offenders = ALL_SOURCE.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        /auth\s*\.\s*admin\b/.test(source) ||
        /\bdeleteUser\s*\(/.test(source) ||
        /GoTrueAdminApi/.test(source)
      );
    }).map(relative);

    expect(offenders).toEqual([]);
  });

  it('leaves no account-deletion call of any kind', () => {
    const offenders = ALL_SOURCE.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        /\.\s*delete\s*\(\s*\)/.test(source) && /from\s*\(\s*['"]profiles['"]/.test(source)
      );
    }).map(relative);

    // Deleting the profile row while `auth.users` keeps the credential produces an account that
    // can still sign in and has lost its name. Worse than not deleting.
    expect(offenders).toEqual([]);
  });
});

describe('the Supabase client', () => {
  it('is never imported by presentation', () => {
    const offenders = PRESENTATION_SOURCE.filter((file) => {
      const source = readFileSync(file, 'utf8');
      const imports = source
        .split('\n')
        .filter((line) => line.trimStart().startsWith('import'))
        .join('\n');
      return (
        imports.includes('@/lib/supabase') ||
        imports.includes('@supabase/supabase-js') ||
        source.includes('createClient(')
      );
    }).map(relative);

    expect(offenders).toEqual([]);
  });

  it('is created in exactly one place', () => {
    const creators = ALL_SOURCE.filter((file) =>
      readFileSync(file, 'utf8').includes('createClient('),
    ).map(relative);

    expect(creators).toEqual([`${sep}lib${sep}supabase.ts`]);
  });
});

describe('credential logging', () => {
  const LOG_CALL = /console\s*\.\s*(log|warn|error|info|debug|trace)\s*\(/g;

  it('never logs a password, a nonce or a form payload', () => {
    const offenders: string[] = [];

    for (const file of ALL_SOURCE) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(LOG_CALL)) {
        // The argument list, up to the end of the statement. Crude on purpose: a false positive
        // here is a line somebody has to justify, which is the right direction to be wrong in.
        const start = (match.index ?? 0) + match[0].length;
        const argument = source.slice(start, start + 400);
        if (
          /\bpassword\b/i.test(argument) ||
          /\bnonce\b/i.test(argument) ||
          /\bnewPassword\b/.test(argument) ||
          /\bconfirm\b/.test(argument) ||
          /\baccess_token\b/.test(argument) ||
          /\brefresh_token\b/.test(argument)
        ) {
          offenders.push(`${relative(file)} :: ${argument.slice(0, 80)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('leaves the account-security service silent entirely', () => {
    // The one module that handles a password, an emailed nonce and an address. A log line is the
    // easiest place for any of the three to escape, so it has none at all.
    const source = readFileSync(
      join(SRC_ROOT, 'services', 'account', 'account-security.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/console\s*\./);
  });

  it('leaves the three Privacy & Security screens silent entirely', () => {
    for (const screen of [
      'privacy-security-screen.tsx',
      'change-password-screen.tsx',
      'change-email-screen.tsx',
    ]) {
      const source = readFileSync(
        join(SRC_ROOT, 'features', 'profile', 'screens', screen),
        'utf8',
      );
      expect(source).not.toMatch(/console\s*\./);
    }
  });
});

describe('credential persistence', () => {
  it('never writes a password to storage', () => {
    const offenders = ALL_SOURCE.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /(setItem|setItemAsync|setStringAsync)\s*\([^)]*password/i.test(source);
    }).map(relative);

    expect(offenders).toEqual([]);
  });

  it('never puts a token in plain device storage', () => {
    const offenders = ALL_SOURCE.filter((file) => {
      const source = readFileSync(file, 'utf8');
      // The Supabase SDK's own AsyncStorage session is the documented exception and lives in
      // `lib/supabase.ts`; nothing else may write a token to unencrypted storage.
      return (
        !file.endsWith(join('lib', 'supabase.ts')) &&
        /AsyncStorage\s*\.\s*setItem\s*\([^)]*(token|Token)/.test(source)
      );
    }).map(relative);

    expect(offenders).toEqual([]);
  });
});

/**
 * The fixture harness, after Phase 6C-3B removed it from the route tree.
 *
 * ── The claim that was wrong ────────────────────────────────────────────────
 * 6C-3A shipped the harness as a real Expo Router route guarded by `if (!__DEV__)`. The guard
 * stops it *rendering*; it does not stop Metro compiling it, because the route file's import is
 * unconditional. So the fixture screen, its five state names and its fixture address were all in
 * the release bundle, and the report that said `__DEV__` removed them was disproved by a grep of
 * the bundle it described.
 *
 * The route and the screen are deleted. The states survive as data under `src/test-support/`,
 * which Expo Router does not scan and which nothing in `src/app` or `src/features` may import —
 * both asserted below, so the fix cannot be undone by a later import.
 */
describe('the fixture harness', () => {
  it('has no route in the production route tree', () => {
    const routes = sourceFiles(join(SRC_ROOT, 'app')).map(relative);
    expect(routes.filter((file) => /fixture/i.test(file))).toEqual([]);
  });

  it('leaves no fixture screen in the feature', () => {
    const screens = sourceFiles(join(SRC_ROOT, 'features')).map(relative);
    expect(screens.filter((file) => /fixture/i.test(file))).toEqual([]);
  });

  it('is not importable from any production module', () => {
    // The whole point of the move. A single `@/test-support/…` import from `app` or `features`
    // would put the states straight back into the bundle, and would do it silently.
    const offenders = PRESENTATION_SOURCE.filter((file) =>
      readFileSync(file, 'utf8').includes('test-support'),
    ).map(relative);

    expect(offenders).toEqual([]);
  });

  it('performs no network call in any fixture', () => {
    const harness = readFileSync(
      join(SRC_ROOT, 'test-support', 'account-security-fixtures.ts'),
      'utf8',
    );
    // Every port method resolves or rejects in memory. A capture run must not be able to change an
    // account, which is exactly what the brief forbids.
    expect(harness).not.toContain('accountSecurityPort');
    expect(harness).not.toContain('fetch(');
    expect(harness).not.toContain('@/lib/supabase');
  });

  it('carries no credential and no address that could receive mail', () => {
    const harness = readFileSync(
      join(SRC_ROOT, 'test-support', 'account-security-fixtures.ts'),
      'utf8',
    );
    // RFC 2606 reserves example.com precisely so a fixture address cannot reach a real mailbox.
    for (const address of harness.matchAll(/[\w.+-]+@[\w.-]+/g)) {
      expect(address[0]).toMatch(/@example\.com$/);
    }
    expect(harness).not.toMatch(/password\s*[:=]\s*['"]/i);
  });

  it('constructs a port nowhere inside the Profile feature', () => {
    // Prose mentioning "fixture" is fine — several screens explain why they have none. What must
    // not exist under `features` is an *implementation* of the seam, which is what a `readSummary:`
    // property is: that is production code carrying a fake account.
    const offenders = sourceFiles(join(SRC_ROOT, 'features', 'profile'))
      .filter((file) => /readSummary\s*:/.test(readFileSync(file, 'utf8')))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it('records the routes that still have the pattern rather than quietly leaving them', () => {
    // `module-gallery` and `hero-audit` are `__DEV__`-guarded routes from earlier phases with the
    // same inclusion problem. They are out of scope for this session by instruction, so they are
    // written down instead — a backlog entry a test keeps honest, not a comment nobody re-reads.
    const backlog = readFileSync(join(SRC_ROOT, '..', 'docs', 'DEV_ROUTE_BACKLOG.md'), 'utf8');
    for (const route of ['module-gallery', 'hero-audit']) {
      expect(backlog).toContain(route);
      // The route must still exist for the entry to be about anything.
      expect(sourceFiles(join(SRC_ROOT, 'app')).map(relative).join('\n')).toContain(route);
    }
  });
});

describe('the deletion architecture', () => {
  it('is documented, since it is not implemented', () => {
    const doc = readFileSync(
      join(SRC_ROOT, '..', 'docs', 'ACCOUNT_DELETION_ARCHITECTURE.md'),
      'utf8',
    );

    for (const requirement of [
      'Edge Function',
      'Reauthentication',
      'confirm',
      'Anonymize',
      'subscription',
      'Idempotency',
      'Failure recovery',
      'Store-policy',
    ]) {
      expect(doc).toContain(requirement);
    }
  });

  it('records that nothing in the repository deletes an account', () => {
    const doc = readFileSync(
      join(SRC_ROOT, '..', 'docs', 'ACCOUNT_DELETION_ARCHITECTURE.md'),
      'utf8',
    );
    expect(doc).toContain('Nothing in this repository deletes an account');
  });

  it('has no Edge Function deployed in this phase', () => {
    // The scan is the assertion: a `supabase/functions` directory appearing means the deferral in
    // the document above is out of date.
    let functionsExist = false;
    try {
      functionsExist = statSync(join(SRC_ROOT, '..', 'supabase', 'functions')).isDirectory();
    } catch {
      functionsExist = false;
    }
    expect(functionsExist).toBe(false);
  });
});
