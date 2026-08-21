/**
 * **Gregorian month-grid arithmetic** — the shape of a month, and where each day sits in a
 * seven-column grid.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is shared rather than owned by a module ───────────────────────
 * Faith's Hijri calendar drew a month grid first, and Planner's calendar needs the same three
 * answers: how wide is a cell, which column does a date fall in, and how many days does this month
 * have. No feature in this codebase imports another feature — Planner reaches only for
 * `@features/modules`, `@shared` and `@ds` — so the choice was between copying the arithmetic into
 * Planner or lifting it somewhere both can see. It is lifted. `hijri-month-grid` re-exports what it
 * used to define, so its own callers and tests are unaffected and there is still exactly one
 * definition of each rule.
 *
 * ── Everything here is UTC arithmetic on purpose ───────────────────────────
 * A month grid is a civil-calendar question, and civil calendars have no time of day. Building one
 * from local `Date` values invites the failure `daysInGregorianMonth` documents: on a
 * spring-forward date the missing hour resolves forward, the day read back is the *next* one, and a
 * thirty-day month gets thirty-one cells. `Date.UTC` has no such hour to lose, so every function
 * here constructs and reads UTC and the answer is identical on every device in every zone.
 *
 * This is the same reasoning `isLocalDate` in the Planner task contract already applies — it
 * validates a date by round-tripping it through `Date.UTC` — so the calendar and the task contract
 * agree about what a date *is* rather than each having its own idea.
 *
 * ── What this deliberately does not do ─────────────────────────────────────
 * No events, no observances, no holidays, no localisation of month names beyond the English labels
 * the rest of the module framework uses. A grid knows about days; what belongs on a day is the
 * caller's business, and a shared utility that guessed would be putting content on somebody's
 * calendar.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Days per week, and therefore columns in the grid. */
export const GRID_COLUMNS = 7;

/** The card's own border, top/bottom/left/right, as `ModuleCard` draws it. */
const CARD_BORDER = 1;

/**
 * The width of one day cell, given the page column and the card's padding.
 *
 * ── Why the card's *border* is in this arithmetic ───────────────────────────
 * It was not, and that cost an entire column. `contentWidth` is the page column; the card takes its
 * padding from both sides **and** its 1 dp border from both sides. Dividing the un-debited track by
 * seven made each cell ~0.3 dp too wide, so seven no longer fitted and `flexWrap` pushed the last
 * one onto the next row — Sunday rendered permanently empty and every date sat one column to the
 * left of its real weekday. On a calendar, that is not a cosmetic error: it tells the user the
 * wrong day of the week for every date in the month.
 *
 * `Math.floor` is belt and braces on top of the correction. A fractional cell width can still round
 * up in the compositor; flooring guarantees seven fit and wastes at most a fraction of a dp on the
 * trailing edge.
 *
 * Exported so the guarantee — seven cells fit the track — is asserted arithmetically rather than
 * inferred from a screenshot.
 */
export function gridCellWidth(contentWidth: number, cardPadding: number): number {
  const track = contentWidth - cardPadding * 2 - CARD_BORDER * 2;
  return Math.floor(track / GRID_COLUMNS);
}

/**
 * Which column an ISO date belongs in, **Monday first**.
 *
 * Monday-first because that is the convention the Faith calendar already established on screen, and
 * two calendars in one app disagreeing about where the week starts is a defect the user notices
 * immediately.
 *
 * Returns `0` for input it cannot parse rather than throwing: a grid that renders a date in the
 * wrong column is a visible bug somebody reports, whereas a screen that crashes on a malformed
 * route parameter is a worse outcome for the same cause.
 */
export function weekdayColumn(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  /*
    `Number.isFinite`, not `!== undefined`. The original guard checked for a missing part, which is
    the wrong test: `'not-a-date'.split('-')` yields three parts, they are all `NaN`, and `NaN` is
    not `undefined` — so the guard passed, `Date.UTC` returned `NaN`, and this function returned
    `NaN` as a column index while its own docblock promised 0. A `NaN` column silently breaks a grid's
    layout rather than failing anywhere a reader would look.
  */
  if (year === undefined || month === undefined || day === undefined) {
    return 0;
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return 0;
  }
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return Number.isFinite(sundayFirst) ? (sundayFirst + 6) % 7 : 0;
}

/** A month, addressed the way humans say it: a real year and a 1–12 month. */
export type MonthAddress = {
  readonly year: number;
  /** 1–12. One-based, because every other date string in this app is. */
  readonly month: number;
};

/**
 * How many days this month has — 28, 29, 30 or 31, leap Februaries included.
 *
 * `Date.UTC(year, month, 0)` is the day before the first of the *following* month, which is the last
 * day of this one. Month `12` overflows into the next January by design and comes back as 31
 * December, so no branch is needed for the year boundary, and February needs no leap-year table
 * because the platform's civil calendar already has one.
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `2026-09-15` for the given parts, zero-padded. */
export function isoFor(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The month `delta` months away, carrying the year correctly in both directions.
 *
 * Expressed as arithmetic on a zero-based month index rather than as `if (month > 12)`, so stepping
 * back from January or forward from December is the same statement as any other step, and a jump of
 * more than one month is too.
 */
export function shiftMonth(address: MonthAddress, delta: number): MonthAddress {
  const zeroBased = address.year * 12 + (address.month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `September 2026`. The heading a month grid sits under. */
export function monthLabel(address: MonthAddress): string {
  return `${MONTH_NAMES[address.month - 1] ?? ''} ${address.year}`;
}

/** The weekday abbreviations across the top, Monday first. */
export const WEEKDAY_LABELS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type MonthGrid = {
  readonly year: number;
  readonly month: number;
  /** `September 2026`. */
  readonly label: string;
  /** Every day of the month in order, as `YYYY-MM-DD`. Never empty. */
  readonly days: readonly string[];
  /** Empty cells before the first, so the 1st lands in its real weekday column. */
  readonly leadingBlanks: number;
  /** Rows the grid needs once the leading blanks are counted. Four to six. */
  readonly rows: number;
};

/**
 * One month, ready to render.
 *
 * The whole month is returned rather than a padded six-by-seven matrix, because trailing blanks are
 * a layout concern and a grid that flex-wraps does not need them. `leadingBlanks` is the only
 * padding that changes meaning — without it the first of the month sits under the wrong weekday.
 */
export function buildMonthGrid(address: MonthAddress): MonthGrid {
  const total = daysInMonth(address.year, address.month);
  const days: string[] = [];
  for (let day = 1; day <= total; day += 1) {
    days.push(isoFor(address.year, address.month, day));
  }
  const first = days[0] ?? isoFor(address.year, address.month, 1);
  const leadingBlanks = weekdayColumn(first);
  return {
    year: address.year,
    month: address.month,
    label: monthLabel(address),
    days,
    leadingBlanks,
    rows: Math.ceil((total + leadingBlanks) / GRID_COLUMNS),
  };
}

/** The month an ISO date belongs to, or `null` when the string is not one. */
export function monthOf(iso: string): MonthAddress | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/**
 * The day of the month a date names, for rendering the number in its cell.
 *
 * Read off the string rather than from a `Date`, so a cell can never disagree with the key it was
 * built from.
 */
export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

/**
 * `Monday, 15 September 2026` — the whole date, spoken.
 *
 * Day cells render a bare number, which tells a screen-reader user nothing about where in the grid
 * they are. The Faith calendar solved this the same way, and the reason is worth restating: the
 * visual grid *is* the context for a sighted user, and a spoken label has to carry that context
 * itself.
 */
export function spokenDate(iso: string): string {
  const address = monthOf(iso);
  if (address === null) {
    return iso;
  }
  const day = dayOfMonth(iso);
  const weekday = WEEKDAY_FULL[weekdayColumn(iso)] ?? '';
  return `${weekday}, ${day} ${MONTH_NAMES[address.month - 1] ?? ''} ${address.year}`;
}

const WEEKDAY_FULL: readonly string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
