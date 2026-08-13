import type { FrameworkModuleId } from '@features/modules/module-tokens';

import type { ContentSource, FaithResult } from './faith-result';

/**
 * Faith AI.
 *
 * ── The boundary is in the return type, not in a prompt ─────────────────────
 * A system prompt is a request; a type is a constraint. Everything the phase brief
 * requires of Faith AI is expressed below as a shape the implementation cannot avoid
 * producing:
 *
 *   • It cannot answer out of scope, because `FaithAiReply` has an `out-of-scope`
 *     variant that carries the hand-off offer, and the in-scope variant carries no way
 *     to name another module.
 *   • It cannot present generated text as scripture, because `quotes` is a separate
 *     field from `answer`, every quote requires a `ContentSource`, and `answer` is
 *     explicitly documented as the assistant's own words.
 *   • It cannot answer a jurisprudential question without a limitation, because the
 *     `qualified` variant is the only one that may carry `topic: 'ruling'`, and it
 *     requires a `limitation` string.
 *   • It cannot hand off silently, because `out-of-scope` returns an *offer* and the
 *     hand-off itself is a second, separate call the user's tap triggers.
 *
 * ── No backend exists ───────────────────────────────────────────────────────
 * There is no AI provider SDK in this app and no API key. `MockFaithAiRepository`
 * satisfies this interface with canned, clearly-labelled responses so the boundary is
 * reviewable and testable now. When an approved backend exists it replaces the mock
 * through the same DI container, and none of these types change.
 */

/** What kind of question was asked. Drives which reply variant is permitted. */
export type FaithQuestionTopic =
  /** Prayer times, the user's own worship record, app features. */
  | 'factual'
  /** "What does this verse mean?" — permitted, with sources. */
  | 'explanation'
  /** A request for a religious ruling. Always qualified, never answered as fiqh. */
  | 'ruling'
  /** Belongs to another module. */
  | 'other-module'
  /** Nothing to do with NoorLife. */
  | 'unrelated';

/**
 * A quoted piece of religious content.
 *
 * The only way scripture reaches the screen from an AI reply. It is a *reference to
 * repository content*, not free text: `verbatim` must have been read from a repository,
 * and `source` records where. The mock enforces this by only ever quoting from its own
 * fixtures.
 */
export type FaithQuote = {
  readonly kind: 'quran' | 'hadith' | 'dua';
  /** The exact text, unmodified. */
  readonly verbatim: string;
  /** e.g. "Surah Ash-Sharh 94:6". */
  readonly reference: string;
  /** Required. A quote without provenance is not renderable. */
  readonly source: ContentSource;
};

export type FaithAiReply =
  /**
   * An answer within Faith's scope.
   *
   * `answer` is the assistant's own wording and is rendered as such. Any scripture it
   * refers to appears in `quotes`, visually distinct and attributed.
   */
  | {
      readonly kind: 'answer';
      readonly topic: Extract<FaithQuestionTopic, 'factual' | 'explanation'>;
      readonly answer: string;
      readonly quotes: readonly FaithQuote[];
    }
  /**
   * An answer that must carry a stated limitation.
   *
   * The only variant permitted to respond to `ruling`. `limitation` is required and is
   * rendered before the answer, not after it.
   */
  | {
      readonly kind: 'qualified';
      readonly topic: Extract<FaithQuestionTopic, 'ruling' | 'explanation'>;
      readonly limitation: string;
      readonly answer: string;
      readonly quotes: readonly FaithQuote[];
    }
  /**
   * The question belongs to another module.
   *
   * Carries no answer at all — not even a partial one — and offers a hand-off the user
   * must accept. `targetModule` is named so the offer can say where it would go.
   */
  | {
      readonly kind: 'out-of-scope';
      readonly message: string;
      readonly targetModule: FrameworkModuleId | null;
      readonly handoffPrompt: string;
    }
  /** Outside NoorLife entirely. No hand-off, because there is nowhere to hand off to. */
  | {
      readonly kind: 'refused';
      readonly message: string;
    };

/**
 * A verse a question is *about*, as a citation and never as text.
 *
 * ── Why this is two integers ────────────────────────────────────────────────
 * The reader can hand an ayah to the assistant, and what it hands over is the reference. The
 * alternative — passing the Arabic and the translation along with the question — creates a second
 * copy of scripture that arrives with no `ContentSource` behind it, sitting in the same object as
 * the user's free text, indistinguishable in a log from something generated. This shape makes that
 * impossible rather than discouraged: there is no field here a verse could be written into.
 *
 * An implementation that needs the text resolves it from `QuranContentRepository`, which is the
 * approved boundary and the only place a rendering carries its attribution.
 */
export type FaithVerseContext = {
  readonly kind: 'ayah';
  readonly surah: number;
  readonly ayah: number;
};

export type FaithAiQuestion = {
  readonly text: string;
  /** The route the question was asked from, for the audit trail. */
  readonly fromScreen: string;
  /** The verse the question is about, when it was asked from one. A reference, never a quotation. */
  readonly context?: FaithVerseContext;
};

/** One turn in the visible conversation. */
export type FaithAiTurn = {
  readonly id: string;
  readonly question: string;
  readonly reply: FaithAiReply;
  readonly askedAt: string;
};

export type FaithAiRepository = {
  /** Suggested prompts, shown as chips before the first question. */
  suggestions(): Promise<FaithResult<readonly string[]>>;

  ask(question: FaithAiQuestion): Promise<FaithResult<FaithAiReply>>;

  /**
   * Performs a hand-off the user has explicitly accepted.
   *
   * Separate from `ask` on purpose: it is only reachable after an `out-of-scope` reply
   * and a deliberate tap, which is what makes "never crosses on its own" structural.
   */
  confirmHandoff(
    question: FaithAiQuestion,
    targetModule: FrameworkModuleId,
  ): Promise<FaithResult<{ readonly href: string }>>;

  history(limit?: number): Promise<FaithResult<readonly FaithAiTurn[]>>;

  clearHistory(): Promise<FaithResult<null>>;
};
