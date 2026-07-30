import { canAccessModule, type AIRequestContext, type ScopeDecision } from '@shared/permissions/ai-scope';

import type { FrameworkModuleId } from './module-tokens';

/**
 * Module-scoped AI policy.
 *
 * Builds on `@shared/permissions/ai-scope`, which already answers "may this
 * request read that module's data". What that layer does not carry is the *user
 * facing* half of the same rule: what a module AI is called, what it may be asked
 * to do, what it must refuse, and the exact wording shown when it refuses. Those
 * belong together, because a boundary the user never sees explained reads as a bug.
 *
 * No provider SDK is installed and no request leaves the device. This is the
 * policy the future orchestrator must satisfy, expressed as data so it can be
 * unit-tested today and rendered by the module AI screens now.
 *
 * ── The one rule every module AI obeys ──────────────────────────────────────
 * A module AI never silently answers about another module. It states the limit and
 * offers a hand-off to Noor AI, which the user must accept. Widening scope without
 * being asked is the failure mode this file exists to prevent.
 */

/** A capability a module AI may be asked to perform, stated in user-facing terms. */
export type ModuleAICapability = {
  readonly key: string;
  /** Shown as a suggested prompt chip on the module AI screen. */
  readonly label: string;
  /** True when acting on it writes module data, which forces a preview + confirm. */
  readonly mutatesData: boolean;
};

/**
 * A limit the AI must hold, with the wording the user sees.
 *
 * `kind` distinguishes a hard refusal from a permitted answer that must carry a
 * caveat — the two are not interchangeable. Telling a user "I can't discuss that"
 * when the honest answer is "here it is, but it is not regulated advice" is its own
 * kind of failure.
 */
export type ModuleAISafetyRule = {
  readonly kind: 'refuse' | 'qualify';
  /** What triggers the rule, for the orchestrator and for review. */
  readonly subject: string;
  /** Verbatim wording shown to the user. */
  readonly message: string;
};

export type ModuleAIPolicy = {
  readonly moduleId: FrameworkModuleId;
  /** Product name, e.g. "Faith AI". */
  readonly label: string;
  /** One line describing the assistant, shown under its title. */
  readonly tagline: string;
  /** What it can help with. Rendered as suggestion chips. */
  readonly capabilities: readonly ModuleAICapability[];
  /**
   * Persistent notice shown above the conversation, when the module needs one.
   *
   * Health and Finance always do — the disclaimer must be visible before the first
   * question, not produced after a risky answer.
   */
  readonly standingDisclaimer?: string;
  readonly safetyRules: readonly ModuleAISafetyRule[];
  /** Shown when the user asks about another module. */
  readonly outOfScopeMessage: string;
  /** The offer that follows it. Requires the user to accept. */
  readonly handoffPrompt: string;
};

const HANDOFF = 'Ask Noor AI instead?';

/**
 * Noor AI.
 *
 * ── The one policy that is not module-scoped ────────────────────────────────
 * Every other assistant here refuses to leave its module. Noor AI is the opposite: it is the
 * assistant a module AI hands *off* to, so it may reach modules the user has granted. What it
 * is not is a general-purpose chatbot — its subject is NoorLife itself, which is why its
 * reference labels the hero "NoorLife questions only".
 *
 * The scope machinery already models this: `canAccessModule` treats a `noorlife` scope as
 * permitted-if-granted rather than out-of-scope, so an ungranted module returns
 * `permission-required` and Noor AI must ask before reading it.
 */
const noorAI: ModuleAIPolicy = {
  moduleId: 'noor-ai',
  label: 'Noor AI',
  tagline: 'Help with NoorLife — features, your progress and planning.',
  capabilities: [
    { key: 'find-feature', label: 'Find a feature', mutatesData: false },
    { key: 'explain-progress', label: 'Explain my progress', mutatesData: false },
    { key: 'help-plan', label: 'Help me plan', mutatesData: false },
    { key: 'app-settings', label: 'App settings', mutatesData: false },
  ],
  safetyRules: [
    {
      kind: 'refuse',
      subject: 'questions unrelated to NoorLife',
      message: 'I only cover NoorLife — its features, your data in it, and planning with it.',
    },
    {
      kind: 'qualify',
      subject: 'reading a module the user has not granted',
      message: 'I need your permission to look at that module first. Grant access?',
    },
  ],
  outOfScopeMessage: 'Noor AI only covers NoorLife.',
  handoffPrompt: 'Ask about something in NoorLife?',
};

const faith: ModuleAIPolicy = {
  moduleId: 'faith',
  label: 'Faith AI',
  tagline: 'Guidance on prayer, Qur’an and your Faith activity.',
  capabilities: [
    { key: 'prayer-times', label: 'When is my next prayer?', mutatesData: false },
    { key: 'explain-verse', label: 'Explain a verse', mutatesData: false },
    { key: 'summarise-week', label: 'Summarise my week', mutatesData: false },
    { key: 'set-reminder', label: 'Remind me for Fajr', mutatesData: true },
  ],
  safetyRules: [
    {
      kind: 'qualify',
      subject: 'religious rulings',
      message:
        'Scholars differ on this. Here is what the approved sources say, with who holds each view — for a ruling on your situation, please ask a qualified scholar.',
    },
    {
      kind: 'refuse',
      subject: 'declaring another person’s belief invalid',
      message: 'I won’t make judgements about anyone’s faith.',
    },
  ],
  outOfScopeMessage: 'Faith AI only covers your Faith module.',
  handoffPrompt: HANDOFF,
};

const health: ModuleAIPolicy = {
  moduleId: 'health',
  label: 'Health AI',
  tagline: 'Understand your logged activity, sleep and habits.',
  capabilities: [
    { key: 'explain-trend', label: 'Explain my sleep trend', mutatesData: false },
    { key: 'weekly-summary', label: 'Summarise this week', mutatesData: false },
    { key: 'suggest-habit', label: 'Suggest a small change', mutatesData: false },
    { key: 'log-entry', label: 'Log today’s walk', mutatesData: true },
  ],
  standingDisclaimer:
    'Health AI explains what you have logged. It is not a medical service and cannot diagnose.',
  safetyRules: [
    {
      kind: 'refuse',
      subject: 'diagnosis, prescription, or dosage',
      message:
        'I can’t diagnose or advise on medication. Please speak to a doctor or pharmacist about this.',
    },
    {
      kind: 'refuse',
      subject: 'stopping or changing prescribed treatment',
      message: 'Only the clinician who prescribed it should change it. Please contact them.',
    },
    {
      kind: 'refuse',
      // The one case where the app must lead rather than answer.
      subject: 'symptoms suggesting an emergency',
      message:
        'This may need urgent care. Please contact your local emergency number or go to an emergency department now.',
    },
    {
      kind: 'qualify',
      subject: 'general wellbeing suggestions',
      message: 'This is general information, not personal medical advice.',
    },
  ],
  outOfScopeMessage: 'Health AI only covers your Health module.',
  handoffPrompt: HANDOFF,
};

const planner: ModuleAIPolicy = {
  moduleId: 'planner',
  label: 'Plan AI',
  tagline: 'Plan your day, tasks and routines.',
  capabilities: [
    { key: 'plan-day', label: 'Plan my day', mutatesData: false },
    { key: 'find-time', label: 'Find me a free hour', mutatesData: false },
    { key: 'add-task', label: 'Add a task', mutatesData: true },
    { key: 'reschedule', label: 'Move what I missed', mutatesData: true },
  ],
  safetyRules: [
    {
      kind: 'qualify',
      subject: 'changing more than one scheduled item',
      message: 'Here is the full change. Nothing moves until you confirm.',
    },
  ],
  outOfScopeMessage: 'Plan AI only covers your Planner module.',
  handoffPrompt: HANDOFF,
};

const finance: ModuleAIPolicy = {
  moduleId: 'finance',
  label: 'Money AI',
  tagline: 'Understand your spending, budgets and savings goals.',
  capabilities: [
    { key: 'where-money-went', label: 'Where did my money go?', mutatesData: false },
    { key: 'budget-health', label: 'Am I on budget?', mutatesData: false },
    { key: 'explain-term', label: 'Explain a term', mutatesData: false },
    { key: 'set-budget', label: 'Set a budget', mutatesData: true },
  ],
  standingDisclaimer:
    'Money AI is educational. It explains your own numbers and general concepts — it is not regulated financial advice.',
  safetyRules: [
    {
      kind: 'refuse',
      subject: 'investment, tax or legal advice',
      message:
        'I can’t give investment, tax or legal advice. A licensed adviser can look at your circumstances properly.',
    },
    {
      kind: 'refuse',
      subject: 'predicting returns or recommending a product',
      message: 'I won’t forecast returns or recommend a specific product.',
    },
    {
      kind: 'qualify',
      subject: 'explaining a financial concept',
      message: 'This is general education, not a recommendation for your situation.',
    },
  ],
  outOfScopeMessage: 'Money AI only covers your Finance module.',
  handoffPrompt: HANDOFF,
};

const learning: ModuleAIPolicy = {
  moduleId: 'learning',
  label: 'Learn AI',
  tagline: 'Study help across your courses and saved material.',
  capabilities: [
    { key: 'explain-topic', label: 'Explain this topic', mutatesData: false },
    { key: 'quiz-me', label: 'Quiz me', mutatesData: false },
    { key: 'summarise', label: 'Summarise what I saved', mutatesData: false },
    { key: 'plan-study', label: 'Build a study plan', mutatesData: true },
  ],
  safetyRules: [
    {
      kind: 'refuse',
      subject: 'completing graded work to be submitted as the user’s own',
      message: 'I won’t write work you’ll submit as your own. I can explain it or quiz you instead.',
    },
  ],
  outOfScopeMessage: 'Learn AI only covers your Learning module.',
  handoffPrompt: HANDOFF,
};

const family: ModuleAIPolicy = {
  moduleId: 'family',
  label: 'Family AI',
  tagline: 'Coordinate your family’s shared plans and moments.',
  capabilities: [
    { key: 'whats-on', label: 'What’s on this week?', mutatesData: false },
    { key: 'suggest-activity', label: 'Suggest something together', mutatesData: false },
    { key: 'add-event', label: 'Add a family event', mutatesData: true },
  ],
  safetyRules: [
    {
      kind: 'refuse',
      subject: 'revealing a member’s private entry to another member',
      message: 'That entry is private to them. I can ask them to share it with you.',
    },
    {
      kind: 'refuse',
      subject: 'a child’s location or private activity, requested without their consent',
      message: 'I won’t share that without their consent.',
    },
  ],
  outOfScopeMessage: 'Family AI only covers your Family module.',
  handoffPrompt: HANDOFF,
};

const goals: ModuleAIPolicy = {
  moduleId: 'goals',
  label: 'Goal AI',
  tagline: 'Turn intentions into habits you keep.',
  capabilities: [
    { key: 'progress', label: 'How am I doing?', mutatesData: false },
    { key: 'break-down', label: 'Break this goal down', mutatesData: false },
    { key: 'why-stalled', label: 'Why did I stall?', mutatesData: false },
    { key: 'add-goal', label: 'Add a goal', mutatesData: true },
  ],
  safetyRules: [
    {
      kind: 'qualify',
      subject: 'a missed streak',
      message: 'Progress reporting stays factual and never shames a missed day.',
    },
  ],
  outOfScopeMessage: 'Goal AI only covers your Goals module.',
  handoffPrompt: HANDOFF,
};

export const moduleAIPolicies: Readonly<Record<FrameworkModuleId, ModuleAIPolicy>> = {
  'noor-ai': noorAI,
  faith,
  health,
  planner,
  finance,
  learning,
  family,
  goals,
};

/** The request context for a module AI: scoped to its own module, nothing else. */
export function moduleAIRequestContext(
  moduleId: FrameworkModuleId,
  currentScreen: string,
): AIRequestContext {
  return {
    scope: { kind: 'module', moduleId },
    currentScreen,
    // A module AI reads only its own module, so no cross-module grant applies.
    grantedModules: [moduleId],
  };
}

/**
 * What a module AI should say when asked about `targetModule`.
 *
 * Returns `null` when the request is in scope. Otherwise returns the refusal and
 * the hand-off offer, so the caller renders the boundary instead of inventing one.
 */
export function moduleAIBoundaryResponse(
  moduleId: FrameworkModuleId,
  targetModule: FrameworkModuleId,
  currentScreen: string,
): { readonly message: string; readonly handoffPrompt: string } | null {
  const decision: ScopeDecision = canAccessModule(
    moduleAIRequestContext(moduleId, currentScreen),
    targetModule,
  );
  if (decision.allowed) {
    return null;
  }
  const policy = moduleAIPolicies[moduleId];
  return { message: policy.outOfScopeMessage, handoffPrompt: policy.handoffPrompt };
}
