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
const stripComments = (s: string): string =>
  s
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

const body = stripComments(sql).toLowerCase();

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

  it('orders the reserve lock, replay, expiry, ceilings and counters correctly', () => {
    // Executable statements only. An ordering claim that a comment could satisfy proves nothing.
    const fn = stripComments(
      sql.slice(
        sql.indexOf('create or replace function noor_ai.reserve('),
        sql.indexOf('create or replace function noor_ai.register_attempt('),
      ),
    );
    const lockAt = fn.indexOf('pg_advisory_xact_lock');
    expect(lockAt).toBeGreaterThan(-1);

    const afterLock = fn.slice(lockAt);
    const at = (needle: string) => {
      const i = afterLock.indexOf(needle);
      expect(i).toBeGreaterThan(-1);
      return i;
    };

    // advisory lock -> authoritative replay -> expire stale -> concurrency -> counters -> insert
    const replayAt = at('r.request_id = p_request_id');
    const expireAt = at('expire_stale');
    const leaseAt = at('into v_leases');
    const incrAt = at('try_increment_global');
    const insertAt = at('insert into noor_ai.reservation');

    expect(replayAt).toBeLessThan(expireAt);
    expect(expireAt).toBeLessThan(leaseAt);
    expect(leaseAt).toBeLessThan(incrAt);
    expect(incrAt).toBeLessThan(insertAt);

    // Exactly one sweep, and it is the one inside the lock. A leftover pre-lock call would restore
    // the unserialised sweep this ordering exists to remove, while still satisfying every check above.
    expect(fn.match(/expire_stale/g) ?? []).toHaveLength(1);

    // Ceilings are resolved before the lock, so a configuration defect never reaches admission.
    expect(fn.indexOf('require_limit')).toBeGreaterThan(-1);
    expect(fn.indexOf('require_limit')).toBeLessThan(lockAt);
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

describe('NoorAI quota migration — configuration fails closed', () => {
  const REQUIRED = [
    'enabled',
    'per_user_minute',
    'per_user_hour',
    'per_user_day',
    'global_minute',
    'global_day',
    'concurrency_lease',
    'daily_spend_micros',
    'monthly_spend_micros',
    'max_input_tokens',
    'max_output_tokens',
    'max_attempts',
    'lease_ttl_seconds',
  ];

  it('declares the required configuration keys in exactly one place', () => {
    // The function body alone. Reading as far as the next statement would sweep in unrelated quoted
    // literals — `default 'reserved'` and a partial index predicate both sit between here and there.
    const start = sql.indexOf('create or replace function noor_ai.required_limit_keys(');
    expect(start).toBeGreaterThan(-1);
    const fn = stripComments(sql.slice(start, sql.indexOf('$$;', start)));

    for (const key of REQUIRED) {
      expect(fn).toContain(`'${key}'`);
    }
    // Set equality, not containment: an undeclared key would go unenforced.
    expect(fn.match(/'[a-z_]+'/g) ?? []).toHaveLength(REQUIRED.length);
  });

  it('asserts the seed satisfies the required set at migration time', () => {
    // `on conflict do nothing` means a re-run keeps whatever is present, so a drifted seed is only
    // catchable here.
    expect(body).toMatch(/missing required configuration keys/);
    expect(body).toMatch(
      /raise exception[\s\S]{0,120}required_limit_keys|required_limit_keys[\s\S]{0,400}raise exception/,
    );
  });

  it('treats missing, duplicated, null and non-positive alike, and substitutes nothing', () => {
    const fn = stripComments(
      sql.slice(
        sql.indexOf('create or replace function noor_ai.require_limit('),
        sql.indexOf('create or replace function noor_ai.config_error('),
      ),
    );
    expect(fn).toMatch(/v_rows <> 1 or v_value is null or v_value < 1/);
    expect(fn).toMatch(/raise exception using errcode = 'NOCFG'/);
    // No default, no coalesce, no re-seed: a defect must not be papered over.
    expect(fn).not.toMatch(/coalesce|insert into|default/i);
  });

  it('routes every ceiling through the strict lookup, leaving limit_of for the kill switch alone', () => {
    // The permissive lookup returns null for a missing key; a null ceiling reaching try_increment_*
    // admits the first request of each window. Only `enabled` may still use it.
    const permissive = body.match(/limit_of\('(\w+)'\)/g) ?? [];
    expect(new Set(permissive)).toEqual(new Set(["limit_of('enabled')"]));

    const strict = (sql.match(/require_limit\('(\w+)'\)/g) ?? []).map((m) =>
      m.replace(/require_limit\('/, '').replace(/'\)/, ''),
    );
    // Every required key except the kill switch is resolved strictly somewhere in the lifecycle.
    expect(new Set(strict)).toEqual(new Set(REQUIRED.filter((k) => k !== 'enabled')));
  });

  it('reports a configuration defect as a store failure, never as a rate-limit denial', () => {
    const fn = sql.slice(
      sql.indexOf('create or replace function noor_ai.config_error('),
      sql.indexOf('-- Database time only'),
    );
    expect(fn).toMatch(/'decision', 'unavailable'/);
    expect(fn).toMatch(/'reason', 'configuration'/);
    expect(fn).toMatch(/'configuration_error', true/);
    expect(fn).toMatch(/'ok', false/);
    // A configuration failure must never be dressed up as a quota denial.
    expect(fn).not.toMatch(/'limited'/);
  });

  it('resolves configuration before any mutation in every lifecycle entry point', () => {
    for (const fnName of ['reserve', 'register_attempt', 'status']) {
      const start = sql.indexOf(`create or replace function noor_ai.${fnName}(`);
      expect(start).toBeGreaterThan(-1);
      const fn = stripComments(sql.slice(start, start + 4000));
      const cfgAt = fn.indexOf('require_limit');
      expect(cfgAt).toBeGreaterThan(-1);
      // Nothing may be written, and no row locked, before the ceilings are known to be valid.
      for (const mutation of ['insert into', 'update noor_ai', 'for update', 'try_increment']) {
        const at = fn.indexOf(mutation);
        if (at > -1) expect(cfgAt).toBeLessThan(at);
      }
      // And the failure is returned as data the Edge Function can map, not raised at the caller.
      expect(fn).toMatch(
        /exception when sqlstate 'NOCFG' then\s*\n\s*return noor_ai\.config_error/,
      );
    }
  });
});
