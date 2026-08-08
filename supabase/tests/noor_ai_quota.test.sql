-- NoorLife — NoorAI quota store behavioural tests.
--
--     npx supabase db reset --local
--     npx supabase test db --local supabase/tests
--
-- Runs inside one transaction that pgTAP rolls back, so every mutation here — including the
-- limit_config edits used to isolate one ceiling at a time — is discarded. Nothing persists.
--
-- Concurrency is NOT tested here: a single transaction cannot exercise the advisory lock against a
-- competing session. See supabase/tests/concurrency/ for the separate two-session harness.

begin;
select * from no_plan();

-- The test role deliberately has NO access to this schema — that is the production posture, and
-- security_invariants.test.sql asserts it. So the suite grants itself read/write access here, inside
-- the transaction pgTAP rolls back. The grants vanish with the rollback; they are visible only to
-- this test and never reach a deployed database.
--
-- Only noor_ai_owner can issue them, so this block assumes that role briefly. The privileges granted
-- are for INSPECTING and ARRANGING state; every lifecycle call still goes through the public wrapper
-- as service_role, so the call path under test is the real one.
do $$
begin
  set local role noor_ai_owner;
  execute 'grant usage on schema noor_ai to postgres';
  execute 'grant select, insert, update, delete on all tables in schema noor_ai to postgres';
  execute 'grant execute on all functions in schema noor_ai to postgres';
  reset role;
end
$$;

-- Fixed synthetic subjects. These are not real accounts and never reach auth.users.
create temporary table t_subj (label text primary key, id uuid) on commit drop;
insert into t_subj values
  ('a', '11111111-1111-4111-8111-111111111111'),
  ('b', '22222222-2222-4222-8222-222222222222');

create or replace function pg_temp.sid(p text) returns uuid language sql stable as
$$ select id from t_subj where label = p $$;

-- The pristine seeded configuration, captured before any section edits it. §16 deletes and zeroes
-- individual keys to prove the fail-closed rule, and restores from here between probes so each probe
-- starts from the same known-good state rather than from the previous probe's damage.
create temporary table t_cfg_backup on commit drop as
  select * from noor_ai.limit_config;

create or replace function pg_temp.restore_cfg() returns void language sql as $$
  delete from noor_ai.limit_config;
  insert into noor_ai.limit_config select * from t_cfg_backup;
$$;

-- Raise every ceiling AND clear accumulated state, so an individual limit can be isolated by lowering
-- just that one. Clearing matters: counters persist across sections within the transaction, so
-- without it a later section would be denied by an earlier section's consumption rather than by the
-- ceiling under test. Reservations cascade their provider_attempt rows.
create or replace function pg_temp.open_limits() returns void language sql as $$
  update noor_ai.limit_config set value = 1000
   where key in ('per_user_minute','per_user_hour','per_user_day',
                 'global_minute','global_day','concurrency_lease');
  delete from noor_ai.reservation;
  delete from noor_ai.user_counter;
  delete from noor_ai.global_counter;
$$;

create or replace function pg_temp.setlim(k text, v bigint) returns void language sql as
$$ update noor_ai.limit_config set value = v where key = k $$;

-- Every RPC call goes through the public wrapper as service_role, i.e. the real call path.
create or replace function pg_temp.rpc_reserve(p_sub uuid, p_req text) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.noor_ai_reserve(p_sub, p_req);
  reset role;
  return v;
end $$;

create or replace function pg_temp.rpc_attempt(p_sub uuid, p_res uuid, n int, i int, o int, r int, oc text)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.noor_ai_register_attempt(p_sub, p_res, n, i, o, r, oc);
  reset role;
  return v;
end $$;

create or replace function pg_temp.rpc_finalize(p_sub uuid, p_res uuid) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.noor_ai_finalize(p_sub, p_res);
  reset role;
  return v;
end $$;

create or replace function pg_temp.rpc_release(p_sub uuid, p_res uuid) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.noor_ai_release(p_sub, p_res);
  reset role;
  return v;
end $$;

create or replace function pg_temp.rpc_status(p_sub uuid) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  v := public.noor_ai_status(p_sub);
  reset role;
  return v;
end $$;

-- ── 1. Reservation basics ───────────────────────────────────────────────────
select pg_temp.open_limits();

select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'r1')->>'decision', 'allowed',
  'first reservation is allowed');
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'r1')->>'idempotent', 'true',
  'replaying the same request id is idempotent');
select is(
  (select count(distinct reservation_id)::int from noor_ai.reservation
    where subject_id = pg_temp.sid('a') and request_id = 'r1'),
  1, 'an idempotent replay creates no second reservation');
select is(
  noor_ai.user_value(pg_temp.sid('a'), 'requests', 'day',
    noor_ai.window_start_of('day', now())),
  1::bigint, 'an idempotent replay consumes no second quota unit');

-- Same request id, different subject: must be a distinct reservation, not a collision.
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'r1')->>'decision', 'allowed',
  'the same request id under a different subject is allowed');
select is(
  (select count(*)::int from noor_ai.reservation where request_id = 'r1'),
  2, 'the same request id under two subjects yields two separate reservations');
select isnt(
  (select reservation_id from noor_ai.reservation where subject_id = pg_temp.sid('a') and request_id = 'r1'),
  (select reservation_id from noor_ai.reservation where subject_id = pg_temp.sid('b') and request_id = 'r1'),
  'the two reservations are distinct rows');

-- ── 2. Subject identity is stored as the verified uuid, nothing else ────────
select is(
  (select subject_id from noor_ai.reservation where subject_id = pg_temp.sid('a') and request_id = 'r1'),
  pg_temp.sid('a'), 'the stored subject equals exactly the uuid the server supplied');

select is_empty(
  $$ select a.attname::text from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     where c.relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
       and (a.attname like '%digest%' or a.attname like '%hash%'
         or a.attname like '%subject_key%' or a.attname like '%_text') $$,
  'no digest, hash or text-form duplicate of the subject exists');

select is(
  (select format_type(a.atttypid, null) from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relname = 'reservation' and a.attname = 'subject_id'
      and c.relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')),
  'uuid', 'subject_id is typed uuid');

-- request_id is text and cannot be confused with the subject uuid.
select is(
  (select format_type(a.atttypid, null) from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    where c.relname = 'reservation' and a.attname = 'request_id'
      and c.relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')),
  'text', 'request_id is text, structurally distinct from the subject uuid');

-- ── 3. No sensitive content columns anywhere ────────────────────────────────
select is_empty(
  $$ select c.relname || '.' || a.attname from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     where c.relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
       and (a.attname ~* 'prompt|response|message|content|email|phone|jwt|token_text'
         or a.attname ~* 'journal|health|family|module|ip_|device|user_agent') $$,
  'no prompt, response, module, journal, health, family or contact column exists');

-- ── 4. Per-user limits ──────────────────────────────────────────────────────
select pg_temp.open_limits();
select pg_temp.setlim('per_user_minute', 1);
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'm1')->>'decision', 'allowed',
  'per-user minute: first request allowed');
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'm2')->>'reason', 'per_user_minute',
  'per-user minute: second request denied with the right reason');
select is(noor_ai.user_value(pg_temp.sid('a'), 'requests', 'minute',
    noor_ai.window_start_of('minute', now())),
  1::bigint, 'a denied request does not consume quota');

select pg_temp.open_limits();
select pg_temp.setlim('per_user_hour', 1);
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'h1')->>'decision', 'allowed',
  'per-user hour: first request allowed');
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'h2')->>'reason', 'per_user_hour',
  'per-user hour: second request denied');

select pg_temp.open_limits();
select pg_temp.setlim('per_user_day', 1);
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'd1')->>'decision', 'allowed',
  'per-user day: first request allowed');
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'd2')->>'reason', 'per_user_day',
  'per-user day: second request denied');

-- One subject exhausting its own limit must not deny another subject.
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'd3')->>'decision', 'allowed',
  'a per-user denial for one subject does not affect another subject');

-- ── 5. Global limits ────────────────────────────────────────────────────────
select pg_temp.open_limits();
select pg_temp.setlim('global_minute', 1);
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'g1')->>'decision', 'allowed',
  'global minute: first request allowed');
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'g2')->>'reason', 'global_minute',
  'global minute: a different subject is denied by the global ceiling');

select pg_temp.open_limits();
select pg_temp.setlim('global_day', 1);
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'gd1')->>'decision', 'allowed',
  'global day: first request allowed');
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'gd2')->>'reason', 'global_day',
  'global day: second request denied');

-- ── 5b. A denial rolls back every counter the same call already incremented ─
-- The five request counters are all-or-nothing. reserve() increments them in order — global minute,
-- global day, per-user minute, per-user hour, per-user day — inside a sub-block whose exception
-- handler is what makes the set atomic. Denying on the LAST of the five is therefore the only
-- arrangement that exercises the whole rollback: four counters have already been raised when the
-- refusal happens, and every one of them must come back down.
--
-- Asserting only the counter that did the denying (as §4 does) would still pass with the sub-block
-- removed, because that counter is the one try_increment_* never raised in the first place. These
-- assertions fail against that version.
select pg_temp.open_limits();
select pg_temp.setlim('per_user_day', 1);

select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'rb1')->>'decision', 'allowed',
  'rollback: the first request is admitted and consumes one unit of each counter');
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'rb2')->>'reason', 'per_user_day',
  'rollback: the second request is denied by the last counter in the sequence');

select is(noor_ai.global_value('requests', 'minute', noor_ai.window_start_of('minute', now())),
  1::bigint, 'rollback: the global minute counter raised before the denial is rolled back');
select is(noor_ai.global_value('requests', 'day', noor_ai.window_start_of('day', now())),
  1::bigint, 'rollback: the global day counter raised before the denial is rolled back');
select is(noor_ai.user_value(pg_temp.sid('a'), 'requests', 'minute',
    noor_ai.window_start_of('minute', now())),
  1::bigint, 'rollback: the per-user minute counter raised before the denial is rolled back');
select is(noor_ai.user_value(pg_temp.sid('a'), 'requests', 'hour',
    noor_ai.window_start_of('hour', now())),
  1::bigint, 'rollback: the per-user hour counter raised before the denial is rolled back');
select is(noor_ai.user_value(pg_temp.sid('a'), 'requests', 'day',
    noor_ai.window_start_of('day', now())),
  1::bigint, 'rollback: the denying counter itself was never raised');

-- The denial left no reservation behind either — a rolled-back admission is not a half-admission.
select is((select count(*)::int from noor_ai.reservation
            where subject_id = pg_temp.sid('a') and request_id = 'rb2'),
  0, 'rollback: a denied reservation is never inserted');

-- ── 6. Concurrency lease and expiry ─────────────────────────────────────────
select pg_temp.open_limits();
select pg_temp.setlim('concurrency_lease', 1);
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'c1')->>'decision', 'allowed',
  'lease: first reservation takes the only lease');
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'c2')->>'reason', 'concurrency',
  'lease: a second live reservation is refused');

-- Force the lease to look expired; the next reserve must reclaim it lazily.
-- Age the whole row: the `expires_at > created_at` constraint correctly refuses an expiry moved into
-- the past on its own, so a realistic stale lease has to be created in the past as well.
update noor_ai.reservation
   set created_at = now() - interval '10 minutes',
       expires_at = now() - interval '1 second'
 where subject_id = pg_temp.sid('a') and request_id = 'c1';
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'c3')->>'decision', 'allowed',
  'lease: an expired lease is reclaimed lazily at the next reserve');
select is(
  (select state::text from noor_ai.reservation
    where subject_id = pg_temp.sid('a') and request_id = 'c1'),
  'expired', 'the stale reservation is marked expired');

-- ── 7. Kill switch ──────────────────────────────────────────────────────────
select pg_temp.open_limits();
select pg_temp.setlim('enabled', 0);
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'k1')->>'reason', 'disabled',
  'kill switch denies every reservation');
select pg_temp.setlim('enabled', 1);

-- ── 8. Attempts, cost accounting and finalization ───────────────────────────
select pg_temp.open_limits();

create temporary table t_res (rid uuid) on commit drop;
insert into t_res select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'f1')->>'reservation_id')::uuid;

select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_res), 1, 1000, 100, 50, 'transient')->>'ok',
  'true', 'a failed provider attempt is recorded');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_res), 2, 1000, 200, 0, 'success')->>'ok',
  'true', 'the permitted retry attempt is recorded separately');
select is(
  (select count(*)::int from noor_ai.provider_attempt where reservation_id = (select rid from t_res)),
  2, 'both provider attempts are cost-accounted separately');
select is(
  (select attempt_count from noor_ai.reservation where reservation_id = (select rid from t_res)),
  2, 'attempt_count reconciles with the recorded attempts');

-- A third attempt exceeds max_attempts (2 = one permitted retry).
-- With a bounded ordinal a "third attempt" cannot even be expressed: 3 is out of range, and reusing
-- ordinal 2 with different accounting is a conflict rather than a silent third record.
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_res), 3, 10, 10, 0, 'success')->>'reason',
  'bad_attempt_number', 'a third provider attempt cannot be expressed');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_res), 2, 10, 10, 0, 'success')->>'reason',
  'attempt_conflict', 'reusing the retry ordinal with different accounting fails closed');

-- 1000 input @ 2.5 micros/token = 2500; (100+50) output-equivalent @ 12 = 1800 -> 4300
-- second attempt: 1000 -> 2500; (200+0) @ 12 = 2400 -> 4900. Total 9200 micro-USD.
select is(
  (select sum(estimated_micros)::bigint from noor_ai.provider_attempt
    where reservation_id = (select rid from t_res)),
  9200::bigint, 'cost is computed in-database from the price table, in integer micro-USD');

select is(pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_res))->>'accumulated_micros',
  '9200', 'finalize accumulates the summed attempt cost');
select is(noor_ai.global_value('spend_micros', 'day', noor_ai.window_start_of('day', now())),
  9200::bigint, 'daily spend accumulator reflects the finalized cost');
select is(pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_res))->>'idempotent',
  'true', 'finalize is idempotent');
select is(noor_ai.global_value('spend_micros', 'day', noor_ai.window_start_of('day', now())),
  9200::bigint, 'a repeated finalize does not accumulate spend twice');

-- ── 8b. Provider-attempt registration is idempotent ─────────────────────────
-- The Edge Function can commit an attempt and then lose the response. A blind retry must not insert,
-- increment or cost-account a second time.
select pg_temp.open_limits();
create temporary table t_idem (rid uuid) on commit drop;
insert into t_idem select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'idem1')->>'reservation_id')::uuid;

select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), 1, 100, 10, 0, 'success')->>'idempotent',
  'false', 'the first registration of attempt 1 inserts');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), 1, 100, 10, 0, 'success')->>'idempotent',
  'true', 'replaying attempt 1 with identical accounting is idempotent');
select is(
  (select count(*)::int from noor_ai.provider_attempt where reservation_id = (select rid from t_idem)),
  1, 'an idempotent replay inserts no second provider_attempt row');
select is(
  (select attempt_count from noor_ai.reservation where reservation_id = (select rid from t_idem)),
  1, 'an idempotent replay does not increment attempt_count');
select is(
  pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), 1, 100, 10, 0, 'success')->>'estimated_micros',
  (select estimated_micros::text from noor_ai.provider_attempt where reservation_id = (select rid from t_idem)),
  'the replay returns the originally recorded cost');

-- Same attempt number, different accounting: the store cannot know which is true, so it refuses.
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), 1, 999, 10, 0, 'success')->>'reason',
  'attempt_conflict', 'reusing attempt 1 with different token counts fails closed');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), 1, 100, 10, 0, 'terminal')->>'reason',
  'attempt_conflict', 'reusing attempt 1 with a different outcome fails closed');
select is(
  (select count(*)::int from noor_ai.provider_attempt where reservation_id = (select rid from t_idem)),
  1, 'a conflicting replay writes nothing');

-- Bounds on the ordinal itself.
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), 0, 1, 1, 0, 'success')->>'reason',
  'bad_attempt_number', 'attempt number 0 is rejected');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), 3, 1, 1, 0, 'success')->>'reason',
  'bad_attempt_number', 'attempt number 3 is rejected');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), -1, 1, 1, 0, 'success')->>'reason',
  'bad_attempt_number', 'a negative attempt number is rejected');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), null, 1, 1, 0, 'success')->>'reason',
  'missing_argument', 'a null attempt number is rejected');

-- A legitimate retry: two attempts, two cost records, still ONE handler quota unit.
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_idem), 2, 100, 20, 0, 'success')->>'ok',
  'true', 'attempt 2 is the permitted retry and is accepted');
select is(
  (select count(*)::int from noor_ai.provider_attempt where reservation_id = (select rid from t_idem)),
  2, 'two provider attempts are recorded');
select is(
  noor_ai.user_value(pg_temp.sid('a'), 'requests', 'day', noor_ai.window_start_of('day', now())),
  1::bigint, 'two provider attempts still consume exactly one handler quota unit');

-- ── 8c. Late accounting after lease expiry ──────────────────────────────────
-- Owner decision 2026-08-08: a provider attempt that really happened must be accounted exactly once
-- even if its result arrives after expiry. Expiry releases the lease permanently; it never refunds
-- quota, never reopens the lease, and never restores `reserved`.

create or replace function pg_temp.age_out(p_rid uuid) returns void language sql as $$
  update noor_ai.reservation
     set state = 'expired',
         created_at = now() - interval '10 minutes',
         expires_at = now() - interval '1 second'
   where reservation_id = p_rid;
$$;

-- (1) reserved -> attempt -> expiry -> late finalize accounts cost once.
select pg_temp.open_limits();
create temporary table t_l1 (rid uuid) on commit drop;
insert into t_l1 select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'late1')->>'reservation_id')::uuid;
select pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_l1), 1, 1000, 100, 0, 'success');
select pg_temp.age_out((select rid from t_l1));
select is(pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_l1))->>'accumulated_micros',
  '3700', 'late finalize of an expired reservation accounts the incurred cost');
select is(noor_ai.global_value('spend_micros', 'day', noor_ai.window_start_of('day', now())),
  3700::bigint, 'daily spend reflects the late accounting exactly once');
select is((select state::text from noor_ai.reservation where reservation_id = (select rid from t_l1)),
  'finalized', 'late finalize moves expired -> finalized, never back to reserved');

-- (5) a repeated late finalize adds nothing.
select is(pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_l1))->>'idempotent',
  'true', 'a repeated late finalize is idempotent');
select is(noor_ai.global_value('spend_micros', 'day', noor_ai.window_start_of('day', now())),
  3700::bigint, 'a repeated late finalize does not double-count');

-- (9) a finalized reservation rejects new attempts.
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_l1), 2, 10, 10, 0, 'success')->>'reason',
  'not_open', 'a finalized reservation rejects a new attempt');

-- (2) reserved -> expiry -> LATE attempt registration -> finalize accounts once.
select pg_temp.open_limits();
create temporary table t_l2 (rid uuid) on commit drop;
insert into t_l2 select (pg_temp.rpc_reserve(pg_temp.sid('b'), 'late2')->>'reservation_id')::uuid;
select pg_temp.age_out((select rid from t_l2));
select is(pg_temp.rpc_attempt(pg_temp.sid('b'), (select rid from t_l2), 1, 1000, 100, 0, 'success')->>'ok',
  'true', 'an attempt may be registered against an expired reservation');
select is((select state::text from noor_ai.reservation where reservation_id = (select rid from t_l2)),
  'expired', 'registering a late attempt does not restore reserved');

-- (3) replaying that late attempt is idempotent.
select is(pg_temp.rpc_attempt(pg_temp.sid('b'), (select rid from t_l2), 1, 1000, 100, 0, 'success')->>'idempotent',
  'true', 'replaying a late attempt is idempotent');
select is((select count(*)::int from noor_ai.provider_attempt where reservation_id = (select rid from t_l2)),
  1, 'a late attempt replay inserts no second row');

-- (4) conflicting late replay fails closed.
select is(pg_temp.rpc_attempt(pg_temp.sid('b'), (select rid from t_l2), 1, 4321, 100, 0, 'success')->>'reason',
  'attempt_conflict', 'a conflicting late attempt replay fails closed');

-- (7) late accounting leaves request counters untouched.
create temporary table t_l2c (n bigint) on commit drop;
insert into t_l2c select noor_ai.user_value(pg_temp.sid('b'), 'requests', 'day',
  noor_ai.window_start_of('day', now()));
select is(pg_temp.rpc_finalize(pg_temp.sid('b'), (select rid from t_l2))->>'accumulated_micros',
  '3700', 'late finalize after a late attempt accounts the cost once');
select is(noor_ai.user_value(pg_temp.sid('b'), 'requests', 'day',
    noor_ai.window_start_of('day', now())),
  (select n from t_l2c), 'late accounting does not change request counters');

-- (6) expiry released the lease before any late accounting, and it stays released.
select pg_temp.open_limits();
select pg_temp.setlim('concurrency_lease', 1);
create temporary table t_l3 (rid uuid) on commit drop;
insert into t_l3 select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'late3')->>'reservation_id')::uuid;
select pg_temp.age_out((select rid from t_l3));
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'late3b')->>'decision', 'allowed',
  'expiry releases the concurrency lease before any late accounting');
select pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_l3), 1, 100, 10, 0, 'success');
select pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_l3));
select is(
  (select count(*)::int from noor_ai.reservation where state = 'reserved' and expires_at > now()),
  1, 'late accounting does not recreate a lease for the expired reservation');

-- (8) expired with zero attempts records zero spend and invents nothing.
select pg_temp.open_limits();
create temporary table t_l4 (rid uuid) on commit drop;
insert into t_l4 select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'late4')->>'reservation_id')::uuid;
select pg_temp.age_out((select rid from t_l4));
select is(pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_l4))->>'accumulated_micros',
  '0', 'an expired reservation with no attempt records zero spend');
select is(noor_ai.global_value('spend_micros', 'day', noor_ai.window_start_of('day', now())),
  0::bigint, 'no estimated cost is invented for the crash/timeout case');
select is((select state::text from noor_ai.reservation where reservation_id = (select rid from t_l4)),
  'expired', 'an unattempted expired reservation is not marked finalized');

-- (9b) a released reservation rejects new attempts.
select pg_temp.open_limits();
create temporary table t_l5 (rid uuid) on commit drop;
insert into t_l5 select (pg_temp.rpc_reserve(pg_temp.sid('b'), 'late5')->>'reservation_id')::uuid;
select pg_temp.rpc_release(pg_temp.sid('b'), (select rid from t_l5));
select is(pg_temp.rpc_attempt(pg_temp.sid('b'), (select rid from t_l5), 1, 10, 10, 0, 'success')->>'reason',
  'not_open', 'a released reservation rejects a new attempt');

-- (10) no path ever returns a reservation to `reserved`.
select is_empty(
  $$ select reservation_id::text from noor_ai.reservation
     where state = 'reserved' and expires_at <= now() $$,
  'no expired reservation was ever restored to reserved by late accounting');

-- ── 9. Spend ceiling denies without a provider call ─────────────────────────
-- Self-contained: build real spend here rather than depending on an earlier section's state, which
-- the intervening open_limits() calls clear.
select pg_temp.open_limits();
create temporary table t_sp (rid uuid) on commit drop;
insert into t_sp select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'spend1')->>'reservation_id')::uuid;
select pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_sp), 1, 1000, 100, 0, 'success');
select pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_sp));
select pg_temp.setlim('daily_spend_micros', 100);
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'sp1')->>'reason', 'daily_spend',
  'a breached daily spend ceiling denies further reservations');
select pg_temp.setlim('daily_spend_micros', 500000);

-- ── 9b. The monthly ceiling is a second, independent gate ───────────────────
-- reserve() tests daily spend first, so a monthly-only breach is the case that proves the monthly
-- check is reached at all rather than being shadowed by the daily one. Daily stays at its approved
-- DEV value here and is deliberately NOT breached: 3700 micro-USD is far below $0.50.
select pg_temp.open_limits();
create temporary table t_ms (rid uuid) on commit drop;
insert into t_ms select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'mspend1')->>'reservation_id')::uuid;
select pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_ms), 1, 1000, 100, 0, 'success');
select pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_ms));

select is(noor_ai.global_value('spend_micros', 'month', noor_ai.window_start_of('month', now())),
  3700::bigint, 'monthly spend accumulates alongside daily from the same finalize');

select pg_temp.setlim('monthly_spend_micros', 100);
select is(pg_temp.rpc_reserve(pg_temp.sid('b'), 'ms2')->>'reason', 'monthly_spend',
  'a breached monthly ceiling denies further reservations even when daily is well inside its bound');

-- A spend ceiling is READ and compared, never pre-debited, so the denial consumed nothing.
select is(noor_ai.user_value(pg_temp.sid('b'), 'requests', 'day',
    noor_ai.window_start_of('day', now())),
  0::bigint, 'a spend-ceiling denial consumes no request quota');
select is(noor_ai.global_value('spend_micros', 'month', noor_ai.window_start_of('month', now())),
  3700::bigint, 'a spend-ceiling denial pre-debits no spend');

select pg_temp.setlim('monthly_spend_micros', 2000000);

-- ── 10. Release semantics ───────────────────────────────────────────────────
select pg_temp.open_limits();
create temporary table t_rel (rid uuid) on commit drop;
insert into t_rel select (pg_temp.rpc_reserve(pg_temp.sid('b'), 'rel1')->>'reservation_id')::uuid;
select is(pg_temp.rpc_release(pg_temp.sid('b'), (select rid from t_rel))->>'state', 'released',
  'release moves a live reservation to released');
select is(pg_temp.rpc_release(pg_temp.sid('b'), (select rid from t_rel))->>'idempotent', 'true',
  'release is idempotent');
select is(noor_ai.user_value(pg_temp.sid('b'), 'requests', 'day',
    noor_ai.window_start_of('day', now())) > 0,
  true, 'released quota is NOT refunded — the request may already have cost money');

-- ── 11. Cross-subject and unknown-identifier handling ───────────────────────
select is(pg_temp.rpc_finalize(pg_temp.sid('a'), (select rid from t_rel))->>'reason',
  'unknown_reservation', 'a subject cannot finalize another subject''s reservation');
select is(pg_temp.rpc_release(pg_temp.sid('a'), (select rid from t_rel))->>'reason',
  'unknown_reservation', 'a subject cannot release another subject''s reservation');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_rel), 1, 1, 1, 0, 'success')->>'reason',
  'unknown_reservation', 'a subject cannot register an attempt on another subject''s reservation');
select is(pg_temp.rpc_finalize(pg_temp.sid('a'), '00000000-0000-4000-8000-000000000000')->>'reason',
  'unknown_reservation', 'an unknown reservation id fails closed');
select is(pg_temp.rpc_reserve(null, 'x')->>'reason', 'missing_argument',
  'a null subject fails before any mutation');
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), '')->>'reason', 'bad_request_id',
  'an empty request id is rejected');

-- ── 12. Token bounds ────────────────────────────────────────────────────────
select pg_temp.open_limits();
create temporary table t_tok (rid uuid) on commit drop;
insert into t_tok select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'tok1')->>'reservation_id')::uuid;
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_tok), 1, -1, 0, 0, 'success')->>'reason',
  'bad_tokens', 'negative token counts are rejected');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_tok), 1, 2147483647, 0, 0, 'success')->>'reason',
  'token_limit', 'an oversized input token count is rejected');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_tok), 1, 0, 2147483647, 0, 'success')->>'reason',
  'token_limit', 'an oversized output token count is rejected without overflowing');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_tok), 1, 0, 0, 0, 'not_a_class')->>'reason',
  'bad_outcome', 'an unknown outcome class is rejected');
select is(pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_tok), 1, 0, 0, 0, 'success')->>'ok',
  'true', 'a zero-token attempt is accepted and costs nothing');

-- ── 13. UTC window boundaries use the database clock ────────────────────────
select is(noor_ai.window_start_of('day', '2026-08-08T23:59:59Z'::timestamptz),
  '2026-08-08T00:00:00Z'::timestamptz, 'day windows truncate on the UTC boundary');
select is(noor_ai.window_start_of('day', '2026-08-09T00:00:00Z'::timestamptz),
  '2026-08-09T00:00:00Z'::timestamptz, 'the next UTC day opens a new window');
select is(noor_ai.window_start_of('minute', '2026-08-08T12:34:56Z'::timestamptz),
  '2026-08-08T12:34:00Z'::timestamptz, 'minute windows truncate on the UTC boundary');
select is(noor_ai.window_start_of('minute', '2026-08-08T12:35:00Z'::timestamptz),
  '2026-08-08T12:35:00Z'::timestamptz, 'the next UTC minute opens a new window');

-- All four window kinds are enforced, so all four are asserted. Truncation is expressed as
-- `... at time zone 'UTC'` on both sides, which makes the result independent of the session TimeZone;
-- comparing against absolute instants here is what proves that, rather than assuming it.
select is(noor_ai.window_start_of('hour', '2026-08-08T12:59:59Z'::timestamptz),
  '2026-08-08T12:00:00Z'::timestamptz, 'hour windows truncate on the UTC boundary');
select is(noor_ai.window_start_of('hour', '2026-08-08T13:00:00Z'::timestamptz),
  '2026-08-08T13:00:00Z'::timestamptz, 'the next UTC hour opens a new window');
select is(noor_ai.window_start_of('month', '2026-08-31T23:59:59Z'::timestamptz),
  '2026-08-01T00:00:00Z'::timestamptz, 'month windows truncate to the first UTC day of the month');
select is(noor_ai.window_start_of('month', '2026-09-01T00:00:00Z'::timestamptz),
  '2026-09-01T00:00:00Z'::timestamptz, 'the next UTC month opens a new window');

-- No RPC accepts a caller-supplied timestamp anywhere in its signature.
select is_empty(
  $$ select p.proname::text from pg_proc p
     where p.pronamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and p.proname in ('reserve','register_attempt','finalize','release','status')
       and pg_get_function_identity_arguments(p.oid) like '%timestamp%' $$,
  'no lifecycle entry point accepts a caller-supplied timestamp');

-- ── 14. Deterministic account-deletion cleanup ──────────────────────────────
-- Proves erasure can target exactly one subject. No deletion RPC exists yet: neither the contract
-- nor ACCOUNT_DELETION_ARCHITECTURE.md authorizes one, so this is the integration gate, tested
-- against the same targeted path the future flow will use.
select pg_temp.open_limits();
select pg_temp.rpc_reserve(pg_temp.sid('a'), 'del1');
select pg_temp.rpc_reserve(pg_temp.sid('b'), 'del2');

create temporary table t_before (n_b int, g int) on commit drop;
insert into t_before
  select (select count(*)::int from noor_ai.user_counter where subject_id = pg_temp.sid('b')),
         (select count(*)::int from noor_ai.global_counter);

delete from noor_ai.reservation where subject_id = pg_temp.sid('a');
delete from noor_ai.user_counter where subject_id = pg_temp.sid('a');

select is((select count(*)::int from noor_ai.reservation where subject_id = pg_temp.sid('a')), 0,
  'deletion removes every reservation for exactly one subject');
select is((select count(*)::int from noor_ai.user_counter where subject_id = pg_temp.sid('a')), 0,
  'deletion removes every counter row for exactly one subject');
select is((select count(*)::int from noor_ai.user_counter where subject_id = pg_temp.sid('b')),
  (select n_b from t_before), 'another subject''s counters are untouched');
select is((select count(*)::int from noor_ai.global_counter), (select g from t_before),
  'global accounting is untouched by a per-subject deletion');
select is((select count(*)::int from noor_ai.provider_attempt pa
            join noor_ai.reservation r on r.reservation_id = pa.reservation_id
           where r.subject_id = pg_temp.sid('a')), 0,
  'provider attempts cascade away with the deleted subject''s reservations');

-- ── 15. Retention: purge_expired() ──────────────────────────────────────────
-- The function is deliberately UNSCHEDULED (review §21.5) — no destructive cron job is approved. That
-- makes it unreachable in production today, which is exactly why its behaviour has to be pinned here:
-- the day it is wired to a schedule, what it deletes must already be settled and tested.
--
-- It is also not granted to service_role, so it is called here as the owner-privileged definer
-- function it is, not through a wrapper. There is no wrapper, and there must not be one.
select pg_temp.open_limits();

create temporary table t_pg (rid uuid) on commit drop;
insert into t_pg select (pg_temp.rpc_reserve(pg_temp.sid('a'), 'purge1')->>'reservation_id')::uuid;
select pg_temp.rpc_attempt(pg_temp.sid('a'), (select rid from t_pg), 1, 100, 10, 0, 'success');
select pg_temp.rpc_release(pg_temp.sid('a'), (select rid from t_pg));

create temporary table t_pg_live (rid uuid) on commit drop;
insert into t_pg_live select (pg_temp.rpc_reserve(pg_temp.sid('b'), 'purge2')->>'reservation_id')::uuid;

-- Age BOTH reservations past the horizon. Ageing the live one too is the point: it isolates the state
-- guard from the age guard, so the test proves `reserved` is retained on its own merits rather than
-- merely being too young to qualify.
update noor_ai.reservation
   set created_at = now() - interval '3 days',
       expires_at = now() - interval '3 days' + interval '90 seconds';
update noor_ai.user_counter   set updated_at = now() - interval '3 days';
update noor_ai.global_counter set updated_at = now() - interval '3 days';

-- Month rows are exempt by design: a monthly spend ceiling cannot be enforced by a counter deleted
-- after 48 hours. Aged deliberately, so their survival is the exemption and not their youth.
insert into noor_ai.user_counter (subject_id, metric, window_kind, window_start, value, updated_at)
values (pg_temp.sid('a'), 'spend_micros', 'month',
        noor_ai.window_start_of('month', now()), 4200, now() - interval '3 days');
insert into noor_ai.global_counter (metric, window_kind, window_start, value, updated_at)
values ('spend_micros', 'month', noor_ai.window_start_of('month', now()), 4200,
        now() - interval '3 days');

create temporary table t_purge (r jsonb) on commit drop;
insert into t_purge select noor_ai.purge_expired();

select is((select (r->>'reservations_deleted')::int from t_purge), 1,
  'purge_expired removes exactly the one terminal reservation past the retention horizon');
select is((select count(*)::int from noor_ai.reservation where reservation_id = (select rid from t_pg)),
  0, 'the aged released reservation is purged');
select is((select count(*)::int from noor_ai.provider_attempt
            where reservation_id = (select rid from t_pg)),
  0, 'its provider_attempt rows cascade away with it — no orphaned cost record survives');
select is((select state::text from noor_ai.reservation where reservation_id = (select rid from t_pg_live)),
  'reserved', 'an equally aged reservation still in `reserved` is retained, never purged');

select is_empty(
  $$ select window_kind::text from noor_ai.user_counter where window_kind <> 'month' $$,
  'aged non-month user counters are purged');
select is_empty(
  $$ select window_kind::text from noor_ai.global_counter where window_kind <> 'month' $$,
  'aged non-month global counters are purged');
select is((select count(*)::int from noor_ai.user_counter where window_kind = 'month'), 1,
  'month user counters are exempt, so the monthly ceiling stays enforceable');
select is((select count(*)::int from noor_ai.global_counter where window_kind = 'month'), 1,
  'month global counters are exempt');
select is((select value from noor_ai.global_counter where window_kind = 'month'), 4200::bigint,
  'the exempt monthly accounting figure is preserved intact, not merely present');

-- Retention is not deletion-on-request: purge is age-based and subject-blind. Erasure for one account
-- is the targeted delete proven in §14, and it remains a separate, separately gated path.
select is((select count(*)::int from noor_ai.user_counter where subject_id = pg_temp.sid('a')), 1,
  'purge is age-based and subject-blind — it is not an account-erasure mechanism');

-- ── 16. Invalid configuration fails closed ──────────────────────────────────
-- The defect this pins: try_increment_*() takes its ceiling as an argument, and a null ceiling makes
-- the ON CONFLICT guard `w.value + p_amount <= p_limit` evaluate to null. On an existing counter row
-- that denies — which LOOKS safe — but on the first request of a window there is no conflict, so the
-- INSERT succeeded unconditionally and the request was admitted. One admission leaked per window, per
-- counter, silently, and no test noticed because every test seeded a complete configuration.
--
-- Each probe below damages exactly one key, drives the real RPC through the public wrapper, and then
-- reads the whole store back. A configuration failure must be distinguishable from a rate-limit
-- denial (503 vs 429) and must move nothing at all.

-- Probe: damage one key, then reserve. Returns the decision plus the entire mutable state, so the
-- assertions can prove "nothing changed" rather than merely "the answer looked right".
create or replace function pg_temp.cfg_probe_reserve(p_key text, p_mode text)
returns jsonb language plpgsql as $$
declare v_res jsonb; v_u bigint; v_g bigint; v_r bigint; v_a bigint;
begin
  perform pg_temp.restore_cfg();
  perform pg_temp.open_limits();
  if p_mode = 'missing' then
    delete from noor_ai.limit_config where key = p_key;
  else
    update noor_ai.limit_config set value = 0 where key = p_key;
  end if;
  v_res := pg_temp.rpc_reserve(pg_temp.sid('a'), 'cfg-' || pg_catalog.left(p_key, 55));
  select coalesce(pg_catalog.sum(value), 0) into v_u from noor_ai.user_counter;
  select coalesce(pg_catalog.sum(value), 0) into v_g from noor_ai.global_counter;
  select pg_catalog.count(*) into v_r from noor_ai.reservation;
  select pg_catalog.count(*) into v_a from noor_ai.provider_attempt;
  return pg_catalog.jsonb_build_object(
    'decision', v_res->>'decision', 'reason', v_res->>'reason', 'key', v_res->>'key',
    'flag', v_res->>'configuration_error',
    'user_counters', v_u, 'global_counters', v_g, 'reservations', v_r, 'attempts', v_a);
end $$;

-- Probe: reserve legitimately FIRST, then damage one key, then register an attempt. The reservation
-- exists, so a leak here would be a real cost record written under unknown ceilings.
create or replace function pg_temp.cfg_probe_attempt(p_key text, p_mode text)
returns jsonb language plpgsql as $$
declare v_rid uuid; v_res jsonb; v_a bigint; v_sp bigint;
begin
  perform pg_temp.restore_cfg();
  perform pg_temp.open_limits();
  v_rid := (pg_temp.rpc_reserve(pg_temp.sid('a'), 'cfga-' || pg_catalog.left(p_key, 54))->>'reservation_id')::uuid;
  if p_mode = 'missing' then
    delete from noor_ai.limit_config where key = p_key;
  else
    update noor_ai.limit_config set value = 0 where key = p_key;
  end if;
  v_res := pg_temp.rpc_attempt(pg_temp.sid('a'), v_rid, 1, 100, 10, 0, 'success');
  select pg_catalog.count(*) into v_a from noor_ai.provider_attempt;
  select coalesce(pg_catalog.sum(value), 0) into v_sp
    from noor_ai.global_counter where metric = 'spend_micros';
  return pg_catalog.jsonb_build_object(
    'ok', v_res->>'ok', 'reason', v_res->>'reason', 'key', v_res->>'key',
    'flag', v_res->>'configuration_error', 'attempts', v_a, 'spend', v_sp);
end $$;

-- Every ceiling reserve() depends on, probed individually, missing and then zero.
create temporary table t_cfg_res (key text, mode text, r jsonb) on commit drop;
insert into t_cfg_res
select k, m, pg_temp.cfg_probe_reserve(k, m)
  from pg_catalog.unnest(array['per_user_minute', 'per_user_hour', 'per_user_day',
                               'global_minute', 'global_day', 'concurrency_lease',
                               'daily_spend_micros', 'monthly_spend_micros',
                               'lease_ttl_seconds']) k
 cross join pg_catalog.unnest(array['missing', 'zero']) m;

select is((select count(*)::int from t_cfg_res), 18,
  'every reserve-path ceiling is probed both missing and zero');

select is_empty(
  $$ select key || '/' || mode from t_cfg_res where r->>'decision' <> 'unavailable' $$,
  'an invalid ceiling makes reserve report unavailable — a store failure (503), never a denial (429)');
select is_empty(
  $$ select key || '/' || mode from t_cfg_res where r->>'reason' <> 'configuration' $$,
  'the refusal reason is `configuration`, distinguishable from every rate-limit reason');
select is_empty(
  $$ select key || '/' || mode from t_cfg_res where r->>'key' is distinct from key $$,
  'the failure names the offending configuration key, so the defect is diagnosable');
select is_empty(
  $$ select key || '/' || mode from t_cfg_res where r->>'flag' <> 'true' $$,
  'the failure carries the configuration_error flag the Edge Function switches on');

select is_empty(
  $$ select key || '/' || mode from t_cfg_res where (r->>'reservations')::bigint <> 0 $$,
  'no reservation is created when configuration is invalid');
select is_empty(
  $$ select key || '/' || mode from t_cfg_res where (r->>'user_counters')::bigint <> 0 $$,
  'no per-user counter moves when configuration is invalid');
select is_empty(
  $$ select key || '/' || mode from t_cfg_res where (r->>'global_counters')::bigint <> 0 $$,
  'no global counter moves when configuration is invalid — including the first request of a window');
select is_empty(
  $$ select key || '/' || mode from t_cfg_res where (r->>'attempts')::bigint <> 0 $$,
  'no provider attempt is inserted when configuration is invalid');

-- The attempt-path ceilings, which reserve() never reads.
create temporary table t_cfg_att (key text, mode text, r jsonb) on commit drop;
insert into t_cfg_att
select k, m, pg_temp.cfg_probe_attempt(k, m)
  from pg_catalog.unnest(array['max_input_tokens', 'max_output_tokens', 'max_attempts']) k
 cross join pg_catalog.unnest(array['missing', 'zero']) m;

select is((select count(*)::int from t_cfg_att), 6,
  'every attempt-path ceiling is probed both missing and zero');
select is_empty(
  $$ select key || '/' || mode from t_cfg_att where r->>'ok' <> 'false' $$,
  'an invalid token or attempt ceiling refuses the provider attempt');
select is_empty(
  $$ select key || '/' || mode from t_cfg_att where r->>'reason' <> 'configuration' $$,
  'the attempt refusal is a configuration failure, not a token-limit denial');
select is_empty(
  $$ select key || '/' || mode from t_cfg_att where r->>'key' is distinct from key $$,
  'the attempt failure names the offending configuration key');
select is_empty(
  $$ select key || '/' || mode from t_cfg_att where r->>'flag' <> 'true' $$,
  'the attempt failure carries the configuration_error flag');
select is_empty(
  $$ select key || '/' || mode from t_cfg_att where (r->>'attempts')::bigint <> 0 $$,
  'no provider attempt row is inserted under invalid configuration');
select is_empty(
  $$ select key || '/' || mode from t_cfg_att where (r->>'spend')::bigint <> 0 $$,
  'no spend is accumulated under invalid configuration');

-- `enabled` is the one key whose ABSENCE is not an error. Off is a legitimate operational state, and
-- absence must resolve to it — a missing kill switch may never read as "on".
select pg_temp.restore_cfg();
select pg_temp.open_limits();
delete from noor_ai.limit_config where key = 'enabled';
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'cfg-enabled')->>'decision', 'limited',
  'a missing `enabled` key denies rather than erroring — absence means disabled');
select is(pg_temp.rpc_reserve(pg_temp.sid('a'), 'cfg-enabled2')->>'reason', 'disabled',
  'the missing kill switch reports `disabled`, the same as an explicit 0');
select is((select count(*)::int from noor_ai.reservation), 0,
  'a missing kill switch creates no reservation');
select is((select coalesce(sum(value), 0)::bigint from noor_ai.global_counter), 0::bigint,
  'a missing kill switch moves no counter');
select is(pg_temp.rpc_status(pg_temp.sid('a'))->>'enabled', 'false',
  'status reports a missing kill switch as disabled, never as null or enabled');

-- status() must refuse rather than quote a ceiling it could not resolve: a null limit renders as
-- "unlimited" to anything downstream.
select pg_temp.restore_cfg();
delete from noor_ai.limit_config where key = 'per_user_day';
select is(pg_temp.rpc_status(pg_temp.sid('a'))->>'reason', 'configuration',
  'status fails closed on a missing ceiling instead of reporting a null limit');

-- Structural guarantees: neither a duplicate nor a negative value is representable at all.
select pg_temp.restore_cfg();
select throws_ok(
  $$ insert into noor_ai.limit_config (key, value, unit) values ('per_user_day', 5, 'count') $$,
  '23505', null,
  'a duplicate configuration key is rejected structurally by the primary key');
select throws_ok(
  $$ update noor_ai.limit_config set value = -1 where key = 'per_user_day' $$,
  '23514', null,
  'a negative configuration value is rejected structurally by the check constraint');

-- The declared required set is the single source of truth, and the seed satisfies it exactly.
select set_eq(
  $$ select pg_catalog.unnest(noor_ai.required_limit_keys()) $$,
  $$ select key from noor_ai.limit_config $$,
  'the seeded configuration equals the declared required key set exactly');
select is((select pg_catalog.array_length(noor_ai.required_limit_keys(), 1)), 13,
  'the required configuration set is the thirteen approved DEV keys');

-- A damaged configuration is never silently repaired: nothing re-seeds a deleted key.
select pg_temp.restore_cfg();
delete from noor_ai.limit_config where key = 'per_user_day';
select pg_temp.rpc_reserve(pg_temp.sid('a'), 'cfg-noreseed');
select is((select count(*)::int from noor_ai.limit_config where key = 'per_user_day'), 0,
  'a deleted configuration key is never re-seeded by a lifecycle call');
select pg_temp.restore_cfg();

-- The intentional DEV seed is preserved by all of this. Asserted against t_cfg_backup, which was
-- captured from the freshly migrated database BEFORE any section edited a ceiling — comparing the
-- restored config against itself would prove only that restore_cfg() copies rows.
select set_eq(
  $$ select key || '=' || value from t_cfg_backup $$,
  $$ values ('enabled=1'), ('per_user_minute=1'), ('per_user_hour=1'), ('per_user_day=1'),
            ('global_minute=1'), ('global_day=1'), ('concurrency_lease=1'),
            ('daily_spend_micros=500000'), ('monthly_spend_micros=2000000'),
            ('max_input_tokens=12000'), ('max_output_tokens=2000'),
            ('max_attempts=2'), ('lease_ttl_seconds=90') $$,
  'the migration seeds exactly the approved DEV values — no production ceiling is invented');
select set_eq(
  $$ select key || '=' || value from noor_ai.limit_config $$,
  $$ select key || '=' || value from t_cfg_backup $$,
  'and the store is left holding those same values after every configuration probe');

-- ── 17. reserve() statement order, read from the live function body ─────────
-- Positional proof against pg_get_functiondef with comment lines stripped, so prose can neither
-- satisfy nor break it. The order under test:
--     advisory lock -> authoritative replay -> expire stale -> concurrency -> counters -> insert
create or replace function pg_temp.reserve_body() returns text language sql stable as $$
  select pg_catalog.string_agg(l, E'\n')
    from pg_catalog.unnest(pg_catalog.string_to_array(
           pg_catalog.pg_get_functiondef('noor_ai.reserve(uuid,text)'::regprocedure), E'\n')) l
   where pg_catalog.btrim(l) not like '--%'
$$;

create temporary table t_body (b text, tail text) on commit drop;
insert into t_body
select body, pg_catalog.substr(body, pg_catalog.strpos(body, 'pg_advisory_xact_lock'))
  from (select pg_temp.reserve_body() as body) s;

select ok((select pg_catalog.strpos(b, 'pg_advisory_xact_lock') from t_body) > 0,
  'order: reserve takes the global transaction advisory lock');
select ok((select pg_catalog.strpos(tail, 'r.request_id = p_request_id') from t_body) > 0,
  'order: an authoritative replay lookup exists after the lock');
select ok(
  (select pg_catalog.strpos(tail, 'expire_stale') from t_body)
  > (select pg_catalog.strpos(tail, 'r.request_id = p_request_id') from t_body),
  'order: the stale-expiry sweep runs after the authoritative replay lookup');
select ok(
  (select pg_catalog.strpos(tail, 'into v_leases') from t_body)
  > (select pg_catalog.strpos(tail, 'expire_stale') from t_body),
  'order: the concurrency count runs after the stale-expiry sweep, so it sees reclaimed slots');
select ok(
  (select pg_catalog.strpos(tail, 'try_increment_global') from t_body)
  > (select pg_catalog.strpos(tail, 'into v_leases') from t_body),
  'order: no counter is incremented before the concurrency check');
select ok(
  (select pg_catalog.strpos(tail, 'insert into noor_ai.reservation') from t_body)
  > (select pg_catalog.strpos(tail, 'try_increment_global') from t_body),
  'order: the reservation insert is last');

-- Exactly one sweep, and it is the one inside the lock. A leftover pre-lock call would be the very
-- deadlock this reordering removes, and would still satisfy every ordering assertion above.
select is(
  (select (pg_catalog.length(b) - pg_catalog.length(pg_catalog.replace(b, 'expire_stale', '')))
          / pg_catalog.length('expire_stale') from t_body),
  1, 'order: expire_stale is called exactly once in reserve, and only inside the lock');

-- Every ceiling is resolved through the strict lookup before the lock is taken; reserve reads the
-- permissive one only for the kill switch.
select ok(
  (select pg_catalog.strpos(b, 'require_limit') from t_body)
  < (select pg_catalog.strpos(b, 'pg_advisory_xact_lock') from t_body),
  'order: configuration is resolved before the lock, so a defect never reaches admission');
select is(
  (select (pg_catalog.length(b) - pg_catalog.length(pg_catalog.replace(b, 'limit_of(', '')))
          / pg_catalog.length('limit_of(') from t_body),
  1, 'reserve reads the permissive lookup exactly once — for the kill switch and nothing else');

select * from finish();
rollback;
