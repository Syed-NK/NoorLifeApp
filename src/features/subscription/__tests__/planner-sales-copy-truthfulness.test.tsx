import fs from 'node:fs';
import path from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { Text } from 'react-native';

import { PLAN_CAPABILITIES, type Entitlement } from '../domain/entitlement';
import { LockedModuleSheet } from '../components/locked-module-sheet';
import { ModuleEntitlementGate } from '../components/module-entitlement-gate';
import { EntitlementProvider } from '../services/entitlement-context';
import { MockPurchaseAdapter } from '../services/mock-purchase-adapter';
import { lockedModuleCopy } from '../subscription-copy';

installMockLatencyTimers();

/**
 * Planner's pre-purchase sentence, and the rule that keeps it honest.
 *
 * `lockedModuleCopy.valueStatements.planner` is shown to a free user *before* they pay, so it is
 * the one Planner string that can cause money to change hands for a capability. It used to read
 * "Plan your day and week, with reminders that respect prayer times." Planner schedules no
 * notifications — `planner-routine.ts` records a routine's preferred time as "never a reminder —
 * nothing notifies" — and no Planner code reads a prayer time. Both halves of that clause were
 * unbuilt.
 *
 * The replacement names tasks, recurring routines and offline operation, all of which ship today.
 *
 * These tests are deliberately stricter than "the string changed": an edit that reintroduces *any*
 * scheduling promise has to fail here rather than at a store refund.
 */

/** Every claim Planner cannot honour. One list, so a new synonym is a one-line addition. */
const UNBUILT_CLAIMS =
  /\b(remind(?:er|ers|s|ed)?|notif(?:y|ies|ication|ications)|alarm(?:s)?|alert(?:s)?|prayer[\s-]?time(?:s)?|nudge(?:s)?|automatically\s+schedul|auto[\s-]?schedul)/i;

const APPROVED_PLANNER_LINE = 'Plan your days with tasks and recurring routines that work offline.';

/** The exact sentence #74 removes. Written once, asserted against the whole tree below. */
const SUPERSEDED_PLANNER_LINE = 'Plan your day and week, with reminders that respect prayer times.';

function collectFiles(root: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        walk(full);
        continue;
      }
      if (extensions.some((ext) => entry.name.endsWith(ext))) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

function premiumEntitlement(status: Entitlement['status'] = 'active'): Entitlement {
  return {
    plan: 'premium_single',
    billingPeriod: 'yearly',
    status,
    provider: 'development_mock',
    currentPeriodEnd: '2027-01-01T00:00:00.000Z',
    trialEnd: null,
    cancelAtPeriodEnd: false,
    isFamilyOrganizer: false,
    capabilities: PLAN_CAPABILITIES.premium_single,
  };
}

/** A fresh adapter per render: the mock is stateful, so a shared one leaks between tests. */
async function renderWith(entitlement: Entitlement | undefined, node: React.ReactNode) {
  const adapter = new MockPurchaseAdapter(
    entitlement === undefined ? {} : { initialEntitlement: entitlement },
  );
  return render(<EntitlementProvider adapter={adapter}>{node}</EntitlementProvider>);
}

async function renderPlannerSheet() {
  return render(
    <LockedModuleSheet
      visible
      moduleId="planner"
      moduleName="Planner"
      featureTitle="Add Task"
      onViewPlans={jest.fn()}
      onNotNow={jest.fn()}
      onContinueToFaith={jest.fn()}
      testID="planner-locked-sheet"
    />,
  );
}

describe("Planner's pre-purchase value statement", () => {
  it('is exactly the approved sentence', () => {
    expect(lockedModuleCopy.valueStatements.planner).toBe(APPROVED_PLANNER_LINE);
  });

  it('is no longer the superseded sentence', () => {
    expect(lockedModuleCopy.valueStatements.planner).not.toBe(SUPERSEDED_PLANNER_LINE);
  });

  it('promises no reminder, notification, alarm, alert, prayer time or automatic scheduling', () => {
    expect(lockedModuleCopy.valueStatements.planner).not.toMatch(UNBUILT_CLAIMS);
  });

  it('names only capabilities Planner ships today', () => {
    // Tasks, recurring routines and offline operation are all built and device-verified. The
    // sentence is allowed to be modest; it is not allowed to be aspirational.
    expect(lockedModuleCopy.valueStatements.planner).toContain('tasks');
    expect(lockedModuleCopy.valueStatements.planner).toContain('recurring routines');
    expect(lockedModuleCopy.valueStatements.planner).toContain('offline');
  });
});

describe('the superseded Planner sentence', () => {
  it('appears nowhere in the source tree', () => {
    // Every source file except this one, which has to quote the sentence in order to search for it —
    // the same exemption `subscription-wording.test.ts` gives the audit doc that names the
    // superseded four-seat phrase. Anywhere else — a screen, a fixture, a mock, a snapshot — fails.
    const offenders = collectFiles(path.join(process.cwd(), 'src'), ['.ts', '.tsx'])
      .filter((file) => file !== __filename)
      .filter((file) => fs.readFileSync(file, 'utf8').includes(SUPERSEDED_PLANNER_LINE));

    expect(offenders).toEqual([]);
  });

  it('appears nowhere in the documentation', () => {
    const offenders = collectFiles(path.join(process.cwd(), 'docs'), ['.md']).filter((file) =>
      fs.readFileSync(file, 'utf8').includes(SUPERSEDED_PLANNER_LINE),
    );

    expect(offenders).toEqual([]);
  });
});

describe('the other modules’ value statements are untouched', () => {
  // Recorded verbatim. #74 is a Planner change; moving another module's sales line is a defect
  // regardless of whether the new line reads well.
  it.each([
    ['health', 'Track wellness, activity and habits with a private health assistant.'],
    ['finance', 'Budgets, spending and savings goals, kept entirely private.'],
    ['learning', 'Structured Islamic learning with progress you can see.'],
    ['family', 'A shared calendar, goals and memories for up to six accounts.'],
    ['goals', 'Set goals, track streaks and see honest progress reporting.'],
  ] as const)('%s is unchanged', (moduleId, expected) => {
    expect(lockedModuleCopy.valueStatements[moduleId]).toBe(expected);
  });

  it('still carries exactly the six paid modules', () => {
    expect(Object.keys(lockedModuleCopy.valueStatements).sort()).toEqual([
      'family',
      'finance',
      'goals',
      'health',
      'learning',
      'planner',
    ]);
  });
});

describe('what a free user actually sees on the Planner upgrade sheet', () => {
  it('renders the approved sentence', async () => {
    await renderPlannerSheet();

    expect(await screen.findByText(APPROVED_PLANNER_LINE)).toBeTruthy();
  });

  it('cannot render the superseded sentence, or any unbuilt claim', async () => {
    await renderPlannerSheet();

    expect(await screen.findByText(APPROVED_PLANNER_LINE)).toBeTruthy();
    expect(screen.queryByText(SUPERSEDED_PLANNER_LINE)).toBeNull();

    // The whole rendered sheet, not only the value statement: the title, the contextual line and
    // the buttons are sales copy too, and none of them may promise scheduling either.
    expect(JSON.stringify(screen.toJSON())).not.toMatch(UNBUILT_CLAIMS);
  });
});

describe('gating and entitled access are unchanged by the copy fix', () => {
  it('still blocks Planner for a free user and withholds its content', async () => {
    await renderWith(
      undefined,
      <ModuleEntitlementGate moduleId="planner">
        <Text>Planner content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByTestId('module-locked-planner')).toBeTruthy());
    expect(screen.queryByText('Planner content')).toBeNull();
    expect(screen.getByText(APPROVED_PLANNER_LINE)).toBeTruthy();
  });

  it('still lets a subscriber into Planner, with no sheet', async () => {
    await renderWith(
      premiumEntitlement(),
      <ModuleEntitlementGate moduleId="planner">
        <Text>Planner content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByText('Planner content')).toBeTruthy());
    expect(screen.queryByTestId('module-locked-planner')).toBeNull();
  });
});
