-- NoorLife — NoorAI quota store: private tables + service-role-only RPCs.
--
-- ── The pivot this migration implements ─────────────────────────────────────
-- The direct-connection D2 runtime path (a custom LOGIN role + a Postgres client + Supavisor pool
-- inside the Edge Function) is SUPERSEDED. It is not erased: docs/NOOR_AI3_QUOTA_STORE_SECURITY_REVIEW.md
-- §19 and §20 remain the record of why it was chosen and why it failed.
--
-- Replaced by: quota state stays in the private `noor_ai` schema; all logic runs in SECURITY DEFINER
-- functions owned by `noor_ai_owner`; the Edge Function reaches them ONLY through thin named wrappers
-- in `public`, executable ONLY by `service_role`.
--
-- The tradeoff is explicit and must not be understated: `service_role` is a broad key. Containment is
-- therefore procedural as well as structural — server-only, never shipped to the mobile app, no
-- general-purpose SQL surface, only these named RPCs with strictly typed parameters.
--
-- ── Why `noor_ai` is NOT exposed, and why the wrappers exist ────────────────
-- PostgREST can only see schemas listed in `[api] schemas`, which is `public` + `graphql_public`.
-- A `noor_ai.*` function is therefore unreachable via `.rpc()`. Exposing `noor_ai` would put the whole
-- schema in front of PostgREST and rest containment solely on EXECUTE grants. Instead each entry point
-- is a thin `public` wrapper that only delegates. `noor_ai` stays private.
--
-- ── Subject identity: the verified user UUID, stored directly ───────────────
-- Owner decision. `subject_id` is the verified Supabase Auth user UUID, stored as `uuid`. No digest,
-- no HMAC, no Vault key, no salt, no reversible encoding, and no duplicate raw-plus-digest pair.
--
-- Why, recorded so it is not re-litigated:
--   1. Contract §I.1 requires the *verified user id* as the rate-limit subject.
--   2. The Edge Function must derive it ONLY from verified JWT claims. It is never read from an
--      untrusted request-body field. The database cannot check that and does not pretend to — it is a
--      documented caller obligation.
--   3. The quota store and Supabase Auth live in the SAME database. An unkeyed digest gives no
--      meaningful unlinkability against an actor who can enumerate known user ids from `auth.users`.
--   4. The direct UUID is necessary data: per-user enforcement, incident investigation, and
--      deterministic account-deletion cleanup all require it.
--   5. This is ACCOUNT-LINKED PERSONAL DATA. It is neither anonymous nor pseudonymous for NoorLife's
--      disclosure purposes, and must be declared as such.
--   6. Protection comes from the private schema, exact RPC privileges, server-only service_role
--      invocation, retention and deletion — not from cosmetic hashing.
--   7. The separate OpenAI `safety_identifier` keying decision (B10) is NOT resolved by this choice
--      and remains separately tracked.
--
-- No foreign key into `auth.users` is declared: that would need a privilege review to justify giving
-- this schema's owner a dependency on the auth schema, and it is not required for enforcement.
--
-- ── Global state is structurally separate ───────────────────────────────────
-- Global counters live in their own relation with no subject column, so there is never a fabricated
-- "global" user UUID and the type invariant `subject_id is always a real account` holds everywhere.
--
-- ── Limits are configuration, not constants ─────────────────────────────────
-- docs/NOOR_AI3_IMPLEMENTATION_PLAN.md §4.8 marks every PRODUCTION ceiling "future, unapproved".
-- Only the dev-smoke column is approved. `noor_ai.limit_config` is seeded with the approved DEV values
-- and nothing else. Raising them is a controlled administrative migration, never a public RPC.
--
-- ── No secret is introduced ─────────────────────────────────────────────────
-- No key, password, salt or secret appears in this file.

-- ── 1. Disable the superseded runtime role ──────────────────────────────────
-- PASSWORD NULL is stated deliberately. The trust-boundary migration omitted any PASSWORD clause so a
-- separately provisioned credential would survive a re-run; that requirement is now inverted — no
-- credential may survive, and any that exists must be removed.
alter role noor_ai_runtime nologin nocreatedb nocreaterole noinherit password null;
alter role noor_ai_runtime set search_path = '';
-- Its USAGE grant is revoked in the owner block below, NOT here: only the schema owner can revoke a
-- schema privilege, and a REVOKE issued by a non-owner silently succeeds while granting nothing
-- ("WARNING: no privileges could be revoked"). Verified — this exact statement was a no-op here.

-- ── 2. Borrow CREATE on the private schema, briefly ─────────────────────────
-- `noor_ai` is owned by `noor_ai_owner`, so the migration role cannot create in it. The trust-boundary
-- migration records why a file-scope `SET ROLE ... RESET ROLE` is unsafe: the CLI appends its own
-- INSERT into supabase_migrations to the same session and it would run under whatever role the file
-- left behind. The switch is therefore confined to this block and undone inside it.
--
-- ── Why the block ends with SET LOCAL ROLE and not RESET ROLE ───────────────
-- `RESET ROLE` restores the connection's *reset* identity — what the session started as, or whatever
-- `role` was configured to default to. That is not necessarily the identity this block captured.
--
-- Those two can differ, and measurably do. A migration session may arrive with `current_user` already
-- switched away from `session_user`; the block then grants CREATE to `current_user` (the identity that
-- is actually executing the file) while `RESET ROLE` hands execution back to `session_user` (the
-- identity that merely opened the connection). The very next statement — `create type noor_ai.metric`
-- — then runs without CREATE on this schema and fails with SQLSTATE 42501, one statement after the
-- grant that was supposed to enable it. The grant and the restore were aiming at different principals.
--
-- So the block returns execution to **the exact identity that received the temporary CREATE**, by name
-- and safely quoted. No identity is hard-coded: `v_migrator` is whatever `current_user` was on entry,
-- so this is correct for any migration identity, on any connection topology, and it does not assume
-- the session is `postgres`.
--
-- ── What this does not leave behind ────────────────────────────────────────
-- `SET LOCAL ROLE` lasts only for the current transaction. When the migration transaction completes,
-- the role state disappears with it, and so does the temporary CREATE grant — §12 below revokes it
-- explicitly rather than relying on that. The CLI's appended migration-history INSERT therefore runs
-- as the captured migration identity: not as `noor_ai_owner`, and not as the connection's session
-- identity.
--
-- This is deliberately *not* the design the trust-boundary migration rejected. That one left the
-- session sitting as the owner role, so the appended INSERT would have run with owner rights. This one
-- restores the caller before returning.
--
-- ── The alternative that was rejected ──────────────────────────────────────
-- Granting CREATE to `session_user` instead would also make the following statements work, and it is
-- the wrong fix on three counts: it grants to an identity that is not the effective migration identity;
-- it is broader than necessary, because nothing needs that principal to hold schema privileges; and it
-- would mean the CLI's temporary login identity acquires rights on this schema for no better reason
-- than that it opened the connection. Privileges follow the executing identity here, not the connector.
do $$
declare
  v_migrator text := current_user;
begin
  execute 'set local role noor_ai_owner';
  execute pg_catalog.format('grant create, usage on schema noor_ai to %I', v_migrator);
  -- service_role needs USAGE to REACH the definer entry points. USAGE alone confers no access to any
  -- object; every table privilege stays with noor_ai_owner and is supplied only by definer functions.
  execute 'grant usage on schema noor_ai to service_role';
  -- The superseded runtime role loses its last reachability into this schema. Issued here because
  -- only the owner can revoke it.
  execute 'revoke all on schema noor_ai from noor_ai_runtime';
  -- Restore the captured caller — see the note above on why this is not `reset role`.
  execute pg_catalog.format('set local role %I', v_migrator);
  -- Fail closed if the restore did not land on the identity holding the temporary CREATE. Everything
  -- after this block creates objects in `noor_ai`, so continuing under the wrong identity would either
  -- fail confusingly several statements later or, worse, create them under an unintended owner. The
  -- message carries no identity, OID, host or connection detail — only that the invariant broke.
  if current_user <> v_migrator then
    raise exception
      using errcode = '42501',
            message = 'noor_ai migration: role restoration did not return to the migration identity',
            hint    = 'The privilege-borrowing block must return to the identity granted temporary CREATE.';
  end if;
end
$$;

-- ── 3. Enumerated domains ───────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'noor_ai' and t.typname = 'metric') then
    create type noor_ai.metric as enum ('requests', 'spend_micros');
  end if;
  if not exists (select 1 from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'noor_ai' and t.typname = 'window_kind') then
    create type noor_ai.window_kind as enum ('minute', 'hour', 'day', 'month');
  end if;
  if not exists (select 1 from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'noor_ai' and t.typname = 'reservation_state') then
    create type noor_ai.reservation_state as enum ('reserved', 'finalized', 'released', 'expired');
  end if;
  if not exists (select 1 from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'noor_ai' and t.typname = 'outcome_class') then
    -- Coarse by construction. Never a provider message, body or identifier.
    create type noor_ai.outcome_class as enum ('success', 'transient', 'terminal');
  end if;
end
$$;

-- ── 4. Configuration ────────────────────────────────────────────────────────
-- Units are explicit: *_micros are MICRO-USD (1 USD = 1,000,000 micros), integer only, never a float.
-- *_seconds are whole seconds. Counter limits are request counts.
create table if not exists noor_ai.limit_config (
  key         text        primary key,
  value       bigint      not null,
  unit        text        not null,
  updated_at  timestamptz not null default pg_catalog.now(),
  constraint limit_config_value_non_negative check (value >= 0),
  constraint limit_config_value_bounded check (value <= 1000000000000),
  constraint limit_config_unit_known check (unit in ('count', 'micro_usd', 'seconds', 'tokens', 'flag'))
);

comment on table noor_ai.limit_config is
  'Approved DEV-smoke limits only (plan §4.8). Production/free/paid ceilings are UNAPPROVED and must '
  'not be set here without a recorded review. Changed only by controlled administrative migration — '
  'never by a public RPC.';

insert into noor_ai.limit_config (key, value, unit) values
  ('enabled',               1,       'flag'),      -- kill switch: 0 disables all reservations
  ('per_user_minute',       1,       'count'),
  ('per_user_hour',         1,       'count'),
  ('per_user_day',          1,       'count'),
  ('global_minute',         1,       'count'),
  ('global_day',            1,       'count'),
  ('concurrency_lease',     1,       'count'),
  ('daily_spend_micros',    500000,  'micro_usd'), -- $0.50 dev ceiling
  ('monthly_spend_micros',  2000000, 'micro_usd'), -- $2.00 dev ceiling
  ('max_input_tokens',      12000,   'tokens'),    -- plan §4.1.3 planning bound
  ('max_output_tokens',     2000,    'tokens'),    -- plan §4.2 dev smoke
  ('max_attempts',          2,       'count'),     -- one permitted retry (§F.8)
  ('lease_ttl_seconds',     90,      'seconds')    -- exceeds handlerBudgetMs 70s + clock skew (§12.5)
on conflict (key) do nothing;

-- The exact set of keys the lifecycle requires, named ONCE. Without a single declaration, "which keys
-- are required" is re-derived at every call site and a key can be dropped from the seed without
-- anything noticing. Tests assert `limit_config` equals this set exactly.
create or replace function noor_ai.required_limit_keys()
returns text[] language sql immutable set search_path = ''
as $$ select array[
  'enabled',
  'per_user_minute', 'per_user_hour', 'per_user_day',
  'global_minute', 'global_day',
  'concurrency_lease',
  'daily_spend_micros', 'monthly_spend_micros',
  'max_input_tokens', 'max_output_tokens',
  'max_attempts',
  'lease_ttl_seconds']::text[] $$;

-- The seed must satisfy that set at migration time. `on conflict do nothing` above means a re-run
-- silently keeps whatever is already there, so this is the only place a seed that has drifted from the
-- required set can still be caught. It reports the missing keys and aborts rather than deploying a
-- store that would fail closed on its first request.
do $$
declare v_missing text[];
begin
  select pg_catalog.array_agg(k) into v_missing
    from pg_catalog.unnest(noor_ai.required_limit_keys()) k
   where not exists (select 1 from noor_ai.limit_config c where c.key = k);
  if v_missing is not null then
    raise exception 'noor_ai.limit_config is missing required configuration keys: %', v_missing;
  end if;
end
$$;

create table if not exists noor_ai.price_table (
  version                 integer     primary key,
  input_micros_per_mtok   bigint      not null,
  output_micros_per_mtok  bigint      not null,
  active                  boolean     not null default false,
  created_at              timestamptz not null default pg_catalog.now(),
  constraint price_non_negative check (input_micros_per_mtok >= 0 and output_micros_per_mtok >= 0)
);

comment on table noor_ai.price_table is
  'Micro-USD per 1,000,000 tokens. Costs are computed in the database; callers never supply money. '
  '`version` makes a stale price table auditable rather than invisible (plan §4.8.2).';

create unique index if not exists price_table_one_active
  on noor_ai.price_table ((active)) where active;

insert into noor_ai.price_table (version, input_micros_per_mtok, output_micros_per_mtok, active) values
  (1, 2500000, 12000000, true)  -- plan §3.2 Terra: $2.50/1M cache-write input, $12.00/1M output
on conflict (version) do nothing;

-- ── 5. Quota state ──────────────────────────────────────────────────────────
-- Per-subject counters. `subject_id` is the verified account UUID (see header).
create table if not exists noor_ai.user_counter (
  subject_id    uuid                not null,
  metric        noor_ai.metric      not null,
  window_kind   noor_ai.window_kind not null,
  window_start  timestamptz         not null,
  value         bigint              not null default 0,
  updated_at    timestamptz         not null default pg_catalog.now(),
  primary key (subject_id, metric, window_kind, window_start),
  constraint user_counter_non_negative check (value >= 0),
  constraint user_counter_bounded check (value <= 4000000000000000000)
);

-- Deletion and retention both target this leading-column index, so removing one account's rows never
-- scans another account's data.
create index if not exists user_counter_sweep on noor_ai.user_counter (updated_at);

-- Global counters, structurally separate: no subject column exists, so no fabricated "global user".
create table if not exists noor_ai.global_counter (
  metric        noor_ai.metric      not null,
  window_kind   noor_ai.window_kind not null,
  window_start  timestamptz         not null,
  value         bigint              not null default 0,
  updated_at    timestamptz         not null default pg_catalog.now(),
  primary key (metric, window_kind, window_start),
  constraint global_counter_non_negative check (value >= 0),
  constraint global_counter_bounded check (value <= 4000000000000000000)
);

create index if not exists global_counter_sweep on noor_ai.global_counter (updated_at);

-- The lifecycle anchor AND the concurrency lease (review §10.1: "A reservation *is* a lease").
create table if not exists noor_ai.reservation (
  reservation_id  uuid                      primary key default pg_catalog.gen_random_uuid(),
  subject_id      uuid                      not null,
  request_id      text                      not null,
  state           noor_ai.reservation_state not null default 'reserved',
  created_at      timestamptz               not null default pg_catalog.now(),
  expires_at      timestamptz               not null,
  finalized_at    timestamptz,
  attempt_count   integer                   not null default 0,
  constraint reservation_attempts_non_negative check (attempt_count >= 0),
  constraint reservation_expiry_after_creation check (expires_at > created_at),
  -- Idempotency scoped BY subject: two different accounts presenting the same request id cannot
  -- collide, and a replay by the same account cannot consume a second quota unit.
  constraint reservation_request_unique unique (subject_id, request_id),
  -- An opaque correlation token, not content. Bounded so it cannot carry a prompt.
  constraint reservation_request_id_bounded check (pg_catalog.length(request_id) between 1 and 64)
);

create index if not exists reservation_by_subject on noor_ai.reservation (subject_id);
create index if not exists reservation_live_lease
  on noor_ai.reservation (expires_at) where state = 'reserved';

create table if not exists noor_ai.provider_attempt (
  attempt_id          uuid                  primary key default pg_catalog.gen_random_uuid(),
  reservation_id      uuid                  not null references noor_ai.reservation (reservation_id) on delete cascade,
  -- Caller-stable attempt identity. Without it the RPC has no way to tell a genuine second provider
  -- attempt from a retry of the SAME registration whose response the Edge Function lost — and would
  -- insert and cost-account twice. Bounded to the approved ceiling: 1, or 2 for the permitted retry.
  attempt_number      integer               not null,
  occurred_at         timestamptz           not null default pg_catalog.now(),
  input_tokens        integer               not null,
  output_tokens       integer               not null,
  reasoning_tokens    integer               not null,
  estimated_micros    bigint                not null,
  price_table_version integer               not null references noor_ai.price_table (version),
  outcome_class       noor_ai.outcome_class not null,
  constraint attempt_tokens_non_negative
    check (input_tokens >= 0 and output_tokens >= 0 and reasoning_tokens >= 0),
  constraint attempt_tokens_bounded
    check (input_tokens <= 10000000 and output_tokens <= 10000000 and reasoning_tokens <= 10000000),
  constraint attempt_micros_non_negative check (estimated_micros >= 0),
  constraint attempt_number_bounded check (attempt_number between 1 and 2),
  -- The database, not the caller, is the authority on "this attempt is already recorded".
  constraint attempt_number_unique unique (reservation_id, attempt_number)
);

create index if not exists provider_attempt_by_reservation
  on noor_ai.provider_attempt (reservation_id);

comment on table noor_ai.provider_attempt is
  'Token counts and a coarse outcome class only. No prompt, response, provider identifier, IP, device, '
  'email, phone, JWT or module/journal/health/family column exists — there is nowhere to put one.';

-- ── 6. Internal helpers (never granted to service_role) ─────────────────────
-- Permissive lookup. Returns null for a missing key, and is used for ONE thing only: the `enabled`
-- kill switch, whose absence must read as "disabled" rather than as an error. Every ceiling goes
-- through require_limit() below instead.
create or replace function noor_ai.limit_of(p_key text)
returns bigint language sql stable strict set search_path = ''
as $$ select c.value from noor_ai.limit_config c where c.key = p_key $$;

-- Strict lookup — the fail-closed rule for every ceiling.
--
-- The hazard this closes: try_increment_*() receives its ceiling as an argument, and a null ceiling
-- makes `w.value + p_amount <= p_limit` evaluate to null. On an EXISTING counter row that null fails
-- the ON CONFLICT guard and denies, which looks safe — but on the FIRST request of a window there is
-- no conflict, so the INSERT succeeds unconditionally and the request is admitted. A deleted ceiling
-- therefore leaked exactly one admission per window, per counter, silently.
--
-- Failing here instead means a configuration defect can never reach the admission path at all:
--
--   • missing (0 rows), duplicated (>1 rows), null, or non-positive are ALL defects, and all fail
--     the same way — there is no ordering in which one of them is treated as headroom;
--   • nothing is substituted, no default is invented, and a deleted row is never re-seeded;
--   • it raises rather than returning, so it cannot be ignored at a call site by accident.
--
-- Zero is rejected on purpose. A ceiling of 0 admits nothing, so it is not *dangerous*, but it is
-- indistinguishable from a truncated deploy and would otherwise present as an endless 429 storm. A
-- configuration failure the operator can see beats a silent denial of every request. Deliberately
-- turning NoorAI off is what `enabled = 0` is for, and that path is untouched.
create or replace function noor_ai.require_limit(p_key text)
returns bigint language plpgsql stable set search_path = ''
as $$
declare v_rows bigint; v_value bigint;
begin
  select pg_catalog.count(*), pg_catalog.min(c.value) into v_rows, v_value
    from noor_ai.limit_config c where c.key = p_key;
  if v_rows <> 1 or v_value is null or v_value < 1 then
    raise exception using errcode = 'NOCFG', message = p_key;
  end if;
  return v_value;
end
$$;

-- One payload shape for every entry point, so the Edge Function has a single thing to test.
--
-- It carries BOTH `ok:false` and `decision:'unavailable'` because the five RPCs do not share a return
-- shape, and `configuration_error` is the unambiguous flag. This is a STORE failure, to be mapped to
-- 503 — never to 429. A rate-limit denial means "you asked too often"; this means the store cannot
-- answer the question at all, and telling a user to slow down would be a lie about our own defect.
-- `key` names the missing configuration key. It is a key NAME, never a value.
create or replace function noor_ai.config_error(p_key text)
returns jsonb language sql immutable set search_path = ''
as $$ select pg_catalog.jsonb_build_object(
  'ok', false, 'decision', 'unavailable', 'reason', 'configuration',
  'key', p_key, 'configuration_error', true) $$;

-- Database time only. A caller-supplied timestamp is never accepted anywhere in this schema.
create or replace function noor_ai.window_start_of(p_kind noor_ai.window_kind, p_now timestamptz)
returns timestamptz language sql immutable strict set search_path = ''
as $$
  select case p_kind
    when 'minute' then pg_catalog.date_trunc('minute', p_now at time zone 'UTC') at time zone 'UTC'
    when 'hour'   then pg_catalog.date_trunc('hour',   p_now at time zone 'UTC') at time zone 'UTC'
    when 'day'    then pg_catalog.date_trunc('day',    p_now at time zone 'UTC') at time zone 'UTC'
    when 'month'  then pg_catalog.date_trunc('month',  p_now at time zone 'UTC') at time zone 'UTC'
  end
$$;

-- Conditional increment (review §12.2): increments ONLY when the result stays within the ceiling, so
-- a denied request never consumes quota. Returns null when the ceiling is already reached.
create or replace function noor_ai.try_increment_user(
  p_subject uuid, p_metric noor_ai.metric, p_window noor_ai.window_kind,
  p_start timestamptz, p_limit bigint, p_amount bigint)
returns bigint language plpgsql set search_path = ''
as $$
declare v_new bigint;
begin
  if p_amount <= 0 or p_limit < p_amount then return null; end if;
  insert into noor_ai.user_counter as w (subject_id, metric, window_kind, window_start, value, updated_at)
  values (p_subject, p_metric, p_window, p_start, p_amount, pg_catalog.now())
  on conflict (subject_id, metric, window_kind, window_start) do update
    set value = w.value + p_amount, updated_at = pg_catalog.now()
    where w.value + p_amount <= p_limit
  returning w.value into v_new;
  return v_new;
end
$$;

create or replace function noor_ai.try_increment_global(
  p_metric noor_ai.metric, p_window noor_ai.window_kind,
  p_start timestamptz, p_limit bigint, p_amount bigint)
returns bigint language plpgsql set search_path = ''
as $$
declare v_new bigint;
begin
  if p_amount <= 0 or p_limit < p_amount then return null; end if;
  insert into noor_ai.global_counter as w (metric, window_kind, window_start, value, updated_at)
  values (p_metric, p_window, p_start, p_amount, pg_catalog.now())
  on conflict (metric, window_kind, window_start) do update
    set value = w.value + p_amount, updated_at = pg_catalog.now()
    where w.value + p_amount <= p_limit
  returning w.value into v_new;
  return v_new;
end
$$;

-- Unconditional accumulation, used only by finalize for spend already incurred. Spend is never
-- pre-debited at reserve (review §12.2 hard rule).
create or replace function noor_ai.accumulate_global(
  p_metric noor_ai.metric, p_window noor_ai.window_kind, p_start timestamptz, p_amount bigint)
returns void language sql set search_path = ''
as $$
  insert into noor_ai.global_counter as w (metric, window_kind, window_start, value, updated_at)
  values (p_metric, p_window, p_start, p_amount, pg_catalog.now())
  on conflict (metric, window_kind, window_start) do update
    set value = w.value + p_amount, updated_at = pg_catalog.now();
$$;

create or replace function noor_ai.global_value(
  p_metric noor_ai.metric, p_window noor_ai.window_kind, p_start timestamptz)
returns bigint language sql stable set search_path = ''
as $$
  select coalesce((select w.value from noor_ai.global_counter w
    where w.metric = p_metric and w.window_kind = p_window and w.window_start = p_start), 0)
$$;

create or replace function noor_ai.user_value(
  p_subject uuid, p_metric noor_ai.metric, p_window noor_ai.window_kind, p_start timestamptz)
returns bigint language sql stable set search_path = ''
as $$
  select coalesce((select w.value from noor_ai.user_counter w
    where w.subject_id = p_subject and w.metric = p_metric
      and w.window_kind = p_window and w.window_start = p_start), 0)
$$;

-- Lazy expiry (review §12.5). Bounded row count, no scheduler dependency.
create or replace function noor_ai.expire_stale()
returns void language sql set search_path = ''
as $$
  update noor_ai.reservation set state = 'expired'
   where reservation_id in (
     select r.reservation_id from noor_ai.reservation r
      where r.state = 'reserved' and r.expires_at <= pg_catalog.now() limit 500);
$$;

-- ── 7. Lifecycle: reserve ───────────────────────────────────────────────────
create or replace function noor_ai.reserve(p_subject_id uuid, p_request_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now    timestamptz := pg_catalog.now();  -- database clock, UTC. Never a caller value.
  v_exist  noor_ai.reservation%rowtype;
  v_rid    uuid;
  v_leases bigint;
  v_lim_concurrency bigint;
  v_lim_daily       bigint;
  v_lim_monthly     bigint;
  v_lim_gmin        bigint;
  v_lim_gday        bigint;
  v_lim_umin        bigint;
  v_lim_uhour       bigint;
  v_lim_uday        bigint;
  v_lim_ttl         bigint;
begin
  if p_subject_id is null or p_request_id is null then
    return pg_catalog.jsonb_build_object('decision', 'invalid', 'reason', 'missing_argument');
  end if;
  if pg_catalog.length(p_request_id) < 1 or pg_catalog.length(p_request_id) > 64 then
    return pg_catalog.jsonb_build_object('decision', 'invalid', 'reason', 'bad_request_id');
  end if;

  -- Kill switch first, fail-closed: a missing or non-1 value denies.
  if noor_ai.limit_of('enabled') is distinct from 1 then
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', 'disabled');
  end if;

  -- Every ceiling this call needs is resolved HERE, before the first read of quota state and long
  -- before any write, so an invalid configuration cannot reach the admission path and be mistaken for
  -- headroom. Resolving up front also means the failure needs no rollback: nothing has happened yet.
  begin
    v_lim_concurrency := noor_ai.require_limit('concurrency_lease');
    v_lim_daily       := noor_ai.require_limit('daily_spend_micros');
    v_lim_monthly     := noor_ai.require_limit('monthly_spend_micros');
    v_lim_gmin        := noor_ai.require_limit('global_minute');
    v_lim_gday        := noor_ai.require_limit('global_day');
    v_lim_umin        := noor_ai.require_limit('per_user_minute');
    v_lim_uhour       := noor_ai.require_limit('per_user_hour');
    v_lim_uday        := noor_ai.require_limit('per_user_day');
    v_lim_ttl         := noor_ai.require_limit('lease_ttl_seconds');
  exception when sqlstate 'NOCFG' then
    return noor_ai.config_error(sqlerrm);
  end;

  -- Idempotent replay: same subject + same request id returns the SAME reservation and consumes no
  -- second quota unit (review §12.4). Unlocked fast path — racy on its own, which is why the
  -- authoritative repeat below exists.
  select * into v_exist from noor_ai.reservation r
   where r.subject_id = p_subject_id and r.request_id = p_request_id;
  if found then
    return pg_catalog.jsonb_build_object(
      'decision', case when v_exist.state = 'reserved' then 'allowed' else 'replayed' end,
      'reservation_id', v_exist.reservation_id, 'state', v_exist.state, 'idempotent', true);
  end if;

  -- Deterministic lock ordering (review §9.6): every reserve takes this ONE transaction-scoped lock
  -- before touching counters, so all reservations serialise in a single global order and no deadlock
  -- cycle can form. Transaction-scoped, not session-scoped: a session lock does not survive
  -- transaction pooling and does not honour rollback (§17.11). Released at commit or abort.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('noor_ai.reserve'));

  -- AUTHORITATIVE replay check, repeated AFTER the lock and BEFORE any limit test or increment.
  --
  -- The lookup above is an unlocked fast path and is racy on its own: two concurrent calls carrying
  -- the same (subject_id, request_id) can both miss it, and whichever loses the lock race would then
  -- be judged against the concurrency ceiling the winner is already holding — returning `limited`
  -- with reason `concurrency` for what is really the caller's own in-flight request, and, once the
  -- lease freed up, consuming a second quota unit for one handler request.
  --
  -- Re-reading here closes that window: the winner has committed its reservation before releasing the
  -- lock, so the loser sees it and replays instead of competing with it.
  select * into v_exist from noor_ai.reservation r
   where r.subject_id = p_subject_id and r.request_id = p_request_id;
  if found then
    return pg_catalog.jsonb_build_object(
      'decision', case when v_exist.state = 'reserved' then 'allowed' else 'replayed' end,
      'reservation_id', v_exist.reservation_id, 'state', v_exist.state, 'idempotent', true);
  end if;

  -- Stale-lease reclamation, moved INSIDE the lock (2026-08-09).
  --
  -- It used to run before the lock, where two concurrent reserves could each UPDATE a different
  -- overlapping subset of the same expired rows. `select ... limit 500` has no ORDER BY, so the two
  -- statements could take row locks in opposite orders and deadlock — aborting a reserve with a
  -- database error, which the Edge Function would have to treat as a store failure rather than a
  -- decision. Under the lock every sweep is serialised with every other sweep, so no such cycle can
  -- form. It runs AFTER the authoritative replay above (a replay needs no sweep and must not pay for
  -- one) and BEFORE the concurrency count below, so the count sees reclaimed slots in this same
  -- transaction rather than a stale snapshot.
  perform noor_ai.expire_stale();

  select pg_catalog.count(*) into v_leases from noor_ai.reservation r
   where r.state = 'reserved' and r.expires_at > v_now;
  if v_leases >= v_lim_concurrency then
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', 'concurrency');
  end if;

  -- Spend ceilings are READ and compared, never pre-debited (review §12.2 hard rule).
  if noor_ai.global_value('spend_micros', 'day', noor_ai.window_start_of('day', v_now))
       >= v_lim_daily then
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', 'daily_spend');
  end if;
  if noor_ai.global_value('spend_micros', 'month', noor_ai.window_start_of('month', v_now))
       >= v_lim_monthly then
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', 'monthly_spend');
  end if;

  -- All five request counters are all-or-nothing. The sub-block establishes a savepoint, so a denial
  -- on a later counter rolls back the increments already made by the earlier ones (review §12.2).
  begin
    if noor_ai.try_increment_global('requests', 'minute',
         noor_ai.window_start_of('minute', v_now), v_lim_gmin, 1) is null then
      raise exception using errcode = 'NOQTA', message = 'global_minute';
    end if;
    if noor_ai.try_increment_global('requests', 'day',
         noor_ai.window_start_of('day', v_now), v_lim_gday, 1) is null then
      raise exception using errcode = 'NOQTA', message = 'global_day';
    end if;
    if noor_ai.try_increment_user(p_subject_id, 'requests', 'minute',
         noor_ai.window_start_of('minute', v_now), v_lim_umin, 1) is null then
      raise exception using errcode = 'NOQTA', message = 'per_user_minute';
    end if;
    if noor_ai.try_increment_user(p_subject_id, 'requests', 'hour',
         noor_ai.window_start_of('hour', v_now), v_lim_uhour, 1) is null then
      raise exception using errcode = 'NOQTA', message = 'per_user_hour';
    end if;
    if noor_ai.try_increment_user(p_subject_id, 'requests', 'day',
         noor_ai.window_start_of('day', v_now), v_lim_uday, 1) is null then
      raise exception using errcode = 'NOQTA', message = 'per_user_day';
    end if;
  exception when sqlstate 'NOQTA' then
    -- Returned as DATA, never raised: the Edge Function must be able to tell a denial (429) from a
    -- store failure (503) (review §12.2).
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', sqlerrm);
  end;

  insert into noor_ai.reservation (subject_id, request_id, expires_at)
  values (p_subject_id, p_request_id,
          v_now + pg_catalog.make_interval(secs => v_lim_ttl))
  returning reservation_id into v_rid;

  return pg_catalog.jsonb_build_object(
    'decision', 'allowed', 'reservation_id', v_rid, 'state', 'reserved', 'idempotent', false);
end
$$;

-- ── 8. Lifecycle: register one provider attempt ─────────────────────────────
create or replace function noor_ai.register_attempt(
  p_subject_id uuid, p_reservation_id uuid, p_attempt_number integer,
  p_input_tokens integer, p_output_tokens integer, p_reasoning_tokens integer, p_outcome text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_res     noor_ai.reservation%rowtype;
  v_price   noor_ai.price_table%rowtype;
  v_prior   noor_ai.provider_attempt%rowtype;
  v_micros  bigint;
  v_outcome noor_ai.outcome_class;
  v_lim_input    bigint;
  v_lim_output   bigint;
  v_lim_attempts bigint;
begin
  if p_subject_id is null or p_reservation_id is null or p_outcome is null
     or p_attempt_number is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing_argument');
  end if;
  -- 0, 3, negative and null are all refused before anything is read or written.
  if p_attempt_number < 1 or p_attempt_number > 2 then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'bad_attempt_number');
  end if;
  if p_input_tokens is null or p_output_tokens is null or p_reasoning_tokens is null
     or p_input_tokens < 0 or p_output_tokens < 0 or p_reasoning_tokens < 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'bad_tokens');
  end if;
  -- Resolved before the token bounds are tested and before any row is read or locked. A missing token
  -- or attempt ceiling must refuse the attempt outright, never wave it through unbounded.
  begin
    v_lim_input    := noor_ai.require_limit('max_input_tokens');
    v_lim_output   := noor_ai.require_limit('max_output_tokens');
    v_lim_attempts := noor_ai.require_limit('max_attempts');
  exception when sqlstate 'NOCFG' then
    return noor_ai.config_error(sqlerrm);
  end;

  if p_input_tokens > v_lim_input
     or (p_output_tokens::bigint + p_reasoning_tokens::bigint) > v_lim_output then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'token_limit');
  end if;

  begin
    v_outcome := p_outcome::noor_ai.outcome_class;
  exception when others then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'bad_outcome');
  end;

  -- Bound to the reserving subject: a caller cannot touch another subject's reservation (§12.6).
  select * into v_res from noor_ai.reservation r
   where r.reservation_id = p_reservation_id and r.subject_id = p_subject_id
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'unknown_reservation');
  end if;

  -- Idempotent replay, decided BEFORE the state and ceiling checks so a lost-response retry behaves
  -- the same way regardless of what has happened to the reservation since.
  select * into v_prior from noor_ai.provider_attempt a
   where a.reservation_id = p_reservation_id and a.attempt_number = p_attempt_number;
  if found then
    -- Same attempt, same accounting inputs: hand back the original result and touch nothing.
    if v_prior.input_tokens = p_input_tokens
       and v_prior.output_tokens = p_output_tokens
       and v_prior.reasoning_tokens = p_reasoning_tokens
       and v_prior.outcome_class = p_outcome::noor_ai.outcome_class then
      return pg_catalog.jsonb_build_object(
        'ok', true, 'idempotent', true, 'estimated_micros', v_prior.estimated_micros);
    end if;
    -- Same attempt number, different accounting. The store cannot know which version is true, so it
    -- refuses rather than overwriting or double-counting.
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'attempt_conflict');
  end if;

  -- LATE ACCOUNTING (owner decision, 2026-08-08). A provider attempt that really happened must be
  -- recorded even if its result reaches the store after the lease expired. `expired` is therefore an
  -- ACCEPTING state here, exactly like `reserved`.
  --
  -- `finalized` and `released` are not: once accounting has closed or the caller has abandoned the
  -- request, a new attempt would alter a settled record. Those fail closed.
  --
  -- This does not reopen the lease, restore `reserved`, or touch any request counter — expiry already
  -- released the concurrency slot and that release is permanent.
  if v_res.state not in ('reserved', 'expired') then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  if v_res.attempt_count >= v_lim_attempts then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'attempt_limit');
  end if;

  select * into v_price from noor_ai.price_table p where p.active;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'no_price_table');
  end if;

  -- Cost computed HERE from the price table. Callers supply token counts only, never money (§12.6).
  -- Reasoning tokens bill at the output rate (plan §2.1). Integer arithmetic throughout, micro-USD.
  v_micros := (p_input_tokens::bigint * v_price.input_micros_per_mtok) / 1000000
            + ((p_output_tokens::bigint + p_reasoning_tokens::bigint) * v_price.output_micros_per_mtok) / 1000000;

  insert into noor_ai.provider_attempt
    (reservation_id, attempt_number, input_tokens, output_tokens, reasoning_tokens,
     estimated_micros, price_table_version, outcome_class)
  values (p_reservation_id, p_attempt_number, p_input_tokens, p_output_tokens, p_reasoning_tokens,
          v_micros, v_price.version, v_outcome);

  update noor_ai.reservation set attempt_count = attempt_count + 1
   where reservation_id = p_reservation_id;

  return pg_catalog.jsonb_build_object('ok', true, 'idempotent', false, 'estimated_micros', v_micros);
end
$$;

-- ── 9. Lifecycle: finalize (idempotent) and release ─────────────────────────
create or replace function noor_ai.finalize(p_subject_id uuid, p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now    timestamptz := pg_catalog.now();
  v_res      noor_ai.reservation%rowtype;
  v_micros   bigint;
  v_attempts bigint;
begin
  if p_subject_id is null or p_reservation_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing_argument');
  end if;

  select * into v_res from noor_ai.reservation r
   where r.reservation_id = p_reservation_id and r.subject_id = p_subject_id
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'unknown_reservation');
  end if;

  -- Idempotency by state guard (review §12.4). `finalized` and `released` are terminal: a repeated
  -- finalize accumulates nothing, which is the whole of double-count prevention.
  if v_res.state in ('finalized', 'released') then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'state', v_res.state, 'idempotent', true, 'accumulated_micros', 0);
  end if;

  select coalesce(pg_catalog.sum(a.estimated_micros), 0), pg_catalog.count(*)
    into v_micros, v_attempts
    from noor_ai.provider_attempt a where a.reservation_id = p_reservation_id;

  -- LATE ACCOUNTING (owner decision, 2026-08-08). An `expired` reservation may still be
  -- cost-finalized, but only when a provider attempt actually exists. With zero attempts there is
  -- nothing to account: that is the already-documented crash/timeout under-count case (review §12.7),
  -- and the store must not invent an estimate. The row stays `expired` so it is not mistaken for a
  -- request that completed.
  if v_res.state = 'expired' and v_attempts = 0 then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'state', 'expired', 'idempotent', true, 'accumulated_micros', 0);
  end if;

  perform noor_ai.accumulate_global('spend_micros', 'day',
            noor_ai.window_start_of('day', v_now), v_micros);
  perform noor_ai.accumulate_global('spend_micros', 'month',
            noor_ai.window_start_of('month', v_now), v_micros);

  -- Finalizing releases the lease in the SAME transaction (review §12.1 steps 4-5). The guard names
  -- both accepting states so a late finalize closes an `expired` row too — and, being a one-way move
  -- to `finalized`, it never restores `reserved` or re-admits a request.
  update noor_ai.reservation set state = 'finalized', finalized_at = v_now
   where reservation_id = p_reservation_id and state in ('reserved', 'expired');

  return pg_catalog.jsonb_build_object(
    'ok', true, 'state', 'finalized', 'idempotent', false, 'accumulated_micros', v_micros);
end
$$;

create or replace function noor_ai.release(p_subject_id uuid, p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_res noor_ai.reservation%rowtype;
begin
  if p_subject_id is null or p_reservation_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing_argument');
  end if;
  select * into v_res from noor_ai.reservation r
   where r.reservation_id = p_reservation_id and r.subject_id = p_subject_id
   for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'unknown_reservation');
  end if;
  if v_res.state <> 'reserved' then
    return pg_catalog.jsonb_build_object('ok', true, 'state', v_res.state, 'idempotent', true);
  end if;
  -- Quota already consumed is NOT refunded (review §12.7): a request that reached the provider may
  -- have cost money, and the store cannot know whether it did.
  update noor_ai.reservation set state = 'released' where reservation_id = p_reservation_id;
  return pg_catalog.jsonb_build_object('ok', true, 'state', 'released', 'idempotent', false);
end
$$;

-- ── 10. Minimal status read ─────────────────────────────────────────────────
-- Deliberately narrow: the caller already knows the subject it asked about, so echoing it back adds
-- nothing. No other subject is ever described, and no reservation ids are listed.
create or replace function noor_ai.status(p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_lim_uday bigint;
  v_lim_gday bigint;
begin
  if p_subject_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing_argument');
  end if;
  -- A status read must not quote a ceiling it could not resolve. Reporting `null` as a limit would
  -- read as "unlimited" to anything that renders it.
  begin
    v_lim_uday := noor_ai.require_limit('per_user_day');
    v_lim_gday := noor_ai.require_limit('global_day');
  exception when sqlstate 'NOCFG' then
    return noor_ai.config_error(sqlerrm);
  end;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    -- Same fail-closed rule as reserve: a missing or non-1 `enabled` reads as disabled, not as an
    -- error, because "off" is a legitimate operational state and absence must resolve to it.
    'enabled', noor_ai.limit_of('enabled') is not distinct from 1,
    'user_day_used', noor_ai.user_value(p_subject_id, 'requests', 'day',
                       noor_ai.window_start_of('day', v_now)),
    'user_day_limit', v_lim_uday,
    'global_day_used', noor_ai.global_value('requests', 'day',
                         noor_ai.window_start_of('day', v_now)),
    'global_day_limit', v_lim_gday);
end
$$;

-- ── 11. Retention ───────────────────────────────────────────────────────────
-- Callable, and deliberately NOT scheduled: no destructive cron job is approved (review §10.3).
-- Month rows are exempt because the monthly spend ceiling cannot be enforced by a counter deleted
-- after 48 hours — one aggregate row per month is an accounting figure, not behavioural history.
--
-- ACCOUNT-DELETION INTEGRATION GATE: erasure of one account's quota rows is a targeted delete on
-- `subject_id` against the leading column of user_counter's primary key and reservation_by_subject,
-- so it never scans another account's data. No deletion RPC is created here: neither
-- NOOR_AI_BACKEND_CONTRACT.md nor docs/ACCOUNT_DELETION_ARCHITECTURE.md authorizes one yet, and
-- inventing an API ahead of that review is exactly what this project has avoided. Wiring it into the
-- account-deletion flow is a tracked release gate.
create or replace function noor_ai.purge_expired()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_u bigint; v_g bigint; v_r bigint;
begin
  delete from noor_ai.user_counter
   where window_kind <> 'month' and updated_at < pg_catalog.now() - interval '48 hours';
  get diagnostics v_u = row_count;
  delete from noor_ai.global_counter
   where window_kind <> 'month' and updated_at < pg_catalog.now() - interval '48 hours';
  get diagnostics v_g = row_count;
  -- provider_attempt rows cascade with their reservation.
  delete from noor_ai.reservation
   where state <> 'reserved' and created_at < pg_catalog.now() - interval '48 hours';
  get diagnostics v_r = row_count;
  return pg_catalog.jsonb_build_object(
    'user_counters_deleted', v_u, 'global_counters_deleted', v_g, 'reservations_deleted', v_r);
end
$$;

-- ── 12. Privileges inside the private schema ────────────────────────────────
-- These run BEFORE the ownership transfer below, because a role that no longer owns an object can no
-- longer alter its ACL. PostgreSQL rewrites the ACL on transfer, re-attributing grants to the new
-- owner, so the end state is preserved.
revoke all on all tables in schema noor_ai from public;
revoke all on all tables in schema noor_ai from anon;
revoke all on all tables in schema noor_ai from authenticated;
revoke all on all tables in schema noor_ai from service_role;
revoke all on all sequences in schema noor_ai from public;
revoke all on all sequences in schema noor_ai from anon;
revoke all on all sequences in schema noor_ai from authenticated;
revoke all on all sequences in schema noor_ai from service_role;
revoke all on all functions in schema noor_ai from public;
revoke all on all functions in schema noor_ai from anon;
revoke all on all functions in schema noor_ai from authenticated;
revoke all on all functions in schema noor_ai from service_role;

-- service_role may execute EXACTLY the five lifecycle entry points. Internal helpers
-- (try_increment_*, accumulate_global, expire_stale, limit_of, window_start_of, *_value,
-- purge_expired) stay unreachable, so no counter can move except through the audited lifecycle.
grant execute on function noor_ai.reserve(uuid, text) to service_role;
grant execute on function noor_ai.register_attempt(uuid, uuid, integer, integer, integer, integer, text) to service_role;
grant execute on function noor_ai.finalize(uuid, uuid) to service_role;
grant execute on function noor_ai.release(uuid, uuid) to service_role;
grant execute on function noor_ai.status(uuid) to service_role;

-- ── 13. Ownership ───────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select c.relname from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'noor_ai' and c.relkind in ('r', 'p')
  loop
    execute pg_catalog.format('alter table noor_ai.%I owner to noor_ai_owner', r.relname);
  end loop;

  for r in select t.typname from pg_catalog.pg_type t
            join pg_catalog.pg_namespace n on n.oid = t.typnamespace
           where n.nspname = 'noor_ai' and t.typtype = 'e'
  loop
    execute pg_catalog.format('alter type noor_ai.%I owner to noor_ai_owner', r.typname);
  end loop;

  for r in select p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
             from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'noor_ai'
  loop
    execute pg_catalog.format('alter function noor_ai.%I(%s) owner to noor_ai_owner', r.proname, r.args);
  end loop;
end
$$;

-- ── 14. The public wrappers — the ONLY reachable surface ────────────────────
-- SECURITY INVOKER on purpose. An earlier revision made them SECURITY DEFINER, which forced an
-- ownership transfer into `public` that `noor_ai_owner` cannot receive without CREATE on `public` — a
-- privilege it must not hold. INVOKER is also strictly safer: the wrapper carries no authority of its
-- own, and every privileged action happens inside the `noor_ai` definer functions owned by the NOLOGIN
-- owner.
--
-- Signatures are exact and unambiguous: no overloads, no default arguments (a default would let a
-- caller omit an argument and broaden reachability).
--
-- PostgreSQL grants EXECUTE to PUBLIC on every newly created function, and that grant appears in no
-- pg_default_acl row. So each REVOKE below runs in the SAME transaction as its CREATE — which it does,
-- because a migration file is one transaction.
--
-- `p_subject_id` is supplied by the Edge Function, which MUST derive it from verified JWT claims. The
-- database cannot verify that and does not pretend to; it is a documented caller obligation.
create or replace function public.noor_ai_reserve(p_subject_id uuid, p_request_id text)
returns jsonb language sql set search_path = ''
as $$ select noor_ai.reserve(p_subject_id, p_request_id) $$;

create or replace function public.noor_ai_register_attempt(
  p_subject_id uuid, p_reservation_id uuid, p_attempt_number integer,
  p_input_tokens integer, p_output_tokens integer, p_reasoning_tokens integer, p_outcome text)
returns jsonb language sql set search_path = ''
as $$ select noor_ai.register_attempt(p_subject_id, p_reservation_id, p_attempt_number,
              p_input_tokens, p_output_tokens, p_reasoning_tokens, p_outcome) $$;

create or replace function public.noor_ai_finalize(p_subject_id uuid, p_reservation_id uuid)
returns jsonb language sql set search_path = ''
as $$ select noor_ai.finalize(p_subject_id, p_reservation_id) $$;

create or replace function public.noor_ai_release(p_subject_id uuid, p_reservation_id uuid)
returns jsonb language sql set search_path = ''
as $$ select noor_ai.release(p_subject_id, p_reservation_id) $$;

create or replace function public.noor_ai_status(p_subject_id uuid)
returns jsonb language sql set search_path = ''
as $$ select noor_ai.status(p_subject_id) $$;

-- ACLs are written out per exact identity signature, NOT enumerated by name prefix.
--
-- An earlier revision looped over `proname like 'noor\_ai\_%'` and granted service_role EXECUTE to
-- whatever it found. That is a standing hazard rather than a tidy shortcut: any future function that
-- happened to match the prefix — added by another migration, or by an operator — would silently
-- inherit service_role EXECUTE without anyone reviewing it. Naming each signature means a sixth
-- entry point cannot appear by accident; adding one requires editing this list AND the guard.
revoke all on function public.noor_ai_reserve(uuid, text) from public;
revoke all on function public.noor_ai_reserve(uuid, text) from anon;
revoke all on function public.noor_ai_reserve(uuid, text) from authenticated;
grant execute on function public.noor_ai_reserve(uuid, text) to service_role;

revoke all on function public.noor_ai_register_attempt(uuid, uuid, integer, integer, integer, integer, text) from public;
revoke all on function public.noor_ai_register_attempt(uuid, uuid, integer, integer, integer, integer, text) from anon;
revoke all on function public.noor_ai_register_attempt(uuid, uuid, integer, integer, integer, integer, text) from authenticated;
grant execute on function public.noor_ai_register_attempt(uuid, uuid, integer, integer, integer, integer, text) to service_role;

revoke all on function public.noor_ai_finalize(uuid, uuid) from public;
revoke all on function public.noor_ai_finalize(uuid, uuid) from anon;
revoke all on function public.noor_ai_finalize(uuid, uuid) from authenticated;
grant execute on function public.noor_ai_finalize(uuid, uuid) to service_role;

revoke all on function public.noor_ai_release(uuid, uuid) from public;
revoke all on function public.noor_ai_release(uuid, uuid) from anon;
revoke all on function public.noor_ai_release(uuid, uuid) from authenticated;
grant execute on function public.noor_ai_release(uuid, uuid) to service_role;

revoke all on function public.noor_ai_status(uuid) from public;
revoke all on function public.noor_ai_status(uuid) from anon;
revoke all on function public.noor_ai_status(uuid) from authenticated;
grant execute on function public.noor_ai_status(uuid) to service_role;

-- ── 15. Hand back the borrowed privilege ────────────────────────────────────
-- Same restoration rule as §2, and for a sharper reason: this is the *last* statement in the file, so
-- whatever identity it leaves behind is the identity the CLI's appended migration-history INSERT runs
-- as. `RESET ROLE` would hand that to the connection's session identity rather than to the migration
-- identity that has been executing the file. The restore is therefore explicit and safely quoted, and
-- the same fail-closed assertion follows it.
--
-- `v_migrator` is re-captured here rather than carried from §2 because each `DO` block has its own
-- scope; §2's assertion guarantees `current_user` is the same identity by the time this runs.
do $$
declare v_migrator text := current_user;
begin
  execute 'set local role noor_ai_owner';
  execute pg_catalog.format('revoke create on schema noor_ai from %I', v_migrator);
  execute pg_catalog.format('set local role %I', v_migrator);
  if current_user <> v_migrator then
    raise exception
      using errcode = '42501',
            message = 'noor_ai migration: role restoration did not return to the migration identity',
            hint    = 'The privilege-borrowing block must return to the identity granted temporary CREATE.';
  end if;
end
$$;
