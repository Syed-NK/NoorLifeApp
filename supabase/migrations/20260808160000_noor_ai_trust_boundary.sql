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
--
-- ── Why this file contains no SET ROLE, and must not ────────────────────────
-- An earlier revision configured the schema under `SET ROLE noor_ai_owner ... RESET ROLE`. It
-- applied cleanly against a local reset and then **failed on the hosted project**: the Supabase CLI
-- appends its own `INSERT INTO supabase_migrations.schema_migrations` to the same session after the
-- file's statements, and that INSERT ran while the session role was still `noor_ai_owner` — which
-- holds no privilege on `supabase_migrations`, exactly as this design intends. The hosted
-- transaction rolled back in full, so nothing was left behind, but nothing was deployed either.
--
-- The lesson is general and outlives this file: **a migration must not change the session role and
-- rely on changing it back.** A tool that appends a statement to the same session will run it under
-- whatever role the file left behind, and a trailing `RESET ROLE` is not a reliable guard against
-- that. Do not reintroduce `SET ROLE` here.
--
-- The alternative used instead is ordinary ownership sequencing: the schema is created under the
-- migration role, every privilege statement is issued while the migration role still owns it, and
-- **ownership is transferred to `noor_ai_owner` as the very last operation**. PostgreSQL rewrites
-- the ACL on transfer, re-attributing each grant to the incoming owner, so the end state is
-- identical to the SET ROLE version — verified: the ACL becomes
-- `{noor_ai_owner=UC/noor_ai_owner,noor_ai_runtime=U/noor_ai_owner}` and the comment survives.

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

-- ── Administrative membership, needed only to hand over ownership ───────────
-- `ALTER SCHEMA ... OWNER TO noor_ai_owner` requires the caller to be able to `SET ROLE` to the
-- incoming owner. On PostgreSQL 16+, a non-superuser that creates a role receives ADMIN OPTION on it
-- but with `set_option = false`, which is not enough — verified: the transfer fails with "must be
-- able to SET ROLE". This grant supplies exactly that ability and nothing more.
--
-- It is the opposite direction from the memberships this design forbids: `noor_ai_owner` gains
-- nothing, and neither custom role becomes a member of any platform role. `INHERIT FALSE` keeps it
-- minimal — the migration role can *assume* the owner role but does not implicitly hold its
-- privileges. This is the smallest membership that makes the ownership transfer possible.
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
-- One guarded block, and the guard is what makes it idempotent. Because the migration role holds the
-- owner role with INHERIT FALSE, it cannot alter the schema once ownership has moved — so a second
-- run must not retry the configuration. It skips instead, and the pgTAP guard is what proves the
-- state is still correct rather than this file re-asserting it.
--
-- Order matters and is the whole point: create, configure, then hand over. Every statement between
-- the create and the transfer is issued by the schema's current owner, so none of them can hit the
-- silent-warning failure mode where GRANT without ownership emits "WARNING: no privileges were
-- granted" and the migration reports success having granted nothing.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_namespace where nspname = 'noor_ai') then

    execute 'create schema noor_ai';

    execute 'comment on schema noor_ai is '
         || quote_literal(
              'Private NoorAI quota store. Not exposed through the Data API and not on any '
              || 'extra_search_path. Owned by noor_ai_owner (NOLOGIN); queried by noor_ai_runtime '
              || '(LOGIN, no credential yet).');

    -- A new schema does not grant PUBLIC anything by default, so these revokes are belt-and-braces
    -- rather than corrections. They are stated anyway: the whole point of this schema is that its
    -- privilege posture is explicit rather than inherited, and a reader should not have to know
    -- PostgreSQL's default to know that anon and authenticated hold nothing here.
    execute 'revoke all on schema noor_ai from public';
    execute 'revoke all on schema noor_ai from anon';
    execute 'revoke all on schema noor_ai from authenticated';

    -- The runtime role gets USAGE and nothing else. USAGE alone confers no access to any object; it
    -- is the precondition for the explicit EXECUTE grants that a later migration will add, once the
    -- functions exist.
    --
    -- CREATE is deliberately withheld. The runtime role must never be able to add objects to the
    -- schema it queries — that is the second half of the owner/runtime split described above.
    execute 'grant usage on schema noor_ai to noor_ai_runtime';

    -- Last operation on the schema. After this the migration role can no longer alter it, which is
    -- the intended end state.
    execute 'alter schema noor_ai owner to noor_ai_owner';

  end if;
end
$$;
