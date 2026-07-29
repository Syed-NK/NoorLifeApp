# Service layer

Interfaces only in Phase 1.

Workflow §16 defines the service architecture: UI → view models → domain
repositories → services. Phase 1 builds the foundation and one proof screen, and
explicitly forbids connecting a backend, adding Firebase/Supabase, or adding an AI
provider SDK. **No secret of any kind may exist in the mobile application.**

So each folder here holds a typed contract and nothing else. The Main Home proof
screen resolves its data from `src/mocks/`, not from these services — deliberately,
so the mock path and the service path stay visibly separate and the mock cannot
quietly become the implementation.

| Folder | Contract | Phase |
|---|---|---|
| `api/` | HTTP transport, error envelope | 2 |
| `auth/` | Sign-in/out, session refresh, secure token storage | 2 |
| `ai/` | AI orchestrator; consumes `shared/permissions/ai-scope.ts` | 4 |
| `notifications/` | Registration, categories, quiet hours | 5 |
| `storage/` | Encrypted local cache, onboarding persistence | 2 |
| `analytics/` | Event contract; must exclude sensitive content | 5 |

Two constraints are structural rather than advisory:

- **No key in the client.** The AI orchestrator contract takes a server endpoint,
  never a provider key. Any design that would need a key on device is wrong.
- **Confirmation before mutation.** `shared/permissions/ai-scope.ts` already
  encodes that a data-changing AI action requires a preview and explicit
  confirmation. The `ai/` implementation must honour it, not re-decide it.
