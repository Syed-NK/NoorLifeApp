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
    and p.proname not like 'noor\_ai\_%'  -- NoorAI wrappers are asserted separately, see section 10
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid
        and d.refclassid = 'pg_extension'::regclass and d.deptype = 'e');

-- The NoorAI quota wrappers are the ONLY reachable entry points into the private schema, so they get
-- their own assertions rather than being folded into the application-function set: they return jsonb
-- rather than trigger, and they are the one place `service_role` is deliberately granted EXECUTE.
create temporary view noorai_wrappers as
  select p.oid,
         'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
           as signature,
         p.proname, p.proowner, p.prosecdef, p.proconfig, p.proacl, p.prorettype,
         p.pronargdefaults
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname like 'noor\_ai\_%';

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

-- SUPERSEDED 2026-08-08: the direct-connection runtime path is abandoned. Nothing connects as this
-- role any more, so it must be inert. It is deliberately NOT dropped — dropping a role a deployed
-- migration created makes the history non-replayable, and keeping it lets this guard prove it stays
-- disabled rather than silently reappearing.
select is(
  (select rolcanlogin from pg_roles where rolname = 'noor_ai_runtime'),
  false,
  'noor_ai_runtime is NOLOGIN — the direct-connection path is superseded and the role is inert'
);

select is_empty(
  $$ select 1 from pg_authid
     where rolname = 'noor_ai_runtime' and rolpassword is not null $$,
  'noor_ai_runtime holds no password verifier'
);

select is(
  has_schema_privilege('noor_ai_runtime', 'noor_ai', 'USAGE'),
  false,
  'noor_ai_runtime holds no USAGE on noor_ai — its last reachability is revoked'
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
  not has_schema_privilege('noor_ai_runtime', 'noor_ai', 'CREATE'),
  'noor_ai_runtime does NOT hold CREATE on noor_ai — it may never add objects to what it queries'
);

-- service_role reaches the definer entry points through USAGE and nothing else. USAGE alone confers
-- no access to any object; every table privilege stays with the owner.
select ok(
  has_schema_privilege('service_role', 'noor_ai', 'USAGE'),
  'service_role holds USAGE on noor_ai — the precondition for the five EXECUTE grants'
);

select ok(
  not has_schema_privilege('service_role', 'noor_ai', 'CREATE'),
  'service_role does NOT hold CREATE on noor_ai'
);

-- ── 7b. Exact private inventory ─────────────────────────────────────────────
-- Allowlists, not counts. A new relation or routine in `noor_ai` fails here until it is added
-- deliberately — that edit IS the security review.
select set_eq(
  $$ select c.relname::text from pg_class c
     where c.relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and c.relkind in ('r', 'p') $$,
  $$ values ('limit_config'), ('price_table'), ('user_counter'), ('global_counter'),
            ('reservation'), ('provider_attempt') $$,
  'noor_ai contains exactly the approved quota relations'
);

select set_eq(
  $$ select p.proname::text from pg_proc p
     where p.pronamespace = (select oid from pg_namespace where nspname = 'noor_ai') $$,
  $$ values ('limit_of'), ('window_start_of'), ('try_increment_user'), ('try_increment_global'),
            ('accumulate_global'), ('global_value'), ('user_value'), ('expire_stale'),
            ('reserve'), ('register_attempt'), ('finalize'), ('release'), ('status'),
            ('purge_expired') $$,
  'noor_ai contains exactly the approved routines'
);

-- Every private object belongs to the NOLOGIN owner.
select is_empty(
  $$ select c.relname::text from pg_class c
     where c.relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and c.relkind in ('r', 'p')
       and pg_get_userbyid(c.relowner) <> 'noor_ai_owner' $$,
  'every noor_ai relation is owned by noor_ai_owner'
);

select is_empty(
  $$ select p.proname::text from pg_proc p
     where p.pronamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and pg_get_userbyid(p.proowner) <> 'noor_ai_owner' $$,
  'every noor_ai routine is owned by noor_ai_owner'
);

-- Fixed empty search_path on every private routine.
select is_empty(
  $$ select p.proname::text from pg_proc p
     where p.pronamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and coalesce(
         (select c from unnest(coalesce(p.proconfig, '{}'::text[])) c
           where split_part(c, '=', 1) = 'search_path' limit 1),
         'NOT SET') <> 'search_path=""' $$,
  'every noor_ai routine pins search_path to empty'
);

-- The EXECUTE matrix: exactly five entry points, and no internal helper.
select set_eq(
  $$ select p.proname::text from pg_proc p
     where p.pronamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and has_function_privilege('service_role', p.oid, 'EXECUTE') $$,
  $$ values ('reserve'), ('register_attempt'), ('finalize'), ('release'), ('status') $$,
  'service_role executes exactly the five lifecycle entry points and no internal helper'
);

select is_empty(
  $$ select g.who || ' -> ' || p.proname
     from (values ('anon'), ('authenticated')) g(who)
     cross join pg_proc p
     where p.pronamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and has_function_privilege(g.who, p.oid, 'EXECUTE') $$,
  'anon and authenticated execute no noor_ai routine'
);

-- No direct table reach for anyone but the owner. This is what makes the lifecycle unbypassable.
select is_empty(
  $$ select g.who || ' -> ' || c.relname || ':' || p.privilege
     from (values ('service_role'), ('anon'), ('authenticated')) g(who)
     cross join all_table_privileges p
     join pg_class c on c.relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and c.relkind = 'r'
     where has_table_privilege(g.who, c.oid, p.privilege) $$,
  'service_role, anon and authenticated hold NO direct privilege on any noor_ai table'
);

select is_empty(
  $$ select c.relname::text from pg_class c
     where c.relnamespace = (select oid from pg_namespace where nspname = 'noor_ai')
       and c.relkind = 'S'
       and (has_sequence_privilege('service_role', c.oid, 'USAGE')
         or has_sequence_privilege('anon', c.oid, 'USAGE')
         or has_sequence_privilege('authenticated', c.oid, 'USAGE')) $$,
  'no client or service role holds any noor_ai sequence privilege'
);

-- ── 7c. The public wrappers ─────────────────────────────────────────────────
select set_eq(
  'select signature from noorai_wrappers',
  $$ values ('public.noor_ai_reserve(p_subject_id uuid, p_request_id text)'),
            ('public.noor_ai_register_attempt(p_subject_id uuid, p_reservation_id uuid, p_attempt_number integer, p_input_tokens integer, p_output_tokens integer, p_reasoning_tokens integer, p_outcome text)'),
            ('public.noor_ai_finalize(p_subject_id uuid, p_reservation_id uuid)'),
            ('public.noor_ai_release(p_subject_id uuid, p_reservation_id uuid)'),
            ('public.noor_ai_status(p_subject_id uuid)') $$,
  'public exposes exactly the five approved NoorAI wrappers, with exact signatures'
);

select is_empty(
  $$ select signature from noorai_wrappers where prosecdef $$,
  'every NoorAI wrapper is SECURITY INVOKER — it carries no authority of its own'
);

select is_empty(
  $$ select signature from noorai_wrappers where pronargdefaults > 0 $$,
  'no NoorAI wrapper has default arguments that could broaden reachability'
);

select is_empty(
  $$ select signature from noorai_wrappers
     where coalesce(
       (select c from unnest(coalesce(proconfig, '{}'::text[])) c
         where split_part(c, '=', 1) = 'search_path' limit 1),
       'NOT SET') <> 'search_path=""' $$,
  'every NoorAI wrapper pins search_path to empty'
);

select is_empty(
  $$ select w.signature from noorai_wrappers w
     where exists (
       select 1 from aclexplode(coalesce(w.proacl, acldefault('f', w.proowner))) a
       where a.grantee = 0 and a.privilege_type = 'EXECUTE') $$,
  'no NoorAI wrapper grants EXECUTE to PUBLIC'
);

select is_empty(
  $$ select w.signature || ' -> ' || r.rolname
     from noorai_wrappers w cross join client_roles r
     where has_function_privilege(r.oid, w.oid, 'EXECUTE') $$,
  'no NoorAI wrapper grants EXECUTE to anon or authenticated'
);

select is_empty(
  $$ select w.signature from noorai_wrappers w
     where not has_function_privilege('service_role', w.oid, 'EXECUTE') $$,
  'service_role executes every NoorAI wrapper — the server-only call path'
);

-- A prefix-matching function must NOT inherit service_role EXECUTE.
--
-- An earlier revision granted by looping over `proname like 'noor\_ai\_%'`, so any future function
-- whose name happened to match would have been granted silently. The migration now names each exact
-- signature. This proves it against the live catalog rather than trusting the SQL text: a synthetic
-- decoy is created here, inside the rolled-back test transaction, and must come out ungranted.
create or replace function public.noor_ai_decoy_not_granted(p int)
returns int language sql set search_path = '' as $decoy$ select p $decoy$;

-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and service_role is implicitly PUBLIC.
-- That inherited grant has nothing to do with this migration, so it is removed first; what remains is
-- exactly the question being asked — did the migration itself grant service_role anything here?
revoke all on function public.noor_ai_decoy_not_granted(int) from public;

select ok(
  not has_function_privilege('service_role', 'public.noor_ai_decoy_not_granted(int)'::regprocedure, 'EXECUTE'),
  'a synthetic public.noor_ai_* function does NOT receive service_role EXECUTE from this migration'
);

drop function public.noor_ai_decoy_not_granted(int);

-- ── 7d. The private schema is never exposed to the Data API ─────────────────
select is_empty(
  $$ select n.nspname::text from pg_namespace n
     where n.nspname = 'noor_ai'
       and exists (
         select 1 from pg_db_role_setting s
         where array_to_string(s.setconfig, ',') like '%noor_ai%'
           and array_to_string(s.setconfig, ',') like '%pgrst.db_schemas%') $$,
  'noor_ai never appears in a PostgREST exposed-schema setting'
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
