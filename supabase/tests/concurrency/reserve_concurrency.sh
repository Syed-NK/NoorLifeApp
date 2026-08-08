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

echo "---"
if [ $case_a_pass = 1 ] && [ $case_b_pass = 1 ]; then
  echo "concurrency_test=PASS"
  exit 0
fi
echo "concurrency_test=FAIL"
exit 1
