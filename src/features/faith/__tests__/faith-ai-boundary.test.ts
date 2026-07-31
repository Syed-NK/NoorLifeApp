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

describe('never presents generated text as scripture', () => {
  it('keeps quotes in a separate field from the assistant’s own words', () => {
    const reply = classifyFaithQuestion('explain this ayah');
    expect(reply.kind).toBe('answer');
    if (reply.kind === 'answer') {
      expect(reply.quotes.length).toBeGreaterThan(0);
      // The verse text must not appear inside the prose field.
      for (const quote of reply.quotes) {
        expect(reply.answer).not.toContain(quote.verbatim);
      }
    }
  });

  it('requires source metadata on every quote', () => {
    for (const question of ['explain this ayah', 'summarise my week', 'is it permissible?']) {
      const reply = classifyFaithQuestion(question);
      const quotes = 'quotes' in reply ? reply.quotes : [];
      for (const quote of quotes) {
        expect(quote.source).toBeDefined();
        expect(quote.source.name.length).toBeGreaterThan(0);
        expect(quote.reference.length).toBeGreaterThan(0);
      }
    }
  });

  it('marks sample scripture as unverified', () => {
    const reply = classifyFaithQuestion('explain this ayah');
    const quotes = 'quotes' in reply ? reply.quotes : [];
    expect(quotes.length).toBeGreaterThan(0);
    for (const quote of quotes) {
      // While Quran Foundation approval is pending, nothing may claim to be verified.
      expect(quote.source.verified).toBe(false);
    }
  });

  it('only ever quotes text from its frozen fixture set', () => {
    // The assistant cannot generate scripture because the only strings it can put in a
    // quote come from a frozen constant. Asking many different things must never
    // produce a quote outside that set.
    const seen = new Set<string>();
    for (const question of [
      'explain this ayah',
      'summarise my week',
      'is it haram?',
      'when is my next prayer',
      'tell me about surah',
      'something else entirely',
    ]) {
      const reply = classifyFaithQuestion(question);
      const quotes = 'quotes' in reply ? reply.quotes : [];
      quotes.forEach((quote) => seen.add(quote.verbatim));
    }
    expect(seen.size).toBeLessThanOrEqual(2);
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
