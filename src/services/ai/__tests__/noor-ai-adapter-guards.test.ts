import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  NOOR_AI_CLIENT_TIMEOUT_MS,
  NOOR_AI_CONTRACT_VERSION,
  NOOR_AI_MAX_BODY_BYTES,
  NOOR_AI_MAX_MESSAGE_CODE_POINTS,
  NOOR_AI_ONE_INVOCATION_INVARIANT,
  NOOR_AI_REQUEST_FIELDS,
  NOOR_AI_SURFACE_ALLOW_LIST,
} from '../noor-ai.contract';

/**
 * Source-level guards for the Noor AI mobile adapter.
 *
 * ── Why these are read as text ──────────────────────────────────────────────
 * `noor-ai.service.test.ts` drives the adapter and proves what it does. These assert what it
 * *cannot* do, which is a different kind of claim: a behavioural test can only show that the two
 * invocations did not happen on the paths it thought to try, and cannot show that no second
 * invocation exists at all. Reading the committed source closes that gap and catches the future
 * edit — a helpful retry, a debug log, a direct fetch — that a runtime test against a mock would
 * never see. It is the same technique `supabase-security.test.ts` uses for the secret boundary.
 *
 * ── Comments are stripped before every source assertion ─────────────────────
 * A file that documents "this must never call a provider endpoint" contains that endpoint's name,
 * and a guard that matched it would fail for the wrong reason — or, worse, a guard written to
 * accommodate it would pass on a file that had grown a real one. Every assertion below runs against
 * executable text only.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const AI_DIR = join(ROOT, 'src', 'services', 'ai');
const SERVICE = join(AI_DIR, 'noor-ai.service.ts');
const CONTRACT = join(AI_DIR, 'noor-ai.contract.ts');
const FUNCTION_DIR = join(ROOT, 'supabase', 'functions', 'noor-ai');

/** Removes block and line comments, so every assertion below is about code. */
function strip(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readCode(path: string): string {
  return strip(readFileSync(path, 'utf8'));
}

/** The adapter's own shipped source: the two modules a build actually bundles. */
const shipped = [SERVICE, CONTRACT].map((path) => ({ path, code: readCode(path) }));

describe('the adapter holds no credential and reaches no provider', () => {
  it('names no service-role secret and no admin access path', () => {
    for (const { path, code } of shipped) {
      expect({ path, matched: /service_role|serviceRole|SERVICE_ROLE/.test(code) }).toEqual({
        path,
        matched: false,
      });
      expect(/supabaseAdmin|createAdminClient|auth\s*\.\s*admin/.test(code)).toBe(false);
    }
  });

  it('names no provider key, host, endpoint or SDK', () => {
    /**
     * The negative control for this assertion is the pattern itself: it is written here, in a test
     * file, which is precisely why the repository's shipped-source scans exclude `__tests__`. The
     * strings below exist in this file and must exist in no adapter module.
     */
    for (const { path, code } of shipped) {
      expect({
        path,
        matched:
          /OPENAI_API_KEY|OPENAI_ORG|OPENAI_PROJECT|OPENAI_BASE_URL|api\.openai\.com|\/v1\/responses|from\s+['"](npm:)?openai|@ai-sdk|langchain/i.test(
            code,
          ),
      }).toEqual({ path, matched: false });
    }
  });

  it('names no signing secret and performs no key import or signature', () => {
    for (const { path, code } of shipped) {
      expect({
        path,
        matched: /importKey|subtle\s*\.\s*sign|createHmac|\bHMAC\b/i.test(code),
      }).toEqual({ path, matched: false });
    }
  });

  it('embeds no credential-shaped literal, comments included', () => {
    // No comment stripping: a key pasted into a comment is committed key material.
    for (const path of [SERVICE, CONTRACT]) {
      const raw = readFileSync(path, 'utf8');
      expect(raw).not.toMatch(/sb_secret_[A-Za-z0-9]{20,}|sbp_[A-Za-z0-9]{20,}/);
      expect(raw).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
      expect(raw).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    }
  });

  it('opens no connection of its own, and builds no URL', () => {
    /**
     * The adapter names a **function**, not an address. Everything about where that function lives
     * — the project origin, the `/functions/v1/` prefix, the region parameter — belongs to the
     * shared client, which is what makes "no provider endpoint is called from mobile source" true
     * by construction rather than by inspection.
     */
    for (const { path, code } of shipped) {
      expect({
        path,
        matched: /\bfetch\s*\(|XMLHttpRequest|WebSocket|new\s+URL\s*\(|https?:\/\//.test(code),
      }).toEqual({ path, matched: false });
    }
  });

  it('creates no Supabase client of its own', () => {
    // The shared client in `@/lib/supabase` is suitable, and a second one is a second auth state.
    for (const { path, code } of shipped) {
      expect({ path, matched: /createClient\s*\(/.test(code) }).toEqual({ path, matched: false });
    }
    expect(readCode(SERVICE)).toContain("from '@/lib/supabase'");
  });
});

describe('the adapter accepts no privileged input from its caller', () => {
  it('declares no caller-controlled identity, model, endpoint or provider configuration', () => {
    const code = readCode(CONTRACT);
    /**
     * §C.6's forbidden inputs, checked against the type declarations rather than a request body.
     * A field that cannot be declared cannot be sent, cannot be defaulted and cannot be forgotten
     * about — which is a stronger guarantee than a runtime filter, and the reason these are types.
     */
    for (const forbidden of [
      'userId',
      'user_id',
      'accountId',
      'accessToken',
      'access_token',
      'authorization',
      'apiKey',
      'apikey',
      'model',
      'endpoint',
      'baseUrl',
      'temperature',
      'maxOutputTokens',
      'max_output_tokens',
      'store',
      'stream',
      'previousResponseId',
      'conversationId',
      'clientRequestId',
      'client_request_id',
      'quotaRequestId',
      'requestId',
      'request_id',
      'history',
      'messages',
      'conversation_id',
      'conversationId',
      'attachments',
      'files',
      'images',
      'tools',
      'toolChoice',
      'scope',
      'grantedModules',
      'permittedModules',
      'accessedModules',
    ]) {
      expect({
        forbidden,
        declared: new RegExp(`\\b${forbidden}\\s*[?]?\\s*:`).test(code),
      }).toEqual({ forbidden, declared: false });
    }
  });

  it('introduces no persistence, no table read and no module dependency', () => {
    /**
     * §H.5 — conversation persistence is deferred, with its own review. The adapter therefore has
     * nowhere to write a question or an answer: no storage module is imported, no Postgres table is
     * selected from, and no module repository or sibling service is reached. `/ai/history` is a
     * route in the surface allow-list and is deliberately not matched here — a route name is not a
     * store, and a guard that conflated them would have to be loosened to pass, which is how a
     * guard stops guarding.
     */
    for (const { path, code } of shipped) {
      expect({
        path,
        matched:
          /AsyncStorage|SecureStore|MMKV|localStorage|ModuleRepository|\.from\s*\(|\.insert\s*\(|\.upsert\s*\(/.test(
            code,
          ),
      }).toEqual({ path, matched: false });
      // The only cross-layer imports are the shared client, the local policy type and the locale type.
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      expect(imports.length).toBeGreaterThan(0);
      for (const source of imports) {
        expect([
          '@/lib/supabase',
          '@application/providers/localization-provider',
          '@shared/permissions/ai-scope',
          './ai-orchestrator.contract',
          './noor-ai.contract',
        ]).toContain(source);
      }
    }
  });

  it('reaches no quota store, private schema or database identifier', () => {
    // The quota wrappers are executable by the elevated server-side role alone; the app names none.
    for (const path of [SERVICE, CONTRACT]) {
      const raw = readFileSync(path, 'utf8');
      expect(raw).not.toMatch(/noor_ai_reserve|noor_ai_register_attempt|noor_ai_finalize/);
      expect(raw).not.toMatch(/noor_ai_release|noor_ai_status/);
      expect(raw).not.toMatch(/\brpc\s*\(/);
    }
  });

  it('holds no identifier derivation of any kind', () => {
    for (const { path, code } of shipped) {
      expect({
        path,
        matched: /safety_identifier|safetyIdentifier|nl_osi_|NOOR_AI_SAFETY/i.test(code),
      }).toEqual({ path, matched: false });
    }
  });
});

describe('exactly one invocation, guaranteed structurally', () => {
  const code = readCode(SERVICE);

  it('contains exactly one invocation call site', () => {
    /**
     * The structural half of `NOOR_AI_ONE_INVOCATION_INVARIANT`. A behavioural test shows the paths
     * it drove invoked once; this shows there is only one place that could invoke at all, so a
     * second call site added on a path nobody thought to test is a failing test rather than a
     * silent second charge.
     */
    const callSites = code.match(/\.invoke\s*\(/g) ?? [];
    expect(callSites).toHaveLength(1);
    expect(NOOR_AI_ONE_INVOCATION_INVARIANT).toContain('no automatic retry');
  });

  it('wraps that call site in no loop and no retry construct', () => {
    expect(code).not.toMatch(/\bwhile\s*\(/);
    expect(code).not.toMatch(/\bdo\s*\{/);
    expect(code).not.toMatch(/\bretry|\bbackoff|\battempt\s*[0-9+]|setTimeout|setInterval/i);
    // A recursive `ask` would be a retry the call-site count cannot see.
    const askBody = code.slice(code.indexOf('async function ask('));
    expect(askBody.match(/\bask\s*\(/g) ?? []).toHaveLength(1);
  });

  it('reads the session exactly once and refreshes nothing', () => {
    expect(code.match(/getSession\s*\(/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/refreshSession|setSession|signIn|signOut|exchangeCodeForSession/);
  });

  it('does not bypass or reconfigure the platform JWT check', () => {
    for (const { path, code: source } of shipped) {
      expect({ path, matched: /verify_jwt|verifyJwt|no-verify-jwt/i.test(source) }).toEqual({
        path,
        matched: false,
      });
    }
  });
});

describe('the adapter logs nothing', () => {
  it('contains no console call and no analytics or telemetry hook', () => {
    for (const { path, code } of shipped) {
      expect({ path, matched: /console\s*\.\s*[a-z]+\s*\(/.test(code) }).toEqual({
        path,
        matched: false,
      });
      expect(/analytics|telemetry|track\s*\(|captureException|Sentry|reportError/i.test(code)).toBe(
        false,
      );
    }
  });

  it('never throws, so no caught value can leave through an exception', () => {
    /**
     * The classification is returned as a tag. A `throw` would carry a platform or provider message
     * out of the adapter through a channel the result type cannot police, and a caller catching it
     * would be catching text this contract promised never to produce.
     */
    expect(readCode(SERVICE)).not.toMatch(/\bthrow\b/);
  });

  it('gives the failure outcome no field that could hold free text', () => {
    /**
     * The type-level half of §I.6. `noor-ai.service.test.ts` asserts that a returned failure has
     * exactly two keys; this asserts that a third could not be added without editing the union, so
     * a `message`, a `detail`, a `cause` or an "error reference" cannot arrive by accident.
     */
    const failedVariant = /\{ readonly outcome: 'failed';([^}]*)\}/.exec(readCode(CONTRACT));
    expect(failedVariant).not.toBeNull();

    const members = [...(failedVariant?.[1] ?? '').matchAll(/readonly\s+([A-Za-z_]+)\s*:/g)].map(
      (match) => match[1],
    );
    expect(members).toEqual(['failure']);
  });
});

describe('the mirrored contract values match the committed Edge Function', () => {
  const contractSource = readFileSync(join(FUNCTION_DIR, 'contract.ts'), 'utf8');
  const allowLists = readFileSync(join(FUNCTION_DIR, 'allow-lists.ts'), 'utf8');

  /** Reads an exported numeric constant from the Edge Function's own source. */
  function serverNumber(name: string): number {
    const match = new RegExp(`export const ${name} = ([0-9_]+);`).exec(contractSource);
    expect(match).not.toBeNull();
    return Number((match?.[1] ?? '').replace(/_/g, ''));
  }

  it('uses the server’s contract version, message limit and body cap', () => {
    expect(NOOR_AI_CONTRACT_VERSION).toBe(serverNumber('CONTRACT_VERSION'));
    expect(NOOR_AI_MAX_MESSAGE_CODE_POINTS).toBe(serverNumber('MAX_MESSAGE_CODE_POINTS'));
    expect(NOOR_AI_MAX_BODY_BYTES).toBe(serverNumber('MAX_BODY_BYTES'));
  });

  it('sends only the fields the server accepts', () => {
    const declared = /export const ACCEPTED_REQUEST_FIELDS = \[([^\]]*)\]/.exec(contractSource);
    expect(declared).not.toBeNull();
    const serverFields = [...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();

    expect([...NOOR_AI_REQUEST_FIELDS].sort()).toEqual(serverFields);
  });

  it('mirrors the surface allow-list exactly', () => {
    const declared = /export const SURFACE_ALLOW_LIST: readonly string\[\] = \[([^\]]*)\]/.exec(
      allowLists,
    );
    expect(declared).not.toBeNull();
    const serverSurfaces = [...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect([...NOOR_AI_SURFACE_ALLOW_LIST]).toEqual(serverSurfaces);
  });

  it('keeps the client deadline above the committed handler budget', () => {
    /**
     * §F.7 — the server owns the deadline. A client that gave up first would abandon a request the
     * server is still completing, and because the adapter may not retry, the user would be left
     * with a timeout for a question that was answered.
     */
    const budget = /handlerBudgetMs:\s*([0-9_]+)/.exec(
      readFileSync(join(FUNCTION_DIR, 'production.ts'), 'utf8'),
    );
    expect(budget).not.toBeNull();
    expect(NOOR_AI_CLIENT_TIMEOUT_MS).toBeGreaterThan(
      Number((budget?.[1] ?? '0').replace(/_/g, '')),
    );
  });
});

describe('the Edge Function kill switch is untouched by this phase', () => {
  it('is still the literal false, and still a source constant', () => {
    /**
     * Asserted here as well as in `supabase-security.test.ts` because AI-4 is the phase with a
     * motive to change it: an adapter is easier to demonstrate against a function that answers. It
     * does not answer, this phase did not enable it, and the deployed function stays source-disabled.
     */
    const wiring = strip(readFileSync(join(FUNCTION_DIR, 'production.ts'), 'utf8'));
    expect(wiring).toMatch(/enabled:\s*false\s*,/);
    expect(wiring).not.toMatch(/enabled:\s*true/);
    expect(wiring).not.toMatch(/enabled:\s*[^,]*Deno\.env/);
  });

  it('leaves provider reach in exactly one server-side module', () => {
    const named = readdirSync(FUNCTION_DIR)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /api\.openai\.com/.test(strip(readFileSync(join(FUNCTION_DIR, file), 'utf8'))),
      );

    expect(named).toEqual(['openai-provider.ts']);
  });
});
