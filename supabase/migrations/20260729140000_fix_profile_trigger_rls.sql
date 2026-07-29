-- NoorLife — allow profile creation during signup
--
-- Corrects 20260729120000_create_profiles.sql, which is already applied and is left untouched.
--
-- ── The defect ──────────────────────────────────────────────────────────────
-- That migration ended with:
--
--     alter table public.profiles force row level security;
--
-- FORCE removes the table owner's normal exemption from RLS. `public.handle_new_user()` is
-- SECURITY DEFINER, so it executes as its owner — the same role that owns `public.profiles` — and
-- every policy on the table is scoped `to authenticated`. With the owner's exemption withdrawn and
-- no policy matching the owner, the trigger's insert is evaluated against a policy set it can never
-- satisfy and is refused. Because that insert runs inside the `auth.users` transaction, the refusal
-- fails the whole signup, which Supabase Auth surfaces as a 500 and the app reported as
-- "Something went wrong on our side."
--
-- FORCE was defensive over-reach on my part: it was added to stop a future mistake reading around
-- the policies, but the only role it actually constrained was the one the trigger needs.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
-- Drop FORCE and keep RLS enabled. Nothing client-facing changes: `anon` and `authenticated` are
-- governed by exactly the same policies as before, and the only role that regains an exemption is
-- the table owner, which is reachable only server-side (migrations, the SQL editor, the service
-- role) and never from the application.
--
-- Policies, grants and the trigger are re-asserted below so this migration alone describes the
-- intended end state and is safe to re-run.

alter table public.profiles no force row level security;
alter table public.profiles enable row level security;

-- ── new-user provisioning ───────────────────────────────────────────────────
-- Unchanged in behaviour, restated so the fix can be verified from one file. Still SECURITY DEFINER
-- with `search_path` pinned to empty and every name fully qualified, so a schema planted earlier on
-- the search path cannot hijack a definer-rights call.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  -- Idempotent: a retried or replayed insert must not fail the signup that triggered it.
  -- `onboarding_completed` is deliberately omitted so the column default (false) applies.
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ── client-facing policies, unchanged ───────────────────────────────────────
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Both USING and WITH CHECK: USING alone would let a user update their own row and reassign `id`,
-- handing the row to somebody else.
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No DELETE policy: a profile is removed only by the `on delete cascade` from auth.users.

-- ── grants, unchanged ───────────────────────────────────────────────────────
grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;
revoke all on public.profiles from public;
