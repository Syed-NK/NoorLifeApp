# Phase 5 — Subscription & Family Audit

Branch: `feature/subscriptions-family-six`
Base commit: recorded in `PHASE_5_PROTECTED_HASHES.md`
Status: pre-implementation audit

---

## 1. What exists today

### 1.1 Routes

Five subscription routes exist. **All five render `SimplePlaceholderScreen`** — a title, a
description and a spec reference. There is no plan UI, no price, no CTA and no purchase path.

| Route | File | Current content |
|---|---|---|
| `/subscription` | `src/app/subscription/index.tsx` | Placeholder, "Subscription Overview" |
| `/subscription/single` | `src/app/subscription/single.tsx` | Placeholder, "Premium Single" |
| `/subscription/family` | `src/app/subscription/family.tsx` | Placeholder, **"Premium Family of 4"** |
| `/subscription/yearly` | `src/app/subscription/yearly.tsx` | Placeholder, "Yearly Plan Comparison" |
| `/subscription/manage` | `src/app/subscription/manage.tsx` | Placeholder, "Manage Subscription" |

`src/app/subscription/_layout.tsx` is a bare `Stack` with `headerShown: false`.

`subscriptionRoutes` in `src/application/navigation/routes.ts` declares exactly those five.

### 1.2 Entitlement logic

**None.** No plan type, no status enum, no entitlement service, no gating anywhere. Every module
route is reachable by every user. `grep` for `entitlement` returns only unrelated matches.

### 1.3 Store integration

**None.** `package.json` contains no purchase dependency — no `react-native-purchases`
(RevenueCat), no `expo-in-app-purchases`, no StoreKit or Play Billing binding. There are no
product identifiers anywhere in the repository.

### 1.4 Database

Two migrations exist, both concerning profiles:

- `supabase/migrations/20260729120000_create_profiles.sql`
- `supabase/migrations/20260729140000_fix_profile_trigger_rls.sql`

There is no `subscriptions`, `families`, `family_members` or `family_invitations` table.

### 1.5 Family module

`src/app/family/` has `index`, `ai`, `calendar`, `memories`, `safety`. These are module content
screens driven by the module framework. There is no family *membership* concept: no organizer, no
seats, no invitations.

---

## 2. Conflicts found

### 2.1 "Premium Family of 4" — the Phase 5 brief contradicts the existing design lock

The Phase 5 brief states the family plan is **six accounts total** (one organizer + five members)
and that `Family of 4` must not appear anywhere. Two places currently say four:

| Location | Content |
|---|---|
| `src/app/subscription/family.tsx:6` | `title="Premium Family of 4"` |
| `docs/NOORLIFE_UI_DESIGN_SPEC.md:582` | `## 16. Premium Family of 4` — "Four member profiles" |

`NOORLIFE_UI_DESIGN_SPEC.md` is marked *"Design lock for Claude development"*. So this is not a
stale placeholder to quietly fix — it is a **direct conflict between two authorities**, and the
older one is labelled a lock.

**Resolution taken:** Phase 5 is the newer and more specific commercial instruction, states the
seat model three separate times, and explicitly forbids the four-seat wording. Phase 5 wins. The
code is rewritten to six seats, and §16 of the design spec is amended with a note recording that
Phase 5 supersedes it, rather than being silently edited or silently left wrong.

Flagged for the design owner: **if four seats was the intended commercial model, Phase 5 is wrong
and this implementation is wrong with it.** Nothing else in the repository corroborates four.

### 2.2 The paid-module gate cannot live in Main Home

The brief asks that selecting a paid module from Main Home open the module when entitled and
otherwise show the Locked Module Paywall Sheet. But Main Home navigates directly:

```
src/features/home/screens/main-home-screen.tsx:99
const openModule = useCallback((theme: ModuleTheme) => router.push(theme.homeHref), [router]);
```

`main-home-screen.tsx` is design-locked, and `module-grid.tsx` (also locked) only forwards an
`onSelectModule` callback. Adding a gate at the call site means editing a locked file.

**Resolution taken:** the gate is placed at the *destination* instead — each paid module's
`src/app/<module>/_layout.tsx` wraps its `Stack` in an entitlement gate. Main Home keeps pushing
the route unchanged, and the module decides whether to render itself or the paywall sheet.

This is strictly better than gating one caller, and the reason is worth stating: Main Home reaches
modules from **four** places — the grid (`:99`), timeline entries (`:102`), quick actions (`:107`)
and direct pushes such as `/planner` (`:147`, `:158`) and `/family` (`:167`). Gating the grid
callback alone would leave the other three, plus deep links and module AI routes, wide open.
Gating the destination closes every path at once and touches no locked file.

Behaviour matches the brief; only the insertion point differs.

### 2.3 `/subscription/yearly` has no place in the Phase 5 screen list

The brief specifies Plan Comparison at `/subscription/compare`. The existing `/subscription/yearly`
placeholder covers similar ground and is referenced by `subscriptionRoutes.yearly`.

**Resolution taken:** `/subscription/compare` is built as the real comparison screen, and
`/subscription/yearly` becomes a redirect to it so any existing link keeps working. The route is
not deleted, because deleting a declared route is a contract change the brief did not ask for.

---

## 3. What is reused, not rebuilt

| Concern | Existing asset reused |
|---|---|
| Soft-mint palette, navy text, electric blue | `entryAuthColors` in the locked `entry-auth-tokens.ts` — imported, never modified |
| Type ramp, spacing, 393 dp baseline scale | `entryAuthType`, `entryAuthLayout`, `useEntryAuthMetrics` |
| Module pictograms | `getModulePictogram()` → `assets/images/pictograms/normalized/*.png` |
| Noor AI robot | the same normalized `noor-ai.png` via `getModulePictogram('noor-ai')` |
| Module identity (name, theme, routes) | `moduleRegistry` / `ModuleDefinition` |
| Safe area, capped content column | `AuthScaffold` pattern, restated for subscription screens |

No new PNG is generated. No `MaterialCommunityIcons`, emoji or SVG substitute is introduced where
an approved PNG exists.

The subscription screens read the *locked* entry-auth palette rather than the module neutrals,
because the brief asks for the soft-mint Entry/Auth look. `entry-auth-tokens.ts` is consumed by
import only — its hash must be unchanged at the end of this phase.

---

## 4. Gaps this phase must close

1. Entitlement domain: plan, billing period, status, provider — normalized internal values.
2. One entitlement service; presentation never touches a store SDK or Supabase directly.
3. Centralized product IDs.
4. A deterministic mock purchase adapter, labelled as mock in development builds only.
5. Seventeen screens, of which twelve are entirely new routes.
6. Family membership: organizer, seats, roles, invitations, six-seat ceiling.
7. Additive database model with RLS — documented and validated, **not applied**.
8. Gating for six paid modules plus paid module AI, with Faith never gated.

---

## 5. Protected-file position

Hashes for all eighteen protected files are recorded in `PHASE_5_PROTECTED_HASHES.md`, taken
before any Phase 5 edit. `src/features/faith/__tests__/protected-files.test.ts` independently
diffs the same files against the branch point on every test run.

Note the four entry screens already carried in that test's `REOPENED_ON_REQUEST` list from the
previous phase (the entry step-dot work). Phase 5 does not touch them.

Expected end state: all eighteen hashes unchanged, and the protection test green.
