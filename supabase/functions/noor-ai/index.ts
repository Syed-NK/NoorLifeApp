import { createNoorAIHandler } from './handler.ts';
import { createProductionDependencies } from './production.ts';

/**
 * `POST /functions/v1/noor-ai` — the production entry point (§C.1).
 *
 * ── What this file is allowed to contain, and what it must not ───────────────
 * Nine lines of wiring and nothing else. It reads two platform-injected, non-secret environment values,
 * builds the production dependency graph, and serves the handler. It constructs no provider, holds no
 * credential, and contains no branch on anything a caller can influence.
 *
 * In particular there is **no fake provider here and no way to reach one**. `production.ts` is the only
 * module this file imports for dependencies, the only provider in that module is the one that reports
 * itself unavailable, and no request field, header, query parameter or environment flag selects
 * anything else. Test fakes exist solely under `tests/`, are imported by nothing outside `tests/`, and
 * `tests/source-scan_test.ts` asserts both halves of that.
 *
 * ── What AI-2 actually answers ──────────────────────────────────────────────
 * An otherwise valid, authenticated request fails closed with §I.5's stable `503 service_unavailable`,
 * after authentication and validation have both run. It never returns a canned AI answer, and it never
 * calls the network: the only network-shaped thing in the whole graph is JWT verification, and that reads
 * the platform-injected `SUPABASE_JWKS` rather than fetching anything (see `jwt-verifier.ts`).
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
    }),
  ),
);
