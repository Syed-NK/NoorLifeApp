import fs from 'node:fs';
import path from 'node:path';

import { isLocalDate } from '@features/planner/data/planner-task';

import { parseAmountToMinor } from '../data/finance-format';
import type { FinanceCurrency } from '../data/finance-money';
import { currencyMismatch, readReceiptLines } from '../receipts/receipt-reading';

/**
 * **What a receipt is read to say, and what it is never allowed to decide** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The counterexamples are the point ──────────────────────────────────────
 * `1.005` is the number that fails quietly. `parseFloat('1.005') * 100` is `100.49999999999999`,
 * which rounds to `100` — a whole minor unit short of what is printed on the receipt. #93 established
 * that the composer never crosses the decimal point with arithmetic; this suite establishes that the
 * *other* way into the ledger has exactly the same property, because two entry paths that disagree
 * about money are worse than one that is wrong consistently.
 *
 * These cases are asserted against `parseAmountToMinor` as well as through the reader, so a future
 * edit that reimplemented parsing inside the reader would fail rather than pass by coincidence.
 *
 * ── Every "cannot tell" is asserted as a refusal ───────────────────────────
 * Ambiguity is the interesting half of receipt reading, and the failure mode is always the same
 * shape: a plausible guess written silently into a real financial record. So an ambiguous date
 * suggests nothing, a receipt with no currency code claims nothing about currency, and a number that
 * is more precise than the ledger's currency is refused rather than rounded.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const READING = path.join(
  process.cwd(),
  'src',
  'features',
  'finance',
  'receipts',
  'receipt-reading.ts',
);

function lines(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function minors(text: string, currency: FinanceCurrency = 'AED'): readonly number[] {
  return readReceiptLines(lines(text), currency).amounts.map((candidate) => candidate.minor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Amounts, exactly
// ─────────────────────────────────────────────────────────────────────────────

describe('amounts read off a receipt are exact integers', () => {
  it.each([
    ['12.34', 'AED' as const, 1234],
    ['0.01', 'AED' as const, 1],
    ['1.005', 'BHD' as const, 1005],
    ['1.234', 'KWD' as const, 1234],
    ['100', 'JPY' as const, 100],
    ['0.29', 'AED' as const, 29],
    ['0.57', 'AED' as const, 57],
  ])('reads a printed %s in %s as %i', (printed, currency, expected) => {
    /*
      Both directions. The reader must produce the value, and the shared parser must agree — the
      second assertion is what stops the reader growing its own arithmetic later.
    */
    expect(minors(`TOTAL ${printed}`, currency)).toContain(expected);
    expect(parseAmountToMinor(printed, currency)).toEqual({ kind: 'ok', minor: expected });
  });

  it('does not lose the minor unit that a float round-trip loses', () => {
    /*
      The counterexample, stated as the arithmetic it rules out. If this file ever reintroduced
      `Math.round(parseFloat(text) * 100)`, the left-hand side would become 100 and this fails.
    */
    expect(Math.round(parseFloat('1.005') * 100)).toBe(100);
    expect(minors('TOTAL 1.005', 'BHD')).toContain(1005);
  });

  it('reads a grouped thousands amount without its separators', () => {
    expect(minors('GRAND TOTAL 1,234.56')).toContain(123456);
  });

  it('reads a comma as a decimal separator when it is not grouping', () => {
    /* `12,34` is twelve dirhams thirty-four fils on a great many receipts, not one thousand two. */
    expect(minors('TOTAL 12,34')).toContain(1234);
  });

  it('refuses an amount more precise than the ledger currency rather than rounding it', () => {
    /*
      Three decimals against a two-decimal ledger. Rounding would pick 12.34 or 12.35 on the user's
      behalf and lose the difference silently; refusing leaves the field for them to fill.
    */
    expect(minors('TOTAL 12.345', 'AED')).toEqual([]);
    expect(minors('TOTAL 12.345', 'KWD')).toContain(12345);
  });

  it('refuses a fraction in a currency that has no minor unit', () => {
    expect(minors('TOTAL 1200.50', 'JPY')).toEqual([]);
  });

  it('reads nothing monetary from a receipt with no numbers', () => {
    expect(minors('THANK YOU\nPLEASE CALL AGAIN')).toEqual([]);
  });

  it('proposes nothing at all when the ledger has no currency', () => {
    /*
      There is no honest minor-unit reading of "12.34" without knowing what it is in. The date and
      the currency codes are still read, because those do not depend on the ledger.
    */
    const reading = readReceiptLines(lines('TOTAL 12.34\n2026-08-27\nUSD'), null);

    expect(reading.amounts).toEqual([]);
    expect(reading.occurredOn).toBe('2026-08-27');
    expect(reading.currencies).toEqual(['USD']);
  });
});

describe('several monetary values on one receipt', () => {
  const RECEIPT = `
    MARKET
    BREAD          3.50
    MILK           4.25
    SUBTOTAL       7.75
    VAT 5%         0.39
    TOTAL          8.14
  `;

  it('offers every distinct value it read', () => {
    expect([...minors(RECEIPT)].sort((left, right) => left - right)).toEqual([
      39, 350, 425, 775, 814,
    ]);
  });

  it('puts the line that names itself the total first', () => {
    const reading = readReceiptLines(lines(RECEIPT), 'AED');

    expect(reading.amounts[0]).toEqual({ text: '8.14', minor: 814, emphasis: 'total' });
  });

  it('does not let a subtotal outrank the total', () => {
    const reading = readReceiptLines(lines(RECEIPT), 'AED');
    const subtotal = reading.amounts.find((candidate) => candidate.minor === 775);

    expect(subtotal?.emphasis).toBe('plain');
  });

  it.each([
    ['TOTAL VAT 1.00', 100],
    ['TOTAL SAVINGS 2.00', 200],
    ['TOTAL ITEMS 3.00', 300],
  ])('does not treat %s as the total', (line, minor) => {
    const reading = readReceiptLines(lines(`${line}\nTOTAL 9.99`), 'AED');

    expect(reading.amounts.find((candidate) => candidate.minor === minor)?.emphasis).toBe('plain');
    expect(reading.amounts[0]?.minor).toBe(999);
  });

  it('upgrades a value first seen in the body when a later line calls it the total', () => {
    const reading = readReceiptLines(lines('ONE ITEM 8.14\nTOTAL 8.14'), 'AED');

    expect(reading.amounts).toEqual([{ text: '8.14', minor: 814, emphasis: 'total' }]);
  });

  it('is deterministic — the same lines always give the same order', () => {
    const first = readReceiptLines(lines(RECEIPT), 'AED');
    const second = readReceiptLines(lines(RECEIPT), 'AED');

    expect(first).toEqual(second);
  });

  it('ignores numbers that are plainly not money', () => {
    /* A time, a percentage and a card fragment all match a number pattern and none is an amount. */
    const reading = readReceiptLines(lines('14:32\nVAT 5%\nCARD ****1234\nTOTAL 6.00'), 'AED');

    expect(reading.amounts.map((candidate) => candidate.minor)).toEqual([600]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

describe('a date is only suggested when the receipt establishes one', () => {
  it('reads an ISO date as a local date key', () => {
    const reading = readReceiptLines(lines('DATE 2026-08-27'), 'AED');

    expect(reading.occurredOn).toBe('2026-08-27');
    expect(isLocalDate(reading.occurredOn ?? '')).toBe(true);
    expect(reading.dateAmbiguous).toBe(false);
  });

  it.each([
    ['27/08/2026', '2026-08-27'],
    ['27.08.2026', '2026-08-27'],
    ['27-08-26', '2026-08-27'],
    ['08/27/2026', '2026-08-27'],
  ])('resolves %s because one component cannot be a month', (printed, expected) => {
    expect(readReceiptLines(lines(`DATE ${printed}`), 'AED').occurredOn).toBe(expected);
  });

  it('suggests nothing for a date whose day and month could be either way round', () => {
    /*
      The third of April, or the fourth of March. The receipt does not say, the phone's locale is a
      fact about the phone, and a wrong date written silently onto a record is exactly the class of
      quiet error this workflow exists to avoid.
    */
    const reading = readReceiptLines(lines('DATE 03/04/2026'), 'AED');

    expect(reading.occurredOn).toBeNull();
    expect(reading.dateAmbiguous).toBe(true);
  });

  it('prefers a later ISO date over an earlier ambiguous one', () => {
    const reading = readReceiptLines(lines('03/04/2026\nISSUED 2026-04-03'), 'AED');

    expect(reading.occurredOn).toBe('2026-04-03');
  });

  it('suggests nothing for a date that is not a real day', () => {
    expect(readReceiptLines(lines('DATE 2026-02-30'), 'AED').occurredOn).toBeNull();
    expect(readReceiptLines(lines('DATE 31/02/2026'), 'AED').occurredOn).toBeNull();
  });

  it('reports neither a date nor an ambiguity when there is no date at all', () => {
    const reading = readReceiptLines(lines('MARKET\nTOTAL 8.14'), 'AED');

    expect(reading.occurredOn).toBeNull();
    expect(reading.dateAmbiguous).toBe(false);
  });

  it('never returns anything but a local date key', () => {
    for (const printed of ['2026-08-27', '27/08/2026', '13/01/2026', '2026/1/9']) {
      const key = readReceiptLines(lines(printed), 'AED').occurredOn;
      if (key !== null) {
        expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(isLocalDate(key)).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────────────────────

describe('currency is recognised as a code and never inferred', () => {
  it('reads a supported code printed on the receipt', () => {
    expect(readReceiptLines(lines('TOTAL 12.34 AED'), 'AED').currencies).toEqual(['AED']);
  });

  it('ignores a symbol entirely', () => {
    /* `$` is four supported currencies at once, so it establishes nothing. */
    expect(readReceiptLines(lines('TOTAL $12.34'), 'USD').currencies).toEqual([]);
  });

  it('ignores a three-letter word that is not a supported code', () => {
    expect(readReceiptLines(lines('VAT INC TAX'), 'AED').currencies).toEqual([]);
  });

  it('reports no mismatch when the receipt names the ledger currency', () => {
    const reading = readReceiptLines(lines('TOTAL 12.34 AED'), 'AED');

    expect(currencyMismatch(reading, 'AED')).toBeNull();
  });

  it('reports no mismatch when a card slip names both currencies', () => {
    const reading = readReceiptLines(lines('AED 12.34\nCARD CHARGED GBP 2.60'), 'AED');

    expect(currencyMismatch(reading, 'AED')).toBeNull();
  });

  it('reports a mismatch when the receipt names only another currency', () => {
    const reading = readReceiptLines(lines('TOTAL 12.34 USD'), 'AED');

    expect(currencyMismatch(reading, 'AED')).toBe('USD');
  });

  it('reports no mismatch when the receipt names no currency at all', () => {
    /* Absence establishes nothing, and must not block a manual entry in the ledger's currency. */
    const reading = readReceiptLines(lines('TOTAL 12.34'), 'AED');

    expect(currencyMismatch(reading, 'AED')).toBeNull();
    expect(reading.amounts.map((candidate) => candidate.minor)).toEqual([1234]);
  });

  it('never converts: a mismatched amount keeps its own digits', () => {
    const reading = readReceiptLines(lines('TOTAL 12.34 USD'), 'AED');

    /*
      12.34 USD read against an AED ledger is still 1234 minor units. No rate is applied anywhere —
      the screen's job is to say the two disagree, not to reconcile them.
    */
    expect(reading.amounts[0]?.minor).toBe(1234);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the reader may not do
// ─────────────────────────────────────────────────────────────────────────────

describe('the reader stays inside what the ledger supports', () => {
  it('proposes no field the ledger does not have', () => {
    const reading = readReceiptLines(
      lines('MERCHANT LTD\nVAT NO 123456\nTOTAL 8.14 AED\n2026-08-27'),
      'AED',
    );

    /*
      A receipt exposes a merchant, a tax number and line items, and none of them is a
      `FinanceTransaction` field. Asserting the exact key set is what stops one being added here
      "because OCR gives it to us" — the #92 envelope is deliberately small and widening it is a
      migration, not a convenience.
    */
    expect(Object.keys(reading).sort()).toEqual([
      'amounts',
      'currencies',
      'dateAmbiguous',
      'occurredOn',
    ]);
    expect(JSON.stringify(reading)).not.toContain('MERCHANT');
  });

  it('proposes no direction, because a receipt does not establish one', () => {
    const reading = readReceiptLines(lines('REFUND 8.14'), 'AED');

    expect(reading).not.toHaveProperty('direction');
  });

  it('proposes no category, because a receipt does not establish one either', () => {
    const reading = readReceiptLines(lines('SUPERMARKET\nTOTAL 8.14'), 'AED');

    expect(reading).not.toHaveProperty('category');
  });

  it('never turns recognised text into a note by itself', () => {
    const reading = readReceiptLines(lines('MERCHANT LTD\nTOTAL 8.14'), 'AED');

    expect(reading).not.toHaveProperty('note');
  });

  it('does no floating-point arithmetic on money anywhere in the file', () => {
    const source = fs
      .readFileSync(READING, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
      Asserted from the source as well as from the results, because a rounding defect passes almost
      every example. `parseFloat` and a `* 100` are the two shapes that reintroduce it.
    */
    expect(source).not.toMatch(/parseFloat/);
    expect(source).not.toMatch(/\*\s*100\b/);
    expect(source).not.toMatch(/toFixed/);
    expect(source).toContain('parseAmountToMinor');
  });

  it('holds no state between calls', () => {
    /*
      The token matchers are module-level regular expressions with the global flag, and a global
      regex carries `lastIndex` between uses. Two identical readings that differ would be that bug,
      and it would show up as a receipt read correctly once and wrongly the next time.
    */
    const first = readReceiptLines(lines('TOTAL 8.14 AED'), 'AED');
    const second = readReceiptLines(lines('TOTAL 8.14 AED'), 'AED');
    const third = readReceiptLines(lines('TOTAL 8.14 AED'), 'AED');

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('caps how many candidates it will offer', () => {
    const many = Array.from({ length: 40 }, (_, index) => `ITEM ${index + 1}.00`).join('\n');

    expect(readReceiptLines(lines(many), 'AED').amounts.length).toBeLessThanOrEqual(8);
  });
});
