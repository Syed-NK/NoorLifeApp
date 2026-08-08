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
