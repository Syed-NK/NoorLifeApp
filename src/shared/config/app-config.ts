/**
 * How to reach NoorLife, and where its published documents live.
 *
 * ── Why one file rather than a constant beside each screen ──────────────────
 * A support address and a policy URL are the two strings in an application that are *promises*.
 * A second copy of `hello@nkdigitalworks.com` is a second address to update when the mailbox
 * moves, and the one nobody remembers is the one a user emails into a void. The same is true of
 * a policy URL: a store review checks the link in the listing, not the fourth copy of it inside
 * a Help screen.
 *
 * So these live here, once, and `__tests__/support-config.test.ts` asserts that no other source
 * file writes them out again. Adding a literal elsewhere fails a test rather than passing review.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No ticketing endpoint, no support API key, no crash-reporting DSN. There is no support backend,
 * and a configuration entry for one would be the first half of a claim the app cannot finish.
 */

export const supportConfig = {
  /** The real, monitored address. Reached through a mail composer — never posted anywhere. */
  email: 'hello@nkdigitalworks.com',
  company: 'NK Digital Works',
  website: 'https://nkdigitalworks.com',
} as const;

export const legalConfig = {
  privacyPolicy: 'https://nkdigitalworks.com/privacy',
  termsOfService: 'https://nkdigitalworks.com/terms',
} as const;

/** The product name, used wherever copy names the application rather than the company. */
export const productConfig = {
  name: 'NoorLife',
} as const;
