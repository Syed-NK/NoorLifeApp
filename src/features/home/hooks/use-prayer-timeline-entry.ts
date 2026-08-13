import { modulePalettes } from '@ds/tokens';
import { formatPrayerClock } from '@features/faith/data/prayer/prayer-clock';
import { useFaithHome } from '@features/faith/hooks/use-faith-home';
import type { TimelineEntry } from '@shared/models/dashboard';

/**
 * Main Home's prayer row, from the same calculation the Faith module uses.
 *
 * ── What this replaces, and why it was the worst kind of fixture ─────────────
 * `src/mocks/main-home.ts` carried a fixed row: `time: '12:35 PM', title: 'Dhuhr Prayer'`. That value
 * is the deleted prayer-times fixture's Dhuhr, and it outlived the fixture by several phases.
 *
 * The result was one app making two different claims about the same prayer. Main Home said Dhuhr was
 * at 12:35 PM; the Faith module one tap away calculated 1:14 PM for the same coordinate on the same
 * day. A user could see both within two seconds of each other. Worse, 12:35 PM was shown to every
 * user everywhere — it was the design reference's number, not a time for any location on Earth.
 *
 * ── Why it reads the Faith hook rather than the repository ──────────────────
 * `useFaithHome()` is the exact resource the Faith home hero renders. Reaching for
 * `prayerTimes.getNextPrayer` directly would have worked and would have been a second call site with
 * its own settings plumbing — and the moment one of them read a preference the other did not, the two
 * screens would disagree again for a subtler reason. Sharing the hook makes agreement structural
 * rather than something two call sites have to keep up.
 *
 * It follows that Main Home shows the **next** prayer rather than always Dhuhr. That is the point of
 * the row: at 9 am it says Fajr has gone and Dhuhr is next, and after Isha it says tomorrow's Fajr.
 * A row hard-coded to Dhuhr could only ever be right for part of the day.
 *
 * ── Why the honest state is a row and not an absence ────────────────────────
 * With no location there is no time, and the row says so instead of disappearing. A vanishing row
 * would leave the user with no way to discover that prayer times are available at all, and it would
 * change Main Home's section height depending on a permission — the timeline is a locked composition
 * and its row count is part of that.
 *
 * `time` is empty in that state rather than an em dash: `TimelineRow` omits an empty time from the
 * spoken label, so a screen reader hears the instruction rather than "dash".
 *
 * ── Formatting is not repeated here ────────────────────────────────────────
 * `formatPrayerClock` reads the hours and minutes out of the stamped timestamp, which carries the
 * *prayer location's* offset. Main Home therefore shows the same location-local time Faith does, and
 * no second formatter exists to drift from it. Nothing in this file touches `Date`.
 */

/** The row's identity and accent are fixed, so only its text depends on the calculation. */
const ROW_ID = 'next-prayer';

export function usePrayerTimelineEntry(): TimelineEntry {
  const { nextPrayer } = useFaithHome();

  const base = {
    id: ROW_ID,
    icon: 'mosque' as const,
    sourceModule: 'faith' as const,
    accent: modulePalettes.faith.primary,
  };

  if (nextPrayer.status === 'settled' && nextPrayer.result.kind === 'ok') {
    const prayer = nextPrayer.result.data.prayer.prayer;
    return {
      ...base,
      time: formatPrayerClock(prayer.at),
      title: `${prayer.label} Prayer`,
    };
  }

  if (nextPrayer.status === 'loading') {
    // No time and no claim while the calculation runs. The row keeps its place so the section does
    // not change height when the answer arrives.
    return { ...base, time: '', title: 'Prayer times' };
  }

  /*
    Everything else — permission refused, location services off, a timeout, a coordinate whose zone
    would not resolve — resolves to the same instruction, because the action is the same in every one
    of them and Main Home is not the screen that should explain the difference. Faith's own screens
    separate the causes and offer the prompt.
  */
  return { ...base, time: '', title: 'Set your location to see prayer times' };
}
