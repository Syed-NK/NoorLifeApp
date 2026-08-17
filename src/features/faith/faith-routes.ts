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
  /**
   * The Dhikr selector, reached from `Change` on the Tasbih screen.
   *
   * Its own destination rather than a sheet: it holds a search field, category filters, five
   * sections and the full create/rename/remove flow for personal counters, which is more than a
   * sheet over a counting surface can carry without burying the thing being counted.
   */
  dhikr: '/faith/dhikr',
  mosques: '/faith/mosques',
  calendar: '/faith/calendar',

  // ── Reached from cards on the home screen ─────────────────────────────────
  /** The Daily Ayah card, opened full-screen with its translation and actions. */
  dailyAyah: '/faith/daily-ayah',
  /** The "Upcoming" card — Ramadan and other observances. */
  events: '/faith/events',

  /**
   * Prayer reminder preferences.
   *
   * Its own screen so the approved dashboard's action row has a real destination — a chevron that
   * led nowhere would be the same kind of claim the reminders themselves are careful not to make.
   */
  reminders: '/faith/reminders',

  /**
   * Where the coordinate every prayer time is calculated from is chosen.
   *
   * Its own destination rather than a sheet on the Prayer screen: it holds a mode selection, a
   * validated coordinate form and a timezone preview, and it has to be reachable from the location
   * card on Prayer Times and from Faith Home's prayer surfaces alike.
   */
  location: '/faith/location',

  // ── Supporting screens ────────────────────────────────────────────────────
  search: '/faith/search',
  bookmarks: '/faith/bookmarks',
  /** Real reading progress: the daily goal, the recorded week, per-surah completion. */
  progress: '/faith/progress',
  /** Translation, reciter and prayer-notification preferences. */
  preferences: '/faith/preferences',
  /**
   * The two catalogue selectors, deliberately separate destinations.
   *
   * They used to be two sections of `preferences`, which meant every translation edition in every
   * language *and* every reciter shared one unfiltered scroll. Splitting the route is what makes
   * each one able to carry its own search, its own filters and its own virtualized list — a single
   * screen could not have a language filter that meant anything for reciters.
   */
  translations: '/faith/translations',
  reciters: '/faith/reciters',
  /**
   * Downloading, keeping and removing offline recitation.
   *
   * ── Why this is its own destination and not a section of Reciters ───────────
   * Because the two answer different questions. Reciters is a *catalogue*: which recitation do I want
   * to hear. This is *storage*: several hundred megabytes on somebody's phone, a Wi-Fi-only
   * preference, a pause and resume, a per-surah removal and a confirmation before the whole thing
   * goes. Folding it into a scrolling list of reciters would put the control that spends half a
   * gigabyte inside a row somebody is scrolling past to find a voice.
   *
   * It is deliberately **not** reachable from the docked player. The player is a playback controller,
   * and every control here is about storage rather than listening — see `QuranAudioPlayer`. The one
   * link from the player is the honest dead end: a verse that is not downloaded cannot be played, and
   * this is where that is fixed.
   */
  offlineAudio: '/faith/offline-audio',
  /**
   * Where Faith's attribution lives.
   *
   * Reached from More rather than pinned above the scripture. The badge this replaced read
   * `Source: Quran Foundation Content API` at the top of three reading surfaces — see
   * `UnverifiedSourceNotice` for why that was the wrong place for it.
   */
  contentInfo: '/faith/content-info',
} as const satisfies Record<string, Href>;

export type FaithRouteKey = keyof typeof faithRoutes;

/**
 * The reader, for a specific surah and optionally a specific verse.
 *
 * ── Why the reader is a parameterised route and not a fixed one ─────────────
 * It used to be `/faith/reader`, a single address that showed whatever position happened to be in
 * storage. Every one of the 114 surah rows pushed that same address, so tapping Al-Baqarah opened
 * whatever the user last read — and a bookmark could not open its verse at all, because there was
 * nowhere to say which verse it meant. Both were the same missing thing: the reader had no way to be
 * *told* what to show.
 *
 * `ayah` is a hint rather than a filter. The reader still renders the surah from its first page; the
 * verse is scrolled to and announced. A reader that showed one verse alone would make a bookmark a
 * dead end rather than a way in.
 */
export function readerHref(surah: number, ayah?: number): Href {
  return {
    pathname: '/faith/reader/[surah]',
    params:
      ayah === undefined ? { surah: String(surah) } : { surah: String(surah), ayah: String(ayah) },
  };
}

/**
 * Noor AI, optionally opened **about** a specific verse.
 *
 * ── Why a reference travels and never a copy of the verse ───────────────────
 * The reader's action sheet can hand a verse to the assistant, and what it hands over is the
 * citation — a surah number and an ayah number — not the Arabic and not the translation. The AI
 * screen resolves those two numbers back through `QuranContentRepository`, which is the same
 * approved boundary the reader itself reads from and the only one attribution is attached to.
 *
 * The alternative would be passing the scripture through the route. That is how a second, unsourced
 * copy of the Qur'an comes into existence inside an app: it would arrive at the AI screen with no
 * `ContentSource` behind it, no way to tell it apart from generated text, and no way to notice if
 * something had altered it in transit. A pair of integers cannot be corrupted into a wrong verse
 * without becoming a different, visibly wrong citation.
 */
export function faithAiHref(surah?: number, ayah?: number): Href {
  return surah === undefined || ayah === undefined
    ? faithRoutes.ai
    : { pathname: '/faith/ai', params: { surah: String(surah), ayah: String(ayah) } };
}

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
