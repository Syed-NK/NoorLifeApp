import { createQuranContentHandler } from './handler.ts';
import { createProductionDependencies } from './production.ts';

/**
 * `POST /functions/v1/quran-content` — the production entry point.
 *
 * ── What this file is allowed to contain ─────────────────────────────────────
 * A dozen lines of wiring and nothing else. It reads the environment, builds the production
 * dependency graph, and serves the handler. It constructs no client itself, holds no credential
 * beyond the two values it hands straight on, and contains no branch on anything a caller can
 * influence.
 *
 * It reads exactly four environment variables and **two of them are secrets**: the Quran Foundation
 * client id and client secret, which reach `token-store.ts` by way of `production.ts` and reach
 * nothing else. Neither is held by the handler, logged, or returned.
 * `tests/source-scan_test.ts` pins both names to this file by exact equality, so a second module
 * gaining a read of either fails a test.
 *
 * ── This file is the source of truth for the deployed function ───────────────
 * A `quran-content` function was created in the Supabase dashboard as a temporary connectivity check
 * and proved that the credentials work against `/content/api/v4/chapters`. It is superseded by this
 * directory. The dashboard copy has no tests, no allow-list, no input validation, no normalisation
 * and no source scan; nothing in this repository depends on it, and redeploying from here replaces
 * it. Deployment is a separate, explicitly authorised step — this work performs none.
 *
 * ── The gateway runs before any of this ──────────────────────────────────────
 * `verify_jwt = true` is declared for this function in `supabase/config.toml`, so the platform
 * inspects the `Authorization` header of every request before this function runs and, on failure,
 * returns a `401` without this code executing. NoorLife therefore cannot promise its own error body
 * or its own `request_id` for a request the gateway refuses, and the mobile adapter normalises both
 * categories. The handler re-verifies the claims it depends on regardless.
 *
 * ── What it answers with no secrets set ──────────────────────────────────────
 * An otherwise valid, authenticated request fails closed with `503 service_unavailable` after
 * authentication and validation have both run, and **no outbound request is made at all** — the
 * client that can only report `unconfigured` is constructed before any transport exists. It never
 * returns sample scripture, because there is none in this module graph to return.
 */

Deno.serve(
  createQuranContentHandler(
    createProductionDependencies({
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      jwks: Deno.env.get('SUPABASE_JWKS'),
      /**
       * The Quran Foundation client id. Read here and handed straight to `production.ts`, which gives
       * it to `quran-foundation-client.ts` and to nothing else. It is never held by the handler,
       * never logged and never returned. Half a Basic credential is still a credential.
       */
      qfClientId: Deno.env.get('QF_CLIENT_ID'),
      /**
       * The Quran Foundation client secret. Same path, same rules, and one further constraint: its
       * only destination is the `Authorization` header of the token exchange inside
       * `token-store.ts`. It is never placed in a URL, a request body, a response, a log line or an
       * error message, and no value for it exists anywhere in this repository.
       */
      qfClientSecret: Deno.env.get('QF_CLIENT_SECRET'),
    }),
  ),
);
