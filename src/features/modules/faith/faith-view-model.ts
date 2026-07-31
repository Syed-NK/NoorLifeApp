import type { IconName } from '@shared/models/icon';

/**
 * Faith's home-screen view model and its fixture.
 *
 * ── Why fixtures and not a table ────────────────────────────────────────────
 * No production Faith table may exist before its data model is reviewed, so this pass
 * ships typed fixtures behind a view-model shape. Presentation reads only these types,
 * so replacing the fixture with a repository later touches nothing in the composition.
 *
 * The values are the approved reference's values — 03-faith.png shows Dhuhr at 12:35 PM
 * on 19 May 2025 — because the point of this pass is to reproduce that screen. They are
 * not live and nothing here claims otherwise.
 */

/** How a worship item stands. Drives an icon *and* a word, never colour alone. */
export type WorshipStatus = 'completed' | 'current' | 'upcoming';

export type WorshipItem = {
  readonly key: string;
  readonly label: string;
  /** Time, or a word like "Completed" where the reference shows one. */
  readonly detail: string;
  readonly status: WorshipStatus;
};

/** One of the eight feature cards, in reference order. */
export type FaithFeature = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  /** True where the reference draws the glyph in green rather than gold. */
  readonly green: boolean;
};

export type FaithHomeViewModel = {
  readonly nextPrayer: {
    readonly eyebrow: string;
    readonly name: string;
    readonly time: string;
    readonly gregorianDate: string;
    readonly hijriDate: string;
    readonly actionLabel: string;
  };
  readonly features: readonly FaithFeature[];
  readonly continueQuran: {
    readonly title: string;
    /** e.g. "Surah Al-Kahf • Verse 32". */
    readonly detail: string;
    /** 0–1. */
    readonly progress: number;
  };
  readonly dailyAyah: {
    readonly title: string;
    readonly arabic: string;
    readonly translation: string;
    readonly reference: string;
  };
  readonly worship: {
    readonly title: string;
    readonly items: readonly WorshipItem[];
  };
  readonly upcoming: {
    readonly eyebrow: string;
    readonly title: string;
    readonly detail: string;
  };
  readonly islamicCalendar: {
    readonly eyebrow: string;
    readonly title: string;
    readonly detail: string;
  };
  readonly insight: {
    readonly title: string;
    readonly body: string;
    readonly source: string;
  };
};

/**
 * The eight feature cards, in the exact order and wording of `03-faith.png`.
 *
 * Row one: Quran, Hadith, Duas, Prayer. Row two: Qibla, Tasbih, Mosques, Calendar.
 * The reference draws Hadith, Duas and Prayer in green and the rest in gold; that is
 * carried as a flag rather than a colour so the theme still owns the actual value.
 */
const FEATURES: readonly FaithFeature[] = [
  { key: 'quran', label: 'Quran', icon: 'quran', green: false },
  { key: 'hadith', label: 'Hadith', icon: 'hadith', green: true },
  { key: 'duas', label: 'Duas', icon: 'worship', green: true },
  { key: 'prayer', label: 'Prayer', icon: 'mosque', green: true },
  { key: 'qibla', label: 'Qibla', icon: 'qibla', green: false },
  { key: 'tasbih', label: 'Tasbih', icon: 'tasbih', green: false },
  { key: 'mosques', label: 'Mosques', icon: 'mosque', green: false },
  { key: 'calendar', label: 'Calendar', icon: 'calendar', green: false },
];

export const faithHomeFixture: FaithHomeViewModel = {
  nextPrayer: {
    eyebrow: 'Next Prayer',
    name: 'Dhuhr',
    time: '12:35 PM',
    gregorianDate: 'May 19, 2025',
    hijriDate: '21 Dhul-Qa‘dah 1446 AH',
    actionLabel: 'View Prayer Times',
  },
  features: FEATURES,
  continueQuran: {
    title: 'Continue Quran',
    detail: 'Surah Al-Kahf • Verse 32',
    progress: 0.55,
  },
  dailyAyah: {
    title: 'Daily Ayah',
    // Qur'an 94:6. Kept as a single string with its harakat; rendered RTL by the
    // component rather than by switching the app's direction.
    arabic: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    translation: 'Indeed, with hardship comes ease.',
    reference: '(Surah Ash-Sharh 94:6)',
  },
  worship: {
    title: 'Today’s Worship',
    items: [
      { key: 'fajr', label: 'Fajr Prayer', detail: '5:02 AM', status: 'completed' },
      { key: 'dhuhr', label: 'Dhuhr Prayer', detail: '12:35 PM', status: 'current' },
      { key: 'asr', label: 'Asr Prayer', detail: '4:15 PM', status: 'upcoming' },
      { key: 'adhkar', label: 'Morning Adhkar', detail: 'Completed', status: 'completed' },
    ],
  },
  upcoming: {
    eyebrow: 'Upcoming',
    title: 'Ramadan 1446 AH',
    detail: 'In 296 days • Mar 1, 2026',
  },
  islamicCalendar: {
    eyebrow: 'Islamic Calendar',
    title: '21 Dhul-Qadah 1446 AH',
    detail: 'May 19, 2025',
  },
  insight: {
    title: 'Faith AI Insight',
    body: 'Consistency in small acts of worship brings great reward.',
    source: 'Source: Sahih Bukhari',
  },
};
