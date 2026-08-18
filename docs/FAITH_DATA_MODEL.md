# Faith module — proposed data model and RLS

**Status: PROPOSAL. No table is created in this phase.**

The phase brief forbids creating production tables before the schema and its
row-level security model are documented and reviewed. This is that document.
Everything below is a proposal for review; the migration that implements it is
a separate, later change.

## What actually needs a table

Nine repositories exist, but most of them serve *content* — the same verses,
narrations and supplications for every user. Content does not belong in our
database at all: it comes from the approved Quran Foundation Content API and is
cached server-side by the edge function.

| Repository | Storage | Why |
|---|---|---|
| `QuranContentRepository` | Quran Foundation, server-cached | Licensed content, not ours |
| `HadithRepository` | Approved hadith source, server-cached | Same |
| `DuaRepository` | Approved source, server-cached | Same |
| `FaithCalendarRepository` | Computed | Hijri conversion is a calculation |
| `PrayerTimesRepository` | Computed + `faith_preferences` | Times are calculated; settings persist |
| `MosqueRepository` | Third-party directory | Not ours to store |
| **`WorshipRepository`** | **`faith_worship_entries`** | The user's own record |
| **`TasbihRepository`** | **`faith_tasbih_sessions`** | The user's own record |
| Bookmarks | **`faith_bookmarks`** | The user's own record |
| Preferences | **`faith_preferences`** | The user's own settings |
| `FaithAiRepository` | Not persisted | No approved retention policy yet |

So four tables, all of them personal, all of them needing RLS.

Today all four live in AsyncStorage on device (`src/features/faith/storage/`).
That is a deliberate interim: it works offline, it needs no schema review, and
it means no worship record leaves the device before we have decided how it
should be protected.

## Proposed schema

```sql
-- ── Preferences ──────────────────────────────────────────────────────────
create table public.faith_preferences (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  translation_id     text        not null,
  reciter_id         text        not null,
  calculation_method text        not null,
  asr_method         text        not null default 'standard',
  show_transliteration boolean   not null default true,
  location_label     text,
  prayer_notifications jsonb     not null default '[]'::jsonb,
  updated_at         timestamptz not null default now(),
  constraint asr_method_valid check (asr_method in ('standard', 'hanafi'))
);

-- ── Worship record ───────────────────────────────────────────────────────
create table public.faith_worship_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  entry_date   date        not null,
  entry_key    text        not null,
  kind         text        not null,
  status       text        not null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint status_valid check (status in ('completed','current','upcoming','missed')),
  constraint kind_valid check (kind in ('prayer','adhkar','quran','fasting','charity','custom')),
  unique (user_id, entry_date, entry_key)
);
create index faith_worship_user_date on public.faith_worship_entries (user_id, entry_date desc);

-- ── Tasbih ───────────────────────────────────────────────────────────────
create table public.faith_tasbih_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  preset_id    text        not null,
  count        integer     not null default 0 check (count >= 0),
  rounds       integer     not null default 0 check (rounds >= 0),
  target       integer     not null check (target > 0),
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index faith_tasbih_user_updated on public.faith_tasbih_sessions (user_id, updated_at desc);

-- ── Bookmarks ────────────────────────────────────────────────────────────
create table public.faith_bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  kind       text        not null,
  content_id text        not null,
  label      text        not null,
  subtitle   text        not null default '',
  saved_at   timestamptz not null default now(),
  constraint kind_valid check (kind in ('ayah','hadith','dua')),
  unique (user_id, kind, content_id)
);
```

## Proposed RLS

Every table is owner-only. There is no sharing, no family visibility and no
aggregate read in this model — a worship record is between a person and their
Lord, and the product has no feature that requires anyone else to see it.

```sql
alter table public.faith_preferences      enable row level security;
alter table public.faith_worship_entries  enable row level security;
alter table public.faith_tasbih_sessions  enable row level security;
alter table public.faith_bookmarks        enable row level security;

-- One policy per operation rather than `for all`, so a future change to read
-- rules cannot silently widen writes.
create policy faith_prefs_select on public.faith_preferences
  for select using ((select auth.uid()) = user_id);
create policy faith_prefs_insert on public.faith_preferences
  for insert with check ((select auth.uid()) = user_id);
create policy faith_prefs_update on public.faith_preferences
  for update using ((select auth.uid()) = user_id)
              with check ((select auth.uid()) = user_id);
create policy faith_prefs_delete on public.faith_preferences
  for delete using ((select auth.uid()) = user_id);

-- The same four policies repeat for faith_worship_entries,
-- faith_tasbih_sessions and faith_bookmarks.
```

Notes on the policy shape:

- `(select auth.uid())` rather than bare `auth.uid()` — the scalar subquery is
  evaluated once per statement instead of once per row, which matters on the
  worship table where a month's read is ~210 rows.
- `with check` is set on both insert and update. Without it on update, a user
  could move their own row to another `user_id`.
- No `service_role` bypass policy is proposed. Nothing server-side needs to read
  a user's worship record; if that changes, it needs its own review.

## Open questions for review

1. **Retention.** How long is a worship record kept after account deletion? The
   `on delete cascade` handles the mechanical part, but there may be a policy
   answer about backups.
2. **Sync conflict.** If the same day is marked on two devices offline, which
   wins? Proposal: last-write-wins on `updated_at`, because the alternative
   (prompting the user to reconcile prayer marks) is worse than occasionally
   taking the wrong one.
3. **AI conversation retention.** Deliberately not modelled. Faith AI history is
   in-memory only until there is an approved answer for how long a religious
   question may be stored and who can see it.
4. **Tasbih history size.** Currently capped at 50 entries on device. A table has
   no natural cap; propose a 90-day retention.

## Migration plan, when approved

1. Write the migration under `supabase/migrations/` following the existing
   `20260729120000_create_profiles.sql` pattern.
2. Implement Supabase-backed repositories satisfying the same four interfaces.
3. Register them in `FaithRepositoryProvider`. No screen changes.
4. Write a one-time device-to-cloud migration for existing AsyncStorage data,
   keyed off `faithStorageKeys`.
5. Keep the AsyncStorage layer as the offline cache rather than deleting it.
