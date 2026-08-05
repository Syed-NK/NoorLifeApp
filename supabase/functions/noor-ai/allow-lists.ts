/**
 * The two closed sets in §C.5, and the deliberately forgiving way both fail.
 *
 * ── Why an unrecognised value is not an error ────────────────────────────────
 * §C.5: "a route rename shipped in a new app build must not make Noor AI start failing for users on
 * the old build. A wrong `surface` costs answer quality; a rejected one costs the feature." So an
 * unknown-but-well-typed `surface` or `locale` is discarded, the default is used, and the discard is
 * recorded (`surface_accepted` / `locale_accepted` in the log) so drift is visible in metrics rather
 * than invisible in support tickets.
 *
 * A value of the wrong *type* is a different case and is rejected: §C.2 types both as strings, and
 * `surface: 42` is a client defect rather than an old build, so silently defaulting would hide a bug
 * the app author needs to see.
 *
 * ── Why these lists are transcribed and then tested against the app ──────────
 * §C.5 asks for the surface list to be "resolved at build time in AI-2 rather than hand-copied here
 * so the list cannot drift". An Edge Function has no build step that can read `src/app/`, and it must
 * not read the repository at runtime. `tests/repo-parity_test.ts` closes the same gap from the other
 * end: it asserts every entry below corresponds to a real Expo Router route file, and that the locale
 * list matches `SupportedLocale` in `src/application/providers/localization-provider.tsx`. A renamed
 * or deleted route fails a test, which is the outcome "cannot drift" was asking for.
 *
 * The reverse direction is deliberately not asserted. §C.5's list is a curated set of AI-relevant
 * surfaces, not every route in the app — `src/app/` holds well over a hundred — and an unlisted
 * surface already degrades safely to `/ai`.
 */

/** §C.5, verbatim. */
export const SURFACE_ALLOW_LIST: readonly string[] = [
  '/ai',
  '/ai/history',
  '/ai/saved',
  '/ai/sources',
  '/ai/permissions',
  '/home',
  '/modules',
  '/insights',
  '/notifications',
  '/settings',
  '/profile',
  '/profile/privacy-security',
  '/subscription',
  '/faith',
  '/health',
  '/planner',
  '/finance',
  '/learning',
  '/family',
  '/goals',
];

/** §C.2 — absent `surface` is treated as `/ai`. */
export const DEFAULT_SURFACE = '/ai';

/**
 * The languages the app actually ships, from `SupportedLocale`.
 *
 * `'ar'` is included because the app is RTL-capable and declares Arabic as a supported locale; §C.3.6
 * counts code points rather than bytes for the same reason — "a byte-based limit would be a
 * language-based limit".
 */
export const LOCALE_ALLOW_LIST: readonly string[] = ['en', 'ar'];

/** §C.2 — absent `locale` is `en`. */
export const DEFAULT_LOCALE = 'en';

/**
 * §C.5 — `surface` is a hint, not a permission.
 *
 * It selects which part of the server's own NoorLife knowledge to lean on. It can never widen scope,
 * and it is **not forwarded** to the provider (§H.1): "the route string itself does not need to
 * travel, and a route is a small behavioural signal about the user". `ProviderRequest` has no field
 * for it, so that rule holds structurally.
 */
export function resolveSurface(value: string | undefined): {
  readonly surface: string;
  readonly accepted: boolean;
} {
  if (value === undefined) {
    return { surface: DEFAULT_SURFACE, accepted: true };
  }
  return SURFACE_ALLOW_LIST.includes(value)
    ? { surface: value, accepted: true }
    : { surface: DEFAULT_SURFACE, accepted: false };
}

export function resolveLocale(value: string | undefined): {
  readonly locale: string;
  readonly accepted: boolean;
} {
  if (value === undefined) {
    return { locale: DEFAULT_LOCALE, accepted: true };
  }
  return LOCALE_ALLOW_LIST.includes(value)
    ? { locale: value, accepted: true }
    : { locale: DEFAULT_LOCALE, accepted: false };
}
