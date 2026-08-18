import { LOCALE_ALLOW_LIST, SURFACE_ALLOW_LIST } from '../allow-lists.ts';
import {
  CRISIS_GUIDANCE,
  FAMILY_PRIVATE_REFUSAL,
  FINANCE_ADVICE_REFUSAL,
  FINANCE_EDUCATION_QUALIFICATION,
  FINANCE_PRODUCT_REFUSAL,
  HEALTH_ADVICE_REFUSAL,
  NOOR_AI_HANDOFF_PROMPT,
  NOOR_AI_TAGLINE,
  OUT_OF_SCOPE_REFUSAL,
  PRESCRIBED_TREATMENT_REFUSAL,
  PROHIBITED_TOPICS,
} from '../policy-copy.ts';
import { assert, assertEquals } from './assert.ts';

/**
 * The drift guard between this function and the app it speaks for.
 *
 * ── The problem this file solves ─────────────────────────────────────────────
 * §G.1 requires the server's safety wording to come from the policy data already in `src/`, because
 * "Restating the wording in prompt text would create a fourth copy that drifts", and §C.5 requires the surface
 * allow-list to be resolved from the app's routes "so the list cannot drift".
 *
 * Neither is possible by import. The Edge Function is Deno; `src/` is React Native TypeScript behind `@shared/*`
 * and `@ds/*` aliases, and pulling it in would mean an import map, a design-token dependency and a second
 * consumer of the app's module resolution — for two dozen strings and twenty route names.
 *
 * So the drift is caught from the other end: this file reads the `src/` files as **text** and asserts the
 * mirrored values still appear in them. A rule softened in `src/` fails a test in `supabase/functions/`, which
 * is the guarantee §G.1 and §C.5 were both asking for. Nothing in `policy-copy.ts` or `allow-lists.ts` may be
 * edited without editing `src/` first.
 *
 * ── The one normalisation, and why ───────────────────────────────────────────
 * Apostrophes are normalised before comparison. `src/` ships the typographic `’` in user-facing copy and the
 * contract document writes the same sentences with a straight `'`; a scan that treated those as different
 * strings would fail on punctuation while the wording was identical, which is how a drift guard gets deleted
 * for being noisy.
 */

const REPO_ROOT = new URL('../../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function read(...segments: readonly string[]): string {
  return Deno.readTextFileSync(`${REPO_ROOT}/${segments.join('/')}`);
}

/** Straight and typographic apostrophes are the same apostrophe for comparison purposes. */
function normalise(value: string): string {
  return value.replace(/[‘’]/g, "'");
}

const MODULE_AI_POLICY = normalise(read('src', 'features', 'modules', 'module-ai-policy.ts'));
const AI_SCOPE = normalise(read('src', 'shared', 'permissions', 'ai-scope.ts'));

Deno.test('the parity scan is reading the right files', () => {
  // Guard: a mistyped path would make every assertion below vacuous.
  assert(MODULE_AI_POLICY.includes('moduleAIPolicies'), 'module-ai-policy.ts was found');
  assert(AI_SCOPE.includes('prohibitedAITopics'), 'ai-scope.ts was found');
});

// ─────────────────────────────────────────────────────────────────────────────
// §G.1 — the mirrored copy
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§G.1 — every mirrored refusal string still exists verbatim in src/', () => {
  /**
   * §E.1's reason this matters, which is a product reason rather than a hygiene one: using the same string the
   * UI already shows "is what stops the server and the screen from describing two different products".
   */
  const mirrored: Readonly<Record<string, string>> = {
    'noor-ai out-of-scope refusal': OUT_OF_SCOPE_REFUSAL,
    'noor-ai hand-off prompt': NOOR_AI_HANDOFF_PROMPT,
    'noor-ai tagline': NOOR_AI_TAGLINE,
    'health advice refusal': HEALTH_ADVICE_REFUSAL,
    'prescribed treatment refusal': PRESCRIBED_TREATMENT_REFUSAL,
    'crisis guidance': CRISIS_GUIDANCE,
    'finance advice refusal': FINANCE_ADVICE_REFUSAL,
    'finance product refusal': FINANCE_PRODUCT_REFUSAL,
    'finance education qualification': FINANCE_EDUCATION_QUALIFICATION,
    'family private refusal': FAMILY_PRIVATE_REFUSAL,
  };

  for (const [label, value] of Object.entries(mirrored)) {
    assert(
      MODULE_AI_POLICY.includes(normalise(value)),
      `the ${label} no longer matches src/features/modules/module-ai-policy.ts — change src/ first`,
    );
  }
});

Deno.test('§G.2 — the four prohibited topics match prohibitedAITopics exactly', () => {
  /**
   * §G.1: `ai-effective-scope.ts` re-exports `prohibitedAITopics` as `AI_BOUNDARIES` "specifically so the
   * privacy screen and the enforcement cannot disagree. The server becomes a third consumer of the same data."
   *
   * The key set is asserted as well as the values, so adding a fifth topic in `src/` — which §12.2 recommends,
   * for crisis — fails here until the server mirrors it and puts it in the instructions.
   */
  assertEquals(
    Object.keys(PROHIBITED_TOPICS).sort(),
    ['faith', 'family', 'finance', 'health'],
    'the four families §G.2 records; a fifth in src/ must be mirrored here',
  );
  for (const [topic, rule] of Object.entries(PROHIBITED_TOPICS)) {
    assert(
      AI_SCOPE.includes(normalise(rule)),
      `the ${topic} boundary no longer matches ai-scope.ts`,
    );
  }
});

Deno.test('§12.2 — noor-ai still has no crisis rule of its own, so the server’s comes from health', () => {
  /**
   * §12.2 is a recorded contradiction, not a defect to work around: "`moduleAIPolicies['noor-ai'].safetyRules`
   * contains **no crisis rule** — the emergency rule lives only under `health`."
   *
   * This test pins the state §12.2 describes. When the recommended shared constant is added to `src/`, this test
   * fails — which is the right outcome, because the server should then derive the crisis rule from the shared
   * layer rather than from one module's list.
   */
  const noorAISection = MODULE_AI_POLICY.slice(
    MODULE_AI_POLICY.indexOf('const noorAI: ModuleAIPolicy'),
    MODULE_AI_POLICY.indexOf('const faith: ModuleAIPolicy'),
  );
  assert(noorAISection.length > 0, 'the noor-ai policy section was located');
  assertEquals(
    noorAISection.includes(normalise(CRISIS_GUIDANCE)),
    false,
    'if noor-ai has gained a crisis rule, move the server’s source of it and delete this test',
  );
  assert(
    AI_SCOPE.includes('prohibitedAITopics'),
    'and the shared layer still has no crisis entry to use',
  );
  assertEquals(AI_SCOPE.includes('crisis'), false, '§12.2’s recommendation is still open');
});

Deno.test('§E.4 / §12.4 — the shipped grant-request copy is still the thing AI-2 must not say', () => {
  /**
   * §E.4 rejects the shipped `permission-required` wording because it "promises a grant flow that does not
   * exist". This asserts both halves of that premise: the shipped string is still there, and the store still
   * does not exist. If `AI_GRANT_EDITING_AVAILABLE` flips, AI-6 has arrived and §12.4 requires the copy to be
   * swapped back in the same change.
   */
  assert(
    MODULE_AI_POLICY.includes('I need your permission to look at that module first'),
    'the shipped grant-request copy is still in src/',
  );
  const effectiveScope = read('src', 'features', 'profile', 'privacy', 'ai-effective-scope.ts');
  assert(
    /AI_GRANT_EDITING_AVAILABLE = false/.test(effectiveScope),
    '§E.4’s premise still holds: there is no grant store, so a permission prompt would lead nowhere',
  );
  assert(
    /AI_CONVERSATION_STORAGE_EXISTS = false/.test(effectiveScope),
    '§H.5’s premise still holds: nothing persists a conversation',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §C.5 — the closed sets against the app
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§C.5 — every allow-listed surface is a route that exists in the app', () => {
  /**
   * §C.5 asks for the list to be resolved rather than hand-copied "so the list cannot drift". An Edge Function
   * has no build step that can read `src/app/` and must not read the repository at runtime, so the drift is
   * caught here instead: a renamed or deleted route fails this test.
   *
   * The reverse direction is deliberately **not** asserted. §C.5's list is a curated set of AI-relevant
   * surfaces, not every route — `src/app/` holds well over a hundred — and §C.5 makes an unlisted surface
   * degrade safely to `/ai` rather than fail.
   */
  const missing = SURFACE_ALLOW_LIST.filter((surface) => {
    const relative = surface.replace(/^\//, '');
    for (const candidate of [`${relative}.tsx`, `${relative}/index.tsx`]) {
      try {
        return !Deno.statSync(`${REPO_ROOT}/src/app/${candidate}`).isFile;
      } catch {
        continue;
      }
    }
    return true;
  });

  assertEquals(
    missing,
    [],
    'every allow-listed surface must resolve to a real Expo Router route file',
  );
  assertEquals(
    SURFACE_ALLOW_LIST.includes('/ai'),
    true,
    '§C.2 — the default must itself be allow-listed',
  );
});

Deno.test('§C.5 — the locale allow-list matches the app’s SupportedLocale', () => {
  /**
   * §C.5: `locale` "is validated against the languages the app actually ships". The app's list is
   * `SupportedLocale` in the localization provider, so that declaration is the source and this is the check.
   */
  const provider = read('src', 'application', 'providers', 'localization-provider.tsx');
  const declaration = /export type SupportedLocale = ([^;]+);/.exec(provider)?.[1];
  assert(declaration !== undefined, 'SupportedLocale is declared');

  const declared = [...declaration.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]).sort();
  assertEquals([...LOCALE_ALLOW_LIST].sort(), declared, 'the two lists must agree');
  assertEquals(
    LOCALE_ALLOW_LIST.includes('en'),
    true,
    '§C.2 — the default must itself be allow-listed',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The declared configuration
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§K / §12.11 — config.toml declares this function with verify_jwt explicitly true', () => {
  /**
   * §K's AI-2 exit criterion: "`[functions.noor-ai]` declared in `config.toml` with **`verify_jwt = true`
   * explicit**". §D.2 says why explicit rather than defaulted: it must be a version-controlled fact that
   * `config push` can report drift against, not a default someone could change in the dashboard without a diff.
   */
  const config = read('supabase', 'config.toml');
  const section = config.slice(config.indexOf('[functions.noor-ai]'));

  assert(config.includes('[functions.noor-ai]'), 'the function is declared');
  assert(/verify_jwt\s*=\s*true/.test(section), 'with verify_jwt = true, explicitly');
  assertEquals(/verify_jwt\s*=\s*false/.test(config), false, 'and nowhere is it false');
  assertEquals(/--no-verify-jwt/.test(config), false, 'nor is the gate waived');

  // §C.9's split depends on the gate staying on. Nothing else about auth may have been touched by this phase.
  assert(/jwt_expiry = 3600/.test(config), '§D.3’s one-hour window is unchanged');
  assert(/enable_confirmations = false/.test(config), '§12.9’s state is unchanged and still open');
});

Deno.test('the function declares no secret and no import map it does not need', () => {
  const config = read('supabase', 'config.toml');
  const section = config.slice(config.indexOf('[functions.noor-ai]'));
  for (const forbidden of ['OPENAI', 'secret', 'service_role', 'key']) {
    assertEquals(
      new RegExp(forbidden, 'i').test(section),
      false,
      `the function section must not mention ${forbidden}`,
    );
  }
});
