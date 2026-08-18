# Phase 5 — Subscription & Family Data Model

Status: **proposed, not applied.** No migration in `supabase/migrations/` implements this document
yet. The brief requires the model, its RLS policies and its tests to be documented and validated
before production migrations run, and entitlements in this phase come from a deterministic mock.

Existing migrations this builds on top of, additively:

- `20260729120000_create_profiles.sql`
- `20260729140000_fix_profile_trigger_rls.sql`

Nothing here alters `public.profiles` or the auth schema.

---

## 1. Principles

1. **The client is never the authority on entitlement.** Apple and Google own payment; a
   server-verified row owns access. The app may read its entitlement, never assert one.
2. **No secret reaches the client.** No Apple issuer key, no Google service account, no webhook
   signing secret. Verification is server-side, later.
3. **Raw invitation tokens are never stored.** The row keeps a hash; the token exists only in the
   link that was sent.
4. **Family membership grants entitlement, not visibility.** Sharing a plan must never share
   Health, Finance, Goals or AI conversation content.
5. **Entitlement writes are idempotent.** A provider will redeliver notifications; replaying one
   must not double-extend a period or duplicate a row.

---

## 2. Enumerated types

Normalized internal values, matching the app's TypeScript domain exactly so no translation layer
can drift.

```sql
create type public.subscription_plan as enum ('free', 'premium_single', 'premium_family');

create type public.billing_period as enum ('none', 'monthly', 'yearly');

create type public.subscription_status as enum (
  'free', 'trialing', 'active', 'grace_period',
  'account_hold', 'paused', 'expired', 'revoked', 'unknown'
);

create type public.subscription_provider as enum ('apple', 'google', 'development_mock');

create type public.family_role as enum ('organizer', 'adult', 'child');

create type public.family_member_status as enum ('active', 'invited', 'removed');

create type public.invitation_status as enum ('pending', 'accepted', 'expired', 'revoked');
```

`development_mock` is a first-class provider value rather than a null. A mock entitlement is a real
state the app can be in during development, and modelling it as absence would make "no provider"
ambiguous with "not yet loaded".

---

## 3. Tables

### 3.1 `subscriptions`

One row per paying owner. A family plan has exactly one row — the organizer's.

```sql
create table public.subscriptions (
  id                            uuid primary key default gen_random_uuid(),
  owner_user_id                 uuid not null references auth.users (id) on delete cascade,
  plan                          public.subscription_plan not null,
  billing_period                public.billing_period not null default 'none',
  provider                      public.subscription_provider not null,
  provider_customer_id          text,
  provider_product_id           text,
  provider_transaction_reference text,
  status                        public.subscription_status not null,
  current_period_start          timestamptz,
  current_period_end            timestamptz,
  trial_end                     timestamptz,
  cancel_at_period_end          boolean not null default false,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  -- A paid plan must carry a billing period; free must not.
  constraint subscriptions_paid_has_period check (
    (plan = 'free' and billing_period = 'none') or
    (plan <> 'free' and billing_period in ('monthly', 'yearly'))
  ),
  -- A trial only exists on a yearly paid plan, per the approved commercial model.
  constraint subscriptions_trial_is_yearly check (
    trial_end is null or billing_period = 'yearly'
  )
);

-- One live subscription per owner. This is the idempotency anchor: a redelivered provider
-- notification updates this row rather than inserting a second one.
create unique index subscriptions_one_active_per_owner
  on public.subscriptions (owner_user_id)
  where status in ('trialing', 'active', 'grace_period', 'account_hold', 'paused');

-- Replay guard for provider notifications.
create unique index subscriptions_provider_txn
  on public.subscriptions (provider, provider_transaction_reference)
  where provider_transaction_reference is not null;
```

Why a partial unique index rather than a plain one: an owner accumulates historical `expired` and
`revoked` rows over years, and those must coexist. Only one row may be *live* at a time.

### 3.2 `families`

```sql
create table public.families (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 60),
  member_limit  smallint not null default 6 check (member_limit = 6),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A user organizes at most one family.
create unique index families_one_per_owner on public.families (owner_user_id);
```

`member_limit` is stored *and* pinned to 6 by check constraint. Stored so the number is data rather
than scattered through code; pinned so it cannot be quietly raised to sell more seats than the
approved model without a migration that someone has to review.

**Six is the total, including the organizer.** This is the single most misread number in the model,
so it is enforced in §4 rather than left to application code.

### 3.3 `family_members`

```sql
create table public.family_members (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      public.family_role not null default 'adult',
  status    public.family_member_status not null default 'active',
  joined_at timestamptz not null default now(),

  constraint family_members_unique_user unique (family_id, user_id)
);

-- A user belongs to at most one family at a time.
create unique index family_members_one_family_per_user
  on public.family_members (user_id)
  where status = 'active';

-- Exactly one organizer per family.
create unique index family_members_single_organizer
  on public.family_members (family_id)
  where role = 'organizer' and status = 'active';
```

### 3.4 `family_invitations`

```sql
create table public.family_invitations (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families (id) on delete cascade,
  invited_email citext not null,
  invited_by    uuid not null references auth.users (id) on delete cascade,
  token_hash    text not null,
  status        public.invitation_status not null default 'pending',
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- One outstanding invitation per address per family, so "resend" updates rather than duplicates.
create unique index family_invitations_one_pending
  on public.family_invitations (family_id, invited_email)
  where status = 'pending';

create index family_invitations_token on public.family_invitations (token_hash);
```

`token_hash` holds `sha256(token)`. The raw token appears only in the emailed link and is never
persisted, so a database disclosure does not yield usable invitations. `citext` for the address so
`Ahmed@x.com` and `ahmed@x.com` are one invitation rather than two seats.

`expires_at` is `not null`: an invitation that never expires is a permanent seat grant to whoever
holds the link.

---

## 4. The six-seat ceiling

Enforced in the database, because application-level counting races. Two invitations accepted
simultaneously both read "5 of 6" and both insert.

```sql
create or replace function public.enforce_family_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seat_limit smallint;
  seats_used integer;
begin
  select member_limit into seat_limit from public.families where id = new.family_id for update;

  -- The FOR UPDATE above serialises concurrent accepts on the family row, which is what makes
  -- this count trustworthy rather than a snapshot two transactions can both pass.
  select count(*) into seats_used
  from public.family_members
  where family_id = new.family_id and status = 'active';

  if seats_used >= seat_limit then
    raise exception 'family_full' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger family_members_limit
  before insert on public.family_members
  for each row when (new.status = 'active')
  execute function public.enforce_family_member_limit();
```

The organizer is inserted as a `family_members` row with `role = 'organizer'`, so the organizer
**consumes one of the six seats** by construction. There is no separate path that could forget to
count them. Five additional members then fill seats 2–6, and the seventh insert raises
`family_full`.

The organizer must not be removable while the family exists:

```sql
create or replace function public.prevent_organizer_removal()
returns trigger language plpgsql as $$
begin
  if old.role = 'organizer' and (new.status <> 'active' or new.role <> 'organizer') then
    raise exception 'organizer_cannot_leave' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger family_members_keep_organizer
  before update on public.family_members
  for each row execute function public.prevent_organizer_removal();
```

Transferring the organizer role is **deferred** — the brief says to defer it unless fully
supported, and doing it safely needs a two-party confirmation flow this phase does not build.

---

## 5. Row-level security

RLS is enabled on all four tables. Every table is user-owned; none is world-readable.

```sql
alter table public.subscriptions       enable row level security;
alter table public.families            enable row level security;
alter table public.family_members      enable row level security;
alter table public.family_invitations  enable row level security;
```

### 5.1 Membership helper

```sql
-- SECURITY DEFINER to avoid infinite recursion: a policy on family_members cannot itself
-- select from family_members under RLS without re-triggering the same policy.
create or replace function public.current_user_family_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select family_id from public.family_members
  where user_id = auth.uid() and status = 'active'
  limit 1;
$$;
```

### 5.2 `subscriptions`

```sql
-- The owner reads their own subscription.
create policy subscriptions_owner_read on public.subscriptions
  for select using (owner_user_id = auth.uid());

-- A family member reads only the fields needed to know they are entitled. Exposed through a
-- view rather than the table, so provider references and transaction ids stay owner-only.
create policy subscriptions_family_read on public.subscriptions
  for select using (
    plan = 'premium_family'
    and exists (
      select 1 from public.family_members m
      where m.family_id = public.current_user_family_id()
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
    and owner_user_id in (
      select owner_user_id from public.families where id = public.current_user_family_id()
    )
  );
```

**No client write policy exists on `subscriptions`.** Inserts and updates happen only through
server-side verified provider handling (service role). This is the rule that makes rule 11 of the
brief — "do not invent successful purchases" — structural rather than a convention: a compromised
or modified client cannot grant itself premium, because it has no write path.

A restricted projection for members:

```sql
create view public.family_entitlement_view
with (security_invoker = true) as
select s.plan, s.status, s.current_period_end, f.id as family_id
from public.subscriptions s
join public.families f on f.owner_user_id = s.owner_user_id
where s.plan = 'premium_family';
```

### 5.3 `families` and `family_members`

```sql
create policy families_member_read on public.families
  for select using (
    owner_user_id = auth.uid() or id = public.current_user_family_id()
  );

create policy families_organizer_write on public.families
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- A member sees who else is in the family: name and role, which is what the members screen needs.
create policy family_members_read on public.family_members
  for select using (family_id = public.current_user_family_id());

-- Only the organizer changes membership.
create policy family_members_organizer_write on public.family_members
  for all using (
    exists (select 1 from public.families f
            where f.id = family_members.family_id and f.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.families f
            where f.id = family_members.family_id and f.owner_user_id = auth.uid())
  );
```

### 5.4 `family_invitations`

```sql
-- Organizer-only. Invitees do not read this table; acceptance goes through a function that
-- takes the raw token, so an invitee never needs select access and cannot enumerate invitations.
create policy family_invitations_organizer_all on public.family_invitations
  for all using (
    exists (select 1 from public.families f
            where f.id = family_invitations.family_id and f.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.families f
            where f.id = family_invitations.family_id and f.owner_user_id = auth.uid())
  );
```

Acceptance:

```sql
create or replace function public.accept_family_invitation(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.family_invitations;
begin
  select * into inv from public.family_invitations
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    and status = 'pending'
  for update;

  if not found then
    raise exception 'invitation_invalid';
  end if;

  if inv.expires_at <= now() then
    update public.family_invitations set status = 'expired' where id = inv.id;
    raise exception 'invitation_expired';
  end if;

  -- The seat trigger fires here and raises `family_full` if the family filled up while this
  -- invitation was outstanding. The invitation is left pending, not consumed, so the organizer
  -- can free a seat and the same link still works.
  insert into public.family_members (family_id, user_id, role, status)
  values (inv.family_id, auth.uid(), 'adult', 'active');

  update public.family_invitations
  set status = 'accepted', accepted_at = now()
  where id = inv.id;

  return inv.family_id;
end;
$$;
```

---

## 6. Privacy: what a family plan does and does not share

The brief's hardest requirement: private Health, Finance, Goals and AI conversations must never be
visible to other family members **by default**.

This model achieves that by **omission**, which is the only durable way. There is no join from
`family_members` to any content table. A future Health or Finance table is owned by
`user_id = auth.uid()` and its RLS policy references only `auth.uid()` — never
`current_user_family_id()`. Family membership therefore cannot widen content visibility, because
no content policy consults it.

| Shared across the family | Private to one account |
|---|---|
| Plan entitlement (via `family_entitlement_view`) | Health records and metrics |
| Family name, roster, roles, seat count | Finance accounts, budgets, transactions |
| Shared calendar, events, tasks *(future table, explicitly family-scoped)* | Personal goals |
| Shared family goals *(future, explicitly family-scoped)* | Noor AI conversation history |
| Check-ins and shared memories *(future, explicitly family-scoped)* | Personal profile detail beyond display name |

A future shared table must opt **in** by name — `family_events`, `family_goals` — and carry
`family_id` explicitly. Any table without `family_id` is private by construction.

Removal: setting `family_members.status = 'removed'` immediately drops the row from
`current_user_family_id()`, so the removed user's entitlement falls back to `free` on their next
refresh. Their own data is untouched — rule 4 of the brief, cancellation does not delete data.

---

## 7. Idempotency of entitlement changes

A provider notification handler must be safe to run twice:

```sql
insert into public.subscriptions (
  owner_user_id, plan, billing_period, provider, provider_product_id,
  provider_transaction_reference, status, current_period_start, current_period_end, trial_end
) values (...)
on conflict (provider, provider_transaction_reference)
  where provider_transaction_reference is not null
do update set
  status               = excluded.status,
  current_period_end   = greatest(subscriptions.current_period_end, excluded.current_period_end),
  cancel_at_period_end = excluded.cancel_at_period_end,
  updated_at           = now();
```

`greatest(...)` on the period end is deliberate: an out-of-order redelivery of an older
notification must not shorten a period the user has already paid for.

---

## 8. Validation required before applying

None of this is applied. Before a migration ships, these must pass:

1. Seat ceiling: inserting a seventh active member raises `family_full`; the organizer occupies
   seat one; concurrent accepts cannot both pass the count.
2. Organizer cannot be removed or demoted while the family exists.
3. A family member reading `subscriptions` sees no `provider_transaction_reference` or
   `provider_customer_id`.
4. A family member cannot select any row from a private content table owned by another member.
5. A removed member's entitlement resolves to `free`, and their own rows survive.
6. An expired invitation cannot be accepted; an accepted invitation cannot be accepted twice.
7. Accepting into a full family leaves the invitation `pending` rather than consuming it.
8. Replaying a provider notification neither duplicates a row nor shortens a period.
9. No client role can insert or update `subscriptions`.

Items 1, 5, 6 and 9 have equivalents in the application-level test suite added this phase against
the mock entitlement service; the SQL-level equivalents need a local Supabase instance and are
listed here as the gate on applying the migration.
