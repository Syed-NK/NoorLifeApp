import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';

import { LocalizationProvider } from '@application/providers/localization-provider';
import { touchTarget } from '@ds/tokens';
import { minimumTouchTargetSize, pixelSafeTouchTarget } from '@shared/utils/a11y';
import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import {
  createFinanceLedgerRepository,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { FinanceProvider } from '../di/finance-provider';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **The 44 dp minimum, after the pixel grid has had its say** — measured defect.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was measured, and why the style was not enough ────────────────────
 * The Expense / Income / Refund chips carried `minHeight: 44` and rendered at **43.8 dp** on
 * `emulator-5554`. Not a rounding curiosity in the report — the real node was 115 px on a 2.625
 * density screen, and 115 ÷ 2.625 is 43.81. Every device at that density had an undersized
 * accessibility node, and the style said otherwise.
 *
 * The cause is that a dp request is not a dp result: Yoga snaps every edge to a whole pixel, and
 * 44 × 2.625 = 115.5 has no whole-pixel representation. Asking for the *next* pixel up —
 * `ceil(115.5) = 116 px`, 44.19 dp — is a value the grid can hold exactly, so nothing can round it
 * down.
 *
 * ── What this file refuses to accept as a fix ──────────────────────────────
 * `hitSlop`, because it leaves the accessibility node undersized — a screen reader and an
 * accessibility scanner both still see 43.8 dp, and only a finger sees more. A hard-coded 45 or 46,
 * because it is a magic number that is wrong at another density. Shrinking the text, disabling font
 * scaling, or truncating a label, because those trade an accessibility bound for a different
 * accessibility failure.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const NOW = new Date(2026, 7, 10, 9, 0, 0);
const TODAY = '2026-08-10';

/** The density the defect was measured at, and the reason this file exists. */
const PIXEL_CLASS_DENSITY = 2.625;

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

const CHIPS = ['expense', 'income', 'refund'] as const;

async function openComposer(fontScale: number) {
  pinModuleWindow({ fontScale });
  const { storage } = memory();
  const ledger = ledgerRepo(storage);
  await ledger.setCurrency('AED');

  await render(
    <LocalizationProvider>
      <FinanceProvider repository={ledgerRepo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>
    </LocalizationProvider>,
  );
  await settle();

  await act(async () => {
    fireEvent.press(screen.getByTestId('finance-open-composer'));
    await Promise.resolve();
    await Promise.resolve();
  });
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
// The shared floor
// ─────────────────────────────────────────────────────────────────────────────

describe('the touch-target floor survives the pixel grid', () => {
  it('reproduces the defect the raw contract had', () => {
    /* What the old style asked for, and what the grid gave back. */
    const requested = touchTarget.minimum;
    const painted = Math.floor(requested * PIXEL_CLASS_DENSITY) / PIXEL_CLASS_DENSITY;
    expect(painted).toBeCloseTo(43.81, 2);
    expect(painted).toBeLessThan(touchTarget.minimum);
  });

  it('raises the request to the next whole pixel, and only that', () => {
    const safe = pixelSafeTouchTarget(PIXEL_CLASS_DENSITY);
    expect(safe * PIXEL_CLASS_DENSITY).toBe(116);
    expect(safe).toBeGreaterThanOrEqual(touchTarget.minimum);
    expect(safe).toBeCloseTo(44.19, 2);
  });

  /*
    The fractional densities matter most where the fraction is *below* a half: at 1.1, 44 dp is
    48.4 px, and rounding to the nearest pixel gives 48 — 43.64 dp, still under the minimum.
    Rounding *up* is what makes the bound hold at every density rather than most of them.
  */
  it.each([1, 1.1, 1.5, 2, 2.1, 2.625, 3, 3.1, 3.5, 4])(
    'never lands below 44 dp at density %p',
    (density) => {
      const safe = pixelSafeTouchTarget(density);
      expect(safe).toBeGreaterThanOrEqual(touchTarget.minimum);
      /* And it is a whole number of pixels, so nothing downstream can round it down. */
      expect(Number.isInteger(Math.round(safe * density))).toBe(true);
      expect(Math.abs(safe * density - Math.round(safe * density))).toBeLessThan(1e-9);
    },
  );

  it.each([1, 2, 3, 4])('is exactly 44 at the integer density %p, changing nothing', (density) => {
    expect(pixelSafeTouchTarget(density)).toBe(touchTarget.minimum);
  });

  it('falls back to the plain contract for an unusable density', () => {
    for (const density of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pixelSafeTouchTarget(density)).toBe(touchTarget.minimum);
    }
  });

  it('reads the live density rather than a cached one', () => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(PIXEL_CLASS_DENSITY);
    try {
      expect(minimumTouchTargetSize()).toBe(pixelSafeTouchTarget(PIXEL_CLASS_DENSITY));
      spy.mockReturnValue(3);
      expect(minimumTouchTargetSize()).toBe(44);
    } finally {
      spy.mockRestore();
    }
  });

  it('is derived from the one shared 44 dp contract, not a local number', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/shared/utils/a11y.ts'), 'utf8');
    expect(source).toContain('touchTarget.minimum');
    /* No magic 45/46 anywhere in the helper. */
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\b4[5-9]\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The selector
// ─────────────────────────────────────────────────────────────────────────────

describe('the Expense / Income / Refund selector', () => {
  it.each([1, 1.5])('gives all three chips the floor at font scale %p', async (fontScale) => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(PIXEL_CLASS_DENSITY);
    try {
      await openComposer(fontScale);
      const heights = CHIPS.map((chip) => {
        const style = flat(screen.getByTestId(`finance-direction-${chip}`).props.style);
        return Number(style.minHeight);
      });
      for (const height of heights) {
        expect(height).toBeGreaterThanOrEqual(touchTarget.minimum);
        expect(height * PIXEL_CLASS_DENSITY).toBe(116);
      }
      /* Equal by construction — one contract, not three numbers that happen to agree today. */
      expect(new Set(heights).size).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not scale the floor down on a narrow screen', async () => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(PIXEL_CLASS_DENSITY);
    try {
      /* 320 dp drives `dp()` below 1; a minimum that shrank with it would not be a minimum. */
      pinModuleWindow({ width: 320, fontScale: 1.5 });
      await openComposer(1.5);
      for (const chip of CHIPS) {
        const style = flat(screen.getByTestId(`finance-direction-${chip}`).props.style);
        expect(Number(style.minHeight)).toBeGreaterThanOrEqual(touchTarget.minimum);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps its labels, roles and selected state', async () => {
    await openComposer(1.5);
    for (const [chip, label] of [
      ['expense', 'Expense'],
      ['income', 'Income'],
      ['refund', 'Refund'],
    ] as const) {
      const node = screen.getByTestId(`finance-direction-${chip}`);
      expect(node.props.accessibilityRole).toBe('radio');
      expect(node.props.accessibilityLabel).toBe(`What this is: ${label}`);
      /* Selection is announced, so it is never carried by colour alone. */
      expect(node.props.accessibilityState).toEqual({ selected: chip === 'expense' });
    }
  });

  it('renders every label in full, with no truncation', async () => {
    await openComposer(1.5);
    for (const label of ['Expense', 'Income', 'Refund']) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(label).props.numberOfLines).toBeUndefined();
    }
  });

  it('wraps rather than overflowing when the row cannot hold three chips', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-spending-screen.tsx'),
      'utf8',
    );
    /* The row wraps, so a narrow screen stacks the chips instead of clipping one off the edge. */
    expect(source).toMatch(/choices: \{ flexDirection: 'row', flexWrap: 'wrap' \}/);
  });

  it('does not disable font scaling or shrink the type to fit', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-spending-screen.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/allowFontScaling\s*=\s*\{?false/);
    expect(source).not.toMatch(/adjustsFontSizeToFit/);
    expect(source).not.toMatch(/numberOfLines/);
  });

  it('does not substitute hitSlop for the bound', async () => {
    await openComposer(1.5);
    for (const chip of CHIPS) {
      expect(screen.getByTestId(`finance-direction-${chip}`).props.hitSlop).toBeUndefined();
    }
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-spending-screen.tsx'),
      'utf8',
    );
    expect(source).not.toContain('hitSlop');
    expect(source).not.toContain('minimumHitSlop');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Every other control this PR touched
// ─────────────────────────────────────────────────────────────────────────────

describe('no Finance control still asks for the unrounded minimum', () => {
  const SCREENS = [
    'finance-spending-screen.tsx',
    'finance-budgets-screen.tsx',
    'finance-savings-screen.tsx',
    'finance-receipts-screen.tsx',
    'finance-home-content.tsx',
  ];

  it.each(SCREENS)('%s sizes every control through the pixel-safe floor', (file) => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens', file),
      'utf8',
    );
    /*
      The raw token is the defect: it is the value that becomes 43.8 dp. Any control sized by it
      would be undersized on exactly the devices this project verifies on.
    */
    expect(source).not.toMatch(/min(Height|Width): moduleLayout\.minTouchTarget/);
  });

  it('raised every control that had the raw token, and none by a local number', () => {
    let raised = 0;
    for (const file of SCREENS) {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src/features/finance/screens', file),
        'utf8',
      );
      raised += (source.match(/min(Height|Width): minimumTouchTargetSize\(\)/g) ?? []).length;
      /* No screen invents its own floor. */
      expect(source).not.toMatch(/min(Height|Width): 4[4-9]\b/);
    }
    expect(raised).toBe(10);
  });
});
