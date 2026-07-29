/**
 * Display formatting helpers.
 *
 * Locale-aware via `Intl`, which React Native 0.86 ships with full ICU on both
 * platforms. The locale is passed in rather than read from a global, so these stay
 * pure and testable and so the localization boundary remains the single authority
 * on which locale is active.
 */

/** Formats a percentage for display, e.g. `68` → `"68%"`. */
export function formatPercentage(value: number, locale = 'en'): string {
  const clamped = Math.max(0, Math.min(100, value));
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(clamped / 100);
}

/** Formats a completion pair, e.g. `4, 5` → `"4 of 5"`. */
export function formatCompletion(completed: number, total: number): string {
  return `${completed} of ${total}`;
}

/** Formats a currency amount, e.g. `2450, 'USD'` → `"$2,450"`. */
export function formatCurrency(amount: number, currency: string, locale = 'en'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Formats a time of day, e.g. `"12:35 PM"`. */
export function formatTime(date: Date, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** Formats a long day label, e.g. `"Monday, May 19"`. */
export function formatDayLabel(date: Date, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * Truncates to `maxLength` with an ellipsis.
 *
 * A last resort only: prefer `numberOfLines` so text still reflows under text
 * scaling instead of being cut at a fixed character count.
 */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
