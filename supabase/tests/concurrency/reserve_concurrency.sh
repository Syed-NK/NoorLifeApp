#!/usr/bin/env bash
# NoorAI quota store — real concurrency check.
#
#     bash supabase/tests/concurrency/reserve_concurrency.sh
#
# pgTAP runs inside ONE transaction, so it cannot exercise the advisory lock against a competing
# session — a single-session test would only re-assert the sequential path. This harness opens N
# genuinely separate psql sessions against the running local stack and fires them at once.
#
# With global_minute = 1, exactly ONE reservation may be admitted no matter how many sessions race.
# Anything above one is oversubscription; anything below one means the lock deadlocked or errored.
#
# Local stack only. Never run against a hosted project.
set -uo pipefail

CONTAINER="${NOORAI_DB_CONTAINER:-supabase_db_noorlife}"
SESSIONS="${NOORAI_CONCURRENCY:-12}"

psql_c() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -A -t -c "$1" 2>&1; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "concurrency_test=BLOCKED reason=local_stack_not_running"
  exit 2
fi

# Arrange: clear state and pin the global minute ceiling to 1. Only the owner may touch these.
psql_c "
set role noor_ai_owner;
delete from noor_ai.reservation;
delete from noor_ai.user_counter;
delete from noor_ai.global_counter;
update noor_ai.limit_config set value = 1000
 where key in ('per_user_minute','per_user_hour','per_user_day','concurrency_lease','global_day');
update noor_ai.limit_config set value = 1 where key = 'global_minute';
" >/dev/null

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Act: N separate sessions, each its own subject and request id, launched together.
for i in $(seq 1 "$SESSIONS"); do
  (
    sub=$(printf '%08d-0000-4000-8000-000000000000' "$i")
    psql_c "set role service_role; select public.noor_ai_reserve('$sub'::uuid, 'conc-$i')->>'decision';" \
      > "$tmp/out.$i"
  ) &
done
wait

allowed=$(cat "$tmp"/out.* 2>/dev/null | grep -c '^allowed$')
limited=$(cat "$tmp"/out.* 2>/dev/null | grep -c '^limited$')
errors=$(cat "$tmp"/out.* 2>/dev/null | grep -ciE 'error|deadlock' || true)

# Assert against the database, not just the replies.
rows=$(psql_c "set role noor_ai_owner; select count(*) from noor_ai.reservation where state='reserved';" | tail -1)
counter=$(psql_c "set role noor_ai_owner; select coalesce(max(value),0) from noor_ai.global_counter where metric='requests' and window_kind='minute';" | tail -1)

echo "sessions=$SESSIONS"
echo "allowed=$allowed"
echo "limited=$limited"
echo "errors=$errors"
echo "reservations_in_db=$rows"
echo "global_minute_counter=$counter"

# Restore the approved DEV ceiling and clear the arranged state.
psql_c "
set role noor_ai_owner;
delete from noor_ai.reservation;
delete from noor_ai.user_counter;
delete from noor_ai.global_counter;
update noor_ai.limit_config set value = 1
 where key in ('per_user_minute','per_user_hour','per_user_day','global_minute','global_day','concurrency_lease');
" >/dev/null

case_a_pass=0
if [ "$allowed" = "1" ] && [ "$rows" = "1" ] && [ "$counter" = "1" ] && [ "$errors" = "0" ]; then
  case_a_pass=1
fi
echo "case_distinct_requests=$([ $case_a_pass = 1 ] && echo PASS || echo FAIL)"

# ── Case B: concurrent replay of ONE request id ────────────────────────────
#
# The dangerous case, and the reason the reserve lock re-checks for a replay after acquiring it.
# Every session presents the SAME subject and request id. All must converge on one reservation:
# a loser that instead competed for the lease would be told `limited/concurrency` for its own
# in-flight request, and could later consume a second quota unit for one handler request.
echo "---"
psql_c "
set role noor_ai_owner;
delete from noor_ai.reservation;
delete from noor_ai.user_counter;
delete from noor_ai.global_counter;
update noor_ai.limit_config set value = 1000
 where key in ('per_user_minute','per_user_hour','per_user_day','global_minute','global_day');
update noor_ai.limit_config set value = 1 where key = 'concurrency_lease';
" >/dev/null

SUBJ='99999999-9999-4999-8999-999999999999'
tmp2="$(mktemp -d)"
trap 'rm -rf "$tmp" "$tmp2"' EXIT

for i in $(seq 1 "$SESSIONS"); do
  (
    psql_c "set role service_role; select public.noor_ai_reserve('$SUBJ'::uuid, 'same-request')->>'reservation_id';" \
      > "$tmp2/out.$i"
  ) &
done
wait

distinct_ids=$(cat "$tmp2"/out.* 2>/dev/null | grep -oE '[0-9a-f-]{36}' | sort -u | wc -l | tr -d ' ')
replies=$(cat "$tmp2"/out.* 2>/dev/null | grep -coE '[0-9a-f-]{36}')
rows_b=$(psql_c "set role noor_ai_owner; select count(*) from noor_ai.reservation where subject_id='$SUBJ';" | tail -1)
units_b=$(psql_c "set role noor_ai_owner; select coalesce(max(value),0) from noor_ai.user_counter where subject_id='$SUBJ' and metric='requests' and window_kind='day';" | tail -1)
errors_b=$(cat "$tmp2"/out.* 2>/dev/null | grep -ciE 'error|deadlock' || true)

echo "sessions=$SESSIONS"
echo "reservation_id_replies=$replies"
echo "distinct_reservation_ids=$distinct_ids"
echo "reservations_in_db=$rows_b"
echo "quota_units_consumed=$units_b"
echo "errors=$errors_b"

psql_c "
set role noor_ai_owner;
delete from noor_ai.reservation;
delete from noor_ai.user_counter;
delete from noor_ai.global_counter;
update noor_ai.limit_config set value = 1
 where key in ('per_user_minute','per_user_hour','per_user_day','global_minute','global_day','concurrency_lease');
" >/dev/null

case_b_pass=0
if [ "$distinct_ids" = "1" ] && [ "$replies" = "$SESSIONS" ] && [ "$rows_b" = "1" ] \
   && [ "$units_b" = "1" ] && [ "$errors_b" = "0" ]; then
  case_b_pass=1
fi
echo "case_identical_replay=$([ $case_b_pass = 1 ] && echo PASS || echo FAIL)"

# ── Case C: stale expiry racing live admission ─────────────────────────────
#
# expire_stale() used to run BEFORE the advisory lock. Two concurrent reserves could each UPDATE a
# different overlapping subset of the same expired rows, and `select ... limit 500` has no ORDER BY,
# so they could take row locks in opposite orders and deadlock — turning a reserve into a database
# error rather than a decision. The sweep now runs inside the lock, which serialises it.
#
# This case is the one that would have caught it: many expired rows, many sessions sweeping at once.
# The ceiling is 3 rather than 1 so the result proves "exactly the configured number" rather than
# merely "at most one". Expired leases must occupy no slot.
echo "---"
STALE=8
LEASE=3
psql_c "
set role noor_ai_owner;
delete from noor_ai.reservation;
delete from noor_ai.user_counter;
delete from noor_ai.global_counter;
update noor_ai.limit_config set value = 1000
 where key in ('per_user_minute','per_user_hour','per_user_day','global_minute','global_day');
update noor_ai.limit_config set value = $LEASE where key = 'concurrency_lease';
insert into noor_ai.reservation (subject_id, request_id, state, created_at, expires_at)
select ('7'||lpad(i::text,7,'0')||'-0000-4000-8000-000000000000')::uuid,
       'stale-'||i, 'reserved',
       now() - interval '10 minutes', now() - interval '1 second'
  from generate_series(1, $STALE) i;
" >/dev/null

stale_before=$(psql_c "set role noor_ai_owner; select count(*) from noor_ai.reservation where state='reserved' and expires_at <= now();" | tail -1)

tmp3="$(mktemp -d)"
trap 'rm -rf "$tmp" "$tmp2" "$tmp3"' EXIT

for i in $(seq 1 "$SESSIONS"); do
  (
    sub=$(printf '6%07d-0000-4000-8000-000000000000' "$i")
    psql_c "set role service_role; select public.noor_ai_reserve('$sub'::uuid, 'exp-$i')->>'decision';" \
      > "$tmp3/out.$i"
  ) &
done
wait

allowed_c=$(cat "$tmp3"/out.* 2>/dev/null | grep -c '^allowed$')
limited_c=$(cat "$tmp3"/out.* 2>/dev/null | grep -c '^limited$')
errors_c=$(cat "$tmp3"/out.* 2>/dev/null | grep -ciE 'error|deadlock' || true)
deadlocks_c=$(cat "$tmp3"/out.* 2>/dev/null | grep -ci 'deadlock' || true)

# The arranged stale rows must all have been reclaimed, and none may still hold a slot.
still_stale=$(psql_c "set role noor_ai_owner; select count(*) from noor_ai.reservation where state='reserved' and expires_at <= now();" | tail -1)
expired_now=$(psql_c "set role noor_ai_owner; select count(*) from noor_ai.reservation where state='expired';" | tail -1)
live_c=$(psql_c "set role noor_ai_owner; select count(*) from noor_ai.reservation where state='reserved' and expires_at > now();" | tail -1)

echo "sessions=$SESSIONS"
echo "stale_reservations_arranged=$stale_before"
echo "configured_lease_ceiling=$LEASE"
echo "allowed=$allowed_c"
echo "limited=$limited_c"
echo "errors=$errors_c"
echo "deadlocks=$deadlocks_c"
echo "stale_still_holding_a_slot=$still_stale"
echo "reclaimed_to_expired=$expired_now"
echo "live_reservations=$live_c"

psql_c "
set role noor_ai_owner;
delete from noor_ai.reservation;
delete from noor_ai.user_counter;
delete from noor_ai.global_counter;
update noor_ai.limit_config set value = 1
 where key in ('per_user_minute','per_user_hour','per_user_day','global_minute','global_day','concurrency_lease');
" >/dev/null

case_c_pass=0
if [ "$allowed_c" = "$LEASE" ] && [ "$limited_c" = "$((SESSIONS - LEASE))" ] \
   && [ "$errors_c" = "0" ] && [ "$deadlocks_c" = "0" ] \
   && [ "$still_stale" = "0" ] && [ "$expired_now" = "$STALE" ] && [ "$live_c" = "$LEASE" ]; then
  case_c_pass=1
fi
echo "case_expired_lease_race=$([ $case_c_pass = 1 ] && echo PASS || echo FAIL)"

echo "---"
if [ $case_a_pass = 1 ] && [ $case_b_pass = 1 ] && [ $case_c_pass = 1 ]; then
  echo "concurrency_test=PASS"
  exit 0
fi
echo "concurrency_test=FAIL"
exit 1
