import type { FrameworkModuleId } from '@features/modules/module-tokens';

import type {
  FaithAiQuestion,
  FaithAiReply,
  FaithAiRepository,
  FaithAiTurn,
  FaithQuote,
} from '../faith-ai.repository';
import type { FaithResult } from '../faith-result';
import { MOCK_HADITH_SOURCE, MOCK_SOURCE, delay, matches, nowIso } from './mock-support';

/**
 * Faith AI, as a mock.
 *
 * ── What this actually is ───────────────────────────────────────────────────
 * A keyword classifier over canned replies. It is not an assistant and does not pretend
 * to be one — the screen says so above the conversation. What it *is* is a faithful
 * implementation of the boundary rules, which is the part worth having now: the routing
 * from question to reply variant is the same logic a real backend must apply, and it is
 * unit-testable today.
 *
 * ── Every rule from the phase brief, and where it lives ─────────────────────
 *   "Answer only Faith-module questions"      → `classify` → `out-of-scope` / `refused`
 *   "Never invent or rewrite Quran verses"    → `QUOTES` is the only source of scripture,
 *                                                and it is a frozen constant
 *   "Never present generated text as Quran"   → quotes are a separate field from `answer`
 *   "Require source metadata"                 → `FaithQuote.source` is required
 *   "Display a limitation for rulings"        → `ruling` only ever yields `qualified`
 *   "Handoff only after confirmation"         → `ask` returns an offer; `confirmHandoff`
 *                                                is a separate call
 *   "Never cross into Health, Finance, …"     → `OTHER_MODULE_TERMS` detects and refuses
 */

/**
 * The only scripture this assistant can produce.
 *
 * Frozen so a bug cannot mutate a verse in place, and small so it is auditable by eye. A
 * real implementation must retrieve from `QuranContentRepository` rather than hold its
 * own copy — but the constraint is the same: quotes come from a repository, never from
 * generation.
 */
const QUOTES: Readonly<Record<string, FaithQuote>> = Object.freeze({
  ease: Object.freeze({
    kind: 'quran',
    verbatim: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    reference: 'Surah Ash-Sharh 94:6',
    source: MOCK_SOURCE,
  }),
  consistency: Object.freeze({
    kind: 'hadith',
    verbatim: 'The deeds most beloved to Allah are those done consistently, even if they are few.',
    reference: 'Sahih al-Bukhari 6464',
    source: MOCK_HADITH_SOURCE,
  }),
});

/** Terms that place a question in another module. Ordered most specific first. */
const OTHER_MODULE_TERMS: readonly (readonly [FrameworkModuleId, readonly string[]])[] = [
  [
    'health',
    ['sleep', 'steps', 'calories', 'workout', 'medication', 'doctor', 'symptom', 'weight'],
  ],
  // Stems rather than whole words: `matches` is a substring test, so "spend" also
  // catches "spending" and "spent". Listing only the inflected form is what let
  // "what did I spend on groceries?" fall through to an in-scope answer.
  [
    'finance',
    [
      'budget',
      'spend',
      'spent',
      'salary',
      'invest',
      'zakat calculator',
      'expense',
      'savings',
      'groceries',
    ],
  ],
  ['planner', ['my calendar', 'my tasks', 'schedule a meeting', 'to-do']],
  ['family', ['family event', 'my children', 'shared album']],
  ['learning', ['my course', 'my lesson', 'study plan']],
  ['goals', ['my goals', 'my habits', 'streak']],
];

/** Terms that signal a request for a religious ruling. */
const RULING_TERMS: readonly string[] = [
  'is it haram',
  'is it halal',
  'permissible',
  'allowed to',
  'ruling',
  'fatwa',
  'must i',
  'do i have to',
  'sinful',
];

/** Terms with nothing to do with NoorLife at all. */
const UNRELATED_TERMS: readonly string[] = [
  'weather',
  'football',
  'stock price',
  'write me code',
  'movie',
  'recipe for',
];

const RULING_LIMITATION =
  'Scholars differ on questions like this, and a ruling depends on your circumstances. ' +
  'I can explain what the commonly-cited sources say, but for a decision that applies to ' +
  'you, please ask a qualified scholar.';

export function classifyFaithQuestion(text: string): FaithAiReply {
  const query = text.trim();

  if (query === '') {
    return { kind: 'refused', message: 'Ask me something about your Faith module.' };
  }

  for (const term of UNRELATED_TERMS) {
    if (matches(query, term)) {
      return {
        kind: 'refused',
        message:
          'I only cover the Faith module — prayer, Qur’an, Hadith, duas and your worship record.',
      };
    }
  }

  for (const [moduleId, terms] of OTHER_MODULE_TERMS) {
    for (const term of terms) {
      if (matches(query, term)) {
        return {
          kind: 'out-of-scope',
          message: 'Faith AI only covers your Faith module.',
          targetModule: moduleId,
          handoffPrompt: 'Ask Noor AI instead?',
        };
      }
    }
  }

  for (const term of RULING_TERMS) {
    if (matches(query, term)) {
      return {
        kind: 'qualified',
        topic: 'ruling',
        limitation: RULING_LIMITATION,
        answer:
          'Here is what the commonly-cited sources address on this subject. Treat it as ' +
          'background reading rather than a ruling for your situation.',
        quotes: [QUOTES.consistency!],
      };
    }
  }

  if (matches(query, 'prayer') || matches(query, 'salah') || matches(query, 'next')) {
    return {
      kind: 'answer',
      topic: 'factual',
      answer:
        'Your next prayer is Dhuhr at 12:35 PM, based on the times shown on your Faith home. ' +
        'You can change the calculation method in Faith preferences.',
      quotes: [],
    };
  }

  if (matches(query, 'verse') || matches(query, 'ayah') || matches(query, 'surah')) {
    return {
      kind: 'answer',
      topic: 'explanation',
      answer:
        'This ayah is widely read as a reassurance that relief accompanies hardship rather ' +
        'than merely following it. The wording below is the verse itself.',
      quotes: [QUOTES.ease!],
    };
  }

  if (matches(query, 'week') || matches(query, 'summar') || matches(query, 'progress')) {
    return {
      kind: 'answer',
      topic: 'factual',
      answer:
        'From what you have marked in Today’s Worship, Fajr has been your most consistent ' +
        'prayer and Asr the one most often left unmarked. That is a description of your own ' +
        'record, not a judgement.',
      quotes: [QUOTES.consistency!],
    };
  }

  return {
    kind: 'answer',
    topic: 'explanation',
    answer:
      'I can help with prayer times, Qur’an and Hadith references, duas, and your own ' +
      'worship record. Try one of the suggestions above.',
    quotes: [],
  };
}

const SUGGESTIONS: readonly string[] = [
  'When is my next prayer?',
  'Explain this ayah',
  'Summarise my week',
  'A dua for anxiety',
];

export function createMockFaithAiRepository(): FaithAiRepository {
  // In-memory only. A conversation is not persisted in this phase — there is no approved
  // retention policy for it, and writing one to disk before that exists would be a
  // decision made by omission.
  const turns: FaithAiTurn[] = [];

  return {
    async suggestions(): Promise<FaithResult<readonly string[]>> {
      return delay({ kind: 'ok' as const, data: SUGGESTIONS }, 80);
    },

    async ask(question: FaithAiQuestion): Promise<FaithResult<FaithAiReply>> {
      const reply = classifyFaithQuestion(question.text);
      turns.unshift({
        id: `turn-${turns.length + 1}`,
        question: question.text,
        reply,
        askedAt: nowIso(),
      });
      return delay({ kind: 'ok' as const, data: reply }, 420);
    },

    async confirmHandoff(
      question: FaithAiQuestion,
      targetModule: FrameworkModuleId,
    ): Promise<FaithResult<{ readonly href: string }>> {
      void question;
      void targetModule;
      // Always Noor AI. A module AI hands off to the cross-module assistant, never
      // straight into another module's AI — that would be crossing the boundary with an
      // extra step rather than respecting it.
      return delay({ kind: 'ok' as const, data: { href: '/ai' } }, 120);
    },

    async history(limit = 20): Promise<FaithResult<readonly FaithAiTurn[]>> {
      if (turns.length === 0) {
        return { kind: 'empty' };
      }
      return { kind: 'ok', data: turns.slice(0, limit) };
    },

    async clearHistory(): Promise<FaithResult<null>> {
      turns.length = 0;
      return { kind: 'ok', data: null };
    },
  };
}

export const faithAiSuggestionsForTest = SUGGESTIONS;
export const faithAiQuotesForTest = QUOTES;
