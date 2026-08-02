import { evaluateEmailDraft } from '../email-change-validation';

/**
 * The submit gate as a pure function.
 *
 * `change-email-screen.test.tsx` proves the *screen* honours this — the disabled button, the
 * refused press, the refused keyboard Submit. This proves the rule itself, without a render, so a
 * change to the rule fails here in milliseconds rather than being diagnosed through a component
 * tree.
 */

const CURRENT = 'ahmed@example.com';

describe('an empty draft', () => {
  it.each(['', ' ', '   ', '\t', ' \t \n '])('reads %j as empty', (draft) => {
    expect(evaluateEmailDraft(draft, CURRENT)).toMatchObject({ state: 'empty', canSubmit: false });
  });
});

describe('a malformed draft', () => {
  it.each([
    'not-an-address',
    'someone@',
    '@example.com',
    'some one@example.com',
    'someone@example',
    'someone.example.com',
    '@',
  ])('reads %j as invalid', (draft) => {
    expect(evaluateEmailDraft(draft, CURRENT)).toMatchObject({
      state: 'invalid',
      canSubmit: false,
    });
  });
});

describe('the address the account already has', () => {
  it.each([
    ['exactly', 'ahmed@example.com'],
    ['upper-cased', 'AHMED@EXAMPLE.COM'],
    ['mixed case', 'Ahmed@Example.Com'],
    ['padded', '  ahmed@example.com  '],
    ['padded and re-cased', ' \tAhmed@Example.COM '],
  ])('reads a %s match as unchanged', (_label, draft) => {
    expect(evaluateEmailDraft(draft, CURRENT)).toMatchObject({
      state: 'unchanged',
      canSubmit: false,
    });
  });

  it('compares against a stored address that is itself oddly cased', () => {
    // Supabase folds addresses, but a summary read from an older row need not be folded. Both
    // sides are normalized so the comparison cannot depend on which one happens to be tidy.
    expect(evaluateEmailDraft('ahmed@example.com', 'Ahmed@Example.COM')).toMatchObject({
      state: 'unchanged',
    });
  });
});

describe('a valid, different address', () => {
  it.each([
    'new@example.com',
    '  new@example.com  ',
    'NEW@Example.com',
    'ahmed.al+noor@example.com',
  ])('accepts %j', (draft) => {
    const result = evaluateEmailDraft(draft, CURRENT);
    expect(result.state).toBe('valid');
    expect(result.canSubmit).toBe(true);
  });

  it('normalizes only case and surrounding space', () => {
    // Stripping a dot or a +tag would silently send the confirmation to a different mailbox from
    // the one the user asked for.
    expect(evaluateEmailDraft(' Ahmed.Al+noor@Example.COM ', CURRENT).normalized).toBe(
      'ahmed.al+noor@example.com',
    );
  });

  it('does not mutate either input', () => {
    const draft = '  New@Example.com  ';
    const current = 'Ahmed@Example.com';

    const result = evaluateEmailDraft(draft, current);

    expect(draft).toBe('  New@Example.com  ');
    expect(current).toBe('Ahmed@Example.com');
    expect(result.normalized).toBe('new@example.com');
  });
});

describe('no current address to compare against', () => {
  it('still validates syntax, so a malformed draft is refused', () => {
    expect(evaluateEmailDraft('nope', null)).toMatchObject({ state: 'invalid', canSubmit: false });
  });

  it('cannot report "unchanged", because nothing is known to be unchanged from', () => {
    // The screen refuses to submit in this state for its own reason — an unknown current address is
    // the one that ends with a lockout — but the rule itself must not invent a comparison.
    expect(evaluateEmailDraft('anything@example.com', null)).toMatchObject({ state: 'valid' });
  });
});
