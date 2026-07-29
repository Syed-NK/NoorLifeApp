import { authErrorCopy } from '@features/entry-auth/entry-auth-copy';

import { toAuthErrorCode } from '../auth.service';
import { AuthError } from '../auth-service.contract';

/**
 * Error-classification tests.
 *
 * The signup failure that prompted this suite was a misconfigured base URL: `supabase-js` appends its
 * own paths, so a URL carrying `/rest/v1/` made every auth call request an endpoint that does not
 * exist. Supabase answered 404 "Invalid path specified in request URL", the mapper had no case for it,
 * and the user was told "Something went wrong on our side. Please try again." — advice that could never
 * work, for a fault that was entirely local.
 *
 * These lock the classification so a configuration fault is never again reported as an outage.
 */

describe('configuration faults', () => {
  it('maps the auth 404 from a URL carrying a path to not-configured', () => {
    expect(
      toAuthErrorCode({ status: 404, name: 'AuthApiError', message: 'Invalid path specified in request URL' }),
    ).toBe('not-configured');
  });

  it('maps PostgREST PGRST125 to not-configured', () => {
    expect(toAuthErrorCode({ code: 'PGRST125', message: 'Invalid path specified in request URL' })).toBe(
      'not-configured',
    );
  });

  it('does not report a configuration fault as a server error', () => {
    // The regression: "try again" for something retrying cannot fix.
    expect(toAuthErrorCode({ status: 404, message: 'Invalid path specified in request URL' })).not.toBe(
      'server-error',
    );
  });
});

describe('authorization faults', () => {
  it('maps Postgres 42501 permission denied to session-expired', () => {
    expect(toAuthErrorCode({ code: '42501', message: 'permission denied for table profiles' })).toBe(
      'session-expired',
    );
  });

  it('maps a rejected JWT to session-expired', () => {
    expect(toAuthErrorCode({ code: 'PGRST301', message: 'JWT expired' })).toBe('session-expired');
    expect(toAuthErrorCode({ status: 401, message: 'Unauthorized' })).toBe('session-expired');
  });
});

describe('rate limits are told apart', () => {
  // The email quota is hourly and needs a project change; a request rate limit clears in seconds.
  // Reporting both as "wait a minute" left the user tapping a button that could not succeed.
  it('classifies the email quota separately from a request rate limit', () => {
    expect(
      toAuthErrorCode({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }),
    ).toBe('email-rate-limited');
    expect(toAuthErrorCode({ status: 429, message: 'email rate limit exceeded' })).toBe('email-rate-limited');
    expect(toAuthErrorCode({ status: 429, message: 'too many requests' })).toBe('rate-limited');
  });

  it('does not promise a one-minute wait for the email quota', () => {
    expect(authErrorCopy['email-rate-limited']).not.toMatch(/minute/i);
  });
});

describe('signup and sign-in faults', () => {
  it.each([
    [{ status: 400, message: 'Invalid login credentials' }, 'invalid-credentials'],
    [{ status: 422, message: 'User already registered' }, 'email-already-registered'],
    [{ status: 400, message: 'Password should be at least 6 characters' }, 'weak-password'],
    [{ status: 400, code: 'email_address_invalid', message: 'Email address "x@y" is invalid' }, 'invalid-email'],
    [{ status: 400, message: 'Email not confirmed' }, 'email-not-confirmed'],
    [{ status: 429, code: 'over_request_rate_limit', message: 'too many requests' }, 'rate-limited'],
    [{ message: 'Network request failed' }, 'offline'],
    [{ status: 500, message: 'Database error saving new user' }, 'server-error'],
  ])('maps %j', (error, expected) => {
    expect(toAuthErrorCode(error)).toBe(expected);
  });

  it('passes an AuthError through unchanged', () => {
    expect(toAuthErrorCode(new AuthError('provider-not-configured'))).toBe('provider-not-configured');
  });

  it('falls back to server-error for anything unrecognised', () => {
    expect(toAuthErrorCode(new Error('something entirely new'))).toBe('server-error');
    expect(toAuthErrorCode(null)).toBe('server-error');
    expect(toAuthErrorCode(undefined)).toBe('server-error');
  });
});
