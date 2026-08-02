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

describe('the fixture harness', () => {
  it('is guarded by __DEV__, so it cannot render in a release build', () => {
    const route = readFileSync(
      join(SRC_ROOT, 'app', 'profile', 'privacy-security', 'fixtures.tsx'),
      'utf8',
    );
    // The same guard `module-gallery` and `hero-audit` already use — a redirect, so a stale
    // development link lands on Main Home rather than on the not-found screen.
    expect(route).toContain('if (!__DEV__)');
    expect(route).toContain('<Redirect href={globalRoutes.home} />');
  });

  it('performs no network call in any fixture', () => {
    const harness = readFileSync(
      join(SRC_ROOT, 'features', 'profile', 'screens', 'privacy-security-fixtures-screen.tsx'),
      'utf8',
    );
    // Every port method resolves or rejects locally. A capture run must not be able to change an
    // account, which is exactly what the brief forbids.
    expect(harness).not.toContain('accountSecurityPort');
    expect(harness).not.toContain('fetch(');
    expect(harness).not.toContain('@/lib/supabase');
  });

  it('is the only place in the feature that constructs a port', () => {
    // Prose mentioning "fixture" is fine — several older screens explain why they have none. What
    // must stay unique is an *implementation* of the seam, which is what a `readSummary:` property
    // is. A second one would be a second set of states nobody is checking.
    const offenders = sourceFiles(join(SRC_ROOT, 'features', 'profile'))
      .filter((file) => /readSummary\s*:/.test(readFileSync(file, 'utf8')))
      .map(relative);

    expect(offenders).toEqual([
      `${sep}features${sep}profile${sep}screens${sep}privacy-security-fixtures-screen.tsx`,
    ]);
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
