import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AIRequestContext } from '@shared/permissions/ai-scope';

import type { AIAskOrchestrator, AIOrchestrator, AIResult } from '../ai-orchestrator.contract';
import type { NoorAIPort, NoorAIResult } from '../noor-ai.contract';

/**
 * The staged orchestrator boundary.
 *
 * ── What this suite is defending ────────────────────────────────────────────
 * §K assigns AI-4 "an `AIOrchestrator` implementation", and AI-4 cannot implement
 * `confirmAction`: there is no tool that can propose an `AIActionPreview` (§F.4, §A.2), so the
 * method would exist only to fail. The resolution is a **named subset** — `AIAskOrchestrator` —
 * that the adapter genuinely satisfies, rather than a claim that the adapter is unrelated to the
 * orchestrator or a stub that pretends to be the whole of it.
 *
 * That resolution is only worth anything if three things stay true, and each is asserted below
 * rather than described:
 *
 *   1. The adapter really is assignable to the subset — with no cast anywhere.
 *   2. The subset really does exclude `confirmAction`, so nothing was quietly relaxed.
 *   3. The **full** `AIOrchestrator` still requires `confirmAction`, so the security property that
 *      makes an unconfirmed mutation unexpressible is intact and waiting for AI-9.
 *
 * ── Type-level assertions are load-bearing here, not decoration ─────────────
 * `tsconfig.json` includes every `.ts` in the project and `npm run typecheck` runs over this file,
 * so a broken relationship below is a failed build, not just a failed test. The runtime `expect`s
 * exist so Jest reports the suite; the compiler is what actually enforces it.
 */

/** Fails to compile unless `T` is exactly `true`. */
type Expect<T extends true> = T;

/** Exact type equality — invariant, so it will not accept a merely-assignable near-miss. */
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

/**
 * Structural equivalence, in both directions.
 *
 * Used where `Equals` would be the wrong tool: `AIOrchestrator` is written as an intersection so
 * the `ask` signature is declared once, and `Equals` distinguishes `A & B` from the flattened
 * object with the same members even though nothing can tell them apart in use. The claim being
 * made is "no member changed", and mutual assignability is exactly that claim.
 */
type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : false) : false;

/**
 * The same controlled client the behavioural suite uses.
 *
 * The project's shared Jest double serves a healthy signed-in session, which would carry the
 * two-argument call below all the way to an invocation against a client that cannot answer. This
 * suite is about the type relationship, so the client is replaced and the single invocation is
 * answered from a literal — no network, no project, no provider.
 */
const mockAuth = { getSession: jest.fn() };
const mockInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  get supabase() {
    return { auth: mockAuth, functions: { invoke: mockInvoke } };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { noorAIService } = require('../noor-ai.service') as typeof import('../noor-ai.service');

const ROOT = join(__dirname, '..', '..', '..', '..');
const AI_DIR = join(ROOT, 'src', 'services', 'ai');

function strip(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const context: AIRequestContext = {
  scope: { kind: 'noorlife', permittedModules: ['faith'] },
  currentScreen: '/ai',
  grantedModules: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.getSession.mockResolvedValue({
    data: { session: { access_token: 'test-access-token' } },
    error: null,
  });
  mockInvoke.mockResolvedValue({
    data: {
      contract_version: 1,
      request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
      outcome: 'answer',
      answer: { text: 'Open Settings, then Reminders.', sources: [], accessed_modules: [] },
      finish: 'complete',
    },
    error: null,
  });
});

describe('the adapter satisfies the ask-only orchestrator contract', () => {
  it('is assignable to it with no cast, at the declaration and from outside', () => {
    /**
     * The declaration-site half is in `noor-ai.contract.ts`: `NoorAIPort extends
     * AIAskOrchestrator<NoorAIResult>`, which the compiler checks there. This is the outside-in
     * half — a plain annotation, so if the relationship ever broke, this line would stop compiling
     * and no cast could hide it.
     */
    const asAskOrchestrator: AIAskOrchestrator<NoorAIResult> = noorAIService;

    expect(typeof asAskOrchestrator.ask).toBe('function');

    type PortIsAskOrchestrator = Expect<
      NoorAIPort extends AIAskOrchestrator<NoorAIResult> ? true : false
    >;
    const proven: PortIsAskOrchestrator = true;
    expect(proven).toBe(true);
  });

  it('is callable through the contract with the original two arguments', async () => {
    /**
     * The point of the subset is that a consumer holding only `AIAskOrchestrator` sees the
     * signature it has always had. The adapter's third parameter is optional, so a two-argument
     * call is legal — and this proves it by making one and awaiting a real result rather than by
     * inspecting a type.
     *
     * The one-invocation invariant holds through this seam too, which is worth asserting here
     * rather than assuming: routing a call through a narrower interface must not change how many
     * times the function is invoked.
     */
    const orchestrator: AIAskOrchestrator<NoorAIResult> = noorAIService;

    const result = await orchestrator.ask('How do I turn off the Fajr reminder?', context);

    expect(result).toEqual({
      outcome: 'answer',
      answer: { text: 'Open Settings, then Reminders.', finish: 'complete', sources: [] },
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('keeps the ask signature single, so the subset and the full contract cannot drift', () => {
    // `AIOrchestrator` is defined in terms of `AIAskOrchestrator`, so there is one declaration.
    type AskIsShared = Expect<Equals<AIOrchestrator['ask'], AIAskOrchestrator['ask']>>;
    const shared: AskIsShared = true;

    // And the defaulted subset is exactly what `Pick` would have produced from the full contract.
    type SubsetIsThePick = Expect<Equals<AIAskOrchestrator, Pick<AIOrchestrator, 'ask'>>>;
    const isPick: SubsetIsThePick = true;

    expect([shared, isPick]).toEqual([true, true]);
  });
});

describe('the subset is a subset, and the full contract is untouched', () => {
  it('exposes no confirmAction', () => {
    type SubsetKeys = Expect<Equals<keyof AIAskOrchestrator<NoorAIResult>, 'ask'>>;
    const onlyAsk: SubsetKeys = true;

    expect(onlyAsk).toBe(true);
    // Runtime mirror: the adapter itself carries no confirm channel either.
    expect(Object.keys(noorAIService)).toEqual(['ask']);
    expect('confirmAction' in noorAIService).toBe(false);
  });

  it('still requires confirmAction on the full AIOrchestrator', () => {
    const askOnly = {
      ask: async (): Promise<AIResult> => ({
        outcome: 'refused',
        refusal: { kind: 'unavailable' },
      }),
    };

    /**
     * The assertion is the suppression itself. If a future edit made `confirmAction` optional — or
     * removed it — this `@ts-expect-error` would become unused and the build would fail, which is
     * exactly the alarm this phase must leave behind. `confirmAction`'s security property is that
     * an unconfirmed mutation is unexpressible; nothing may relax it to make an adapter fit.
     */
    // @ts-expect-error - an ask-only value must never satisfy the full orchestrator.
    const notAnOrchestrator: AIOrchestrator = askOnly;

    expect(notAnOrchestrator).toBeDefined();
    expect('confirmAction' in askOnly).toBe(false);
  });

  it('still types confirmAction as required, returning the original result type', () => {
    type ConfirmIsRequired = Expect<
      Equals<AIOrchestrator['confirmAction'], (actionId: string) => Promise<AIResult>>
    >;
    const required: ConfirmIsRequired = true;

    // No member of the full contract is optional, so `confirmAction` cannot have become one.
    type ConfirmIsNotOptional = Expect<
      MutuallyAssignable<AIOrchestrator, Required<AIOrchestrator>>
    >;
    const notOptional: ConfirmIsNotOptional = true;

    expect([required, notOptional]).toEqual([true, true]);
  });

  it('leaves the full orchestrator structurally what it always was', () => {
    /**
     * The shape as it stood before the subset was extracted, written out by hand. Mutual
     * assignability against it is what makes "unchanged" a checked claim rather than a promise —
     * a reviewer does not have to diff two revisions to believe the refactor was structural only.
     */
    type OrchestratorAsItWas = {
      readonly ask: (prompt: string, context: AIRequestContext) => Promise<AIResult>;
      readonly confirmAction: (actionId: string) => Promise<AIResult>;
    };

    type Unchanged = Expect<MutuallyAssignable<AIOrchestrator, OrchestratorAsItWas>>;
    const unchanged: Unchanged = true;

    expect(unchanged).toBe(true);
  });
});

describe('the boundary is declared, not merely true by accident', () => {
  /**
   * Why these two exist at all.
   *
   * TypeScript is structural, so `NoorAIPort` would remain assignable to
   * `AIAskOrchestrator<NoorAIResult>` even if the `extends` clause were deleted — every type-level
   * assertion above would still pass. That makes the assertions a check on the *relationship* and
   * not on the *declaration*, and the declaration is the whole point of this correction: a reader
   * of `noor-ai.contract.ts` must be able to see that the adapter implements the orchestrator's ask
   * channel, rather than infer it. A mutation removing the clause was confirmed to survive every
   * other test in this file, which is why these are written against the source text.
   */
  it('declares NoorAIPort as extending the ask-only orchestrator', () => {
    const code = strip(readFileSync(join(AI_DIR, 'noor-ai.contract.ts'), 'utf8'));

    expect(code).toMatch(
      /export interface NoorAIPort extends AIAskOrchestrator<NoorAIResult>\s*\{/,
    );
  });

  it('defines the full orchestrator in terms of the subset, so one signature serves both', () => {
    const code = strip(readFileSync(join(AI_DIR, 'ai-orchestrator.contract.ts'), 'utf8'));

    expect(code).toMatch(/export type AIOrchestrator = AIAskOrchestrator\s*&\s*\{/);
    // Exactly one `ask` declaration in the module: the subset's.
    expect(code.match(/readonly ask:/g) ?? []).toHaveLength(1);
  });
});

describe('conformance is not claimed by a cast', () => {
  it('uses no assertion in either contract module', () => {
    for (const file of ['ai-orchestrator.contract.ts', 'noor-ai.contract.ts']) {
      const code = strip(readFileSync(join(AI_DIR, file), 'utf8'));

      expect({ file, matched: /\bas\s+unknown\s+as\b|\bas\s+any\b|<any>/.test(code) }).toEqual({
        file,
        matched: false,
      });
      expect({ file, matched: /@ts-(ignore|expect-error|nocheck)/.test(code) }).toEqual({
        file,
        matched: false,
      });
    }
  });

  it('exports the adapter under a plain annotation', () => {
    /**
     * `export const noorAIService: NoorAIPort = { ask };` — an annotation the compiler checks, not
     * an assertion that would silence it. The service does contain one narrowing cast for the
     * Supabase functions surface, which is a different question from conformance and is asserted
     * separately in `noor-ai-adapter-guards.test.ts`; what must not exist is a cast on this line.
     */
    const code = strip(readFileSync(join(AI_DIR, 'noor-ai.service.ts'), 'utf8'));
    const declaration = /export const noorAIService[^\n;]*;/.exec(code);

    expect(declaration).not.toBeNull();
    expect(declaration?.[0]).toBe('export const noorAIService: NoorAIPort = { ask };');
  });
});
