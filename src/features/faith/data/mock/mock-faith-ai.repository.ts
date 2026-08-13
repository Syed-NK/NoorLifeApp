import type { FrameworkModuleId } from '@features/modules/module-tokens';

import type {
  FaithAiQuestion,
  FaithAiReply,
  FaithAiRepository,
  FaithAiTurn,
  FaithQuote,
} from '../faith-ai.repository';
import type { FaithResult } from '../faith-result';
import { delay, matches, nowIso } from './mock-support';

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
 *   "Never invent or rewrite Quran verses"    → no reply carries a quote at all; there is no
 *                                                scripture literal in this file
 *   "Never present generated text as Quran"   → quotes are a separate field from `answer`, and it
 *                                                is always empty here
 *   "Require source metadata"                 → `FaithQuote.source` is required, so an unsourced
 *                                                quote cannot be constructed even by mistake
 *   "Display a limitation for rulings"        → `ruling` only ever yields `qualified`
 *   "Handoff only after confirmation"         → `ask` returns an offer; `confirmHandoff`
 *                                                is a separate call
 *   "Never cross into Health, Finance, …"     → `OTHER_MODULE_TERMS` detects and refuses
 */

/**
 * This assistant quotes nothing. There is no scripture in this file, and that is the point.
 *
 * ── What was here, and why an allow-list was not enough ─────────────────────
 * A frozen two-entry `QUOTES` constant: Qur'an 94:6 in Arabic with the reference "Surah Ash-Sharh
 * 94:6", and the narration "The deeds most beloved to Allah are those done consistently, even if
 * they are few." attributed to "Sahih al-Bukhari 6464". Both were stamped `verified: false` and both
 * were rendered under a "not a verified source" warning.
 *
 * The warning was not the problem and the freezing was not the protection. Both entries **named a
 * real source** — one a surah and ayah, the other a collection and hadith number — and neither had
 * been checked against a critical edition by anybody. A reference is a provenance claim regardless of
 * the badge beside it: a user reads "Sahih al-Bukhari 6464" and reasonably concludes NoorLife looked
 * it up. The Arabic was the more serious of the two, because it is text a user may recite.
 *
 * The old boundary rule was "the assistant may only quote from a frozen set". The rule now is
 * stronger and needs no set to police: **a mock reply carries no quotes at all.** `quotes` is `[]` on
 * every path, so there is no literal here for a future edit to extend and no allow-list entry in the
 * fabrication scan to keep in step. When Faith AI is wired to `QuranContentRepository` it will quote
 * approved scripture retrieved at request time, with real attribution — which is the only arrangement
 * in which a quote in this module is honest.
 *
 * A mock reply may still describe what NoorLife can do, and may say that verified religious content
 * is not configured. It may not name a collection, a narrator, a scholar or a scripture reference.
 */
const NO_QUOTES: readonly FaithQuote[] = Object.freeze([]);

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

/*
  The second clause used to read "I can explain what the commonly-cited sources say". With the
  fabricated narration removed it cannot, so the promise had to go with it — a limitation notice that
  overstates the capability it is limiting is its own small untruth.
*/
const RULING_LIMITATION =
  'Scholars differ on questions like this, and a ruling depends on your circumstances. ' +
  'NoorLife does not have verified scholarly sources configured, so for a decision that applies ' +
  'to you, please ask a qualified scholar.';

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
        /*
          It no longer offers "what the commonly-cited sources address on this subject" and then
          attaches a narration, because it has no sources: naming one was the fabrication. Saying
          that verified material is not configured is the honest version of the same reply, and it
          keeps the qualified/refused distinction the boundary rules depend on.
        */
        /*
          Worded to avoid "what the sources say", which the fabrication scan now rejects on sight —
          even in this negative construction. That is the scan being blunt rather than wrong: the
          phrase is the one a reintroduced fabrication would use, and the reply reads better without
          it.
        */
        answer:
          'NoorLife does not have verified scholarly material configured, so it cannot set out the ' +
          'scholarly position on this. A qualified scholar is the right place for a question of ' +
          'this kind.',
        quotes: NO_QUOTES,
      };
    }
  }

  if (matches(query, 'prayer') || matches(query, 'salah') || matches(query, 'next')) {
    /**
     * It points at the times; it does not state one.
     *
     * This used to answer "Your next prayer is Dhuhr at 12:35 PM, based on the times shown on your
     * Faith home" — a specific time, to every user, whatever the hour and wherever they were. It was
     * not even the time the Faith home was showing, because this repository and that screen shared
     * nothing but a design reference.
     *
     * An assistant with no access to the user's resolved location cannot answer this, and the honest
     * reply is to say where the answer is. When Faith AI is genuinely wired to the prayer-times
     * repository it can read one; until then, naming a time would be the assistant inventing the
     * single most checkable fact in the module.
     */
    return {
      kind: 'answer',
      topic: 'factual',
      answer:
        'Your prayer times are on the Faith home and on the Prayer times screen, calculated for ' +
        'the location you have set. You can change the calculation method and the Asr convention ' +
        'in Faith preferences.',
      quotes: NO_QUOTES,
    };
  }

  if (matches(query, 'verse') || matches(query, 'ayah') || matches(query, 'surah')) {
    /**
     * It points at the reader; it does not quote.
     *
     * This used to answer with an interpretation — "widely read as a reassurance that relief
     * accompanies hardship" — and attach Qur'an 94:6 in Arabic. Two separate problems in one reply:
     * the interpretation was a generated exegetical claim about a specific ayah, and the ayah itself
     * was a local literal rather than text retrieved from the approved repository.
     *
     * The reader already holds the real thing: approved Uthmani text with a named translation and
     * translator. Sending the user there is both honest and more useful than a quote this file cannot
     * source.
     */
    return {
      kind: 'answer',
      topic: 'explanation',
      answer:
        'NoorLife cannot quote or explain scripture yet. The Qur’an reader has the approved Arabic ' +
        'text with your chosen translation and its translator named, and you can open any ayah from ' +
        'the surah list.',
      quotes: NO_QUOTES,
    };
  }

  if (matches(query, 'week') || matches(query, 'summar') || matches(query, 'progress')) {
    /**
     * It says where the record is; it does not summarise it.
     *
     * This used to answer "Fajr has been your most consistent prayer and Asr the one most often left
     * unmarked", and called that "a description of your own record". It was not: this classifier
     * reads no storage, so the sentence was invented and would have been stated to a user who had
     * never marked a single prayer. It also attached the fabricated narration.
     *
     * A reply that names a specific prayer as the user's weakest is a judgement about their worship
     * built from nothing, which is the most personal fabrication available to this module.
     */
    return {
      kind: 'answer',
      topic: 'factual',
      answer:
        'NoorLife cannot summarise your week yet. Your own marks are on the Worship screen, and the ' +
        'Progress screen shows the reading you have recorded — both are kept on this device.',
      quotes: NO_QUOTES,
    };
  }

  return {
    kind: 'answer',
    topic: 'explanation',
    answer:
      'I can help with prayer times, Qur’an and Hadith references, duas, and your own ' +
      'worship record. Try one of the suggestions above.',
    quotes: NO_QUOTES,
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
