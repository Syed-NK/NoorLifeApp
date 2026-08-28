import { isLocalDate } from '@features/planner/data/planner-task';

import { parseAmountToMinor } from '../data/finance-format';
import { FINANCE_CURRENCIES, type FinanceCurrency } from '../data/finance-money';

/**
 * **What a receipt appears to say, as suggestions the user then edits** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── A reading, never a decision ────────────────────────────────────────────
 * Nothing in this file is authority. It reads lines of recognised text and returns *candidates*: the
 * amounts it found, the date it could establish, the currency codes it saw. The review screen
 * presents them as a starting point and every one of them is editable, because a photograph of a
 * crumpled receipt read by a model is evidence about what was printed, not a statement about what
 * the user spent.
 *
 * That is why there is no confidence score anywhere here. A number beside a suggestion invites a
 * screen to act on it — to auto-accept above some threshold — and auto-accepting is precisely the
 * behaviour #101 forbids. A field the user must confirm anyway is not improved by a score.
 *
 * ── Money is string work, all the way through ──────────────────────────────
 * Every candidate amount is produced by `parseAmountToMinor` — the same #93 parser the composer
 * uses, which splits on the separator and concatenates rather than multiplying. There is no
 * `parseFloat`, no `Number(text) * 100` and no rounding in this file, and a test asserts that from
 * the source as well as from the results. `1.005` typed into the composer is 1005 fils; `1.005`
 * *read off a receipt* has to be the same 1005, or the two entry paths disagree about money.
 *
 * A grouped number is the one place this file touches the digits, and it does so before the parser
 * rather than instead of it: `1,234.56` has its grouping commas removed only when the token matches
 * the grouping shape exactly, so a European `12,34` still reaches the parser with its comma intact
 * and is read as a decimal separator, which is what it is.
 *
 * ── Why an ambiguous date suggests nothing ─────────────────────────────────
 * `03/04/2026` is the third of April or the fourth of March, and no amount of cleverness in this
 * file can tell which — the receipt does not say, and the device's locale is a fact about the phone
 * rather than about the shop. Guessing would put a wrong date on a real record silently, so the
 * ambiguity is *reported* and the field falls back to today with the screen saying plainly that the
 * receipt did not establish it.
 *
 * A component above 12 resolves it, because no month is 13. That is the only disambiguation used
 * here, and it is a fact rather than a heuristic.
 *
 * ── Why currency is read as a code and never as a symbol ───────────────────
 * `$` is four of this ledger's supported currencies and `£`, `€`, `﷼` are ambiguous in their own
 * ways. A symbol therefore establishes nothing, and a workflow that treated one as a currency would
 * be inferring the very thing #92 refuses to infer. Only a standalone three-letter code the ledger
 * already supports counts as recognised, and even then it is used to *warn about a mismatch* — never
 * to set the ledger's currency and never to convert.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * One monetary value found on the receipt.
 *
 * `text` is kept as it appeared so the screen can show the user what it read, which is what makes a
 * wrong suggestion recognisable as wrong. `minor` is the exact integer that would be stored.
 */
export type ReceiptAmountCandidate = {
  readonly text: string;
  readonly minor: number;
  /** Whether the line it came from named itself a total. Ordering only — never a decision. */
  readonly emphasis: 'total' | 'plain';
};

export type ReceiptReading = {
  /** Best-first, deduplicated by value. Empty when nothing monetary was recognised. */
  readonly amounts: readonly ReceiptAmountCandidate[];
  /** A local `YYYY-MM-DD` key the receipt actually established, or `null`. */
  readonly occurredOn: string | null;
  /** True when a date was found but its day and month order cannot be known. */
  readonly dateAmbiguous: boolean;
  /** Supported currency codes printed on the receipt, in the order first seen. */
  readonly currencies: readonly FinanceCurrency[];
};

/** How many candidates the screen is offered. A receipt has one total and a handful of lines. */
export const MAX_AMOUNT_CANDIDATES = 8;

/**
 * A grouped thousands number, or a plain one with at most three decimal places.
 *
 * Three, not two: BHD, KWD, OMR and TND have three minor digits, and a pattern that stopped at two
 * would silently drop the last digit of every Gulf-dinar receipt. The parser then decides what the
 * *ledger's* currency actually permits, which is where over-precision is refused rather than
 * rounded.
 */
const MONEY_TOKEN = /\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?|\d+(?:[.,]\d{1,3})?/g;

/** A token that is grouping, e.g. `1,234` or `12,345,678` — commas every three digits. */
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?$/;

/**
 * Lines whose value is the one being paid.
 *
 * ── What Android showed that no test could ─────────────────────────────────
 * This fires only when the word and the number are on the *same* recognised line, and on a
 * column-aligned receipt they frequently are not. ML Kit groups text spatially: where the labels run
 * down one column and the amounts down another, it returns them as separate blocks, so the workflow
 * sees `TOTAL` on one line and `8.14` on another and this pattern matches nothing.
 *
 * That is left alone deliberately. The obvious repair — treat the next number after a bare `TOTAL`
 * as the total — is wrong on exactly the layout that motivates it: in a two-block reading the "next
 * number" is the *first* amount in the amounts column, which is the first line item, not the total.
 * It would replace "no emphasis" with a confident wrong answer, which is the failure this whole
 * screen is built to avoid.
 *
 * So when the layout defeats the heuristic there is simply no emphasis, the candidates are offered
 * largest-first, and the screen says "pick the one you paid". The largest number on a receipt is
 * usually the total, the user is choosing from a visible list either way, and nothing claims the
 * receipt established which one it was.
 */
const TOTAL_LINE =
  /\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|amount\s+payable|total\s+to\s+pay|total)\b/i;

/**
 * Lines that say "total" and mean something else.
 *
 * Checked first, so `SUBTOTAL` and `TOTAL VAT` do not outrank the actual total. They are still
 * offered as plain candidates — a subtotal is a real number on the receipt and the user may want it
 * — they simply do not get to be the suggestion.
 */
const NOT_THE_TOTAL =
  /\b(?:sub\s?-?total|total\s+(?:savings|saved|items|qty|quantity|vat|tax|discount)|vat\s+total|tax\s+total)\b/i;

/** An ISO-shaped date: unambiguous by construction. */
const ISO_DATE = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/;

/**
 * A separated date whose component order has to be worked out.
 *
 * Both details here were found by a failing case rather than reasoned out in advance, and both are
 * the kind of thing that reads as correct.
 *
 * The word boundaries are load-bearing. Without them this pattern matches *inside* an ISO date:
 * `2026-02-30` contains `26-02-30`, which reads as the twenty-sixth of February 2030 — a real,
 * plausible, entirely invented date produced from a string whose actual meaning is "no such day".
 * Anchoring the match to a boundary means an ISO-shaped run is either read as ISO or not read.
 *
 * The four-digit year is tried **first**. With `\d{2}` leading the alternation, `27.08.2026` matched
 * a year of `20` and suggested 2020 — off by six years, silently, on the commonest printed form
 * there is.
 */
const LOOSE_DATE = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/;

/** A three-letter word, so `AEDX` and `SAUDI` cannot be read as currency codes. */
const CODE_TOKEN = /\b[A-Z]{3}\b/g;

/**
 * Every date-shaped run in a line, so its digits can be kept out of the money candidates.
 *
 * This exists because a real device said so. On the first Android run the workflow proposed
 * **2026.00 AED** for a receipt whose total was 8.14: `DATE 2026-08-20` contains `2026`, `08` and
 * `20`, all three of which match a money token, and 2026 is the largest number on the receipt so it
 * sorted to the top and prefilled the amount field.
 *
 * The suggestion was wrong in the worst available way — confidently, plausibly, and in the field the
 * user is most likely to accept without re-reading. A day of the month is not an amount of money, and
 * the fix is to say so where the tokens are found rather than to hope the ranking hides it.
 */
const DATE_SPANS = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2})\b/g;

/** A time, whose digits are not money either — `14:32` is not fourteen of anything. */
const TIME_SPANS = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

/** Character ranges in a line that a money token may not overlap. */
function excludedSpans(line: string): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  for (const pattern of [DATE_SPANS, TIME_SPANS]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(line);
    while (match !== null) {
      spans.push([match.index, match.index + match[0].length]);
      match = pattern.exec(line);
    }
  }
  return spans;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKey(year: number, month: number, day: number): string | null {
  const key = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return isLocalDate(key) ? key : null;
}

/**
 * Whether a matched token is really money rather than part of something else.
 *
 * A time (`12:34`), a percentage (`5%`), a quantity marker (`x2`) and a card fragment (`****1234`)
 * all match a number pattern and none of them is an amount. The characters *around* the match are
 * what tell them apart, which is why this looks at the line rather than the token.
 */
function isMonetaryContext(
  line: string,
  start: number,
  end: number,
  excluded: readonly (readonly [number, number])[],
): boolean {
  /* Inside a date or a time. See `DATE_SPANS` — this is the 2026.00 case, from a real device. */
  if (excluded.some(([from, to]) => start < to && end > from)) {
    return false;
  }
  const before = line.slice(Math.max(0, start - 2), start);
  const after = line.slice(end, end + 2);
  if (/[:%]/.test(after.charAt(0)) || /[:%]/.test(before.slice(-1))) {
    return false;
  }
  if (/[*xX#]$/.test(before.trim()) && before.trim().length > 0) {
    return false;
  }
  return true;
}

function collectAmounts(
  lines: readonly string[],
  currency: FinanceCurrency,
): readonly ReceiptAmountCandidate[] {
  const found: ReceiptAmountCandidate[] = [];
  const seen = new Set<number>();

  for (const line of lines) {
    const emphasis: ReceiptAmountCandidate['emphasis'] =
      !NOT_THE_TOTAL.test(line) && TOTAL_LINE.test(line) ? 'total' : 'plain';
    const excluded = excludedSpans(line);

    MONEY_TOKEN.lastIndex = 0;
    let match = MONEY_TOKEN.exec(line);
    while (match !== null) {
      const token = match[0];
      const start = match.index;
      const end = start + token.length;
      match = MONEY_TOKEN.exec(line);

      if (!isMonetaryContext(line, start, end, excluded)) {
        continue;
      }
      /*
        Grouping commas are removed only from a token that is *shaped* like grouping. `12,34` is not,
        so it keeps its comma and the #93 parser reads it as a decimal separator — which is what a
        comma means on most of the receipts this app will meet.
      */
      const normalised = GROUPED.test(token) ? token.replace(/,/g, '') : token;
      const parsed = parseAmountToMinor(normalised, currency);
      if (parsed.kind !== 'ok') {
        continue;
      }
      if (seen.has(parsed.minor)) {
        /*
          Deduplicated by value, but a later *total* line upgrades an earlier plain sighting of the
          same number: a receipt commonly prints the amount once in the body and again as the total,
          and the second sighting is the one that means something.
        */
        const existing = found.find((candidate) => candidate.minor === parsed.minor);
        if (existing !== undefined && existing.emphasis === 'plain' && emphasis === 'total') {
          found[found.indexOf(existing)] = { ...existing, emphasis: 'total' };
        }
        continue;
      }
      seen.add(parsed.minor);
      found.push({ text: token, minor: parsed.minor, emphasis });
    }
  }

  /*
    Totals first, then larger before smaller, then by the text so the order cannot depend on anything
    outside the input. A receipt's grand total is the largest thing labelled "total"; among unlabelled
    numbers the largest is the least bad first guess, and the user is choosing from a list either way.
  */
  return [...found]
    .sort((left, right) => {
      if (left.emphasis !== right.emphasis) {
        return left.emphasis === 'total' ? -1 : 1;
      }
      if (left.minor !== right.minor) {
        return right.minor - left.minor;
      }
      return left.text < right.text ? -1 : 1;
    })
    .slice(0, MAX_AMOUNT_CANDIDATES);
}

function collectDate(lines: readonly string[]): { key: string | null; ambiguous: boolean } {
  let ambiguous = false;

  for (const line of lines) {
    const iso = ISO_DATE.exec(line);
    if (iso !== null) {
      const key = dateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      if (key !== null) {
        return { key, ambiguous: false };
      }
    }

    const loose = LOOSE_DATE.exec(line);
    if (loose === null) {
      continue;
    }
    const first = Number(loose[1]);
    const second = Number(loose[2]);
    const rawYear = loose[3] ?? '';
    /*
      A two-digit year is read as 20xx. Receipts are not historical documents and this app did not
      exist in 1999; the alternative — refusing every `12/03/26` — would reject the commonest printed
      form on the grounds of a century nobody means.
    */
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);

    if (first > 12 && second <= 12) {
      const key = dateKey(year, second, first);
      if (key !== null) {
        return { key, ambiguous: false };
      }
      continue;
    }
    if (second > 12 && first <= 12) {
      const key = dateKey(year, first, second);
      if (key !== null) {
        return { key, ambiguous: false };
      }
      continue;
    }
    /*
      Both components could be a month. The receipt genuinely does not say which, so this records
      that a date was seen and refuses to invent one — and keeps looking, because a later line may
      carry an ISO date that settles it.
    */
    if (first <= 12 && second <= 12 && dateKey(year, second, first) !== null) {
      ambiguous = true;
    }
  }

  return { key: null, ambiguous };
}

function collectCurrencies(lines: readonly string[]): readonly FinanceCurrency[] {
  const found: FinanceCurrency[] = [];
  for (const line of lines) {
    CODE_TOKEN.lastIndex = 0;
    let match = CODE_TOKEN.exec(line.toUpperCase());
    while (match !== null) {
      const code = match[0];
      match = CODE_TOKEN.exec(line.toUpperCase());
      if (
        Object.prototype.hasOwnProperty.call(FINANCE_CURRENCIES, code) &&
        !found.includes(code as FinanceCurrency)
      ) {
        found.push(code as FinanceCurrency);
      }
    }
  }
  return found;
}

/**
 * Reads recognised lines into suggestions.
 *
 * `currency` is the **ledger's** currency, and it is what the amounts are parsed against — a
 * three-decimal receipt read against a two-decimal ledger is over-precise and is refused rather than
 * rounded, exactly as it would be if the user had typed it. `null` means the ledger is not yet
 * configured, in which case no amount is proposed at all: there is no honest minor-unit reading of
 * "12.34" without knowing what currency it is in.
 */
export function readReceiptLines(
  lines: readonly string[],
  currency: FinanceCurrency | null,
): ReceiptReading {
  const date = collectDate(lines);
  return {
    amounts: currency === null ? [] : collectAmounts(lines, currency),
    occurredOn: date.key,
    dateAmbiguous: date.ambiguous,
    currencies: collectCurrencies(lines),
  };
}

/**
 * The currency the receipt disagrees with the ledger about, or `null` when there is no disagreement.
 *
 * A receipt that names the ledger's own currency anywhere is treated as agreeing, even if it also
 * names another — a card slip commonly prints both the transaction currency and the card's. A
 * receipt that names only other currencies is a real mismatch the user has to resolve, and a receipt
 * that names none establishes nothing either way.
 */
export function currencyMismatch(
  reading: ReceiptReading,
  ledgerCurrency: FinanceCurrency,
): FinanceCurrency | null {
  if (reading.currencies.length === 0 || reading.currencies.includes(ledgerCurrency)) {
    return null;
  }
  return reading.currencies[0] ?? null;
}
