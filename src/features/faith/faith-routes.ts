import type { Href } from 'expo-router';

/**
 * Every Faith destination, in one typed map.
 *
 * ── Why a map rather than inline strings ────────────────────────────────────
 * The previous pass routed most Faith controls through `comingSoon()`, which took a
 * free-text label. That made "where does this control go?" a question you answered by
 * reading each call site, and it made a typo a runtime surprise rather than a build
 * failure. Every Faith control now resolves through this object, so the set of
 * destinations is enumerable — which is exactly what the control-coverage test asserts
 * against.
 *
 * `Href` is Expo Router's generated type, so each string below is validated against the
 * files actually present under `src/app/faith/`. Deleting a route file breaks the build
 * here rather than at the tap.
 */
export const faithRoutes = {
  /** Module home — the approved `03-faith.png` screen. */
  home: '/faith',

  // ── Bottom navigation ─────────────────────────────────────────────────────
  quran: '/faith/quran',
  ai: '/faith/ai',
  worship: '/faith/worship',
  more: '/faith/more',

  // ── The eight approved feature cards ──────────────────────────────────────
  hadith: '/faith/hadith',
  duas: '/faith/duas',
  prayerTimes: '/faith/prayer-times',
  qibla: '/faith/qibla',
  tasbih: '/faith/tasbih',
  mosques: '/faith/mosques',
  calendar: '/faith/calendar',

  // ── Reached from cards on the home screen ─────────────────────────────────
  /** "Continue Quran" — resumes at the stored position. */
  reader: '/faith/reader',
  /** The Daily Ayah card, opened full-screen with its translation and actions. */
  dailyAyah: '/faith/daily-ayah',
  /** The "Upcoming" card — Ramadan and other observances. */
  events: '/faith/events',

  // ── Supporting screens ────────────────────────────────────────────────────
  search: '/faith/search',
  bookmarks: '/faith/bookmarks',
  /** Translation, reciter and prayer-notification preferences. */
  preferences: '/faith/preferences',
} as const satisfies Record<string, Href>;

export type FaithRouteKey = keyof typeof faithRoutes;

/**
 * The five bottom-navigation slots, by their `ModuleNavigation` key.
 *
 * Declared here so a screen can name the slot it belongs under without importing the
 * navigation array and indexing into it. The keys match `moduleThemes.faith.navigation`,
 * and a test asserts they still do.
 */
export const faithNavKeys = {
  today: 'today',
  quran: 'quran',
  ai: 'faith-ai',
  worship: 'worship',
  more: 'more',
} as const;

export type FaithNavKey = (typeof faithNavKeys)[keyof typeof faithNavKeys];
