import {
  PROFILE_NAME_MAX_LENGTH,
  hasNameChanged,
  normalizeFullName,
  validateFullName,
} from '../profile-name';

/**
 * What a display name is allowed to be.
 *
 * The point of asserting this against the function rather than against the rendered form is that
 * "أحمد الراشد is accepted" is a claim about the rule, and a form test proves only that one
 * particular input reached one particular error line. If the rule is right, every screen that uses
 * it is right.
 */

describe('trimming', () => {
  it('removes surrounding whitespace before anything else looks at the value', () => {
    expect(normalizeFullName('  Ahmed Al-Rashid  ')).toBe('Ahmed Al-Rashid');
    expect(normalizeFullName('\tAisha\n')).toBe('Aisha');
  });

  it('leaves the spaces inside a name alone', () => {
    // Two given names is a name, not a formatting error.
    expect(normalizeFullName('  Fatima Zahra Bint Ali ')).toBe('Fatima Zahra Bint Ali');
  });

  it('returns the trimmed value from a successful validation', () => {
    const result = validateFullName('   Ahmed   ');
    expect(result).toEqual({ ok: true, value: 'Ahmed' });
  });
});

describe('names that are accepted', () => {
  it.each([
    ['Arabic', 'أحمد الراشد'],
    ['Cyrillic', 'Айша Иванова'],
    ['Han', '王小明'],
    ['Devanagari', 'आयशा शर्मा'],
    ['Hangul', '김민준'],
    ['an accented Latin name', 'Zoë Müller-Öztürk'],
    ['an apostrophe', "Sa'id O'Brien"],
    ['a hyphen', 'Anne-Marie Al-Rashid'],
    ['a single word', 'Prince'],
    ['a name with a period', 'J. R. Ahmed'],
    ['a mixed-script name', 'Ahmed أحمد'],
  ])('accepts %s', (_description, name) => {
    // No Latin-only rule anywhere: a validation that rejects these rejects a category of user.
    expect(validateFullName(name)).toEqual({ ok: true, value: name });
  });

  it('accepts a name of exactly the maximum length', () => {
    const name = 'م'.repeat(PROFILE_NAME_MAX_LENGTH);
    expect(validateFullName(name).ok).toBe(true);
  });

  it('accepts a name that is only over the limit before trimming', () => {
    const name = `${'a'.repeat(PROFILE_NAME_MAX_LENGTH)}     `;
    // Trailing spaces are not the user's mistake to be punished for.
    expect(validateFullName(name).ok).toBe(true);
  });
});

describe('names that are refused', () => {
  it.each([
    ['an empty string', ''],
    ['a single space', ' '],
    ['only spaces', '     '],
    ['only tabs and newlines', '\t\n  \n'],
  ])('refuses %s as empty', (_description, name) => {
    expect(validateFullName(name)).toEqual({ ok: false, problem: 'empty' });
  });

  it('refuses a name one character past the limit', () => {
    const name = 'a'.repeat(PROFILE_NAME_MAX_LENGTH + 1);
    expect(validateFullName(name)).toEqual({ ok: false, problem: 'too-long' });
  });

  it('refuses a pasted paragraph', () => {
    expect(validateFullName('Lorem ipsum dolor sit amet, '.repeat(20))).toEqual({
      ok: false,
      problem: 'too-long',
    });
  });

  it('refuses control characters inside the name', () => {
    // A line break inside a name renders as a gap the user can neither see nor delete.
    expect(validateFullName('Ahmed\nAl-Rashid')).toEqual({
      ok: false,
      problem: 'control-characters',
    });
    expect(validateFullName('Ahmed\tAl-Rashid')).toEqual({
      ok: false,
      problem: 'control-characters',
    });
  });

  it('sets a maximum that is long enough for a real full name', () => {
    // Guards against the limit being tightened into something that excludes real people.
    expect(PROFILE_NAME_MAX_LENGTH).toBeGreaterThanOrEqual(60);
    expect(validateFullName('Ahmed ibn Muhammad ibn Abdullah Al-Rashid Al-Baghdadi').ok).toBe(true);
  });
});

describe('detecting an unsaved edit', () => {
  it('reports no change when only surrounding whitespace differs', () => {
    // Otherwise a stray space would arm Save and stop Back with a discard prompt.
    expect(hasNameChanged('  Ahmed Al-Rashid ', 'Ahmed Al-Rashid')).toBe(false);
  });

  it('reports a change when the name itself differs', () => {
    expect(hasNameChanged('Ahmed Al-Rashid', 'Ahmed Rashid')).toBe(true);
  });

  it('treats an absent stored name as empty rather than as a match', () => {
    expect(hasNameChanged('Ahmed', null)).toBe(true);
    expect(hasNameChanged('   ', null)).toBe(false);
  });
});
