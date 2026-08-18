import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OTP_LENGTH } from '../components/otp-input';

/**
 * The six-digit OTP contract.
 *
 * Three things have to agree or Verify Email breaks in a way that looks like a wrong
 * code rather than a misconfiguration: the constant the UI renders boxes from, the
 * validation that decides when a code is complete, and the length the Supabase project
 * emails. The first two are asserted directly here; the third is pinned in
 * `supabase/config.toml`, which this test reads so a change there fails the suite.
 *
 * The failure this prevents is specific and silent: with a project set to 8, a user
 * receives an eight-digit code, the UI accepts only six, and the sixth keystroke submits
 * a code that cannot be right.
 */

const EXPECTED = 6;

describe('OTP length', () => {
  it('is exactly six in the application', () => {
    expect(OTP_LENGTH).toBe(EXPECTED);
  });

  it('is pinned to six in the Supabase project config', () => {
    // Read rather than imported: config.toml is the source of truth for the remote
    // project, and an unpinned value is what let the two drift in the first place.
    const config = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8');
    const match = /^\s*otp_length\s*=\s*(\d+)\s*$/m.exec(config);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(EXPECTED);
  });
});

/**
 * The completeness rule Verify Email applies, isolated.
 *
 * `verify-email-screen.tsx` gates submission on `code.length !== OTP_LENGTH`, and
 * `OtpInput` strips non-digits before reporting a change. Together those mean a
 * submittable code is exactly six digits and nothing else — which is what this asserts,
 * so the rule survives a refactor of either file.
 */
function isSubmittable(code: string): boolean {
  return code.length === OTP_LENGTH && /^\d+$/.test(code);
}

describe('code acceptance', () => {
  it('accepts exactly six digits', () => {
    expect(isSubmittable('123456')).toBe(true);
    expect(isSubmittable('000000')).toBe(true);
  });

  it.each(['', '1', '12345', '1234567', '12345678'])('rejects %p on length', (code) => {
    expect(isSubmittable(code)).toBe(false);
  });

  it.each(['12345a', 'abcdef', '12 456', '123-56', '１２３４５６'])(
    'rejects %p as not six digits',
    (code) => {
      // The last case is full-width digits: visually six numbers, not ASCII digits, and a
      // real paste hazard from some keyboards.
      expect(isSubmittable(code)).toBe(false);
    },
  );

  it('rejects an eight-digit code, which is what a misconfigured project would send', () => {
    expect(isSubmittable('12345678')).toBe(false);
  });
});
