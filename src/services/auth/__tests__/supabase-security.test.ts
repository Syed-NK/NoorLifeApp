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

  it('never mentions the service-role key', () => {
    for (const source of [client, service, sql]) {
      expect(source).not.toMatch(/service_role/i);
      expect(source).not.toMatch(/SERVICE_ROLE_KEY/);
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
