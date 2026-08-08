/**
 * Static invariants for the NoorAI quota-store migration.
 *
 * These read the migration text. They cannot prove runtime behaviour — that is what the pgTAP suites
 * do — but they catch the class of regression that only appears in review: a credential pasted in, a
 * schema quietly exposed, a wrapper switched to SECURITY DEFINER, a grant widened.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');
const QUOTA_MIGRATION = '20260808180000_noor_ai_quota_store.sql';

const sql = readFileSync(join(MIGRATIONS_DIR, QUOTA_MIGRATION), 'utf8');
const lower = sql.toLowerCase();

/**
 * Executable SQL only, with `--` comment lines removed.
 *
 * The header prose deliberately names what the design excludes ("no digest, no HMAC, no salt"), so a
 * naive scan of the whole file reports those very words as present. Assertions about what the SQL
 * *does* must read the statements, not the explanation of them.
 */
const body = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .toLowerCase();

describe('NoorAI quota migration — shape', () => {
  it('is a single forward-only migration that amends no earlier file', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(files).toContain(QUOTA_MIGRATION);
    // Newest timestamp: nothing already deployed may be edited in place.
    expect([...files].sort().at(-1)).toBe(QUOTA_MIGRATION);
  });

  it('never drops the superseded runtime role', () => {
    expect(lower).not.toMatch(/drop\s+role/);
  });

  it('disables the superseded runtime role with no verifier', () => {
    expect(lower).toMatch(/alter\s+role\s+noor_ai_runtime[\s\S]*?nologin/);
    expect(lower).toMatch(/password\s+null/);
  });
});

describe('NoorAI quota migration — no secrets', () => {
  it('contains no password, key, token or secret literal', () => {
    expect(lower).not.toMatch(/password\s+'[^']+'/); // PASSWORD NULL is fine; a literal is not
    expect(lower).not.toMatch(/service_role_key|anon_key|supabase_service/);
    expect(lower).not.toMatch(/sb_secret_|sbp_|eyj[a-z0-9]/i);
    expect(lower).not.toMatch(/\bsecret\s*=\s*'/);
  });

  it('contains no connection string or hosted identifier', () => {
    expect(lower).not.toMatch(/postgres(ql)?:\/\//);
    expect(lower).not.toMatch(/\.supabase\.(co|com|in)/);
    expect(lower).not.toMatch(/pooler|aws-\d/);
  });

  it('introduces no HMAC key, salt or digest construction', () => {
    expect(body).not.toMatch(/hmac|salt|sha256|digest/);
  });
});

describe('NoorAI quota migration — exposure boundary', () => {
  it('does not change the Data API exposed schemas', () => {
    const config = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'supabase', 'config.toml'),
      'utf8',
    );
    expect(config).toMatch(/schemas\s*=\s*\["public",\s*"graphql_public"\]/);
    expect(config).not.toMatch(/noor_ai/);
  });

  it('never grants CREATE on noor_ai to a client or service role', () => {
    expect(lower).not.toMatch(/grant[^;]*create[^;]*on\s+schema\s+noor_ai\s+to\s+service_role/);
    expect(lower).not.toMatch(/grant[^;]*on\s+schema\s+noor_ai\s+to\s+(anon|authenticated)/);
  });
});

describe('NoorAI quota migration — privilege posture', () => {
  const wrappers = [
    'noor_ai_reserve',
    'noor_ai_register_attempt',
    'noor_ai_finalize',
    'noor_ai_release',
    'noor_ai_status',
  ];

  it('creates exactly the five approved public wrappers', () => {
    for (const w of wrappers) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${w}\\(`));
    }
    const created = sql.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(created).toHaveLength(wrappers.length);
  });

  it('keeps every public wrapper SECURITY INVOKER', () => {
    const publicBlock = sql.slice(sql.indexOf('create or replace function public.'));
    expect(publicBlock).not.toMatch(/security definer/i);
  });

  it('writes wrapper ACLs per exact signature, never by name prefix', () => {
    // A prefix loop would hand service_role EXECUTE to any future public.noor_ai_* function.
    expect(lower).not.toMatch(/grant execute on function public\.%i\(%s\)/);
    expect(lower).not.toMatch(/proname like 'noor\\_ai\\_%'[\s\S]{0,400}grant execute/);

    const sigs: [string, string][] = [
      ['noor_ai_reserve', 'uuid, text'],
      ['noor_ai_register_attempt', 'uuid, uuid, integer, integer, integer, integer, text'],
      ['noor_ai_finalize', 'uuid, uuid'],
      ['noor_ai_release', 'uuid, uuid'],
      ['noor_ai_status', 'uuid'],
    ];
    for (const [fn, args] of sigs) {
      const sig = `public\\.${fn}\\(${args}\\)`;
      for (const role of ['public', 'anon', 'authenticated']) {
        expect(lower).toMatch(new RegExp(`revoke all on function ${sig} from ${role};`));
      }
      expect(lower).toMatch(new RegExp(`grant execute on function ${sig} to service_role;`));
    }
  });

  it('grants exactly five public wrappers to service_role and no more', () => {
    const grants = lower.match(/grant execute on function public\.\w+\(/g) ?? [];
    expect(grants).toHaveLength(5);
  });

  it('grants service_role EXECUTE on exactly the five private entry points', () => {
    const grants = (sql.match(/grant execute on function noor_ai\.(\w+)\(/g) ?? []).map((g) =>
      g.replace(/grant execute on function noor_ai\./, '').replace(/\($/, ''),
    );
    expect(grants.sort()).toEqual(
      ['finalize', 'register_attempt', 'release', 'reserve', 'status'].sort(),
    );
  });

  it('grants service_role no table or sequence privilege', () => {
    expect(lower).not.toMatch(/grant[^;]*\b(select|insert|update|delete)\b[^;]*to\s+service_role/);
    expect(lower).toMatch(/revoke all on all tables in schema noor_ai from service_role/);
    expect(lower).toMatch(/revoke all on all sequences in schema noor_ai from service_role/);
  });
});

describe('NoorAI quota migration — definer hardening', () => {
  it('pins an empty search_path on every function it creates', () => {
    const fns = sql.match(/create or replace function [\s\S]*?as \$\$/g) ?? [];
    expect(fns.length).toBeGreaterThan(10);
    for (const fn of fns) {
      expect(fn).toMatch(/set search_path = ''/);
    }
  });

  it('marks the lifecycle entry points SECURITY DEFINER', () => {
    for (const fn of ['reserve', 'register_attempt', 'finalize', 'release', 'status']) {
      const idx = sql.indexOf(`create or replace function noor_ai.${fn}(`);
      expect(idx).toBeGreaterThan(-1);
      expect(sql.slice(idx, idx + 400)).toMatch(/security definer/);
    }
  });

  it('uses no general-purpose dynamic SQL on any caller-supplied value', () => {
    // format() appears only in migration-time DDL loops over catalog names, never on RPC arguments.
    const dynamic = sql.match(/execute\s+pg_catalog\.format\(/g) ?? [];
    expect(dynamic.length).toBeGreaterThan(0);
    expect(lower).not.toMatch(/execute\s+.*\|\|\s*p_/); // never concatenate a parameter into SQL
  });
});

describe('NoorAI quota migration — data minimisation', () => {
  it('stores the subject as a uuid column and keeps no duplicate encoding', () => {
    expect(lower).toMatch(/subject_id\s+uuid\s+not null/);
    expect(lower).not.toMatch(/subject_key|subject_digest|subject_hash/);
  });

  it('declares no forbidden sensitive-content column', () => {
    const forbidden = [
      'prompt',
      'response_text',
      'message_text',
      'email',
      'phone',
      'journal',
      'health',
      'family',
      'ip_address',
      'user_agent',
      'device_id',
    ];
    // Column declarations only; prose in comments is allowed to name what is excluded.
    const body = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
      .toLowerCase();
    for (const f of forbidden) {
      expect(body).not.toMatch(new RegExp(`^\\s*${f}\\s+\\w`, 'm'));
    }
  });

  it('gives provider_attempt a caller-stable bounded ordinal with a unique constraint', () => {
    expect(lower).toMatch(/attempt_number\s+integer\s+not null/);
    expect(lower).toMatch(/check \(attempt_number between 1 and 2\)/);
    expect(lower).toMatch(/unique \(reservation_id, attempt_number\)/);
  });

  it('re-checks the reservation replay after acquiring the reserve lock', () => {
    const fn = sql.slice(
      sql.indexOf('create or replace function noor_ai.reserve('),
      sql.indexOf('create or replace function noor_ai.register_attempt('),
    );
    const lockAt = fn.indexOf('pg_advisory_xact_lock');
    const afterLock = fn.slice(lockAt);
    // The authoritative lookup must sit between the lock and any ceiling test or increment.
    const replayAt = afterLock.indexOf('r.request_id = p_request_id');
    const leaseAt = afterLock.indexOf('concurrency_lease');
    const incrAt = afterLock.indexOf('try_increment');
    expect(lockAt).toBeGreaterThan(-1);
    expect(replayAt).toBeGreaterThan(-1);
    expect(replayAt).toBeLessThan(leaseAt);
    expect(replayAt).toBeLessThan(incrAt);
  });

  it('accepts late accounting only from reserved or expired, never from a terminal state', () => {
    const reg = sql.slice(
      sql.indexOf('create or replace function noor_ai.register_attempt('),
      sql.indexOf('create or replace function noor_ai.finalize('),
    );
    expect(reg).toMatch(/state not in \('reserved', 'expired'\)/);

    const fin = sql.slice(
      sql.indexOf('create or replace function noor_ai.finalize('),
      sql.indexOf('create or replace function noor_ai.release('),
    );
    // Terminal states short-circuit; the closing update is one-way into finalized.
    expect(fin).toMatch(/state in \('finalized', 'released'\)/);
    expect(fin).toMatch(/set state = 'finalized'[\s\S]*state in \('reserved', 'expired'\)/);
    // Zero-attempt expiry invents no cost.
    expect(fin).toMatch(/state = 'expired' and v_attempts = 0/);
    // Nothing in finalize or register_attempt may touch a request counter or the lease.
    for (const body of [reg, fin]) {
      expect(body).not.toMatch(/try_increment_/);
      expect(body).not.toMatch(/set state = 'reserved'/);
      expect(body).not.toMatch(/expires_at\s*=/);
    }
  });

  it('adds no foreign key into auth', () => {
    expect(lower).not.toMatch(/references\s+auth\./);
  });
});

describe('NoorAI quota migration — approved configuration', () => {
  it('seeds only the approved DEV ceilings', () => {
    const expected: [string, string][] = [
      ['enabled', '1'],
      ['per_user_minute', '1'],
      ['per_user_hour', '1'],
      ['per_user_day', '1'],
      ['global_minute', '1'],
      ['global_day', '1'],
      ['concurrency_lease', '1'],
      ['daily_spend_micros', '500000'],
      ['monthly_spend_micros', '2000000'],
      ['max_attempts', '2'],
    ];
    for (const [key, value] of expected) {
      expect(sql).toMatch(new RegExp(`'${key}',\\s*${value},`));
    }
  });

  it('declares explicit units and uses integer micro-USD for money', () => {
    expect(lower).toMatch(/unit\s+text\s+not null/);
    expect(lower).toMatch(/'micro_usd'/);
    expect(body).not.toMatch(/\b(numeric|float|double precision|real)\b/);
  });

  it('exposes no RPC that mutates configuration', () => {
    const publicBlock = sql.slice(sql.indexOf('create or replace function public.'));
    expect(publicBlock).not.toMatch(/limit_config|price_table/);
  });

  it('keeps the kill switch fail-closed', () => {
    expect(lower).toMatch(/limit_of\('enabled'\) is distinct from 1/);
  });
});
