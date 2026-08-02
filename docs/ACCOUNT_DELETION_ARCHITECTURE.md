# Account deletion — the required architecture

**Status: not built. Nothing in this repository deletes an account.**

Phase 6C-3A ships a `Delete Account` row that opens an informational sheet and stops. This
document records what a real implementation has to be, so that the deferral is a decision with a
plan behind it rather than an omission somebody later fills in badly.

---

## 1. Why the mobile client cannot do this

Every shortcut available to the app is wrong, and each is wrong in a specific way:

| Shortcut | Why it fails |
|---|---|
| `auth.admin.deleteUser()` from the app | Requires the **service-role key**, which bypasses Row Level Security entirely. Anything in an `EXPO_PUBLIC_*` variable is inlined into the JavaScript bundle and readable by anyone who unzips the APK. A service-role key in a mobile build is a total compromise of every user's data, not just this one's. |
| `delete from profiles` | Removes the name and the onboarding flag while `auth.users` keeps the credential. The account can still sign in, and is now nameless. Worse than not deleting. |
| Deleting the auth user only | Orphans every row that referenced it — future family memberships, subscription records, any module data added later. Some will have `on delete cascade`; assuming all of them do is how a deletion silently keeps data. |
| Signing out and calling it deletion | The account and its data are untouched. This is the deception the informational sheet exists to refuse. |

There is no Edge Function in this project (`supabase/functions` does not exist) and none is deployed
in this phase.

---

## 2. What a correct implementation requires

### 2.1 An authenticated server-side function

A Supabase Edge Function invoked with the caller's own JWT. The function:

1. Verifies the JWT and derives the user id **from the token**, never from the request body. A
   user id in the body is an invitation to delete somebody else's account.
2. Holds the service-role key as a function secret — server side, never shipped.
3. Performs the deletion in one transaction where the storage allows it.

### 2.2 Reauthentication

Deletion is at least as sensitive as a password change, so it takes at least the same proof:
`auth.reauthenticate()` issues a nonce to the confirmed address, and the deletion request carries
it. A session minted 23 hours ago is not, on its own, evidence that the person holding the phone is
the account holder.

### 2.3 An explicit deletion request, confirmed

Two steps, deliberately: a request that states exactly what will be removed and what will not, and
a separate confirmation. The confirmation must name the account (the address) rather than being a
bare "Delete" button, so a mis-tap cannot destroy an account.

A grace period — the request schedules deletion, and any sign-in within N days cancels it — is the
recommended shape. It converts the one irreversible action in the product into a recoverable one
for the case that actually happens, which is regret rather than intent.

### 2.4 Dependency-aware deletion or anonymization

Deletion order matters and is not simply "cascade everything":

- **Delete**: the profile row, device-scoped records, anything holding personal content.
- **Anonymize**: rows another user still needs. A family plan's audit of who invited whom cannot
  keep a departed member's address, and cannot lose the fact that an invitation occurred either.
- **Reassign**: a family *organizer* leaving is not the same as a member leaving. The plan either
  transfers to another member or is closed, and that decision must be made before deletion, not
  discovered by a foreign-key error during it.

Every table added after this document is written must be classified into one of those three before
it ships.

### 2.5 Subscription cancellation guidance

Deleting the account does **not** cancel a store subscription. Apple and Google own that
relationship and neither can be cancelled by a server-side call from us. The flow must therefore
state plainly, before confirmation, that the subscription has to be cancelled separately in the App
Store or Play Store, and link to the store's management screen.

Deleting an account while leaving an active subscription billing is the failure that generates
support load and store complaints.

### 2.6 Audit without retaining deleted personal content

An audit record is required (a deletion happened, when, and by what route) and must not become a
back door to the data just deleted. It holds a non-reversible identifier, a timestamp and an
outcome — never the address, the name or any module content.

### 2.7 Idempotency

The function takes a request identifier and returns the same result for a repeat. A phone that
loses connection after the request is sent and retries must not produce a second deletion attempt
against a half-deleted account.

### 2.8 Failure recovery

A partial deletion is the dangerous state: some data gone, credential intact, user believing they
are deleted. The function must either complete or leave the account in a recoverable, marked state
that a retry can finish. Silent partial success is not an acceptable outcome.

### 2.9 Store-policy compliance

Both stores require in-app account deletion for apps that support in-app account creation. Once the
server side above exists, the in-app entry point becomes a real destructive flow rather than the
informational sheet shipping now. Until then the sheet plus a monitored support address is the
honest position, and it is what this phase ships.

---

## 3. What ships in Phase 6C-3A

- A `Delete Account` row on `/profile/privacy-security`.
- An informational blocking sheet titled **"Account deletion isn't available yet"**.
- Two actions: **Close**, and **Contact Support**, which opens a mail draft to the centralized
  support address from `@shared/config/app-config`.
- No deletion API call of any kind. `privacy-security-source-scan.test.ts` asserts that no source
  file references `auth.admin`, `deleteUser`, `service_role` or a service-role key.
