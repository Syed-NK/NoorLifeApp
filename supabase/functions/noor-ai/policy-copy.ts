/**
 * The refusal wording, mirrored from the repository's policy data.
 *
 * ── Why this file is a mirror and not a source ───────────────────────────────
 * §G.1 is emphatic that the safety rules are "not authored here": they are already data in
 * `src/shared/permissions/ai-scope.ts` (`prohibitedAITopics`) and
 * `src/features/modules/module-ai-policy.ts` (`safetyRules`), and `ai-effective-scope.ts` re-exports
 * the former as `AI_BOUNDARIES` precisely so the privacy screen and the enforcement cannot disagree.
 * "Restating the wording in prompt text would create a fourth copy that drifts."
 *
 * The Edge Function cannot import those modules. They are React Native TypeScript behind `@shared/*`
 * and `@ds/*` path aliases, and pulling them into Deno would mean an import map, a design-token
 * dependency and a second consumer of the app's module resolution — for two dozen strings.
 *
 * So the strings are mirrored here and the drift is caught by test instead of by import:
 * `tests/repo-parity_test.ts` reads both source files as text and asserts every string below appears
 * in them verbatim. A rule softened in `src/` fails a test in `supabase/functions/`, which is the
 * guarantee §G.1 was asking for. Nothing in this file may be edited without editing `src/` first.
 *
 * ── The two strings that are *not* mirrored, and why ─────────────────────────
 * `MODULE_DATA_REFUSAL` and `CITATION_REFUSAL` have no counterpart in `src/`, and both are flagged
 * for product sign-off rather than presented as settled copy:
 *
 *   • §E.4 and §12.4 record that the shipped `permission-required` copy — "I need your permission to
 *     look at that module first. Grant access?" — promises a grant flow that does not exist
 *     (`AI_GRANT_EDITING_AVAILABLE` is `false`, there is no grant store), and that the honest AI-2
 *     answer is "I can’t reach your module data yet." §12.4 states the exact wording needs product
 *     sign-off and that AI-6 must swap it back in the same change that makes granting possible.
 *   • §G.5 forbids substantive religious content in AI-2 because §07 requires citations and there is
 *     no approved-source retrieval layer. `moduleAIPolicies.faith.safetyRules[0]` is the wording for
 *     when retrieval *exists* — it promises "what the approved sources say" — so using it now would
 *     promise a citation the function cannot produce. This string is new for the same reason the
 *     module-data one is, and carries the same open sign-off.
 */

/**
 * `moduleAIPolicies['noor-ai'].safetyRules[0].message`.
 *
 * §E.1: the server refuses an unrelated question with this string verbatim, because "using the same
 * string the UI already shows is not tidiness — it is what stops the server and the screen from
 * describing two different products".
 */
export const OUT_OF_SCOPE_REFUSAL =
  'I only cover NoorLife — its features, your data in it, and planning with it.';

/** `moduleAIPolicies['noor-ai'].handoffPrompt` — §G.8's onward route for a scope refusal. */
export const NOOR_AI_HANDOFF_PROMPT = 'Ask about something in NoorLife?';

/** `moduleAIPolicies.health.safetyRules[0].message` — §G.3. */
export const HEALTH_ADVICE_REFUSAL =
  'I can’t diagnose or advise on medication. Please speak to a doctor or pharmacist about this.';

/** `moduleAIPolicies.health.safetyRules[1].message` — §G.3. */
export const PRESCRIBED_TREATMENT_REFUSAL =
  'Only the clinician who prescribed it should change it. Please contact them.';

/**
 * `moduleAIPolicies.health.safetyRules[2].message` — §G.7.
 *
 * The one case where the product must lead rather than answer. §G.7 sets four constraints this string
 * satisfies and the handler must not break: it is said **first and alone**, it does not diagnose or
 * triage, it does not claim NoorLife has contacted anyone, and it invents no phone number — "the
 * server does not reliably know the user's country, and a wrong emergency number is worse than none".
 *
 * §12.2 records that `moduleAIPolicies['noor-ai'].safetyRules` contains no crisis rule at all, so this
 * is the only such copy in the codebase and it lives under `health`. The recommendation there is to
 * move it to a shared constant; that is a `src/` change and is reported rather than made here.
 */
export const CRISIS_GUIDANCE =
  'This may need urgent care. Please contact your local emergency number or go to an emergency department now.';

/** `moduleAIPolicies.finance.safetyRules[0].message` — §G.4. */
export const FINANCE_ADVICE_REFUSAL =
  'I can’t give investment, tax or legal advice. A licensed adviser can look at your circumstances properly.';

/** `moduleAIPolicies.finance.safetyRules[1].message` — §G.4. */
export const FINANCE_PRODUCT_REFUSAL = 'I won’t forecast returns or recommend a specific product.';

/**
 * `moduleAIPolicies.finance.safetyRules[2].message` — §G.4, kind `qualify`, **not** `refuse`.
 *
 * §G.4 states the distinction is load-bearing and the server must preserve it: "telling a user 'I
 * can't discuss that' when the honest answer is 'here it is, but it is not regulated advice' is its
 * own kind of failure. Over-refusal is a defect, not extra safety." So this one string is appended to
 * an answer rather than replacing it.
 */
export const FINANCE_EDUCATION_QUALIFICATION =
  'This is general education, not a recommendation for your situation.';

/** `moduleAIPolicies.family.safetyRules[0].message` — §G.6. */
export const FAMILY_PRIVATE_REFUSAL =
  'That entry is private to them. I can ask them to share it with you.';

/**
 * §E.4's honest AI-2 answer. **Product sign-off open — §12.4.**
 *
 * Carried on refusal kind `permission-required`, which §E.4 chooses as "the closest existing
 * `AIRefusal` kind, so no client type changes", while the wording tells the truth: there is nothing to
 * grant access to yet, because `PRE_RELEASE_BACKLOG.md` §4.1 records that no module tables exist.
 */
export const MODULE_DATA_REFUSAL =
  'I can’t reach your module data yet. I can show you where a module’s features are instead.';

/**
 * §G.5's AI-2 position. **Product sign-off open — see the file note.**
 *
 * §J.10b's required outcome is "no scripture quoted; `sources` is `[]`; the answer points at the Faith
 * module instead", and this string is the second and third of those. The first is guaranteed by the
 * handler refusing any provider answer that asserts or needs a citation, rather than by inspecting the
 * text for scripture.
 */
export const CITATION_REFUSAL =
  'I can’t quote or interpret scripture yet — NoorLife has no approved source for me to cite. I can show you where the Faith module’s features are.';

/**
 * `prohibitedAITopics`, verbatim — §G.2.
 *
 * Mirrored as an object rather than four loose strings because §G.1 requires the server's instruction
 * text to be *derived* from the shared policy rather than retyped, and `buildInstructions` in
 * `policy.ts` iterates this. A rule added to `prohibitedAITopics` in `src/` therefore appears in the
 * server instructions as soon as it is mirrored here, and the parity test fails until it is.
 */
export const PROHIBITED_TOPICS: Readonly<Record<string, string>> = {
  health: 'Must not diagnose, prescribe, or replace a clinician.',
  finance: 'Must not provide investment, tax, or legal advice, or promise returns.',
  faith: 'Must cite approved sources and must not present disputed opinions as universal facts.',
  family: "Must not surface a child's private entry to another member without explicit consent.",
};

/** `moduleAIPolicies['noor-ai'].tagline` — used in the instruction text's statement of subject. */
export const NOOR_AI_TAGLINE = 'Help with NoorLife — features, your progress and planning.';
