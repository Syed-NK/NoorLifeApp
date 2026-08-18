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

/**
 * Presentation, and the one thing inside a feature folder that is not.
 *
 * ── Why `data/` is excluded, and why that is a narrowing rather than a hole ──
 * The rule this scope serves is "no screen touches the Supabase client". It was written when every
 * backend call lived under `src/services`, so "everything in `features` and `app`" was an exact
 * statement of it. This repository's own architecture then put a feature's repositories inside the
 * feature — `src/features/faith/data/*.repository.ts` — and the Quran Foundation adapter is one of
 * them: a data-layer module that invokes an Edge Function, sitting in the directory the architecture
 * says data-layer modules sit in.
 *
 * Excluding `data/` keeps the rule aimed at what it was aimed at. Screens, components, hooks and
 * route files are all still in scope, and so is every other directory of every feature — a screen
 * importing the client fails exactly as before. What is no longer flagged is a repository doing the
 * job repositories do, and `quran-foundation-contract.test.ts` holds *that* directory to a stricter
 * standard than this scan ever did: one invocation call site, no `fetch`, no URL construction, no
 * vendor hostname and no logging.
 */
const PRESENTATION_SOURCE = PRESENTATION_ROOTS.flatMap((root) => sourceFiles(root)).filter(
  (file) => !file.includes(`${sep}data${sep}`),
);

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
      return /\.\s*delete\s*\(\s*\)/.test(source) && /from\s*\(\s*['"]profiles['"]/.test(source);
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
      const source = readFileSync(join(SRC_ROOT, 'features', 'profile', 'screens', screen), 'utf8');
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

  /**
   * ── Why this assertion changed shape in Phase AI-2, and what was lost ───────
   * It used to be one line: `statSync('supabase/functions')` must throw. The *absence of the directory*
   * was the proxy for "the deferral in the document above is out of date", and as a tripwire it was
   * excellent — it fired on any Edge Function whatsoever, however that function was written.
   *
   * AI-2 added `supabase/functions/noor-ai`, so the proxy had to be replaced. It would be convenient to
   * claim the replacement is strictly stronger. **It is not**, and pretending otherwise is how a
   * guarantee quietly degrades: the old check needed no list of forbidden spellings, and any
   * content-based check does. An account-deletion path written through a Postgres driver, an RPC call or
   * the Admin REST API is caught only because the scans below were written to look for those too — not
   * because the instrument is inherently better.
   *
   * So the replacement is deliberately two assertions, not one, and the first is what preserves the
   * original's real value:
   *
   *   1. **The set of deployed functions is pinned.** A second function appearing fails the test exactly
   *      as the old check did, and forces a human to look at it. This is the tripwire, kept.
   *   2. **No function can reach privileged access or express a deletion.** This is the new part, and it
   *      covers a case the old check never did: a deletion capability added *inside* an
   *      already-approved function, which directory-existence could never have noticed.
   *
   * `docs/ACCOUNT_DELETION_ARCHITECTURE.md` remains the source of truth for the deferral itself, and the
   * two assertions above it still hold it to that.
   */
  const FUNCTIONS_ROOT = join(SRC_ROOT, '..', 'supabase', 'functions');

  /**
   * The Edge Functions this repository has reviewed and approved.
   *
   * `noor-ai` was AI-2's. `quran-content` is the server side of the Quran Foundation Content API
   * integration, added after production Content API access was approved on 2026-08-10: it holds the
   * vendor credential so the app cannot, proxies seven fixed content reads and nothing else, and is
   * declared with `verify_jwt = true` in `supabase/config.toml`. Its own scans live in
   * `supabase/functions/quran-content/tests/source-scan_test.ts`; the two assertions below still
   * apply to it, and it satisfies them by having no database client, no privileged role and no
   * destructive verb of any kind.
   */
  const APPROVED_FUNCTIONS = ['noor-ai', 'quran-content'];

  function functionDirectories(): readonly string[] {
    try {
      if (!statSync(FUNCTIONS_ROOT).isDirectory()) {
        return [];
      }
    } catch {
      // No Edge Function exists at all, which satisfies both assertions trivially.
      return [];
    }
    return readdirSync(FUNCTIONS_ROOT)
      .filter((entry) => statSync(join(FUNCTIONS_ROOT, entry)).isDirectory())
      .sort();
  }

  function functionSources(): readonly string[] {
    if (functionDirectories().length === 0) {
      return [];
    }
    // A function's own `tests/` directory is skipped for the same reason `sourceFiles` skips
    // `__tests__`: a scan asserting the absence of `DELETE FROM` necessarily contains the phrase.
    return sourceFiles(FUNCTIONS_ROOT).filter((file) => !file.includes(`${sep}tests${sep}`));
  }

  /**
   * A file's executable text, so a comment explaining a rule cannot be what breaks it.
   *
   * The same helper `auth-callback-source-scan.test.ts` uses, and needed here for the same reason: the
   * Edge Function documents its own prohibitions at length — `jwt-verifier.ts` explains why it does not
   * use `@supabase/server`, and `ports.ts` explains why `service_role` is unrepresentable. Scanning raw
   * text would fail on the files being most careful. Code cannot execute from inside a comment, so
   * stripping them narrows the scan to what the function can actually do.
   */
  function executable(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  it('deploys no Edge Function that has not been reviewed', () => {
    // The original tripwire, narrowed from "none at all" to "none beyond the approved list". Adding a
    // function is now a deliberate edit to `APPROVED_FUNCTIONS` rather than a silent green run.
    expect(functionDirectories()).toEqual(APPROVED_FUNCTIONS);
  });

  it('has no Edge Function that can delete an account', () => {
    const files = functionSources();
    // Guard: an empty file list would satisfy every pattern below and prove nothing.
    expect(files.length).toBeGreaterThan(0);

    /**
     * Two families, because deleting an account needs both a privileged reach and a destructive verb,
     * and the honest check is that neither exists rather than that one specific spelling does not.
     */
    const privilegedReach = [
      /@supabase\/(supabase-js|server)/,
      /\bcreateClient\s*\(/,
      /\bfrom\s+['"](npm:)?(postgres|pg|deno-postgres)/,
      /service_role|SERVICE_ROLE|SUPABASE_SECRET/,
    ];
    const destructiveVerb = [
      /\bDELETE FROM\b/i,
      /\.\s*delete\s*\(/,
      /\.\s*rpc\s*\(/,
      /method\s*:\s*['"]DELETE['"]/i,
    ];

    /**
     * The admin user API, banned outright.
     *
     * These are not "privileged reach" in general — they are the specific capability that deletes an
     * account, and there is no legitimate reason for any Edge Function in this repository to name one.
     * Kept as an absolute so the narrowing below cannot reach them.
     */
    const accountDeletionApi = [/\bauth\s*\.\s*admin\b/, /\bdeleteUser\b/, /\/auth\/v1\/admin/];

    const sources = files.map((file) => ({
      name: file.replace(FUNCTIONS_ROOT, ''),
      code: executable(readFileSync(file, 'utf8')),
    }));

    expect(
      sources
        .filter((file) => accountDeletionApi.some((pattern) => pattern.test(file.code)))
        .map((file) => file.name),
    ).toEqual([]);

    /**
     * Narrowed 2026-08-09 by the AI-3 quota integration, along the axis this test is actually about.
     *
     * Until then no Edge Function had any privileged reach at all, so flagging reach *or* a
     * destructive verb cost nothing. `noor-ai/quota-rpc.ts` now legitimately holds the platform
     * service-role secret to call five quota RPCs — and holds no destructive verb whatsoever: no
     * `DELETE`, no `.delete(`, no `DELETE` method, and no client that could express one.
     *
     * "Can delete an account" is the conjunction, not either half. Requiring both is what keeps this
     * test meaningful: a function that gains a destructive verb *next to* its privileged reach fails,
     * which is the change that would actually matter, while a reach with nothing to destroy does not
     * masquerade as a deletion capability.
     */
    const canDelete = sources.filter(
      (file) =>
        privilegedReach.some((pattern) => pattern.test(file.code)) &&
        destructiveVerb.some((pattern) => pattern.test(file.code)),
    );
    expect(canDelete.map((file) => file.name)).toEqual([]);

    // And the destructive verbs remain absolutely absent on their own, reach or no reach.
    expect(
      sources
        .filter((file) => destructiveVerb.some((pattern) => pattern.test(file.code)))
        .map((file) => file.name),
    ).toEqual([]);
  });
});
