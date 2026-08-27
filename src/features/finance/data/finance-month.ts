/**
 * **The local month, done as string arithmetic** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why no `Date` appears in this file ─────────────────────────────────────
 * A transaction's `occurredOn` is a local `YYYY-MM-DD` the user chose. Its month is the first seven
 * characters of that string, and nothing else. Parsing it into a `Date` to ask which month it is
 * would re-introduce exactly the defect the prayer-time work spent three passes removing: a `Date`
 * built from a local day string is interpreted in the *device's* zone, so a record on the 1st can
 * report as the previous month for anyone east or west of the machine that wrote it.
 *
 * String comparison also disposes of February. A month contains a transaction when their `YYYY-MM`
 * prefixes are equal — so 28, 29, 30 and 31-day months all work without anybody computing a length,
 * and a leap February needs no case of its own. The only arithmetic here is on the month number
 * itself, where a year boundary is the single carry.
 *
 * ── The current month comes from the one day source ────────────────────────
 * `currentMonthOf(today)` takes the day the shared source states — the source that already owns
 * midnight, foreground reconciliation and the timezone (#76). There is no second clock, no timer and
 * no independent notion of "now" in this module, so when the day rolls over the month rolls with it,
 * everywhere, at once.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** A local month, `YYYY-MM`. */
export type FinanceMonth = string;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
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
] as const;

export function isFinanceMonth(value: string): value is FinanceMonth {
  return MONTH_PATTERN.test(value);
}

/** The month a local `YYYY-MM-DD` day falls in. The first seven characters, and nothing else. */
export function monthOfDay(day: string): FinanceMonth {
  return day.slice(0, 7);
}

/** The month the shared day source is currently in. */
export function currentMonthOf(today: string): FinanceMonth {
  return monthOfDay(today);
}

function parts(month: FinanceMonth): { readonly year: number; readonly index: number } {
  const match = MONTH_PATTERN.exec(month);
  if (match === null) {
    /* An unparseable month is a programming error, not a user input — every caller derives one. */
    throw new Error(`Not a month: ${month}`);
  }
  return { year: Number(match[1]), index: Number(match[2]) - 1 };
}

function compose(year: number, index: number): FinanceMonth {
  /* One carry, in one place: the only thing a year boundary needs. */
  const carried = year + Math.floor(index / 12);
  const normalised = ((index % 12) + 12) % 12;
  return `${String(carried).padStart(4, '0')}-${String(normalised + 1).padStart(2, '0')}`;
}

export function previousMonth(month: FinanceMonth): FinanceMonth {
  const { year, index } = parts(month);
  return compose(year, index - 1);
}

export function nextMonth(month: FinanceMonth): FinanceMonth {
  const { year, index } = parts(month);
  return compose(year, index + 1);
}

/**
 * The month as a person reads it — "August 2026".
 *
 * A fixed English table rather than `Intl.DateTimeFormat`: this module already refuses to infer the
 * currency from the device, and a month name that changed language with the phone's locale while
 * every other word on the screen stayed English would be a worse inconsistency than a plain one.
 * Localisation is a whole-app decision, not a per-screen one.
 */
export function formatMonth(month: FinanceMonth): string {
  const { year, index } = parts(month);
  return `${MONTH_NAMES[index]} ${year}`;
}

/** Whether a local day falls inside a month. Prefix equality — exact for every month length. */
export function dayIsInMonth(day: string, month: FinanceMonth): boolean {
  return monthOfDay(day) === month;
}
