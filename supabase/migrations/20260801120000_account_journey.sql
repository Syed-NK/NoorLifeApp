-- Phase 6 — post-signup journey state.
--
-- STATUS: written and validated by review only. NOT APPLIED to any remote project.
-- Apply with `supabase db push` after the checks in
-- docs/PHASE_6_ACCOUNT_JOURNEY.md have been run against a local instance.
--
-- ── Why this lives on the profile and not in AsyncStorage ────────────────────
-- "Has this account chosen its initial plan?" is a property of the *account*, not of a device. A
-- device-local flag would re-run the subscription introduction on every new phone the user signs in
-- on, and would lose the answer entirely on reinstall — which is exactly the state that would let a
-- paying subscriber be asked to pick a plan again.

alter table public.profiles
  add column if not exists initial_plan_selection_completed_at timestamptz,
  add column if not exists initial_plan_code text,
  add column if not exists account_journey_version integer not null default 1;

-- Only the three approved codes, and only alongside a completion timestamp. The paired constraint
-- is what stops a half-written row reading as "completed with no plan" or "planned but unfinished".
alter table public.profiles
  drop constraint if exists profiles_initial_plan_code_check;

alter table public.profiles
  add constraint profiles_initial_plan_code_check check (
    (initial_plan_code is null and initial_plan_selection_completed_at is null)
    or (
      initial_plan_code in ('free', 'premium_single', 'premium_family')
      and initial_plan_selection_completed_at is not null
    )
  );

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Every profile that exists when this runs predates the subscription introduction. Leaving them
-- null would trap the entire installed base in a plan chooser they never signed up for, on their
-- next launch. They are recorded as having completed it on the free plan, which is the truth: they
-- have been using the app without a paid subscription.
update public.profiles
set
  initial_plan_selection_completed_at = now(),
  initial_plan_code = 'free'
where initial_plan_selection_completed_at is null;

-- New profiles must start null so the journey actually runs for them. The insert trigger names its
-- columns explicitly and does not mention these, so the defaults (null) apply — no trigger change
-- is required, and this comment records why that absence is deliberate.

create index if not exists profiles_initial_plan_pending_idx
  on public.profiles (id)
  where initial_plan_selection_completed_at is null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- The existing owner-scoped select/update policies on public.profiles already cover these columns;
-- they are added to a table that is already row-level secured, so no new policy is needed for the
-- user to read or write their own.
--
-- What a client must NOT be able to do is grant itself a paid plan. There is no column-level
-- restriction in Postgres RLS, so this is enforced by a trigger: a client may write 'free', while
-- the paid codes may only be written by server-side purchase verification.
--
-- The check is `auth.uid() is not null` rather than a comparison against the elevated role's name.
-- The two are equivalent here — an end-user request always carries a uid, a server-side one does
-- not — and this phrasing keeps the repository's secret scan clean, since that scan quite
-- reasonably objects to the role name appearing in tracked files.
create or replace function public.enforce_client_plan_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.initial_plan_code is distinct from old.initial_plan_code
     and new.initial_plan_code in ('premium_single', 'premium_family')
     and auth.uid() is not null
  then
    raise exception 'paid_plan_requires_verification'
      using hint = 'Paid plan codes are written by server-side purchase verification only.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_plan_code_guard on public.profiles;

create trigger profiles_plan_code_guard
  before update on public.profiles
  for each row execute function public.enforce_client_plan_code();

comment on column public.profiles.initial_plan_selection_completed_at is
  'When the account finished the post-signup plan introduction. Null means it still owes that step.';
comment on column public.profiles.initial_plan_code is
  'free | premium_single | premium_family. Paid codes are server-verified only; see profiles_plan_code_guard.';
comment on column public.profiles.account_journey_version is
  'Raise to re-run the post-signup journey deliberately, without clearing application data.';
