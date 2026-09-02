import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';

import { LocalizationProvider } from '@application/providers/localization-provider';
import { touchTarget } from '@ds/tokens';
import { pixelSafeTouchTarget } from '@shared/utils/a11y';
import { moduleRegistry } from '@features/modules/module-registry';
import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import { createFinanceGoalRepository } from '../data/finance-goal.repository';
import {
  createFinanceLedgerRepository,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { FinanceProvider } from '../di/finance-provider';
import { FinanceSavingsScreen } from '../screens/finance-savings-screen';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **Every Finance choice chip is at least 44 dp on both axes** — issue #116.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * Three screens had each copied a `ChoiceRow`, and all three bounded the chip's height with
 * `minimumTouchTargetSize()` and its width with nothing. Width was therefore
 * `text + 2 × paddingHorizontal`, so a short label produced an undersized control.
 *
 * Measured on `emulator-5554` — density 2.625, font scale 1.0, release build of `f5a9e02` — the
 * category filter's `All` chip reported `bounds=[98,1186][201,1302]`: 103 × 116 px, **39.238** ×
 * 44.190 dp. The height was already right; the width was 4.762 dp short.
 *
 * ── Why the label is not allowed to be the bound ───────────────────────────
 * At font scale 1.5 the same chip measures 49.14 dp and passes, because the bigger text pushes it
 * over on its own. So the control was compliant only for users who had already enlarged their
 * text. Every assertion here that concerns size uses a **short** label, so no test can pass because
 * a word happened to be wide enough.
 *
 * ── What is refused ────────────────────────────────────────────────────────
 * `hitSlop`, which leaves the accessibility node undersized. `dp()`, which scales a bound down on
 * narrow screens and is the defect #115 measures elsewhere. A local 45 or 46, which is a magic
 * number that is wrong at some other density.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const NOW = new Date(2026, 7, 10, 9, 0, 0);
const TODAY = '2026-08-10';

/** The density the defect was measured at. 44 × 2.625 = 115.5 px — no whole-pixel representation. */
const PIXEL_CLASS_DENSITY = 2.625;

const FINANCE_ROOT = path.join(process.cwd(), 'src/features/finance');
const PRIMITIVE = path.join(FINANCE_ROOT, 'components/finance-choice-row.tsx');
const MIGRATED_SCREENS = [
  'screens/finance-spending-screen.tsx',
  'screens/finance-savings-screen.tsx',
  'screens/finance-receipts-screen.tsx',
];

const readPrimitive = () => fs.readFileSync(PRIMITIVE, 'utf8');
const readFinance = (relative: string) =>
  fs.readFileSync(path.join(FINANCE_ROOT, relative), 'utf8');

/**
 * Every TypeScript source file under `src/features/finance`.
 *
 * `includeTests` is off for structural assertions — a suite that quotes a symbol must not read as
 * a second declaration of it — and on for the raw-byte scan, where a test file is exactly as
 * capable of hiding itself from `grep` as production source is.
 */
function financeSources(includeTests = true): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!includeTests && entry.name === '__tests__') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        found.push(full);
      }
    }
  };
  walk(FINANCE_ROOT);
  return found;
}

let harness: PlannerDayHarness | null = null;

function memory() {
  const rows = new Map<string, string>();
  const storage: FinanceStorage = {
    getItem: async (key) => {
      await Promise.resolve();
      return rows.get(key) ?? null;
    },
    setItem: async (key, value) => {
      await Promise.resolve();
      rows.set(key, value);
    },
  };
  return { storage, rows };
}

const ledgerRepo = (storage: FinanceStorage) =>
  createFinanceLedgerRepository({
    ownerId: OWNER,
    storage,
    id: () => 'finance.aaaaaaaa-1111-4111-8111-000000000001',
    now: () => new Date('2026-08-10T09:00:00.000Z'),
  });

const goalRepo = (storage: FinanceStorage) =>
  createFinanceGoalRepository({
    ownerId: OWNER,
    storage,
    id: () => 'goal.aaaaaaaa-1111-4111-8111-000000000002',
    now: () => new Date('2026-08-10T09:00:00.000Z'),
  });

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Flattens a style prop to the object a renderer would apply. */
function flat(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style.flat(6) : [style])
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});
}

function bounds(testID: string): { minWidth: number; minHeight: number } {
  const style = flat(screen.getByTestId(testID).props.style);
  return { minWidth: Number(style.minWidth), minHeight: Number(style.minHeight) };
}

/**
 * Spending, with one categorised transaction so the filter renders its chips.
 *
 * The category is deliberately short: `Gas` and the unconditional `All` are the labels that expose
 * a missing width bound, and a test seeded with `Groceries` would pass with the defect present.
 */
async function renderSpending(fontScale: number, width?: number) {
  pinModuleWindow(width === undefined ? { fontScale } : { fontScale, width });
  const { storage } = memory();
  const ledger = ledgerRepo(storage);
  await ledger.setCurrency('AED');
  await ledger.createTransaction({
    direction: 'expense',
    amountMinor: 1_250,
    occurredOn: TODAY,
    category: 'Gas',
    goalId: null,
  });
  await render(
    <LocalizationProvider>
      <FinanceProvider repository={ledgerRepo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>
    </LocalizationProvider>,
  );
  await settle();
}

async function renderSavings(fontScale: number) {
  pinModuleWindow({ fontScale });
  const { storage } = memory();
  const ledger = ledgerRepo(storage);
  await ledger.setCurrency('AED');
  await render(
    <LocalizationProvider>
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <FinanceSavingsScreen />
      </FinanceProvider>
    </LocalizationProvider>,
  );
  await settle();
}

beforeEach(() => {
  pinModuleWindow();
  harness = installPlannerDaySource(NOW);
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// One primitive, and the copies are gone
// ─────────────────────────────────────────────────────────────────────────────

describe('the shared choice row is the only one', () => {
  it('exists, exported once, in the Finance component directory', () => {
    expect(fs.existsSync(PRIMITIVE)).toBe(true);
    const source = readPrimitive();
    expect(source.split('export function FinanceChoiceRow(').length - 1).toBe(1);
  });

  it('is the only definition anywhere under Finance', () => {
    /* Production sources only: a suite that quotes the symbol is not a second definition of it. */
    const definitions = financeSources(false).filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return (
        source.includes('function ChoiceRow(') || source.includes('function FinanceChoiceRow(')
      );
    });
    expect(definitions).toEqual([PRIMITIVE]);
  });

  it.each(MIGRATED_SCREENS)('%s keeps no local copy and renders the shared one', (file) => {
    const source = readFinance(file);
    expect(source).not.toContain('function ChoiceRow(');
    expect(source).toContain('<FinanceChoiceRow');
    expect(source).toContain("from '../components/finance-choice-row'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Both axes, from the one helper, on the accessibility node
// ─────────────────────────────────────────────────────────────────────────────

describe('the bound', () => {
  it('applies the shared pixel-safe helper to the width', () => {
    expect(readPrimitive()).toContain('minWidth: minimumTouchTargetSize()');
  });

  it('applies the same helper to the height', () => {
    expect(readPrimitive()).toContain('minHeight: minimumTouchTargetSize()');
  });

  it('derives from the one 44 dp token rather than a local number', () => {
    const source = readPrimitive();
    expect(source).toContain("from '@shared/utils/a11y'");
    /* No invented floor: 45 and 46 are the numbers a hand-tuned fix reaches for. */
    expect(source).not.toMatch(/min(Height|Width): 4[4-9]\b/);
  });

  it('passes neither axis through the dp layout scale', () => {
    const source = readPrimitive();
    expect(source).not.toMatch(/min(Height|Width): dp\(/);
    expect(source).not.toMatch(/min(Height|Width): [a-zA-Z]*[Ss]caled\(/);
  });

  it('sits on the Pressable that carries the accessibility contract', async () => {
    await renderSpending(1);
    const node = screen.getByTestId('finance-filters-category-all');
    /* The measured node and the announced node are the same node. */
    expect(node.props.accessibilityRole).toBe('radio');
    expect(node.props.accessibilityLabel).toBe('Category: All');
    const style = flat(node.props.style);
    expect(Number(style.minWidth)).toBeGreaterThanOrEqual(touchTarget.minimum);
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(touchTarget.minimum);
  });

  it('does not substitute hitSlop on any chip', async () => {
    await renderSpending(1);
    for (const id of ['finance-filters-category-all', 'finance-filters-category-Gas']) {
      expect(screen.getByTestId(id).props.hitSlop).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Geometry, across the densities that separate ceil from round
// ─────────────────────────────────────────────────────────────────────────────

describe('the geometry the bound produces', () => {
  it('is 116 px / 44.190 dp at the density the defect was measured at', () => {
    const size = pixelSafeTouchTarget(PIXEL_CLASS_DENSITY);
    expect(size * PIXEL_CLASS_DENSITY).toBe(116);
    expect(Number(size.toFixed(3))).toBe(44.19);
    expect(size).toBeGreaterThanOrEqual(touchTarget.minimum);
  });

  it.each([1, 2, 3, 4])('is exactly 44 dp at integer density %p', (density) => {
    expect(pixelSafeTouchTarget(density)).toBe(touchTarget.minimum);
  });

  it.each([1.1, 1.25, 1.5, 1.75, 2.625, 2.75, 3.5])(
    'never rounds below the minimum at fractional density %p',
    (density) => {
      const size = pixelSafeTouchTarget(density);
      expect(size).toBeGreaterThanOrEqual(touchTarget.minimum);
      /* A whole number of pixels, so the grid cannot move it afterwards. */
      expect(Number.isInteger(Math.round(size * density))).toBe(true);
      expect(Math.abs(size * density - Math.round(size * density))).toBeLessThan(1e-9);
    },
  );

  it('rounds up rather than to nearest, on both sides of a half pixel', () => {
    /*
      `round` and `ceil` agree at 2.625 and disagree here, which is the whole point of checking a
      second density: a rule verified only at 2.625 is not verified.
    */
    for (const density of [1.1, 2.2, 2.4]) {
      const raw = touchTarget.minimum * density;
      expect(pixelSafeTouchTarget(density) * density).toBeCloseTo(Math.ceil(raw), 9);
      expect(pixelSafeTouchTarget(density)).toBeGreaterThanOrEqual(touchTarget.minimum);
    }
  });

  it('falls back to the plain contract for an unusable density', () => {
    for (const density of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pixelSafeTouchTarget(density)).toBe(touchTarget.minimum);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rendered controls, at both font scales
// ─────────────────────────────────────────────────────────────────────────────

describe('every rendered Finance chip', () => {
  it.each([1, 1.5])(
    'holds both axes on the short "All" label at font scale %p',
    async (fontScale) => {
      const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(PIXEL_CLASS_DENSITY);
      try {
        await renderSpending(fontScale);
        const { minWidth, minHeight } = bounds('finance-filters-category-all');
        expect(minWidth).toBeGreaterThanOrEqual(touchTarget.minimum);
        expect(minHeight).toBeGreaterThanOrEqual(touchTarget.minimum);
        expect(minWidth * PIXEL_CLASS_DENSITY).toBe(116);
        expect(minHeight * PIXEL_CLASS_DENSITY).toBe(116);
        /* One contract, not two numbers that agree today. */
        expect(minWidth).toBe(minHeight);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it.each([1, 1.5])(
    'holds both axes on every Spending chip at font scale %p',
    async (fontScale) => {
      await renderSpending(fontScale);
      const ids = [
        'finance-filters-category-all',
        'finance-filters-category-Gas',
        'finance-direction-expense',
        'finance-direction-income',
        'finance-direction-refund',
      ];
      for (const id of ids) {
        const node = screen.queryByTestId(id);
        if (node === null) continue;
        const { minWidth, minHeight } = bounds(id);
        expect(minWidth).toBeGreaterThanOrEqual(touchTarget.minimum);
        expect(minHeight).toBeGreaterThanOrEqual(touchTarget.minimum);
      }
    },
  );

  it.each([1, 1.5])('holds both axes on the Savings chips at font scale %p', async (fontScale) => {
    await renderSavings(fontScale);
    for (const id of [
      'finance-contribution-direction-expense',
      'finance-contribution-direction-income',
    ]) {
      const node = screen.queryByTestId(id);
      if (node === null) continue;
      const { minWidth, minHeight } = bounds(id);
      expect(minWidth).toBeGreaterThanOrEqual(touchTarget.minimum);
      expect(minHeight).toBeGreaterThanOrEqual(touchTarget.minimum);
    }
  });

  it('does not shrink the bound on a 320 dp screen', async () => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(PIXEL_CLASS_DENSITY);
    try {
      /* `dp()` drops below 1 here; a bound that followed it would stop being a bound. */
      await renderSpending(1, 320);
      const { minWidth, minHeight } = bounds('finance-filters-category-all');
      expect(minWidth).toBeGreaterThanOrEqual(touchTarget.minimum);
      expect(minHeight).toBeGreaterThanOrEqual(touchTarget.minimum);
    } finally {
      spy.mockRestore();
    }
  });

  it('wraps instead of clipping when the row runs out of width', () => {
    /* Wrapping is what lets a bounded chip move to a second line rather than overflow the card. */
    expect(readPrimitive()).toContain("choices: { flexDirection: 'row', flexWrap: 'wrap' }");
  });

  it('keeps labels legible: no truncation, no shrink-to-fit, no disabled font scaling', () => {
    const source = readPrimitive();
    expect(source).not.toContain('numberOfLines');
    expect(source).not.toContain('adjustsFontSizeToFit');
    expect(source).not.toContain('allowFontScaling');
  });

  it('renders a long label in full', async () => {
    await renderSpending(1.5);
    expect(screen.getByText('Expense')).toBeTruthy();
    expect(screen.getByText('Expense').props.numberOfLines).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Behaviour the migration must not have changed
// ─────────────────────────────────────────────────────────────────────────────

describe('behaviour is unchanged by the migration', () => {
  it('announces selection rather than carrying it in colour', async () => {
    await renderSpending(1);
    expect(screen.getByTestId('finance-filters-category-all').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('finance-filters-category-Gas').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('keeps the Expense / Income / Refund labels, roles and state', async () => {
    await renderSpending(1);
    await act(async () => {
      void fireEvent.press(screen.getByTestId('finance-open-composer'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    for (const [chip, label] of [
      ['expense', 'Expense'],
      ['income', 'Income'],
      ['refund', 'Refund'],
    ] as const) {
      const node = screen.getByTestId(`finance-direction-${chip}`);
      expect(node.props.accessibilityRole).toBe('radio');
      expect(node.props.accessibilityLabel).toBe(`What this is: ${label}`);
      expect(node.props.accessibilityState).toEqual({ selected: chip === 'expense' });
    }
  });

  it('keeps the empty filter key rendering as the "all" testID', async () => {
    await renderSpending(1);
    /* The one behavioural difference between the old copies, preserved for every caller. */
    expect(screen.getByTestId('finance-filters-category-all')).toBeTruthy();
    expect(screen.getByTestId('finance-filters-category-all').props.accessibilityLabel).toBe(
      'Category: All',
    );
  });

  it('leaves Receipts unavailable, with no destination', () => {
    const finance = moduleRegistry.finance;
    const receipts = finance?.capabilities.find((capability) => capability.key === 'receipts');
    expect(receipts?.available).toBe(false);
    expect(receipts?.href).toBeUndefined();
    const bank = finance?.capabilities.find((capability) => capability.key === 'bank-sync');
    expect(bank?.available).toBe(false);
    expect(bank?.href).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source hygiene: the raw NUL that hid these controls from an audit
// ─────────────────────────────────────────────────────────────────────────────

describe('Finance source stays text', () => {
  it('contains no raw NUL byte in any TypeScript or TSX file', () => {
    const offenders = financeSources().filter((file) => fs.readFileSync(file).indexOf(0) !== -1);
    /*
      A NUL makes `grep`, `file` and most review tooling classify the source as binary. That is how
      the undersized chips in `finance-spending-screen.tsx` survived an audit looking for them.
    */
    expect(offenders).toEqual([]);
  });

  it('keeps the uncategorised sentinel as an escape with the identical runtime value', () => {
    const source = readFinance('screens/finance-spending-screen.tsx');
    const escaped = String.fromCharCode(92) + 'u0000uncategorised';
    expect(source).toContain(escaped);
    /*
      The escape and the raw byte denote the same string, so the key, its uniqueness and the row
      order are unmoved. Built from a char code rather than typed — typing it is exactly how a raw
      NUL reached the production file in the first place, and it reached this test file too.
    */
    const sentinel = String.fromCharCode(0) + 'uncategorised';
    expect(sentinel.charCodeAt(0)).toBe(0);
    expect(sentinel.length).toBe('uncategorised'.length + 1);
    /* And it still cannot collide with a real category of that name. */
    expect(sentinel).not.toBe('uncategorised');
    /* The file states it as six source characters and holds no NUL byte of its own. */
    expect(Buffer.from(source, 'utf8').indexOf(0)).toBe(-1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Neighbouring scopes this change must not have entered
// ─────────────────────────────────────────────────────────────────────────────

describe('scope', () => {
  it('shares the floor with the rest of the app, now that #115 has migrated it', () => {
    /*
      This guard was inverted when #115 landed. It previously asserted that `module-header.tsx`
      still carried the scaled bound, because #116 deliberately did not widen into shared chrome
      and that had to be provable. #115 is the issue allowed to change it, so the guard now asserts
      the opposite: the shared header takes the same density-safe floor these chips do.
    */
    const header = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/components/module-header.tsx'),
      'utf8',
    );
    expect(header).toContain('minimumTouchTargetSize()');
    expect(header).not.toContain('dp(moduleLayout.minTouchTarget)');
  });

  it('leaves #84 navigation geometry intact while it takes the shared floor', () => {
    const nav = fs.readFileSync(
      path.join(process.cwd(), 'src/design-system/components/module-bottom-navigation.tsx'),
      'utf8',
    );
    /* #115 raised the bound; the slot geometry #84 fixed is untouched and Finance stays out of it. */
    expect(nav).toContain('minimumTouchTargetSize()');
    expect(nav).not.toContain('FinanceChoiceRow');
  });

  it('introduces no raster or pictogram behaviour', () => {
    const source = readPrimitive();
    expect(source).not.toContain('Image');
    expect(source).not.toContain('raster');
    expect(source).not.toContain('require(');
  });
});
