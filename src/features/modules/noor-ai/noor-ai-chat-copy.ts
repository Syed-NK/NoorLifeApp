import type { NoorAIFailureState, NoorAIRefusalKind } from '@services/ai/noor-ai.contract';

import type { ModuleStatusTone } from '../components/module-status-banner';

/**
 * Every word the Noor AI conversation surface can show.
 *
 * ── Why the copy is a table and not inline strings ──────────────────────────
 * §I.6 of `docs/NOOR_AI_BACKEND_CONTRACT.md` is the rule this file exists to satisfy:
 * "provider and platform error bodies are never forwarded, wrapped, embedded, or appended". The
 * adapter already makes that structurally true — `NoorAIResult`'s failure outcome carries a single
 * state word and nothing else — and this table is the other half of it. Every sentence a user can
 * read while using Noor AI was written by NoorLife, before any request happened, and is reachable
 * from a tag rather than from a response.
 *
 * That includes the refusal case, which is the one worth stating explicitly. `NoorAIRefusal` does
 * carry an `explanation`, and the contract argues at length that it is safe — it comes from the
 * server's own policy table, not from the model. **This surface does not render it.** Keying the
 * refusal copy off `kind` alone is strictly narrower, it makes "no server-supplied text is
 * displayed" a property a test can assert by rendering rather than a claim about provenance, and
 * it costs nothing today because the two texts say the same thing. If a future phase wants the
 * server's wording on screen, that is a deliberate change with its own review.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No status code, no error code, no exception message, no URL, no host, no project reference, no
 * request id, no provider or platform name, no quota reason, no token or cost figure, and no
 * database, function or configuration terminology. There is no interpolation slot anywhere in this
 * file, so there is nowhere for one of those to be inserted later without a visible diff.
 *
 * ── Localization ────────────────────────────────────────────────────────────
 * English only, as a `*-copy.ts` constant, matching `privacy-security-copy.ts`,
 * `entry-auth-copy.ts` and `profile-copy.ts`. This repository ships no message catalogue —
 * `LocalizationProvider` is a locale/direction boundary, not an i18n implementation — so adding
 * one for this surface would be inventing an architecture the phase was told not to invent. The
 * answer language is still a real locale decision: the screen passes `locale` to the adapter, which
 * puts it on the wire per §C.2.
 */

/** What the screen calls itself, and the standing boundary it states near the composer. */
export const noorAIChatCopy = {
  /** The screen title, in the module header. */
  title: 'Ask Noor AI',

  /**
   * The scope block that sits directly above the composer.
   *
   * §06 of `docs/NOORLIFE_UI_DESIGN_SPEC.md` requires the scope to be shown *near the composer*,
   * and the pill's wording is the specification's own: `NoorLife questions only`.
   */
  scope: {
    heading: 'What Noor AI covers',
    pill: 'NoorLife questions only',
    /**
     * The one sentence that keeps the client's scope honest about what it is.
     *
     * §E.2: "the client's scope objects are UI policy; the server's are authorization." A scope
     * indicator that implied otherwise would be telling the user their device had granted
     * something, which it cannot.
     */
    authority:
      'This is what NoorLife lets you ask about here. What Noor AI will actually answer is decided on the server.',
    /** Rendered when no module has been granted — which is every user, today. */
    noModuleAccess: 'No module access',
    noModuleAccessDetail:
      'Noor AI is not reading your Faith, Health, Planner, Finance, Learning, Family or Goals records. Nothing you have saved in a module is sent with your question.',
    /** The plan-shaped part of the scope, phrased as subjects rather than as data. */
    limitedSubjects:
      'On your current plan Noor AI answers questions about NoorLife itself — finding a feature, your account and what a plan includes.',
    fullSubjects:
      'Your plan covers every NoorLife module, so Noor AI can answer about all of them. It still reads no module records until you grant access, which is not available yet.',
    /**
     * The professional-advice boundary, stated where it is read before a question is asked.
     *
     * Required by `prohibitedAITopics` and §G. Deliberately not softened: the four professions are
     * named, because "general guidance only" is the sort of phrase that reads as a disclaimer and
     * lands as nothing.
     */
    notAnAuthority:
      'Noor AI is not a scholar, imam, doctor, therapist, lawyer or financial adviser. Nothing it says is a religious ruling or professional advice.',
  },

  composer: {
    /** A visible label, because a placeholder is not a label (spec §8). */
    label: 'Your question',
    placeholder: 'Ask about a feature, your account or your plan',
    accessibilityLabel: 'Your question for Noor AI',
    accessibilityHint: 'Noor AI answers questions about NoorLife.',
    submit: 'Send',
    submitAccessibilityLabel: 'Send your question to Noor AI',
    submitHintReady: 'Sends your question once.',
    submitHintDisabled: 'Type a question first.',
    submitHintPending: 'Waiting for an answer. You cannot send another question yet.',
    /**
     * The hint after something went wrong.
     *
     * §I.1 mints a fresh quota request id per handler execution, so a second send is a second
     * request — not a resend of the first. The wording says exactly that and claims nothing about
     * idempotency.
     */
    submitHintAfterFailure: 'Sends your question again as a new request.',
    cancel: 'Stop',
    cancelAccessibilityLabel: 'Stop waiting for this answer',
    pending: 'Noor AI is thinking…',
  },

  /**
   * The local reasons a question cannot be sent.
   *
   * These are the four `buildRequestBody` refuses without an invocation. Saying so here means the
   * user is told why the button is inert instead of pressing it and being answered by a round trip
   * that was never going to succeed.
   */
  draft: {
    blank: 'Type a question before sending.',
    tooLong: 'That question is too long. Please shorten it.',
    unsupportedCharacters:
      'That question contains characters Noor AI cannot read. Please retype it.',
  },

  /**
   * The initial state, before anything has been asked.
   *
   * Written here rather than taken from `moduleRegistry['noor-ai'].stateCopy.empty`, whose body
   * offers "your progress" and "how to plan your week". §12.8 records that both of those need
   * module data AI-1 does not have, and AI-5 "must enable only the capabilities AI-1's server can
   * serve". Inviting a question this build cannot answer is exactly the promise that section warns
   * against.
   */
  empty: {
    title: 'Nothing asked yet',
    body: 'Ask about finding a feature, your account, or what your plan includes. Noor AI answers one question at a time.',
  },

  answer: {
    heading: 'Noor AI',
    /**
     * §C.4's `length` finish reason, in NoorLife's words.
     *
     * The contract's instruction is exact: "the client must say so rather than presenting a
     * truncated answer as finished."
     */
    incomplete:
      'This answer may be incomplete — Noor AI reached its length limit. Try asking something shorter or more specific.',
  },

  /** Shown after every outcome, so the single-turn boundary is never a surprise. */
  singleTurn: 'Noor AI answers one question at a time. Nothing here is saved.',

  /**
   * Policy refusals — a *successful* request whose answer is "no" (§C.4).
   *
   * Kept visually and verbally apart from the failures below. A refusal is Noor AI declining, and
   * "something went wrong" would be a lie about a request that worked exactly as designed.
   */
  refusal: {
    heading: 'Noor AI did not answer that',
    tone: 'info' as ModuleStatusTone,
    kinds: {
      'out-of-scope':
        'That is outside what Noor AI covers. It answers questions about NoorLife — finding a feature, your account, and what your plan includes.',
      'safety-boundary':
        'Noor AI does not answer questions in this area. That is a limit on Noor AI, not a judgement about you or your question.',
      'permission-required':
        'Answering that would need access to a module’s records, and Noor AI has none. Granting module access is not available yet.',
    } satisfies Record<NoorAIRefusalKind, string>,
  },

  /**
   * The ten failure states, each with copy the user can act on and nothing they cannot.
   *
   * `temporarily-unavailable` is the state the current deployment reaches for every valid,
   * authenticated question, because the Edge Function is deployed and source-disabled. The copy is
   * written for that being the ordinary case rather than an emergency.
   */
  failure: {
    heading: 'Noor AI could not answer',
    states: {
      'authentication-required': {
        title: 'Your session has expired',
        body: 'Sign in again to ask Noor AI. Nothing you have saved is affected.',
        tone: 'warning' as ModuleStatusTone,
      },
      'invalid-request': {
        title: 'That question could not be sent',
        body: 'Noor AI could not accept it as written. Please rewrite it and try again.',
        tone: 'warning' as ModuleStatusTone,
      },
      'temporarily-limited': {
        title: 'Noor AI is temporarily limited',
        body: 'Too many questions have been asked in a short time. Please wait a little and ask again.',
        tone: 'warning' as ModuleStatusTone,
      },
      'temporarily-unavailable': {
        title: 'Noor AI is unavailable',
        body: 'Noor AI is not answering questions at the moment. Please try again later.',
        tone: 'warning' as ModuleStatusTone,
      },
      'network-unavailable': {
        title: 'You’re offline',
        body: 'Noor AI needs a connection. Check your internet and ask again.',
        tone: 'warning' as ModuleStatusTone,
      },
      'timed-out': {
        title: 'That took too long',
        body: 'Noor AI did not answer in time. Please ask again.',
        tone: 'warning' as ModuleStatusTone,
      },
      cancelled: {
        title: 'You stopped that request',
        body: 'Your question is still in the box, so you can edit it or send it again. It may already have reached Noor AI.',
        tone: 'info' as ModuleStatusTone,
      },
      'invalid-server-response': {
        title: 'Something went wrong',
        body: 'Noor AI could not complete that. Please try again.',
        tone: 'error' as ModuleStatusTone,
      },
      'not-configured': {
        title: 'Noor AI is unavailable',
        body: 'Noor AI is not available in this version of the app.',
        tone: 'warning' as ModuleStatusTone,
      },
      unknown: {
        title: 'Something went wrong',
        body: 'Noor AI could not answer that. Please try again.',
        tone: 'error' as ModuleStatusTone,
      },
    } satisfies Record<
      NoorAIFailureState,
      { readonly title: string; readonly body: string; readonly tone: ModuleStatusTone }
    >,
    /** The one failure with an action, because it is the one with a remedy the app can perform. */
    signIn: 'Sign in',
  },

  /**
   * `/ai/feedback` — required to exist by `NOORLIFE_PRODUCTION_WORKFLOW.md` §6, and inert.
   *
   * See `noor-ai-feedback-screen.tsx` for why. In short: there is no approved storage, endpoint,
   * privacy classification or retention period for a report, and §H.5 expects a report to carry the
   * §I.7 `request_id` — which the AI-4 adapter deliberately does not expose. Building the screen
   * without any of those would mean either inventing a store or accepting a report and dropping it.
   */
  feedback: {
    title: 'Report an answer',
    heading: 'Reporting is not available yet',
    body: 'There is nowhere for a report to go. Noor AI does not keep your questions or its answers, so there is no saved answer to attach a report to.',
    detail:
      'When reporting arrives, NoorLife will say first what a report contains, where it is stored and how long it is kept. Until then this screen does nothing, and nothing you type here would be sent.',
    back: 'Back to Noor AI',
  },
} as const;
