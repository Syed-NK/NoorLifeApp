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
-- left behind. The switch is therefore confined to this block and reset inside it.
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
  execute 'reset role';
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
create or replace function noor_ai.limit_of(p_key text)
returns bigint language sql stable strict set search_path = ''
as $$ select c.value from noor_ai.limit_config c where c.key = p_key $$;

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

  -- Idempotent replay: same subject + same request id returns the SAME reservation and consumes no
  -- second quota unit (review §12.4).
  select * into v_exist from noor_ai.reservation r
   where r.subject_id = p_subject_id and r.request_id = p_request_id;
  if found then
    return pg_catalog.jsonb_build_object(
      'decision', case when v_exist.state = 'reserved' then 'allowed' else 'replayed' end,
      'reservation_id', v_exist.reservation_id, 'state', v_exist.state, 'idempotent', true);
  end if;

  perform noor_ai.expire_stale();

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

  select pg_catalog.count(*) into v_leases from noor_ai.reservation r
   where r.state = 'reserved' and r.expires_at > v_now;
  if v_leases >= noor_ai.limit_of('concurrency_lease') then
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', 'concurrency');
  end if;

  -- Spend ceilings are READ and compared, never pre-debited (review §12.2 hard rule).
  if noor_ai.global_value('spend_micros', 'day', noor_ai.window_start_of('day', v_now))
       >= noor_ai.limit_of('daily_spend_micros') then
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', 'daily_spend');
  end if;
  if noor_ai.global_value('spend_micros', 'month', noor_ai.window_start_of('month', v_now))
       >= noor_ai.limit_of('monthly_spend_micros') then
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', 'monthly_spend');
  end if;

  -- All five request counters are all-or-nothing. The sub-block establishes a savepoint, so a denial
  -- on a later counter rolls back the increments already made by the earlier ones (review §12.2).
  begin
    if noor_ai.try_increment_global('requests', 'minute',
         noor_ai.window_start_of('minute', v_now), noor_ai.limit_of('global_minute'), 1) is null then
      raise exception using errcode = 'NOQTA', message = 'global_minute';
    end if;
    if noor_ai.try_increment_global('requests', 'day',
         noor_ai.window_start_of('day', v_now), noor_ai.limit_of('global_day'), 1) is null then
      raise exception using errcode = 'NOQTA', message = 'global_day';
    end if;
    if noor_ai.try_increment_user(p_subject_id, 'requests', 'minute',
         noor_ai.window_start_of('minute', v_now), noor_ai.limit_of('per_user_minute'), 1) is null then
      raise exception using errcode = 'NOQTA', message = 'per_user_minute';
    end if;
    if noor_ai.try_increment_user(p_subject_id, 'requests', 'hour',
         noor_ai.window_start_of('hour', v_now), noor_ai.limit_of('per_user_hour'), 1) is null then
      raise exception using errcode = 'NOQTA', message = 'per_user_hour';
    end if;
    if noor_ai.try_increment_user(p_subject_id, 'requests', 'day',
         noor_ai.window_start_of('day', v_now), noor_ai.limit_of('per_user_day'), 1) is null then
      raise exception using errcode = 'NOQTA', message = 'per_user_day';
    end if;
  exception when sqlstate 'NOQTA' then
    -- Returned as DATA, never raised: the Edge Function must be able to tell a denial (429) from a
    -- store failure (503) (review §12.2).
    return pg_catalog.jsonb_build_object('decision', 'limited', 'reason', sqlerrm);
  end;

  insert into noor_ai.reservation (subject_id, request_id, expires_at)
  values (p_subject_id, p_request_id,
          v_now + pg_catalog.make_interval(secs => noor_ai.limit_of('lease_ttl_seconds')))
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
  if p_input_tokens > noor_ai.limit_of('max_input_tokens')
     or (p_output_tokens::bigint + p_reasoning_tokens::bigint) > noor_ai.limit_of('max_output_tokens') then
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
  if v_res.attempt_count >= noor_ai.limit_of('max_attempts') then
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
declare v_now timestamptz := pg_catalog.now();
begin
  if p_subject_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing_argument');
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'enabled', noor_ai.limit_of('enabled') = 1,
    'user_day_used', noor_ai.user_value(p_subject_id, 'requests', 'day',
                       noor_ai.window_start_of('day', v_now)),
    'user_day_limit', noor_ai.limit_of('per_user_day'),
    'global_day_used', noor_ai.global_value('requests', 'day',
                         noor_ai.window_start_of('day', v_now)),
    'global_day_limit', noor_ai.limit_of('global_day'));
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
do $$
declare v_migrator text := current_user;
begin
  execute 'set local role noor_ai_owner';
  execute pg_catalog.format('revoke create on schema noor_ai from %I', v_migrator);
  execute 'reset role';
end
$$;
