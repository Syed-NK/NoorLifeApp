import {
  assertNoHardCodedPrayerValues,
  describePrayerProvenance,
  PRAYER_ORIGIN_LABELS,
} from '../data/prayer/prayer-provenance';
import type { DailyPrayerTimes, NextPrayer } from '../data/prayer-times.repository';

import { FaithDevAudit, type FaithDevAuditRow } from './faith-dev-audit';

/**
 * Where every value on this rendering of the Prayer screen came from.
 *
 * ── What question it answers ────────────────────────────────────────────────
 * Not "is the architecture right" — the repository's own tests answer that — but "is *this* screen,
 * as it stands on this device right now, showing derived values or a fixture". Those are different
 * questions, and only the second one catches a fixture that was reintroduced downstream of a
 * correct repository.
 *
 * ── It shows no value it is auditing ────────────────────────────────────────
 * Every row is a slot name and a mechanism. No coordinate, no place name, no time zone, no clock
 * time — a diagnostic that echoed the prayer times would put the user's latitude in every
 * screenshot of it, and screenshots of a diagnostic are exactly what gets pasted into a ticket.
 * Rows whose value is withheld for that reason are marked, so the omission reads as a decision.
 *
 * Renders nothing in a production bundle; the `__DEV__` guard is inside `FaithDevAudit`.
 */
export function PrayerProvenanceDevAudit({
  day,
  next,
  countdownLabel,
  testID,
}: {
  readonly day: DailyPrayerTimes;
  readonly next: NextPrayer | null;
  readonly countdownLabel: string | null;
  readonly testID: string;
}) {
  const report = describePrayerProvenance({ day, next, countdownLabel });
  const fallbacks = assertNoHardCodedPrayerValues(report);

  const rows: readonly FaithDevAuditRow[] = [
    ...report.entries.map((entry, index): FaithDevAuditRow => ({
      key: `${entry.slot}-${index}`,
      label: entry.slot,
      value: `${PRAYER_ORIGIN_LABELS[entry.origin]}${entry.resolved ? '' : ' · UNRESOLVED'}${
        entry.redacted ? ' · value withheld' : ''
      }`,
      // Not flagged: an unresolved slot is a legitimate state — a polar day, a denied permission —
      // and flagging it would train the reader to ignore the colour that matters below.
      flagged: false,
    })),
    /*
      The row the panel exists for. It reads "none" on every build there has ever been, and the
      value of printing a constant is that its absence would be noticed: a reader who scrolls to the
      bottom and does not find this line knows the panel is out of date rather than reassuring.
    */
    {
      key: 'hard-coded',
      label: 'Hard-coded fallbacks reachable in production',
      value: fallbacks.length === 0 ? 'none' : fallbacks.map((item) => item.slot).join(', '),
      flagged: fallbacks.length > 0,
    },
  ];

  return (
    <FaithDevAudit
      title="prayer data provenance"
      note="Origins only — no coordinate, place name, zone or clock time is printed here."
      rows={rows}
      testID={testID}
    />
  );
}
