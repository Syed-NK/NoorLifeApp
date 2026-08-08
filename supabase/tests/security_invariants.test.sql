-- NoorLife — database security invariants.
--
-- Run against a freshly reset LOCAL database:
--
--     npx supabase db reset --local
--     npx supabase test db --local supabase/tests
--
-- ── What this guard is, and what it is not ──────────────────────────────────
-- Supabase's platform default privileges in schema `public` are deliberately left UNCHANGED. They
-- grant every table privilege and EXECUTE to the API roles on each new object created by `postgres`
-- or `supabase_admin`, and PostgreSQL separately grants EXECUTE to PUBLIC on every new function — a
-- grant that appears in no pg_default_acl row. Altering those platform defaults has a wider blast
-- radius than this project has evidence to justify, and one half of it may not even be executable
-- from a migration.
--
-- So this file is CONTAINMENT, not elimination. The defaults still fire; this guard makes the
-- resulting over-grant impossible to ship unnoticed. Concretely:
--
--   • Every NoorLife-owned object must converge to explicit least privilege.
--   • Every new NoorLife migration must therefore REVOKE and then GRANT explicitly. A migration that
--     merely CREATEs a table or function will fail this guard, by design.
--   • Adding a public object requires editing the allowlists below. That edit is the deliberate
--     security review — it cannot be skipped, and it cannot happen by accident.
--
-- ── Hosted verification is still required ───────────────────────────────────
-- Local and hosted default privileges DIFFER. Locally, creator `postgres` grants only Dxtm on new
-- tables and nothing to the API roles on new functions; hosted grants all eight and all four. A pass
-- here therefore proves the migrations converge, NOT that hosted is correct. Every deployment must
-- still be verified against the hosted catalog afterwards.
--
-- ── AI quota objects ────────────────────────────────────────────────────────
-- Future AI quota objects must live in a dedicated `noor_ai` schema, not in `public`, so they never
-- inherit the public-schema defaults in the first place. That schema is not created yet, and this
-- file deliberately does not create it.
--
-- ── Why pgTAP ───────────────────────────────────────────────────────────────
-- `supabase test db` is the CLI's own database test runner and needs no new dependency: the project
-- already invokes that CLI through npx, and Deno is not installed here. pgTAP is installed into the
-- `extensions` schema on purpose — installing it into `public` would add its functions to the very
-- namespace this file asserts over.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select * from no_plan();

-- ── Allowlists: editing these is the deliberate security review ─────────────
create temporary table approved_functions (signature text primary key) on commit drop;
insert into approved_functions (signature) values
  ('public.handle_new_user()'),
  ('public.set_updated_at()'),
  ('public.enforce_client_plan_code()');

create temporary table approved_tables (relname text primary key) on commit drop;
insert into approved_tables (relname) values ('profiles');

-- One row per privilege `authenticated` is approved to hold. Anything it holds beyond this set is a
-- failure, and anything missing is a failure too — the comparison is set equality, not containment.
create temporary table approved_table_privileges (relname text, grantee text, privilege text)
  on commit drop;
insert into approved_table_privileges (relname, grantee, privilege) values
  ('profiles', 'authenticated', 'SELECT'),
  ('profiles', 'authenticated', 'INSERT'),
  ('profiles', 'authenticated', 'UPDATE');

-- The eight table privileges PostgreSQL 17 recognises. MAINTAIN is the one added in 17; omitting it
-- would let a re-inherited MAINTAIN grant pass unnoticed.
create temporary table all_table_privileges (privilege text primary key) on commit drop;
insert into all_table_privileges (privilege) values
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN');

-- Resolved by OID, and only if present, so a missing role reports as "no privilege" rather than
-- aborting the run. PUBLIC is never listed here: it is not a pg_roles row, and is read from ACL
-- grantee OID 0 instead.
create temporary view client_roles as
  select r.oid, r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated');

-- ── NoorLife-owned objects, separated from extension-owned ones ─────────────
-- Provenance comes from pg_depend deptype='e', never from guessing at names. If an extension is
-- later installed into public, its functions are excluded here rather than being misreported as
-- NoorLife code that has been over-granted.
create temporary view noorlife_functions as
  select p.oid,
         'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
           as signature,
         p.proowner, p.prosecdef, p.proconfig, p.proacl, p.prorettype
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass and d.deptype = 'e');

create temporary view noorlife_tables as
  select c.oid, c.relname, c.relowner, c.relacl
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid
        and d.refclassid = 'pg_extension'::regclass and d.deptype = 'e');

-- ── 1. Server version (B11 regression assertion) ────────────────────────────
select is(
  (current_setting('server_version_num')::int / 10000),
  17,
  'B11: local PostgreSQL major version is exactly 17'
);

-- ── 2. Exactly the approved application functions exist in public ───────────
select set_eq(
  'select signature from noorlife_functions',
  'select signature from approved_functions',
  'public contains exactly the approved NoorLife functions (extension-owned excluded via pg_depend)'
);

-- ── 3. Function EXECUTE privileges ──────────────────────────────────────────
select is_empty(
  $$ select f.signature from noorlife_functions f
     where exists (
       select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
       where a.grantee = 0 and a.privilege_type = 'EXECUTE') $$,
  'No NoorLife function grants EXECUTE to PUBLIC'
);

select is_empty(
  $$ select f.signature || ' -> ' || r.rolname
     from noorlife_functions f cross join client_roles r
     where has_function_privilege(r.oid, f.oid, 'EXECUTE') $$,
  'No NoorLife function grants EXECUTE to anon or authenticated'
);

select is_empty(
  $$ select f.signature from noorlife_functions f
     where not has_function_privilege(f.proowner, f.oid, 'EXECUTE') $$,
  'Every NoorLife function remains executable by its owner'
);

-- The elevated server-side role is asserted against the LOCAL expectation only. Locally it holds no
-- explicit grant on these functions and reaches them only through PUBLIC, so revoking PUBLIC removes
-- it. Hosted DOES carry an explicit grant, so it retains EXECUTE there. Both states are approved;
-- they are not required to match, and this assertion must not be "fixed" to expect the hosted one.
select is_empty(
  $$ select f.signature from noorlife_functions f, pg_roles r
     where r.rolname = 'service_role'
       and has_function_privilege(r.oid, f.oid, 'EXECUTE') $$,
  'Local expectation: the elevated server-side role holds no EXECUTE (hosted differs, by design)'
);

-- ── 4. public.profiles effective privileges ─────────────────────────────────
select set_eq(
  $$ select p.privilege from all_table_privileges p
     where has_table_privilege('authenticated', 'public.profiles'::regclass, p.privilege) $$,
  $$ select privilege from approved_table_privileges
     where relname = 'profiles' and grantee = 'authenticated' $$,
  'authenticated holds exactly SELECT, INSERT, UPDATE on public.profiles'
);

select is_empty(
  $$ select p.privilege from all_table_privileges p, pg_roles r
     where r.rolname = 'anon'
       and has_table_privilege(r.oid, 'public.profiles'::regclass, p.privilege) $$,
  'anon holds no privilege on public.profiles'
);

select is_empty(
  $$ select a.privilege_type from pg_class c,
       aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = 'public.profiles'::regclass and a.grantee = 0 $$,
  'PUBLIC holds no privilege on public.profiles'
);

-- ── 5. Structural state ─────────────────────────────────────────────────────
select is(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  true,
  'public.profiles has RLS enabled'
);

-- FORCE must stay off: it removes the owner's exemption, and the provisioning trigger runs as the
-- owner against policies scoped to `authenticated`. Turning it on breaks signup. See 20260729140000.
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  false,
  'public.profiles has FORCE RLS off'
);

select set_eq(
  $$ select policyname::text from pg_policies
     where schemaname = 'public' and tablename = 'profiles' $$,
  $$ values ('profiles_select_own'), ('profiles_insert_own'), ('profiles_update_own') $$,
  'public.profiles carries exactly the three approved policies'
);

select set_eq(
  $$ select tgname::text from pg_trigger
     where tgrelid = 'public.profiles'::regclass and not tgisinternal $$,
  $$ values ('profiles_set_updated_at'), ('profiles_plan_code_guard') $$,
  'public.profiles carries exactly the two approved triggers'
);

select is(
  (select count(*)::int from noorlife_functions),
  3,
  'public contains exactly three NoorLife application functions'
);

select is_empty(
  $$ select signature from noorlife_functions
     where format_type(prorettype, null) <> 'trigger' $$,
  'Every NoorLife function returns trigger'
);

select set_eq(
  $$ select signature || ' => ' || case when prosecdef then 'DEFINER' else 'INVOKER' end
     from noorlife_functions $$,
  $$ values ('public.handle_new_user() => DEFINER'),
            ('public.enforce_client_plan_code() => DEFINER'),
            ('public.set_updated_at() => INVOKER') $$,
  'Each NoorLife function keeps its approved SECURITY DEFINER/INVOKER state'
);

-- PostgreSQL stores `SET search_path = ''` as the element `search_path=""`.
select is_empty(
  $$ select signature from noorlife_functions
     where coalesce(
       (select c from unnest(coalesce(proconfig, '{}'::text[])) c
         where split_part(c, '=', 1) = 'search_path' limit 1),
       'NOT SET') <> 'search_path=""' $$,
  'Every NoorLife function pins search_path to empty'
);

-- ── 6. Recurrence detection for any future public object ────────────────────
-- These four assertions are the actual guard. A migration that creates a table or function in public
-- and forgets to revoke will fail here even though every assertion above still passes, because these
-- range over whatever exists rather than over a fixed list.
select set_eq(
  'select relname::text from noorlife_tables',
  'select relname from approved_tables',
  'public contains exactly the approved NoorLife tables — a new table must be added to the allowlist'
);

select is_empty(
  $$ select t.relname || ':' || p.privilege
     from noorlife_tables t cross join all_table_privileges p, pg_roles r
     where r.rolname = 'anon' and has_table_privilege(r.oid, t.oid, p.privilege) $$,
  'anon holds no privilege on any NoorLife table in public'
);

select is_empty(
  $$ select t.relname || ':' || a.privilege_type
     from noorlife_tables t,
       aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
     where a.grantee = 0 $$,
  'PUBLIC holds no privilege on any NoorLife table in public'
);

select set_eq(
  $$ select t.relname || ':' || p.privilege
     from noorlife_tables t cross join all_table_privileges p, pg_roles r
     where r.rolname = 'authenticated' and has_table_privilege(r.oid, t.oid, p.privilege) $$,
  $$ select relname || ':' || privilege from approved_table_privileges
     where grantee = 'authenticated' $$,
  'authenticated holds exactly the approved privileges across every NoorLife table in public'
);

-- ── 7. D2 trust boundary: the noor_ai schema and its two roles ──────────────
-- Migration 20260808160000 creates the boundary the approved D2 architecture rests on
-- (docs/NOOR_AI3_QUOTA_STORE_SECURITY_REVIEW.md §19). Nothing is implemented inside it yet, and
-- these assertions are what keep "nothing" true until a reviewed migration changes it.
--
-- Why this is asserted against the live catalogue rather than trusted from the migration text:
-- `GRANT` and `REVOKE` issued by a role without ownership or grant option do **not** error. They
-- emit "WARNING: no privileges were granted" and the migration reports success. An earlier draft of
-- 20260808160000 did exactly that, and only the assertion below caught it.

create temporary table approved_noor_ai_roles (rolname text primary key, must_login boolean)
  on commit drop;
insert into approved_noor_ai_roles (rolname, must_login) values
  ('noor_ai_owner',   false),
  ('noor_ai_runtime', true);

select set_eq(
  'select rolname::text from pg_roles where rolname like ''noor\_ai\_%''',
  'select rolname from approved_noor_ai_roles',
  'exactly the two approved NoorAI roles exist'
);

select is(
  (select rolcanlogin from pg_roles where rolname = 'noor_ai_owner'),
  false,
  'noor_ai_owner is NOLOGIN — nothing can authenticate as the object owner'
);

select is(
  (select rolcanlogin from pg_roles where rolname = 'noor_ai_runtime'),
  true,
  'noor_ai_runtime has LOGIN — it is the identity the Edge Function will connect as'
);

-- The predicate is read, never the value. This is what "exists but cannot connect" means: a LOGIN
-- role with a null verifier cannot authenticate by any password method. Provisioning a credential is
-- a separate, secret-managed phase; when it happens, THIS ASSERTION IS EXPECTED TO FAIL LOCALLY ONLY
-- IF someone provisions one locally, which they should not.
select is_empty(
  $$ select rolname::text from pg_authid
     where rolname like 'noor\_ai\_%' and rolpassword is not null $$,
  'neither NoorAI role has a password verifier — no usable credential exists yet'
);

select is_empty(
  $$ select rolname::text || ' has ' ||
       case when rolsuper then 'SUPERUSER ' else '' end ||
       case when rolbypassrls then 'BYPASSRLS ' else '' end ||
       case when rolcreatedb then 'CREATEDB ' else '' end ||
       case when rolcreaterole then 'CREATEROLE ' else '' end ||
       case when rolreplication then 'REPLICATION ' else '' end
     from pg_roles
     where rolname like 'noor\_ai\_%'
       and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication) $$,
  'neither NoorAI role holds SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE or REPLICATION'
);

select is_empty(
  $$ select rolname::text from pg_roles where rolname like 'noor\_ai\_%' and rolinherit $$,
  'both NoorAI roles are NOINHERIT — a future membership would not apply implicitly'
);

-- Neither custom role may be a member of anything. The reverse direction — the migration role being
-- granted SET on noor_ai_owner so it can own the schema — is deliberate and is not covered here.
select is_empty(
  $$ select m.rolname::text || ' is a member of ' || r.rolname::text
     from pg_auth_members a
     join pg_roles m on m.oid = a.member
     join pg_roles r on r.oid = a.roleid
     where m.rolname like 'noor\_ai\_%' $$,
  'neither NoorAI role is a member of any other role, platform or otherwise'
);

select is(
  (select pg_get_userbyid(nspowner)::text from pg_namespace where nspname = 'noor_ai'),
  'noor_ai_owner',
  'schema noor_ai is owned by the NOLOGIN owner role'
);

select is_empty(
  $$ select g.who || ':' || p.priv
     from (values ('anon'), ('authenticated')) g(who)
     cross join (values ('USAGE'), ('CREATE')) p(priv)
     where has_schema_privilege(g.who, 'noor_ai', p.priv) $$,
  'anon and authenticated hold neither USAGE nor CREATE on noor_ai'
);

select is_empty(
  $$ select a.privilege_type from pg_namespace n,
       aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
     where n.nspname = 'noor_ai' and a.grantee = 0 $$,
  'PUBLIC holds no privilege on noor_ai'
);

select ok(
  has_schema_privilege('noor_ai_runtime', 'noor_ai', 'USAGE'),
  'noor_ai_runtime holds USAGE on noor_ai — the precondition for later EXECUTE grants'
);

select ok(
  not has_schema_privilege('noor_ai_runtime', 'noor_ai', 'CREATE'),
  'noor_ai_runtime does NOT hold CREATE on noor_ai — it may never add objects to what it queries'
);

select is(
  (select count(*)::int from pg_class
    where relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')),
  0,
  'noor_ai contains no relations yet'
);

select is(
  (select count(*)::int from pg_proc
    where pronamespace = (select oid from pg_namespace where nspname = 'noor_ai')),
  0,
  'noor_ai contains no routines yet'
);

-- The runtime role must reach nothing that already exists. Note that both roles DO hold USAGE on
-- schema `public`, because `public` grants USAGE to PUBLIC and every role is implicitly PUBLIC.
-- Schema USAGE alone confers no access to any object, which is what these assertions establish.
select is_empty(
  $$ select p.privilege from all_table_privileges p
     where has_table_privilege('noor_ai_runtime', 'public.profiles'::regclass, p.privilege) $$,
  'noor_ai_runtime holds no privilege on public.profiles'
);

select is_empty(
  $$ select f.signature from noorlife_functions f, pg_roles r
     where r.rolname = 'noor_ai_runtime'
       and has_function_privilege(r.oid, f.oid, 'EXECUTE') $$,
  'noor_ai_runtime cannot EXECUTE any existing public function'
);

select is_empty(
  $$ select g.who || ' -> ' || s.nspname
     from (values ('noor_ai_runtime'), ('noor_ai_owner')) g(who)
     cross join (values ('vault'), ('auth'), ('storage'), ('extensions'),
                        ('supabase_migrations')) s(nspname)
     where exists (select 1 from pg_namespace n where n.nspname = s.nspname)
       and has_schema_privilege(g.who, s.nspname, 'USAGE') $$,
  'neither NoorAI role holds USAGE on vault, auth, storage, extensions or supabase_migrations'
);

select is_empty(
  $$ select g.who || ' -> ' || t.relname
     from (values ('noor_ai_runtime'), ('noor_ai_owner')) g(who)
     cross join (values ('vault.secrets'), ('vault.decrypted_secrets')) t(relname)
     where exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname || '.' || c.relname = t.relname)
       and has_table_privilege(g.who, t.relname, 'SELECT') $$,
  'neither NoorAI role can SELECT from any Vault relation'
);

-- Data API exposure. The local stack does not persist `pgrst.db_schemas` as a role setting, so this
-- is vacuously true locally and becomes meaningful wherever that setting exists. The authoritative
-- local declaration is `supabase/config.toml`, asserted separately in the Jest security suite —
-- neither check alone is sufficient, and that is stated rather than papered over.
select is_empty(
  $$ select e from pg_db_role_setting s,
       unnest(coalesce(s.setconfig, '{}'::text[])) e
     where split_part(e, '=', 1) = 'pgrst.db_schemas'
       and e like '%noor\_ai%' $$,
  'noor_ai does not appear in any pgrst.db_schemas role setting'
);

-- ── 8. Negative probes: the boundary refused, not merely ungranted ──────────
-- Each probe assumes the runtime role inside a subtransaction, runs one statement, and returns its
-- SQLSTATE. 42501 is insufficient_privilege. Nothing selects real columns, so no row data or secret
-- can surface even if a probe unexpectedly succeeds — it would return 'NO ERROR' and fail the test.
create function pg_temp.probe_as_runtime(stmt text) returns text
language plpgsql as $probe$
declare
  state text;
begin
  begin
    execute 'set local role noor_ai_runtime';
    execute stmt;
    return 'NO ERROR';
  exception when others then
    state := sqlstate;
    return state;
  end;
end;
$probe$;

select is(pg_temp.probe_as_runtime('select 1 from public.profiles limit 1'), '42501',
  'runtime role is REFUSED reading public.profiles');
select is(pg_temp.probe_as_runtime('select public.set_updated_at()'), '42501',
  'runtime role is REFUSED calling public.set_updated_at()');
select is(pg_temp.probe_as_runtime('select public.handle_new_user()'), '42501',
  'runtime role is REFUSED calling public.handle_new_user()');
select is(pg_temp.probe_as_runtime('select public.enforce_client_plan_code()'), '42501',
  'runtime role is REFUSED calling public.enforce_client_plan_code()');
select is(pg_temp.probe_as_runtime('create table noor_ai.should_not_exist(i int)'), '42501',
  'runtime role is REFUSED creating objects in noor_ai');
select is(pg_temp.probe_as_runtime('create table public.should_not_exist(i int)'), '42501',
  'runtime role is REFUSED creating objects in public');
select is(pg_temp.probe_as_runtime('select 1 from vault.secrets limit 1'), '42501',
  'runtime role is REFUSED reading vault.secrets');
select is(pg_temp.probe_as_runtime('select 1 from vault.decrypted_secrets limit 1'), '42501',
  'runtime role is REFUSED reading vault.decrypted_secrets');
select is(pg_temp.probe_as_runtime('select 1 from auth.users limit 1'), '42501',
  'runtime role is REFUSED reading auth.users');
select is(pg_temp.probe_as_runtime('select 1 from supabase_migrations.schema_migrations limit 1'),
  '42501', 'runtime role is REFUSED reading the migration history');

-- ── 9. The migration must not leave the session role changed ───────────────
-- This is the regression assertion for a real hosted deployment failure. An earlier revision of
-- 20260808160000 configured the schema under `SET ROLE noor_ai_owner ... RESET ROLE`. The Supabase
-- CLI appends its own `INSERT INTO supabase_migrations.schema_migrations` to the same session after
-- the file's statements; that INSERT ran as noor_ai_owner, which holds no privilege on
-- supabase_migrations, and the whole hosted transaction rolled back.
--
-- The direct evidence that the migration no longer does this is simply that its history row exists:
-- the CLI could only have written it if the post-migration session still held its own privileges.
select ok(
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260808160000'),
  'migration 20260808160000 recorded its history row — the post-migration session kept its privileges'
);

select is(
  current_user::text,
  session_user::text,
  'no migration left a session role change behind (current_user still equals session_user)'
);

-- And the same capability demonstrated directly: a statement issued immediately after the migrations,
-- as the current role, can create and write a migration-history-shaped object. Everything here is
-- inside the guard's transaction and is rolled back with it.
select lives_ok(
  $$ create schema noor_ai_history_probe $$,
  'post-migration session can CREATE SCHEMA — as the CLI needs in order to record history'
);

select lives_ok(
  $$ create table noor_ai_history_probe.schema_migrations
       (version text primary key, name text, statements text[]) $$,
  'post-migration session can CREATE TABLE in a schema it owns'
);

select lives_ok(
  $$ insert into noor_ai_history_probe.schema_migrations (version, name, statements)
     values ('probe', 'probe', array['probe']) $$,
  'post-migration session can INSERT a history-shaped row — the exact statement that failed hosted'
);

select * from finish();

rollback;
