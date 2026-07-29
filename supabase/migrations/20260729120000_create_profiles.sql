-- NoorLife — public.profiles
--
-- One row per authenticated user, created automatically when auth.users gains a row.
--
-- Nothing sensitive is stored here. No password, no OTP, no provider access or refresh token, no
-- Google client secret and no Apple private key: Supabase Auth owns credentials in the `auth` schema,
-- and this table holds only the profile fields the application renders.

create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Per-user profile. Readable and writable only by its owner; see RLS policies below.';

-- The foreign key already creates an index on `id` as the primary key. This one supports the
-- routing query "does this user still need onboarding", which the entry gate runs on every launch.
create index if not exists profiles_onboarding_completed_idx
  on public.profiles (onboarding_completed);

-- ── updated_at ──────────────────────────────────────────────────────────────
-- Maintained by a trigger rather than by the client: a client-supplied timestamp can be wrong,
-- back-dated, or simply omitted, and RLS cannot police the *value* of a column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ── new-user provisioning ───────────────────────────────────────────────────
-- Runs as the definer because it writes to public.profiles while the inserting role is the auth
-- system, not the new user. `search_path` is pinned to empty and every name is fully qualified, so a
-- schema planted earlier on the search path cannot hijack the call — the standard hardening for a
-- security-definer function.
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

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;
-- Applies the policies to the table owner too, so a mistake elsewhere cannot read around them.
alter table public.profiles force row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

-- Each policy is scoped to `authenticated` only. `anon` is granted nothing, which is what denies
-- anonymous access — with RLS enabled and no permissive policy for that role, every row is invisible.
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

-- Both USING and WITH CHECK are required. USING alone would let a user update their own row and
-- change `id` to somebody else's, handing the row away.
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No DELETE policy: rows are removed only by the `on delete cascade` from auth.users, so deleting an
-- account is the single path that removes a profile.

grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;
