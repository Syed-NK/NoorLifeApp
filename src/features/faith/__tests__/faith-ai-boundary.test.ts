import { classifyFaithQuestion, createMockFaithAiRepository } from '../data/mock';

/**
 * The Faith AI boundary rules, as executable assertions.
 *
 * Each `describe` below names one requirement from the phase brief. If a future
 * implementation replaces the mock, these are the tests it inherits — the classifier is
 * an implementation detail, the boundary is not.
 */

describe('answers only Faith-module questions', () => {
  it.each([
    ['how did I sleep last night?', 'health'],
    ['what is my budget this month?', 'finance'],
    ['add a task to my to-do list', 'planner'],
    ['show me my goals', 'goals'],
    ['what is my course progress?', 'learning'],
  ])('refuses %p as belonging to %s', (question, expectedModule) => {
    const reply = classifyFaithQuestion(question);
    expect(reply.kind).toBe('out-of-scope');
    if (reply.kind === 'out-of-scope') {
      expect(reply.targetModule).toBe(expectedModule);
    }
  });

  it('carries no answer at all on an out-of-scope reply', () => {
    const reply = classifyFaithQuestion('how many steps did I walk?');
    // The variant has no `answer` field, so this is a type-level guarantee as well as a
    // runtime one — there is nowhere to put a partial answer.
    expect(reply).not.toHaveProperty('answer');
    expect(reply).not.toHaveProperty('quotes');
  });

  it('refuses topics outside NoorLife entirely, with no hand-off', () => {
    const reply = classifyFaithQuestion('what is the weather tomorrow?');
    expect(reply.kind).toBe('refused');
    expect(reply).not.toHaveProperty('handoffPrompt');
  });
});

describe('never crosses into another module on its own', () => {
  it('offers a hand-off rather than performing one', () => {
    const reply = classifyFaithQuestion('what did I spend on groceries?');
    expect(reply.kind).toBe('out-of-scope');
    if (reply.kind === 'out-of-scope') {
      expect(reply.handoffPrompt).toMatch(/Noor AI/);
    }
  });

  it('only reaches Noor AI through the separate confirmHandoff call', async () => {
    const repository = createMockFaithAiRepository();
    const asked = await repository.ask({ text: 'my sleep trend', fromScreen: '/faith/ai' });

    expect(asked.kind).toBe('ok');
    if (asked.kind === 'ok') {
      expect(asked.data.kind).toBe('out-of-scope');
    }

    // The hand-off is a second call the user's tap triggers. `ask` never returns a
    // destination, so there is no path from a question straight into another module.
    const handoff = await repository.confirmHandoff(
      { text: 'my sleep trend', fromScreen: '/faith/ai' },
      'health',
    );
    expect(handoff.kind).toBe('ok');
    if (handoff.kind === 'ok') {
      // Always Noor AI — never straight into the other module's AI, which would be
      // crossing the boundary with an extra step rather than respecting it.
      expect(handoff.data.href).toBe('/ai');
    }
  });
});

describe('jurisprudential questions always carry a limitation', () => {
  it.each([
    'is it haram to do this?',
    'is this permissible?',
    'what is the ruling on this?',
    'do i have to make up the fast?',
  ])('qualifies %p', (question) => {
    const reply = classifyFaithQuestion(question);
    expect(reply.kind).toBe('qualified');
    if (reply.kind === 'qualified') {
      expect(reply.topic).toBe('ruling');
      expect(reply.limitation.length).toBeGreaterThan(40);
      expect(reply.limitation).toMatch(/qualified scholar/i);
    }
  });

  it('never answers a ruling with an unqualified reply', () => {
    const reply = classifyFaithQuestion('is it halal to eat this?');
    expect(reply.kind).not.toBe('answer');
  });
});

/**
 * The mock assistant quotes nothing at all.
 *
 * ── Why these assertions inverted ───────────────────────────────────────────
 * This block used to establish that quotes were well-formed: separated from the prose, carrying source
 * metadata, marked unverified, and drawn only from a frozen two-entry set. Every one of those passed,
 * and together they licensed the thing that was actually wrong — the set held Qur'an 94:6 referenced as
 * "Surah Ash-Sharh 94:6" and a narration attributed to "Sahih al-Bukhari 6464", neither verified by
 * anybody.
 *
 * "Only from a frozen set" is a weaker guarantee than it reads as, because it says nothing about
 * whether the set should exist. The rule now is that a mock reply carries no quote on any path, which
 * cannot be satisfied by a well-formed fabrication.
 *
 * The `FaithQuote` type keeps its required `source` and `reference` fields. That is deliberate: when a
 * real backend quotes approved scripture retrieved at request time, an unattributed quote must still be
 * unconstructable. What changed is that nothing in the mock is entitled to build one.
 */
describe('never presents generated text as scripture', () => {
  /** Every question shape the classifier routes, including the three that used to attach a quote. */
  const EVERY_QUESTION: readonly string[] = [
    'explain this ayah',
    'summarise my week',
    'is it haram?',
    'is it permissible?',
    'when is my next prayer',
    'tell me about surah',
    'what does the hadith say',
    'something else entirely',
    '',
  ];

  it.each(EVERY_QUESTION)('carries no quote in the reply to "%s"', (question) => {
    const reply = classifyFaithQuestion(question);
    const quotes = 'quotes' in reply ? reply.quotes : [];
    expect(quotes).toHaveLength(0);
  });

  it('names no collection, narrator or scripture reference in its prose', () => {
    /*
      The prose field is now the only place text can reach the user, so it is the place a fabrication
      would reappear. These are the shapes the deleted content took.
    */
    for (const question of EVERY_QUESTION) {
      const reply = classifyFaithQuestion(question);
      const prose = 'answer' in reply ? reply.answer : 'message' in reply ? reply.message : '';
      expect(prose).not.toMatch(/(Sahih|Sunan|Jami|Musnad|Muwatta|Bukhari|Tirmidhi)/i);
      expect(prose).not.toMatch(/\d{1,3}:\d{1,3}/);
      expect(prose).not.toMatch(/(narrated by|widely read as|the sources say)/i);
    }
  });

  it('contains no Arabic script on any path', () => {
    // The most serious of the two deleted entries: Arabic a user may recite, from no approved source.
    for (const question of EVERY_QUESTION) {
      const reply = classifyFaithQuestion(question);
      expect(JSON.stringify(reply)).not.toMatch(/[ء-ي]/);
    }
  });

  it('still answers in scope rather than refusing everything', () => {
    // The guarantee above would also be satisfied by an assistant that said nothing useful. It is not
    // one: an in-scope question is still answered, and still points somewhere real.
    const reply = classifyFaithQuestion('explain this ayah');
    expect(reply.kind).toBe('answer');
    if (reply.kind === 'answer') {
      expect(reply.answer).toMatch(/reader/i);
    }
  });
});

describe('in-scope answers', () => {
  it('answers a prayer-time question factually', () => {
    const reply = classifyFaithQuestion('when is my next prayer?');
    expect(reply.kind).toBe('answer');
    if (reply.kind === 'answer') {
      expect(reply.topic).toBe('factual');
    }
  });

  it('reports a worship summary without shaming a missed day', () => {
    const reply = classifyFaithQuestion('summarise my week');
    expect(reply.kind).toBe('answer');
    if (reply.kind === 'answer') {
      expect(reply.answer).not.toMatch(/fail|lazy|should have|shame|guilty/i);
    }
  });

  it('handles an empty question without throwing', () => {
    expect(classifyFaithQuestion('   ').kind).toBe('refused');
  });
});

/**
 * **The assistant may not advertise a capability the module does not have.**
 *
 * ── The failure this locks out ──────────────────────────────────────────────
 * The catch-all reply used to open "I can help with prayer times, Qur'an and Hadith references,
 * duas, and your own worship record." Two of those five were false: Hadith and Duas have no approved
 * provider, their repositories answer `not-configured`, and their own screens render the locked
 * state. So the module's most cautious screens said "no verified content is available" while its
 * assistant, one tap away, offered the same content as a service.
 *
 * That is the fixture problem wearing conversational clothes. It is not fixed by a badge, because
 * the claim is in prose the user reads as the app describing itself — and unlike a card, an
 * assistant's sentence about its own abilities is the one statement a user has no way to check.
 *
 * The tests below assert the two halves separately: what the reply may not offer, and that no
 * starter chip invites the offer either. A suggestion is a promise that the question will be
 * answered, so a chip reading "A dua for anxiety" is the same untruth in fewer words.
 */
describe('claims no capability the module cannot honour', () => {
  it('does not offer Hadith or duas in the catch-all reply', () => {
    const reply = classifyFaithQuestion('what can you do?');
    expect(reply.kind).toBe('answer');
    if (reply.kind !== 'answer') {
      return;
    }

    /*
      Asserted as "not offered as a service", not as "the words never appear". The reply is allowed
      — and required — to *name* them as unconfigured, which is why the check is on the offering
      construction rather than on the nouns.
    */
    expect(reply.answer).not.toMatch(/I can (help with|answer).*(hadith|dua)/i);
    expect(reply.answer).toMatch(/hadith and duas/i);
    expect(reply.answer).toMatch(/no approved source|not configured|cannot answer/i);
  });

  it('still points at the three surfaces that do work', () => {
    const reply = classifyFaithQuestion('what can you do?');
    if (reply.kind !== 'answer') {
      throw new Error('the catch-all must be an answer');
    }
    expect(reply.answer).toMatch(/prayer times/i);
    expect(reply.answer).toMatch(/reader/i);
    expect(reply.answer).toMatch(/worship record/i);
  });

  it('suggests nothing that resolves to an unconfigured provider', async () => {
    const repository = createMockFaithAiRepository();
    const result = await repository.suggestions();
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      return;
    }

    for (const suggestion of result.data) {
      expect(suggestion).not.toMatch(/\bdua\b|\bhadith\b|\bnarration\b/i);
    }
  });
});
