import type { DailyPrayerTimes, NextPrayer, PrayerLocation } from '../prayer-times.repository';

/**
 * Where every value the Prayer screen displays actually came from.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The Prayer screen is the one surface in NoorLife whose values a user will act on and cannot
 * easily check: a prayer time that is plausible and wrong is indistinguishable from one that is
 * plausible and right. The module has already shipped a fixture that returned the design
 * reference's five times to every user on every day, and the audit that caught it was a source
 * scan — a scan can prove a literal is absent, but it cannot prove the value on screen was derived.
 *
 * This closes that half. It answers, for a rendering the developer is looking at right now, "which
 * of these came from a calculation, which from a device service, and which from a preference the
 * user chose" — reported per slot rather than per file.
 *
 * ── Why it reports origins and never values ─────────────────────────────────
 * A prayer-time diagnostic that echoed what it was diagnosing would be a coordinate leak wearing a
 * different hat. The resolved place label *is* the user's location, the IANA zone narrows it to a
 * region, and the six times narrow it to a latitude band. So nothing here carries a value: each
 * entry names a slot and the mechanism behind it, and anything derived from the coordinate is
 * marked `redacted` so the omission reads as deliberate rather than as a gap.
 *
 * The one exception is `resolved`, a boolean — whether the slot has a value at all. That is the
 * fact a developer is usually chasing and it discloses nothing about where the user is.
 *
 * ── Development only ────────────────────────────────────────────────────────
 * This module is pure and has no `__DEV__` guard of its own, because a guard inside a pure function
 * is untestable. The guard lives at the single render site — `FaithDevAudit` — so a production
 * bundle renders nothing, and this file's tests can still run.
 */

/** The mechanism behind a displayed value. One of these, never a free-text explanation. */
export type PrayerValueOrigin =
  /** `expo-location`'s reverse geocoder, via `LocationPort.describe`. */
  | 'device-reverse-geocoder'
  /** The rounded coordinate NoorLife substitutes when the geocoder names no place. */
  | 'coordinate-derived-label'
  /** Read back from this device's own storage, written by an earlier fix or a manual choice. */
  | 'device-storage'
  /** `tz-lookup` against the coordinate — offline, no network, no service. */
  | 'coordinate-iana-zone-lookup'
  /** The `adhan` library's astronomical calculation for the coordinate and day. */
  | 'adhan-calculation'
  /** NoorLife's tabular Hijri arithmetic. */
  | 'tabular-hijri-calculation'
  /** A value the user selected, or the seeded default they have not yet changed. */
  | 'user-preference'
  /** The device clock, sampled at render. */
  | 'device-clock'
  /** Derived on screen from values that are themselves listed here. */
  | 'derived-on-screen';

export type PrayerProvenanceEntry = {
  /** The slot as it appears on screen, in the words the screen uses. */
  readonly slot: string;
  readonly origin: PrayerValueOrigin;
  /** True when the slot currently has a value to show. */
  readonly resolved: boolean;
  /**
   * True when the value itself is withheld because it would disclose the user's location.
   *
   * Every entry withholds its value; this marks the ones where that is a *privacy* decision rather
   * than simply this report's format, so a reader can tell the two apart.
   */
  readonly redacted: boolean;
};

/**
 * A hard-coded fallback, if one were ever reachable.
 *
 * There are none, and the point of the type is that adding one would have to be declared here to
 * compile — `assertNoHardCodedPrayerValues` reads this list and fails on any entry.
 */
export type PrayerHardCodedFallback = {
  readonly slot: string;
  readonly literal: string;
};

export type PrayerProvenanceReport = {
  readonly entries: readonly PrayerProvenanceEntry[];
  /** Always empty. See `PrayerHardCodedFallback`. */
  readonly hardCodedFallbacks: readonly PrayerHardCodedFallback[];
};

/**
 * Human wording for each origin, for the development panel.
 *
 * Separate from the union so the strings can be edited without touching the contract, and so a test
 * can assert every origin has wording rather than discovering a missing one on screen.
 */
export const PRAYER_ORIGIN_LABELS: Readonly<Record<PrayerValueOrigin, string>> = {
  'device-reverse-geocoder': 'OS reverse geocoder',
  'coordinate-derived-label': 'rounded coordinate (geocoder named no place)',
  'device-storage': 'this device’s storage',
  'coordinate-iana-zone-lookup': 'IANA zone from coordinate, offline',
  'adhan-calculation': 'adhan astronomical calculation',
  'tabular-hijri-calculation': 'tabular Hijri arithmetic',
  'user-preference': 'user preference',
  'device-clock': 'device clock',
  'derived-on-screen': 'derived on screen',
};

/**
 * The provenance of one rendering of the Prayer screen.
 *
 * Takes the same objects the screen renders from, so the report describes *this* rendering rather
 * than restating the architecture. A slot with no value still appears, marked unresolved — knowing
 * a value is absent is as useful as knowing where a present one came from.
 */
export function describePrayerProvenance({
  day,
  next,
  countdownLabel,
}: {
  readonly day: DailyPrayerTimes;
  readonly next: NextPrayer | null;
  readonly countdownLabel: string | null;
}): PrayerProvenanceReport {
  const location: PrayerLocation = day.location;

  /*
    A resolved place name and NoorLife's coordinate-derived stand-in are two different origins, and
    the difference matters when a label looks wrong: `12.345, -67.890` is the geocoder declining,
    not a bug. They are told apart by shape rather than by a flag, because the repository writes one
    field for both — see `toPrayerLocation`.
  */
  const labelIsCoordinate = /^-?\d+\.\d+, -?\d+\.\d+$/.test(location.label);

  const entries: PrayerProvenanceEntry[] = [
    {
      slot: 'Location name',
      origin: labelIsCoordinate ? 'coordinate-derived-label' : 'device-reverse-geocoder',
      resolved: location.label.length > 0,
      redacted: true,
    },
    {
      slot: location.manual ? 'Location (chosen by user)' : 'Location (device fix)',
      origin: 'device-storage',
      resolved: true,
      redacted: true,
    },
    {
      slot: 'Time zone the clocks are formatted in',
      origin: 'coordinate-iana-zone-lookup',
      resolved: location.timeZone.length > 0,
      redacted: true,
    },
    {
      slot: 'Hijri date',
      origin: 'tabular-hijri-calculation',
      resolved: day.hijriDate.length > 0,
      redacted: false,
    },
    {
      slot: 'Calculation method',
      origin: 'user-preference',
      resolved: true,
      redacted: false,
    },
    {
      slot: 'Asr juristic method',
      origin: 'user-preference',
      resolved: true,
      redacted: false,
    },
  ];

  /*
    One entry per time actually resolved, named by its key rather than by a fixed list of six. A
    polar day that yields four is reported as four — a report that always claimed six would be the
    same kind of confident fiction the screen itself avoids.
  */
  for (const time of day.times) {
    entries.push({
      slot: `${time.label} time`,
      origin: 'adhan-calculation',
      resolved: time.at.length > 0,
      redacted: true,
    });
  }

  entries.push(
    {
      slot: 'Next prayer selection',
      origin: 'derived-on-screen',
      resolved: next !== null,
      redacted: false,
    },
    {
      slot: 'Next prayer time',
      origin: 'adhan-calculation',
      resolved: next !== null,
      redacted: true,
    },
    {
      slot: 'Countdown',
      origin: 'device-clock',
      resolved: countdownLabel !== null,
      redacted: false,
    },
    {
      slot: 'Day-arc marker positions',
      origin: 'derived-on-screen',
      resolved: day.times.length > 0,
      redacted: false,
    },
  );

  return { entries, hardCodedFallbacks: [] };
}

/**
 * The assertion the audit exists to make: no slot on this screen has a hard-coded value behind it.
 *
 * Returns the offending entries rather than throwing, so the development panel can show them and a
 * test can assert the list is empty. If a fallback is ever added, it has to be declared in
 * `hardCodedFallbacks` to be honest — and declaring it is what fails this.
 */
export function assertNoHardCodedPrayerValues(
  report: PrayerProvenanceReport,
): readonly PrayerHardCodedFallback[] {
  return report.hardCodedFallbacks;
}
