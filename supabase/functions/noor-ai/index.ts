import { createNoorAIHandler } from './handler.ts';
import { createProductionDependencies } from './production.ts';

/**
 * `POST /functions/v1/noor-ai` — the production entry point (§C.1).
 *
 * ── What this file is allowed to contain, and what it must not ───────────────
 * A dozen lines of wiring and nothing else. It reads the environment, builds the production dependency
 * graph, and serves the handler. It constructs no provider itself, holds no credential beyond the two
 * secret values it hands straight on, and contains no branch on anything a caller can influence.
 *
 * It reads exactly two secrets, and they are the two that are *handed through* it: the platform-injected
 * service-role key, which reaches `quota-rpc.ts` and nothing else, and the provider key, which reaches
 * `openai-provider.ts` and nothing else. Neither is held by the handler, logged, or returned.
 * `tests/source-scan_test.ts` pins both names to this file by exact equality.
 *
 * B10's HMAC key is the one secret this file deliberately does **not** read. It is not passed through
 * anything — it is read, validated, imported non-extractably and used inside `safety-identifier.ts` —
 * so its name lives there instead, pinned to that one file by the same scan. Splitting it out this way
 * means the module that holds key material is also the module a reviewer reads to see where the key
 * came from, rather than tracing it across two files.
 *
 * In particular there is **no fake provider here and no way to reach one**. `production.ts` is the only
 * module this file imports for dependencies, no request field, header, query parameter or environment
 * flag selects a different one, and there is no environment variable that can retarget the provider
 * origin — it is a literal in the adapter. Test fakes exist solely under `tests/`, are imported by
 * nothing outside `tests/`, and `tests/source-scan_test.ts` asserts both halves of that.
 *
 * ── What this function actually answers today ───────────────────────────────
 * An otherwise valid, authenticated request fails closed with §I.5's stable `503 service_unavailable`,
 * after authentication and validation have both run. It never returns a canned AI answer, and it makes
 * no network call: the kill switch is off, no `OPENAI_API_KEY` exists, and B10's dedicated HMAC secret
 * exists in no environment so no identifier can be derived — any one of the three is sufficient on its
 * own.
 *
 * ── The gateway runs before any of this ─────────────────────────────────────
 * `verify_jwt = true` is declared for this function in `supabase/config.toml`, so per the documentation
 * the platform "inspects the `Authorization` header of every request before your function runs" and on
 * failure "returns a 401 error, and your code never executes". §C.9 records the consequence honestly:
 * NoorLife cannot promise its own error body or its own `request_id` for a request the gateway refuses,
 * and AI-4 must normalise both categories. The handler re-verifies the claims it depends on regardless
 * (§D.2 mechanism 2).
 */

Deno.serve(
  createNoorAIHandler(
    createProductionDependencies({
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      jwks: Deno.env.get('SUPABASE_JWKS'),
      // Read here and handed straight to `production.ts`, which gives it to `quota-rpc.ts` and to
      // nothing else. It is never held by the handler, never logged and never returned.
      serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      /**
       * The provider key. **No such secret exists** — it is set in no environment, and this phase is
       * not authorised to create one — so this read yields `undefined` and the provider refuses.
       *
       * Read here for the same reason as the line above: one place, handed straight on, never held by
       * the handler, never logged, never returned, and never placed in a URL or a request body. Its
       * only destination is the `Authorization` header inside `openai-provider.ts`.
       */
      openaiApiKey: Deno.env.get('OPENAI_API_KEY'),
    }),
  ),
);
