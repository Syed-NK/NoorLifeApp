import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Security contract tests for the Supabase layer.
 *
 * These assert the properties §13, §14 and §19 care about — no service-role key, no provider secret, no
 * credential in the repository, and RLS that actually confines a user to their own row. They read the
 * migration and the source as text on purpose: the point is to catch a future edit that quietly drops a
 * policy or pastes a key, which a runtime test against a mock could never see.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

function readMigration(): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')).join('\n');
}

describe('supabase project files', () => {
  it('ships config, migrations and a seed', () => {
    expect(existsSync(join(ROOT, 'supabase', 'config.toml'))).toBe(true);
    expect(existsSync(join(ROOT, 'supabase', 'seed.sql'))).toBe(true);
    expect(readdirSync(MIGRATIONS).some((f) => f.endsWith('.sql'))).toBe(true);
  });

  it('names migrations with a sortable timestamp', () => {
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
  });
});

describe('profiles table', () => {
  const sql = readMigration();

  it('keys the profile to auth.users and cascades on delete', () => {
    expect(sql).toMatch(/id uuid primary key references auth\.users \(id\) on delete cascade/i);
  });

  it('declares every required column', () => {
    for (const column of [
      'full_name text',
      'avatar_url text',
      'onboarding_completed boolean not null default false',
      'created_at timestamptz not null default now()',
      'updated_at timestamptz not null default now()',
    ]) {
      expect(sql.toLowerCase()).toContain(column);
    }
  });

  it('maintains updated_at with a trigger rather than trusting the client', () => {
    expect(sql).toMatch(/create trigger profiles_set_updated_at/i);
    expect(sql).toMatch(/before update on public\.profiles/i);
  });

  it('provisions a profile from the auth-user trigger, reading the documented fields', () => {
    expect(sql).toMatch(/after insert on auth\.users/i);
    expect(sql).toContain('new.id');
    expect(sql).toContain("new.raw_user_meta_data ->> 'full_name'");
    expect(sql).toContain("new.raw_user_meta_data ->> 'avatar_url'");
  });

  it('indexes the column the entry gate queries', () => {
    expect(sql).toMatch(/create index if not exists profiles_onboarding_completed_idx/i);
  });
});

describe('row level security', () => {
  const sql = readMigration();

  it('is enabled and forced', () => {
    expect(sql).toMatch(/alter table public\.profiles enable row level security/i);
    // FORCE applies the policies to the table owner too, so a mistake elsewhere cannot read around them.
    expect(sql).toMatch(/alter table public\.profiles force row level security/i);
  });

  it('confines select, insert and update to the owner', () => {
    for (const policy of ['profiles_select_own', 'profiles_insert_own', 'profiles_update_own']) {
      expect(sql).toContain(policy);
    }
    // Three separate auth.uid() comparisons: one per policy.
    expect(sql.match(/auth\.uid\(\)\) = id/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('guards update with WITH CHECK as well as USING', () => {
    // USING alone would let a user update their own row and reassign `id`, handing the row away.
    const updatePolicy = sql.slice(sql.indexOf('profiles_update_own'));
    expect(updatePolicy).toMatch(/using \(\(select auth\.uid\(\)\) = id\)/i);
    expect(updatePolicy).toMatch(/with check \(\(select auth\.uid\(\)\) = id\)/i);
  });

  it('scopes every policy to authenticated and revokes anon', () => {
    expect(sql.match(/to authenticated/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/revoke all on public\.profiles from anon/i);
  });

  it('pins search_path on the security-definer function', () => {
    // An unpinned search_path lets a schema planted earlier hijack a definer-rights call.
    const definer = sql.slice(sql.indexOf('handle_new_user'));
    expect(definer).toMatch(/security definer/i);
    expect(definer).toMatch(/set search_path = ''/i);
  });
});

describe('no secrets in the repository', () => {
  const sql = readMigration();
  const client = readFileSync(join(ROOT, 'src', 'lib', 'supabase.ts'), 'utf8');
  const service = readFileSync(join(ROOT, 'src', 'services', 'auth', 'auth.service.ts'), 'utf8');
  const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');

  // Deliberately split 2026-08-08 by the NoorAI service-role RPC pivot.
  //
  // The APP must still never mention service_role at all — it holds only the publishable key, and any
  // appearance there would mean the broad key had reached the client bundle. That prohibition is
  // unchanged and is the one that protects users.
  //
  // The MIGRATIONS now legitimately name `service_role`, because the quota RPCs grant EXECUTE to that
  // database role — that IS the approved architecture. What they must never contain is a service-role
  // *key*: the role name is a grantee, the key is a secret. Conflating the two would either force the
  // architecture to lie about itself or leave the real hazard untested.
  it('never mentions the service role in any app source', () => {
    for (const source of [client, service]) {
      expect(source).not.toMatch(/service_role/i);
      expect(source).not.toMatch(/SERVICE_ROLE_KEY/);
    }
  });

  /**
   * The whole of `src/`, not two hand-picked files.
   *
   * Widened 2026-08-09 by the AI-3 quota integration. That phase introduces exactly one module that
   * legitimately names the platform service-role secret — the Edge Function's quota adapter, which
   * runs on the server and is never bundled. The mobile app holds the publishable key and nothing
   * else, so the guard that actually protects users is "no service-role access path anywhere in the
   * shipped application source", and checking two files could never have established that.
   *
   * `supabase/functions/` is deliberately out of scope here: it is server code, it is not part of the
   * app bundle, and its own containment is asserted by `tests/source-scan_test.ts`, which pins the
   * secret name to a single file by exact equality.
   */
  /**
   * Walks `src/`, returning the repo-relative paths whose text matches.
   *
   * `shippedOnly` drops `__tests__` and `test-support`: those files are not in the app bundle, and a
   * test that asserts a string must be absent necessarily contains that string. It is the same
   * exclusion the Edge Function's own scan makes for `source-scan_test.ts`, and it is a scoping
   * decision rather than a loophole — the value-shaped scan below deliberately keeps *no* exclusion.
   */
  const scanSrc = (
    pattern: RegExp,
    { shippedOnly, stripComments }: { shippedOnly: boolean; stripComments: boolean },
  ): string[] => {
    const found: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (shippedOnly && /^(__tests__|test-support|__mocks__)$/.test(entry.name)) continue;
          walk(join(directory, entry.name));
          continue;
        }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
        const path = join(directory, entry.name);
        const raw = readFileSync(path, 'utf8');
        const text = stripComments
          ? raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
          : raw;
        if (pattern.test(text)) found.push(path.slice(ROOT.length + 1).replace(/\\/g, '/'));
      }
    };
    walk(join(ROOT, 'src'));
    return found.sort();
  };

  it('contains no service-role secret name or access path anywhere in the app bundle source', () => {
    expect(
      scanSrc(
        /service_role|serviceRole|SERVICE_ROLE|supabaseAdmin|createAdminClient|auth\s*\.\s*admin/,
        { shippedOnly: true, stripComments: true },
      ),
    ).toEqual([]);
  });

  it('embeds no secret-shaped credential anywhere under src, tests included', () => {
    /**
     * No exclusion at all, and no comment stripping. A key pasted into a fixture is committed key
     * material regardless of which directory it landed in or whether somebody commented it out.
     */
    expect(
      scanSrc(
        /sb_secret_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
        {
          shippedOnly: false,
          stripComments: false,
        },
      ),
    ).toEqual([]);
  });

  /**
   * Added 2026-08-09 by the AI-3 provider adapter.
   *
   * That phase introduces exactly one module that may contact OpenAI — the Edge Function's
   * `supabase/functions/noor-ai/openai-provider.ts`, which runs on the server and is never bundled.
   * The mobile app must not name the provider key, the provider host, the endpoint, or any SDK: an
   * `EXPO_PUBLIC_*` variable is inlined into the shipped bundle, so a provider credential reaching
   * `src/` at all is the specific mistake §B.2 exists to prevent.
   *
   * `supabase/functions/` is deliberately out of scope here, exactly as for the service-role guard:
   * it is server code, and its own containment is asserted by `tests/source-scan_test.ts`, which pins
   * both the host and the key name to a single file by exact equality.
   */
  it('the mobile app names no OpenAI key, host, endpoint or SDK', () => {
    expect(
      scanSrc(
        /OPENAI_API_KEY|OPENAI_ORG|OPENAI_PROJECT|OPENAI_BASE_URL|api\.openai\.com|\/v1\/responses|from\s+['"](npm:)?openai|@ai-sdk|langchain/i,
        { shippedOnly: true, stripComments: true },
      ),
    ).toEqual([]);
  });

  it('embeds no OpenAI-shaped key anywhere under src, tests included', () => {
    // No exclusion and no comment stripping: a key pasted into a fixture is committed key material.
    expect(
      scanSrc(/sk-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{8,}/, {
        shippedOnly: false,
        stripComments: false,
      }),
    ).toEqual([]);
  });

  it('the Edge Function keeps provider reach in one file, and the production gate stays shut', () => {
    /**
     * The complement of the scan above, read from the other side of the boundary. It is a coarse
     * check on purpose — `tests/source-scan_test.ts` owns the exact-equality assertions — but it runs
     * in the Jest suite, which is the one a developer runs by habit, so a second file gaining provider
     * reach is caught even if nobody provisions Deno that day.
     */
    const fn = join(ROOT, 'supabase', 'functions', 'noor-ai');
    const named = readdirSync(fn)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) =>
        /api\.openai\.com/.test(
          readFileSync(join(fn, f), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, ''),
        ),
      );
    expect(named).toEqual(['openai-provider.ts']);

    /**
     * B10 is now implemented as a per-user derivation, and the construction-time option the previous
     * revision of this test pinned has been **removed** rather than filled in — it was fixed when the
     * adapter was built, and the graph is built once per isolate, so any value there would have been
     * one constant shared by every user.
     *
     * What replaces it: the graph wires a dedicated deriver port, and §I.2's kill switch is still a
     * source constant rather than an environment lookup.
     */
    const wiring = readFileSync(join(fn, 'production.ts'), 'utf8');
    expect(wiring).not.toMatch(/staticSafetyIdentifier/);
    expect(wiring).toMatch(/safetyIdentifiers:\s*createProductionSafetyIdentifierDeriver\(\)/);
    // And §I.2's kill switch is a constant, not an environment lookup.
    expect(wiring).toMatch(/enabled:\s*false/);
    expect(wiring).not.toMatch(/enabled:\s*.*Deno\.env/);
  });

  /**
   * Added 2026-08-09 by B10 — the per-user OpenAI `safety_identifier`.
   *
   * Two claims, and they are about different sides of the same boundary.
   *
   * **The app knows nothing about it.** There is no field, header, query parameter or configuration
   * value for a safety identifier anywhere in `src/`, no reference to the HMAC secret name, and no
   * derivation of any kind. The mobile client cannot supply, seed, override or even observe the value:
   * it is derived server-side from the verified JWT subject, and the Edge Function's own request schema
   * rejects every identity-shaped field name before anything is derived.
   *
   * **The server keeps it in one module.** The exact-equality assertions live in
   * `supabase/functions/noor-ai/tests/source-scan_test.ts`; this is the coarse version that runs in the
   * suite a developer runs by habit, so a second file gaining key material is caught even if nobody
   * provisions Deno that day.
   */
  it('the mobile app has no safety identifier, no HMAC key name and no derivation', () => {
    expect(
      scanSrc(/NOOR_AI_SAFETY_HMAC_KEY|safety_identifier|safetyIdentifier|nl_osi_/i, {
        shippedOnly: true,
        stripComments: true,
      }),
    ).toEqual([]);
    /**
     * No app module holds key material or signs anything.
     *
     * Deliberately **not** a scan for `crypto.subtle`: `src/services/auth/web-crypto.ts` legitimately
     * installs a `subtle.digest` polyfill so `supabase-js` can compute a PKCE `S256` code challenge on
     * React Native, and banning the whole namespace would ban that. What must be absent is the
     * capability B10 needs — importing a key and signing with it — because an app that could do either
     * is an app that could be given a secret to do it with.
     */
    expect(
      scanSrc(/importKey|subtle\s*\.\s*sign|createHmac|\bHMAC\b/i, {
        shippedOnly: true,
        stripComments: true,
      }),
    ).toEqual([]);
    /**
     * And no key-shaped 32-byte literal is committed anywhere under src, tests included.
     *
     * 43 base64url characters is exactly what a 32-byte key encodes to, but `-` and `_` are also what
     * this codebase's testIDs are made of, so length alone flags strings like
     * `privacy-security-ai-assistant-noor-ai-value`. The two lookaheads require an uppercase letter and
     * a digit as well, which every kebab-case identifier lacks and which random key material has with
     * overwhelming probability — the chance a real 32-byte key contains no uppercase character at all
     * is about `(38/64)^43`, which is far below the odds of anything else this suite guards against.
     */
    expect(
      scanSrc(
        /['"`](?=[A-Za-z0-9_-]{43}['"`])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{43}['"`]/,
        { shippedOnly: false, stripComments: false },
      ),
    ).toEqual([]);
  });

  it('the Edge Function names the HMAC secret in exactly one server-side module', () => {
    const fn = join(ROOT, 'supabase', 'functions', 'noor-ai');
    const strip = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const named = readdirSync(fn)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /NOOR_AI_SAFETY_HMAC_KEY/.test(strip(readFileSync(join(fn, f), 'utf8'))));
    expect(named).toEqual(['safety-identifier.ts']);

    const module = strip(readFileSync(join(fn, 'safety-identifier.ts'), 'utf8'));
    // The reserved name, the active version as a source constant, and no v2 read.
    expect(module).toMatch(/Deno\.env\.get\(\s*'NOOR_AI_SAFETY_HMAC_KEY_V1'\s*\)/);
    expect(module).not.toMatch(/NOOR_AI_SAFETY_HMAC_KEY_V2/);
    expect(module).toMatch(/SAFETY_IDENTIFIER_ACTIVE_VERSION = 'v1'/);
    // The key is imported non-extractably, for signing only, and never exported.
    expect(module).toMatch(/importKey\('raw',[\s\S]*?false,\s*\['sign'\]/);
    expect(module).not.toMatch(/extractable:\s*true|exportKey/);
    // It logs nothing and throws nothing, so no secret can escape through a message.
    expect(module).not.toMatch(/console\s*\.\s*[a-z]+\s*\(/);
    expect(module).not.toMatch(/throw new/);
    // And no value for it exists in this repository.
    expect(module).not.toMatch(/['"`][A-Za-z0-9_-]{43}['"`]/);
  });

  it('the mobile app reaches no Noor AI quota RPC and no private schema', () => {
    /**
     * The quota wrappers are executable by `service_role` alone, so the app could not call them even
     * if it tried — `anon` and `authenticated` hold no EXECUTE. This asserts the app does not even
     * reference them, which keeps the boundary legible as well as enforced.
     */
    expect(
      scanSrc(
        /noor_ai_reserve|noor_ai_register_attempt|noor_ai_finalize|noor_ai_release|noor_ai_status|noor_ai\./,
        { shippedOnly: true, stripComments: false },
      ),
    ).toEqual([]);
  });

  it('never embeds a service-role key in SQL, only the role name as a grantee', () => {
    expect(sql).not.toMatch(/SERVICE_ROLE_KEY/);
    expect(sql).not.toMatch(/service[_-]?role[_-]?key/i);
    // A Supabase secret/JWT-shaped literal must never appear.
    expect(sql).not.toMatch(/sb_secret_|sbp_|eyJ[A-Za-z0-9_-]{10,}/);
    // Every mention must be a grant/revoke of the role, never an assignment of a value to it.
    for (const line of sql.split('\n').filter((l) => /service_role/i.test(l))) {
      expect(line).toMatch(/grant|revoke|--/i);
      expect(line).not.toMatch(/=\s*'/);
    }
  });

  it('reads only the publishable key from the environment', () => {
    expect(client).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(client).toContain('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(envExample).toContain('EXPO_PUBLIC_SUPABASE_URL=');
    expect(envExample).toContain('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=');
  });

  it('ships the template with no values filled in', () => {
    for (const line of envExample.split('\n')) {
      if (line.startsWith('EXPO_PUBLIC_')) {
        expect(line).toMatch(/=$/);
      }
    }
  });

  it('carries no JWT, private key or client secret literal', () => {
    for (const source of [client, service, sql, envExample]) {
      // A Supabase key is a JWT; PEM blocks and Google client secrets have equally distinctive shapes.
      expect(source).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
      expect(source).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(source).not.toMatch(/GOCSPX-/);
    }
  });

  it('stores no credential, OTP or provider token in the profiles table', () => {
    for (const forbidden of ['password', 'otp', 'access_token', 'refresh_token', 'client_secret']) {
      // The word may appear in a comment; what must not exist is a column of that name.
      expect(sql).not.toMatch(new RegExp(`^\\s+${forbidden}\\s+(text|uuid|jsonb)`, 'im'));
    }
  });
});

describe('profiles least-privilege convergence (20260808120000)', () => {
  /**
   * B18: a hosted read-only audit found `authenticated` holding all eight table privileges on
   * public.profiles — five more than this repository intends. These assertions read the correcting
   * migration on its own, not the concatenation, because the properties under test are absences and
   * an earlier file legitimately contains what this one must not.
   *
   * Comment lines are stripped first. The migration explains RLS, the elevated role and the default
   * privileges in prose on purpose; asserting over raw text would match that prose and fail for the
   * wrong reason.
   */
  const FILE = '20260808120000_profiles_least_privilege.sql';
  const raw = readFileSync(join(MIGRATIONS, FILE), 'utf8');
  const statements = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  const grantMatches = [
    ...statements.matchAll(
      /grant\s+([^;]+?)\s+on\s+table\s+public\.profiles\s+to\s+authenticated/gi,
    ),
  ];
  const grantedPrivileges = (grantMatches[0]?.[1] ?? '')
    .split(',')
    .map((privilege) => privilege.trim().toLowerCase())
    .filter((privilege) => privilege.length > 0)
    .sort();

  it('revokes from authenticated before granting, so the end state cannot depend on the start state', () => {
    const revokeAt = statements.search(
      /revoke all privileges on table public\.profiles from authenticated/i,
    );
    const grantAt = statements.search(
      /grant select, insert, update on table public\.profiles to authenticated/i,
    );
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeGreaterThanOrEqual(0);
    // Grant-after-revoke is the whole mechanism. Reversed, the migration would be a no-op.
    expect(grantAt).toBeGreaterThan(revokeAt);
  });

  it('grants authenticated exactly select, insert and update', () => {
    expect(grantMatches).toHaveLength(1);
    expect(grantedPrivileges).toEqual(['insert', 'select', 'update']);
  });

  it('grants authenticated none of the five privileges the audit found unintended', () => {
    for (const privilege of ['delete', 'truncate', 'references', 'trigger', 'maintain']) {
      expect(grantedPrivileges).not.toContain(privilege);
    }
    // Belt and braces: no grant statement anywhere in the file may mention them.
    expect(statements).not.toMatch(/grant[^;]*\b(delete|truncate|references|trigger|maintain)\b/i);
  });

  it('re-asserts revoke all for anon and PUBLIC', () => {
    expect(statements).toMatch(/revoke all privileges on table public\.profiles from anon;/i);
    expect(statements).toMatch(/revoke all privileges on table public\.profiles from public;/i);
  });

  it('changes nothing but privileges on one table', () => {
    expect(statements).not.toMatch(/row level security/i);
    expect(statements).not.toMatch(/(create|drop|alter) policy/i);
    expect(statements).not.toMatch(/(create|drop|alter)( or replace)? function/i);
    expect(statements).not.toMatch(/(create|drop|alter) trigger/i);
    expect(statements).not.toMatch(/alter default privileges/i);
    expect(statements).not.toMatch(/(create|alter|drop) (schema|table|index|extension)/i);
    // Every statement in the file targets public.profiles and nothing else.
    const targets = statements.match(/on table (\S+)/gi) ?? [];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.toLowerCase()).toBe('on table public.profiles');
    }
  });

  it('leaves the elevated server-side role untouched, and does not name it', () => {
    expect(statements).not.toMatch(/service_role/i);
    // The whole file, comments included — the repository's secret scan objects to the role name
    // appearing in tracked files, so the prose says "the elevated server-side role" instead.
    expect(raw).not.toMatch(/service_role/i);
  });
});

describe('function execute hardening (20260808140000)', () => {
  /**
   * B13: the hosted per-signature inventory found exactly three application functions in `public`
   * and no extension-owned ones. `handle_new_user` was already restricted; the two trigger functions
   * still carried EXECUTE for PUBLIC, anon and authenticated, and one of them resolved names through
   * `search_path=public` while running as SECURITY DEFINER.
   *
   * Read on its own, not the concatenation, and with comment lines stripped: the migration explains
   * triggers, RLS and the elevated role in prose, and asserting over raw text would match that prose.
   */
  const FILE = '20260808140000_function_execute_hardening.sql';
  const raw = readFileSync(join(MIGRATIONS, FILE), 'utf8');
  const statements = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('alters exactly one function, and only its search_path', () => {
    const alters = [...statements.matchAll(/alter\s+function\s+([^\s(]+\([^)]*\))/gi)];
    expect(alters).toHaveLength(1);
    expect(alters.map((match) => match[1])).toEqual(['public.enforce_client_plan_code()']);
    expect(statements).toMatch(
      /alter function public\.enforce_client_plan_code\(\) set search_path = '';/i,
    );
  });

  it('pins that search_path to empty, not to a schema', () => {
    const setClause = statements.match(/set\s+search_path\s*=\s*([^;]+);/i);
    expect(setClause).not.toBeNull();
    // `= ''` is the hardened value. `= public` would be the defect this migration removes.
    expect(setClause?.[1]?.trim()).toBe("''");
  });

  it('revokes execute from PUBLIC, anon and authenticated on exactly the two named functions', () => {
    const revokes = [
      ...statements.matchAll(
        /revoke\s+execute\s+on\s+function\s+([^\s(]+\([^)]*\))\s+from\s+([^;]+);/gi,
      ),
    ];
    expect(revokes).toHaveLength(2);
    expect(revokes.map((match) => match[1]).sort()).toEqual([
      'public.enforce_client_plan_code()',
      'public.set_updated_at()',
    ]);
    for (const match of revokes) {
      // `?? ''` keeps this type-safe; a missing capture yields [''] and fails the assertion loudly.
      const grantees = (match[2] ?? '').split(',').map((grantee) => grantee.trim().toLowerCase());
      expect(grantees.sort()).toEqual(['anon', 'authenticated', 'public']);
    }
  });

  it('leaves handle_new_user untouched', () => {
    // It may be discussed in the comments; it must not appear in any statement.
    expect(statements).not.toMatch(/handle_new_user/i);
  });

  it('replaces no function body', () => {
    expect(statements).not.toMatch(/create\s+(or replace\s+)?function/i);
    expect(statements).not.toMatch(/\$\$/);
    expect(statements).not.toMatch(/language\s+plpgsql/i);
    expect(statements).not.toMatch(/returns\s+trigger/i);
    expect(statements).not.toMatch(/security\s+(definer|invoker)/i);
  });

  it('changes no trigger, table, RLS, policy, default privilege, schema or elevated role', () => {
    expect(statements).not.toMatch(/(create|drop|alter)\s+trigger/i);
    expect(statements).not.toMatch(/(create|drop|alter)\s+table/i);
    expect(statements).not.toMatch(/row level security/i);
    expect(statements).not.toMatch(/(create|drop|alter)\s+policy/i);
    expect(statements).not.toMatch(/alter\s+default\s+privileges/i);
    expect(statements).not.toMatch(/(create|drop|alter)\s+schema/i);
    expect(statements).not.toMatch(/on\s+table/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(statements).not.toMatch(/service_role/i);
    expect(raw).not.toMatch(/service_role/i);
  });
});

describe('noor_ai trust boundary (20260808160000)', () => {
  /**
   * The pgTAP guard asserts the database side of the D2 boundary. It cannot see `config.toml`, which
   * is where the local Data API exposure and search path are actually declared — so that half is
   * asserted here. Neither check alone is sufficient.
   */
  const FILE = '20260808160000_noor_ai_trust_boundary.sql';
  const raw = readFileSync(join(MIGRATIONS, FILE), 'utf8');
  const statements = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const config = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8');

  it('keeps noor_ai out of the Data API exposed schemas', () => {
    const schemas = config.match(/^schemas\s*=\s*\[(.*)\]/m)?.[1] ?? '';
    expect(schemas).not.toContain('noor_ai');
    // Positive control: the assertion above would pass on an empty match too.
    expect(schemas).toContain('public');
  });

  it('keeps noor_ai off extra_search_path', () => {
    const extra = config.match(/^extra_search_path\s*=\s*\[(.*)\]/m)?.[1] ?? '';
    expect(extra).not.toContain('noor_ai');
    expect(extra).toContain('public');
  });

  it('creates no table, function, sequence or quota object', () => {
    expect(statements).not.toMatch(/create\s+(table|sequence|view|index|materialized)/i);
    expect(statements).not.toMatch(/create\s+(or replace\s+)?function/i);
    expect(statements).not.toMatch(/create\s+(or replace\s+)?trigger/i);
    expect(statements).not.toMatch(/create\s+policy/i);
    expect(statements).not.toMatch(/insert\s+into/i);
  });

  it('embeds no password, credential or secret placeholder', () => {
    // No PASSWORD clause of any kind — not even PASSWORD NULL, which would wipe a credential
    // provisioned later by the separate secret-managed phase.
    expect(statements).not.toMatch(/\bpassword\b/i);
    expect(statements).not.toMatch(/\bencrypted\b/i);
    expect(raw).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
  });

  it('grants the runtime role usage but never create', () => {
    expect(statements).toMatch(/grant usage on schema noor_ai to noor_ai_runtime/i);
    expect(statements).not.toMatch(/grant[^;']*create[^;']*on schema noor_ai/i);
    expect(statements).not.toMatch(/grant all[^;']*on schema noor_ai/i);
  });

  it('contains no SET ROLE or RESET ROLE, in any spelling', () => {
    /**
     * The regression this guards is a real hosted failure: an earlier revision wrapped the schema
     * configuration in `SET ROLE noor_ai_owner ... RESET ROLE`, and the Supabase CLI's own
     * migration-history INSERT — appended to the same session — then ran as noor_ai_owner and was
     * refused on supabase_migrations. The hosted transaction rolled back in full.
     *
     * A migration must not change the session role and rely on changing it back.
     */
    expect(statements).not.toMatch(/\bset\s+(local\s+)?role\b/i);
    expect(statements).not.toMatch(/\breset\s+role\b/i);
    expect(statements).not.toMatch(/\bset\s+session\s+authorization\b/i);
  });

  it('transfers schema ownership as the final schema operation', () => {
    // Ownership last is what removes the need for SET ROLE: every privilege statement is issued
    // while the migration role still owns the schema.
    const transfer = statements.search(/alter schema noor_ai owner to noor_ai_owner/i);
    const grant = statements.search(/grant usage on schema noor_ai to noor_ai_runtime/i);
    const revoke = statements.search(/revoke all on schema noor_ai from public/i);
    expect(transfer).toBeGreaterThanOrEqual(0);
    expect(grant).toBeGreaterThanOrEqual(0);
    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(transfer).toBeGreaterThan(grant);
    expect(transfer).toBeGreaterThan(revoke);
  });

  it('introduces no SECURITY DEFINER helper or privilege escalation', () => {
    expect(statements).not.toMatch(/security\s+definer/i);
    expect(statements).not.toMatch(/\bsuperuser\b/i);
    expect(statements).not.toMatch(/\bbypassrls\b/i);
  });

  it('grants the custom roles no membership in any platform role', () => {
    for (const platform of ['supabase_admin', 'authenticator', 'anon', 'authenticated']) {
      expect(statements).not.toMatch(new RegExp(`grant\\s+${platform}\\s+to`, 'i'));
    }
    expect(statements).not.toMatch(/service_role/i);
    expect(raw).not.toMatch(/service_role/i);
  });

  it('claims no superuser-only attribute it cannot actually set', () => {
    // ALTER ROLE ... NOSUPERUSER is refused for a non-superuser even to turn the attribute off, so
    // naming these would make the migration fail. They are verified by the pgTAP guard instead.
    expect(statements).not.toMatch(/\bnosuperuser\b/i);
    expect(statements).not.toMatch(/\bnobypassrls\b/i);
    expect(statements).not.toMatch(/\bnoreplication\b/i);
  });
});

describe('git hygiene', () => {
  const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');

  it('ignores .env but keeps the template tracked', () => {
    const lines = gitignore.split('\n').map((l) => l.trim());
    expect(lines).toContain('.env');
    expect(lines).toContain('!.env.example');
  });

  it('ignores Apple private keys and Google client secrets', () => {
    expect(gitignore).toContain('*.p8');
    expect(gitignore).toContain('client_secret');
  });
});
