-- NoorLife — D2 trust boundary: the private `noor_ai` schema and its two roles.
--
-- This is the foundation the approved D2 architecture rests on
-- (docs/NOOR_AI3_QUOTA_STORE_SECURITY_REVIEW.md §19). It creates the boundary and nothing else.
--
-- ── What this migration deliberately does NOT do ────────────────────────────
-- No table, sequence, function, index, policy, Vault secret, HMAC key or quota data. No provider
-- integration. No Edge Function client is chosen. The quota store is still unimplemented and R8 is
-- still blocked.
--
-- **No credential is created here, and none may be.** `noor_ai_runtime` is created with LOGIN and
-- **no password**, so `rolpassword` is null and the role cannot authenticate over any password-based
-- method. That is the intended end state of this migration: a named identity that exists, holds a
-- minimal privilege set, and **cannot yet connect**.
--
-- Provisioning the credential is a **separate, manual, secret-managed phase**. It happens outside
-- version control, sets the password on the hosted project directly, and stores the connection
-- string only as a Supabase Edge Function secret. It must never be written into a migration, a
-- repository file, an `EXPO_PUBLIC_*` variable, or this comment.
--
-- Note on re-runs: the role creation below is guarded by an existence check rather than being
-- unconditional. That is deliberate — it means a password provisioned later by that separate phase
-- is **not** wiped by a subsequent `supabase db push` or `db reset` against an existing database.
-- For the same reason this file contains no `PASSWORD` clause of any kind, not even `PASSWORD NULL`.
--
-- ── The two roles, and why there are two ────────────────────────────────────
-- `noor_ai_owner`   — NOLOGIN. Owns the schema and, later, its objects. Nothing authenticates as it,
--                     so owner rights are never reachable from the network.
-- `noor_ai_runtime` — LOGIN. The identity the Edge Function will eventually connect as. It owns
--                     nothing, and will receive only explicit EXECUTE grants on the specific
--                     functions it needs, once those exist.
--
-- Separating them is what stops a compromised connection from altering the schema it queries: the
-- connecting role is not the owning role, so DDL is out of reach even if the credential leaks.
--
-- Neither role is granted membership in `postgres`, `supabase_admin`, `authenticated`, `anon`,
-- `authenticator`, or any other platform role, and neither is granted SUPERUSER, BYPASSRLS,
-- CREATEDB, CREATEROLE or REPLICATION. Both are NOINHERIT, so even a future membership would not
-- apply implicitly. The elevated server-side platform role is neither used nor modified.

-- ── Roles ───────────────────────────────────────────────────────────────────
-- CREATE ROLE has no IF NOT EXISTS, so existence is checked explicitly. This is the only construct
-- in this file that is not naturally idempotent.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'noor_ai_owner') then
    create role noor_ai_owner;
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'noor_ai_runtime') then
    -- LOGIN with no password clause: the role exists and cannot authenticate.
    create role noor_ai_runtime login;
  end if;
end
$$;

-- Attributes are re-asserted unconditionally so the end state is declared in one place and a re-run
-- converges. Password state is deliberately absent from this list.
--
-- SUPERUSER, BYPASSRLS and REPLICATION are **not** named here, and their absence is not an oversight.
-- PostgreSQL refuses `ALTER ROLE ... NOSUPERUSER` from a non-superuser — even to turn the attribute
-- *off* — and the role running migrations on this project is not a superuser. The same restriction
-- covers NOBYPASSRLS and NOREPLICATION. Naming them makes the migration fail with
-- "permission denied to alter role" (42501).
--
-- They do not need to be set. `CREATE ROLE` defaults every one of them to the safe value, and a
-- non-superuser creator could not have granted them in the first place. So the safe state is
-- guaranteed at creation, and it is **verified rather than set**: the pgTAP guard in
-- supabase/tests/security_invariants.test.sql asserts rolsuper, rolbypassrls and rolreplication are
-- all false for both roles, which is the durable check. That is the "set or verify" split.
alter role noor_ai_owner
  nologin nocreatedb nocreaterole noinherit;

alter role noor_ai_runtime
  login nocreatedb nocreaterole noinherit;

-- Empty search_path on both. Every object either role touches must be schema-qualified, so nothing
-- resolves through `public` and nothing can be redirected by what happens to sit on a path.
alter role noor_ai_owner set search_path = '';
alter role noor_ai_runtime set search_path = '';

-- ── Administrative membership, needed only to set the schema's owner ────────
-- On PostgreSQL 16+, a non-superuser that creates a role receives ADMIN OPTION on it but with
-- `set_option = false`, so it cannot `SET ROLE` to the new role. `CREATE SCHEMA ... AUTHORIZATION`
-- requires exactly that ability, and fails with "must be able to SET ROLE" without it.
--
-- This grants the *migration* role the ability to act as `noor_ai_owner`. It is the opposite
-- direction from the memberships this design forbids: `noor_ai_owner` gains nothing, and neither
-- custom role becomes a member of any platform role. `INHERIT FALSE` means the migration role does
-- not implicitly acquire owner privileges either — it must ask for them explicitly.
--
-- Written as dynamic SQL over `current_user` rather than hardcoding a role name. Do **not** rewrite
-- this as `GRANT ... TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`: that spelling segfaults the
-- backend on PostgreSQL 17.6 (signal 11, reproduced twice locally). The `%I` form takes a different
-- parse path and is safe.
do $$
begin
  execute format('grant noor_ai_owner to %I with inherit false, set true', current_user);
end
$$;

-- ── Private schema ──────────────────────────────────────────────────────────
create schema if not exists noor_ai authorization noor_ai_owner;

-- Re-asserted in case the schema predates this migration with a different owner.
alter schema noor_ai owner to noor_ai_owner;

-- Owner-scoped DDL runs as the owner. Because the grant above is INHERIT FALSE, the migration role
-- does not hold owner rights implicitly and must ask for them — `COMMENT ON SCHEMA` requires
-- ownership. This is the pattern every later migration that creates objects in `noor_ai` will use,
-- so the objects end up owned by `noor_ai_owner` rather than by whoever ran the migration.
-- Everything from here to `reset role` runs as the schema owner. That is not stylistic: GRANT and
-- REVOKE by a role without ownership or grant option do **not** raise an error — PostgreSQL emits
-- "WARNING: no privileges were granted" and continues. A migration written outside this block would
-- report success and silently grant nothing. The pgTAP guard asserts the resulting privileges for
-- exactly that reason.
set role noor_ai_owner;

comment on schema noor_ai is
  'Private NoorAI quota store. Not exposed through the Data API and not on any extra_search_path. '
  'Owned by noor_ai_owner (NOLOGIN); queried by noor_ai_runtime (LOGIN, no credential yet).';

-- A new schema does not grant PUBLIC anything by default, so these revokes are belt-and-braces
-- rather than corrections. They are stated anyway: the whole point of this schema is that its
-- privilege posture is explicit rather than inherited, and a reader should not have to know
-- PostgreSQL's default to know that anon and authenticated hold nothing here.
revoke all on schema noor_ai from public;
revoke all on schema noor_ai from anon;
revoke all on schema noor_ai from authenticated;

-- The runtime role gets USAGE and nothing else. USAGE alone confers no access to any object; it is
-- the precondition for the explicit EXECUTE grants that a later migration will add, once the
-- functions exist.
--
-- CREATE is deliberately withheld. The runtime role must never be able to add objects to the schema
-- it queries — that is the second half of the owner/runtime split described above.
grant usage on schema noor_ai to noor_ai_runtime;

reset role;
