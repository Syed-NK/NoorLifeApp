import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';

import { FREE_ENTITLEMENT, PLAN_CAPABILITIES, type Entitlement } from '../domain/entitlement';
import { PRODUCT_IDS } from '../domain/products';
import { formatRenewalDate } from '../domain/pricing';
import {
  TRIAL_DAYS,
  authoritativeRenewal,
  authoritativeTrialEnd,
  displayableTrialEnd,
  projectedTrialEnd,
  trialEndIsCredible,
  trialLengthLabel,
} from '../domain/trial-period';
import { PurchaseSuccessScreen } from '../screens/purchase-flow-screens';
import { EntitlementProvider } from '../services/entitlement-context';
import { MockPurchaseAdapter } from '../services/mock-purchase-adapter';

/**
 * **One trial date, and it is never in the past** — the regression guard for issue #20.
 *
 * The defect: purchase confirmation said *"On 28 August 2026 it renews"*, then the success screen that
 * followed said *"Your free trial runs until 8 August 2026"* — already three weeks past on the day it
 * was seen. Two clocks: the confirmation screen projected from the device clock, the entitlement came
 * from an adapter whose `now` was hard-coded to 1 August 2026 for reproducible screenshots.
 */

function trialing(overrides?: Partial<Entitlement>): Entitlement {
  return {
    ...FREE_ENTITLEMENT,
    plan: 'premium_single',
    billingPeriod: 'yearly',
    status: 'trialing',
    capabilities: PLAN_CAPABILITIES.premium_single,
    currentPeriodEnd: '2026-09-15T09:00:00.000Z',
    trialEnd: '2026-09-15T09:00:00.000Z',
    ...overrides,
  };
}

async function renderSuccess(entitlement: Entitlement) {
  const adapter = new MockPurchaseAdapter({ initialEntitlement: entitlement });
  await render(
    <EntitlementProvider adapter={adapter}>
      <PurchaseSuccessScreen />
    </EntitlementProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('purchase-success')).toBeTruthy();
  });
}

describe('the 28 August versus 8 August regression', () => {
  /*
    This is the defect, expressed as the difference between the two clocks. Before the fix the adapter
    defaulted `now` to 2026-08-01, so a purchase made at any later date issued a trial end of
    2026-08-08 while the confirmation screen projected from the real clock. The gap is exactly the
    drift between the fixture and the real date, and the fix is that there is no fixture to drift from.
  */
  it('no longer issues a trial end from a fixed calendar date', async () => {
    const at = new Date('2026-08-21T09:00:00.000Z');
    const adapter = new MockPurchaseAdapter({ now: at });

    const result = await adapter.purchase(PRODUCT_IDS.singleYearly);
    expect(result.outcome).toBe('purchased');
    const issued = result.entitlement?.trialEnd ?? null;

    // The old fixture would have produced 8 August whatever `at` was.
    expect(issued).not.toBeNull();
    expect(formatRenewalDate(issued)).not.toBe('8 August 2026');
    expect(formatRenewalDate(issued)).toBe(formatRenewalDate(projectedTrialEnd(at)));
  });

  it('agrees with the confirmation projection for the same purchase moment', async () => {
    const at = new Date('2026-11-03T18:30:00.000Z');
    const adapter = new MockPurchaseAdapter({ now: at });

    const result = await adapter.purchase(PRODUCT_IDS.singleYearly);

    // What Confirmation would have shown, and what Success now shows, from one purchase instant.
    const confirmation = formatRenewalDate(projectedTrialEnd(at));
    const success = formatRenewalDate(result.entitlement?.trialEnd ?? null);
    expect(success).toBe(confirmation);
  });

  /*
    The end-to-end shape of the original bug, and the case that fails hardest without the fix: buy
    through the default adapter, then read the success screen. With the old fixed `now` the issued
    trial end was 8 August 2026, `displayableTrialEnd` rejected it as impossible, and the screen fell
    through to its no-date copy — so asserting a real date is on screen is asserting the defect is gone.
  */
  it('shows a real trial end on the success screen after a default-clock purchase', async () => {
    const adapter = new MockPurchaseAdapter();
    const result = await adapter.purchase(PRODUCT_IDS.singleYearly);
    expect(result.outcome).toBe('purchased');

    await render(
      <EntitlementProvider
        adapter={new MockPurchaseAdapter({ initialEntitlement: result.entitlement })}
      >
        <PurchaseSuccessScreen />
      </EntitlementProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('purchase-success')).toBeTruthy();
    });

    expect(screen.getByTestId('success-renewal')).toBeTruthy();
    expect(screen.queryByTestId('success-no-date')).toBeNull();
    /*
      Word-anchored. An unanchored /8 August 2026/ matches the '28 August 2026' this screen now
      correctly shows — the same substring trap that makes a content gate fail on a prop name.
    */
    expect(screen.queryByText(/\b8 August 2026\b/)).toBeNull();
  });

  it('uses the real clock by default, so no purchase can issue a past trial end', async () => {
    const before = new Date();
    const adapter = new MockPurchaseAdapter();

    const result = await adapter.purchase(PRODUCT_IDS.singleYearly);
    const issued = result.entitlement?.trialEnd ?? null;

    expect(issued).not.toBeNull();
    expect(new Date(issued as string).getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('one authoritative value per question', () => {
  it('reads the trial end from trialEnd, not the period end', () => {
    const entitlement = trialing({
      trialEnd: '2026-09-15T09:00:00.000Z',
      currentPeriodEnd: '2027-09-15T09:00:00.000Z',
    });

    /*
      The two diverge with a real provider — a trial ends before the first billing period does. The
      success screen used to render its trial sentence from `currentPeriodEnd`, which is the same value
      only in the mock.
    */
    expect(authoritativeTrialEnd(entitlement)).toBe('2026-09-15T09:00:00.000Z');
    expect(authoritativeRenewal(entitlement)).toBe('2027-09-15T09:00:00.000Z');
  });

  it('reports no trial end when the subscription is not in a trial', () => {
    const active = trialing({ status: 'active', trialEnd: '2026-09-15T09:00:00.000Z' });

    // A trialEnd left behind on an active subscription is stale; announcing it would claim a trial
    // that is not running.
    expect(authoritativeTrialEnd(active)).toBeNull();
  });

  it('reports no date at all when the provider issued none', () => {
    expect(authoritativeTrialEnd(trialing({ trialEnd: null }))).toBeNull();
    expect(authoritativeRenewal(trialing({ currentPeriodEnd: null }))).toBeNull();
  });

  it('refuses an unparseable date rather than passing it to a formatter', () => {
    expect(authoritativeTrialEnd(trialing({ trialEnd: 'not-a-date' }))).toBeNull();
    expect(authoritativeRenewal(trialing({ currentPeriodEnd: 'whenever' }))).toBeNull();
  });

  it('defines the trial length exactly once', () => {
    expect(TRIAL_DAYS).toBe(7);
    expect(trialLengthLabel).toBe('7-day');
  });
});

describe('a trial cannot end before it starts', () => {
  const activated = new Date('2026-08-21T09:00:00.000Z');

  it('rejects a trial end in the past', () => {
    expect(trialEndIsCredible('2026-08-08T09:00:00.000Z', activated)).toBe(false);
  });

  it('rejects a trial end equal to the activation instant', () => {
    expect(trialEndIsCredible('2026-08-21T09:00:00.000Z', activated)).toBe(false);
  });

  it('accepts a trial end after activation', () => {
    expect(trialEndIsCredible('2026-08-28T09:00:00.000Z', activated)).toBe(true);
  });

  it('rejects a missing or malformed value', () => {
    expect(trialEndIsCredible(null, activated)).toBe(false);
    expect(trialEndIsCredible('soon', activated)).toBe(false);
  });

  it('omits an impossible date instead of displaying it', () => {
    const stale = trialing({ trialEnd: '2026-08-08T09:00:00.000Z' });

    expect(displayableTrialEnd(stale, activated)).toBeNull();
  });
});

describe('the projection', () => {
  it('lands exactly the trial length ahead', () => {
    const from = new Date('2026-08-21T09:00:00.000Z');
    const end = new Date(projectedTrialEnd(from));

    expect(Math.round((end.getTime() - from.getTime()) / 86_400_000)).toBe(TRIAL_DAYS);
  });

  it('crosses a month boundary without shifting the month', () => {
    // 28 August + 7 = 4 September. A month-indexing slip shows August or October.
    expect(formatRenewalDate(projectedTrialEnd(new Date('2026-08-28T12:00:00.000Z')))).toBe(
      '4 September 2026',
    );
  });

  it('crosses a year boundary', () => {
    expect(formatRenewalDate(projectedTrialEnd(new Date('2026-12-28T12:00:00.000Z')))).toBe(
      '4 January 2027',
    );
  });

  it('crosses a leap day', () => {
    // 2028 is a leap year: 25 February + 7 lands on 3 March only if 29 February is counted.
    expect(formatRenewalDate(projectedTrialEnd(new Date('2028-02-25T12:00:00.000Z')))).toBe(
      '3 March 2028',
    );
  });

  it('handles a non-leap February', () => {
    expect(formatRenewalDate(projectedTrialEnd(new Date('2026-02-25T12:00:00.000Z')))).toBe(
      '4 March 2026',
    );
  });
});

describe('month indexing', () => {
  /*
    A zero-based `getMonth()` read against a one-based table renders every date one month out. Asserting
    all twelve is cheap and makes the failure unmistakable.
  */
  it.each([
    ['2026-01-15', 'January'],
    ['2026-02-15', 'February'],
    ['2026-03-15', 'March'],
    ['2026-04-15', 'April'],
    ['2026-05-15', 'May'],
    ['2026-06-15', 'June'],
    ['2026-07-15', 'July'],
    ['2026-08-15', 'August'],
    ['2026-09-15', 'September'],
    ['2026-10-15', 'October'],
    ['2026-11-15', 'November'],
    ['2026-12-15', 'December'],
  ])('renders %s in %s', (iso, month) => {
    expect(formatRenewalDate(`${iso}T12:00:00.000Z`)).toBe(`15 ${month} 2026`);
  });
});

describe('no day drift across midnight', () => {
  /*
    A midday instant renders as the same calendar day in every zone the app supports, so a formatter
    reading local parts cannot move the date. The instants near midnight UTC are the honest edge: they
    genuinely fall on different local days, and the value is an *instant* — the moment billing recurs —
    so rendering it in the device's own time is correct rather than a drift.
  */
  it.each(['2026-03-15', '2026-08-15', '2026-11-15'])(
    'keeps %s stable when the instant is midday',
    (day) => {
      expect(formatRenewalDate(`${day}T12:00:00.000Z`)).toBe(
        formatRenewalDate(new Date(`${day}T12:00:00.000Z`).toISOString()),
      );
      expect(formatRenewalDate(`${day}T12:00:00.000Z`)).toContain(day.slice(8, 10));
    },
  );

  it('projects from local parts, so a projection never lands a day early or late', () => {
    for (const iso of [
      '2026-03-08T23:30:00.000Z',
      '2026-03-29T00:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '2026-11-01T23:30:00.000Z',
    ]) {
      const from = new Date(iso);
      const end = new Date(projectedTrialEnd(from));
      // The local calendar day advances by exactly the trial length, DST transitions included.
      const expected = new Date(from.getTime());
      expected.setDate(expected.getDate() + TRIAL_DAYS);
      expect(end.getDate()).toBe(expected.getDate());
      expect(end.getMonth()).toBe(expected.getMonth());
      expect(end.getFullYear()).toBe(expected.getFullYear());
    }
  });
});

describe('the success screen', () => {
  it('states the trial end when it is credible', async () => {
    const future = new Date(Date.now() + 9 * 86_400_000).toISOString();
    await renderSuccess(trialing({ trialEnd: future, currentPeriodEnd: future }));

    const shown = formatRenewalDate(future) as string;
    expect(screen.getByTestId('success-renewal')).toBeTruthy();
    expect(screen.getByText(`Your free trial runs until ${shown}.`)).toBeTruthy();
  });

  it('states no date, honestly, when the provider issued none', async () => {
    await renderSuccess(trialing({ trialEnd: null }));

    expect(screen.queryByTestId('success-renewal')).toBeNull();
    expect(screen.getByTestId('success-no-date')).toBeTruthy();
    // Honest and date-free: no month, no year, no "7 days from now".
    const copy = String(screen.getByTestId('success-no-date').props.children);
    expect(copy).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );
    expect(copy).not.toMatch(/20\d\d/);
  });

  it('states no date rather than a trial end already in the past', async () => {
    await renderSuccess(trialing({ trialEnd: '2020-01-01T00:00:00.000Z' }));

    expect(screen.queryByTestId('success-renewal')).toBeNull();
    expect(screen.getByTestId('success-no-date')).toBeTruthy();
    expect(screen.queryByText(/1 January 2020/)).toBeNull();
  });

  it('describes billing rather than a trial when the subscription is active', async () => {
    const future = new Date(Date.now() + 300 * 86_400_000).toISOString();
    await renderSuccess(trialing({ status: 'active', trialEnd: null, currentPeriodEnd: future }));

    const shown = formatRenewalDate(future) as string;
    expect(screen.getByText(`Next billing date: ${shown}.`)).toBeTruthy();
    expect(screen.queryByText(/free trial runs until/)).toBeNull();
  });

  it('renders no trial or success date copy for a free entitlement', async () => {
    await renderSuccess(FREE_ENTITLEMENT);

    expect(screen.queryByTestId('success-renewal')).toBeNull();
    expect(screen.queryByText(/free trial runs until/)).toBeNull();
  });
});

describe('a failed or cancelled purchase issues nothing', () => {
  it.each(['cancelled', 'declined', 'offline', 'store_unavailable', 'error'] as const)(
    'leaves the entitlement untouched on a %s outcome',
    async (outcome) => {
      const adapter = new MockPurchaseAdapter({ now: new Date('2026-08-21T09:00:00.000Z') });
      adapter.setNextPurchaseOutcome(outcome);

      const result = await adapter.purchase(PRODUCT_IDS.singleYearly);

      expect(result.outcome).not.toBe('purchased');
      // No entitlement, therefore no trial end, therefore nothing for a success screen to state.
      expect(result.entitlement).toBeUndefined();
      expect(adapter.getEntitlement && (await adapter.getEntitlement()).trialEnd).toBeNull();
    },
  );
});

describe('production source carries no hard-coded trial date', () => {
  const sources = [
    'services/mock-purchase-adapter.ts',
    'screens/purchase-flow-screens.tsx',
    'screens/plan-details-screen.tsx',
    'domain/trial-period.ts',
    'subscription-copy.ts',
  ].map((rel) => join(__dirname, '..', rel));

  function code(path: string): string {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  }

  it('constructs no literal calendar date', () => {
    sources.forEach((path) => {
      expect(code(path)).not.toMatch(/new Date\(\s*['"]\d{4}-\d{2}-\d{2}/);
    });
  });

  it('names no 2026 date in copy or logic', () => {
    sources.forEach((path) => {
      expect(code(path)).not.toMatch(/\b2026-\d{2}-\d{2}\b/);
    });
  });

  it('adds no second seven-day arithmetic', () => {
    ['screens/purchase-flow-screens.tsx', 'screens/plan-details-screen.tsx'].forEach((rel) => {
      const source = code(join(__dirname, '..', rel));
      expect(source).not.toMatch(/getDate\(\)\s*\+\s*7/);
      expect(source).not.toMatch(/sevenDaysFromNow|trialRenewalDate/);
    });
  });
});

describe('nothing sensitive is logged', () => {
  const sources = [
    'services/mock-purchase-adapter.ts',
    'services/purchase-intent.ts',
    'screens/purchase-flow-screens.tsx',
    'domain/trial-period.ts',
  ].map((rel) => join(__dirname, '..', rel));

  it('logs no receipt, token, payload or account identifier', () => {
    sources.forEach((path) => {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      expect(source).not.toMatch(/console\.(log|info|warn|error|debug)/);
      expect(source).not.toMatch(/\breceipt\b/i);
      expect(source).not.toMatch(/purchaseToken|transactionId|originalTransaction/i);
    });
  });
});
