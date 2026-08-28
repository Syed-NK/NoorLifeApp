import fs from 'node:fs';
import path from 'node:path';

import { act, render, screen } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';

import { moduleAIPolicies } from '../module-ai-policy';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';

/**
 * **Finance claims only what Finance does** — issue #90.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Five declarations, none of them true ───────────────────────────────────
 * Finance has no implementation at all: there is no `src/features/finance/`, no repository, no
 * provider and no storage key, and its overview resolves `empty` from the shared mock because there
 * is no data layer to read. Its registry nevertheless declared a sync, a server, budget alerts,
 * receipt photos, and an assistant that writes to the ledger.
 *
 * The last was the one that mattered most. `set-budget` carried `mutatesData: true`, which
 * `requiresConfirmation` reads as "this action changes the user's data" — a claim about what an AI
 * may do with somebody's money, made by a module that has no money in it.
 *
 * ── Removed, not reworded ──────────────────────────────────────────────────
 * The approved decision is that unbuilt behaviour is not preserved as a future promise. So the
 * permissions array is empty, the AI capability is gone, and the two state strings say what is
 * true of a module still being built rather than what will be true of one that ships.
 *
 * ── What must survive ──────────────────────────────────────────────────────
 * Everything Finance genuinely has: three quick actions, four available capabilities, five routes,
 * the honest "Not built yet" placeholders, Bank sync and Receipts as non-interactive unavailable
 * tiles, and a real Noor AI conversation that reads nothing. Those are asserted here too, because a
 * truthfulness change that quietly removed a working surface would be a worse defect than the one
 * it fixed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const finance = moduleRegistry.finance;

/** Claims Finance cannot honour today. */
const UNBUILT_CLAIMS =
  /\b(sync(?:s|ed|ing)?|upload(?:s|ed|ing)?|cloud|server|our side|remind(?:er|ers|s|ed)?|notif(?:y|ies|ication|ications)|alert(?:s)?|receipt(?:s)?|forecast(?:s|ing)?|predict(?:s|ion|ions)?|automatic(?:ally)?)\b/i;

/* The superseded strings, assembled so no literal of a removed claim exists in the repository. */
const OLD_OFFLINE = ['You can add transactions now and', 'they’ll sync when you reconnect.'].join(
  ' ',
);
const OLD_ERROR = ['A request failed on our side.', 'Your transactions are unaffected.'].join(' ');
const OLD_ALERTS_TITLE = ['Budget', 'alerts'].join(' ');
const OLD_ALERTS_RATIONALE = [
  'So NoorLife can tell you when a budget',
  'is close to its limit.',
].join(' ');
const OLD_PHOTOS_TITLE = ['Receipt', 'photos'].join(' ');
const OLD_PHOTOS_RATIONALE = [
  'Only used when you attach a photo',
  'to a transaction yourself.',
].join(' ');
const OLD_AI_CAPABILITY = [
  "{ key: 'set-budget', label: 'Set a budget'",
  'mutatesData: true }',
].join(', ');

const SUPERSEDED = [
  OLD_OFFLINE,
  OLD_ERROR,
  OLD_ALERTS_TITLE,
  OLD_ALERTS_RATIONALE,
  OLD_PHOTOS_TITLE,
  OLD_PHOTOS_RATIONALE,
] as const;

function productionSourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '__tests__' ||
          entry.name === 'test-support' ||
          entry.name.startsWith('.')
        ) {
          continue;
        }
        walk(full);
        continue;
      }
      if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.includes('.test.')
      ) {
        found.push(full);
      }
    }
  };
  walk(path.join(process.cwd(), 'src'));
  return found;
}

const rel = (file: string): string => path.relative(process.cwd(), file).split(path.sep).join('/');

/** Every user-facing string Finance declares. */
function declaredStrings(): readonly string[] {
  const { empty, error, offline, loading } = finance.stateCopy;
  return [
    finance.summary,
    finance.hero.eyebrow,
    finance.hero.headline,
    finance.hero.support ?? '',
    finance.hero.actionLabel,
    empty.title,
    empty.body,
    empty.action,
    error.title,
    error.body,
    error.action,
    offline.title,
    offline.body,
    loading,
    ...finance.quickActions.map((action) => action.label),
    /*
      Only the *available* capabilities. An unavailable tile's label and reason exist precisely to
      name the thing that is missing — "Bank sync", "Receipt capture arrives with the full release" —
      so scanning them for the words they are required to contain would forbid the honest form of the
      declaration this issue is protecting.
    */
    ...finance.capabilities.filter((c) => c.available).map((c) => c.label),
    ...finance.permissions.flatMap((p) => [p.title, p.rationale]),
  ];
}

beforeEach(() => {
  pinModuleWindow();
});

// ─────────────────────────────────────────────────────────────────────────────
// The removals
// ─────────────────────────────────────────────────────────────────────────────

describe('Finance asks the user for nothing', () => {
  it('declares no permissions', () => {
    expect(finance.permissions).toEqual([]);
  });

  it('schedules nothing, so it can promise no notification', () => {
    /*
      The half of #90's rule that is unchanged, and always will be. Finance has no alerts, no
      reminders and no budget warnings to schedule — #94 rules budget alerts out for this reason —
      so a notifications import anywhere in the module would be code for a promise nothing keeps.
    */
    const financeSource = productionSourceFiles().filter((file) =>
      file.includes(`${path.sep}finance${path.sep}`),
    );
    for (const file of financeSource) {
      expect([file, fs.readFileSync(file, 'utf8')]).not.toEqual([
        file,
        expect.stringMatching(/expo-notifications/),
      ]);
    }
  });

  it('asks the OS for the camera and photos from exactly one file, and only inside a press', () => {
    /*
      This case is #90's other half, rewritten by #101 rather than relaxed.

      #90 removed Finance's `photos` permission entry because the module asked for nothing, and the
      scan that backed it forbade the picker outright. Receipts changes the fact on the ground: the
      module now *does* ask, for the camera when the user presses Capture and for the library when
      they press Import. Leaving the old scan in place would have meant either a false declaration or
      a deleted test, and the honest third option is a narrower rule that still forbids the thing
      #90 was really protecting against — a permission prompt the user did not ask for.

      Two properties carry that. Only the acquisition adapter may touch the picker at all, so no
      screen can raise a prompt on its own; and the request lives inside the same call that opens the
      camera, so it cannot be hoisted to mount, to module entry or to app launch. The registry entry
      stays absent because a module-level declaration would describe *entering Finance*, which asks
      for nothing, rather than pressing a button that does.
    */
    const financeSource = productionSourceFiles().filter((file) =>
      file.includes(`${path.sep}finance${path.sep}`),
    );
    const asking = financeSource.filter((file) =>
      /expo-image-picker|requestCameraPermissionsAsync|requestMediaLibraryPermissionsAsync/.test(
        fs.readFileSync(file, 'utf8'),
      ),
    );

    expect(asking.map((file) => path.basename(file))).toEqual(['expo-receipt-source.ts']);

    const adapter = fs.readFileSync(asking[0] ?? '', 'utf8');
    /* Requesting and launching are one call, which is what ties the prompt to the press. */
    expect(adapter).toMatch(/acquire\(kind: ReceiptSourceKind\)/);
    expect(adapter).not.toMatch(/useEffect|componentDidMount/);
  });
});

describe('Money AI cannot claim to write to Finance', () => {
  it('declares no mutating capability', () => {
    const mutating = moduleAIPolicies.finance.capabilities.filter((c) => c.mutatesData);
    expect(mutating).toEqual([]);
  });

  it('no longer declares `set-budget`', () => {
    const keys = moduleAIPolicies.finance.capabilities.map((c) => c.key);
    expect(keys).not.toContain('set-budget');
    expect(keys).toEqual(['where-money-went', 'budget-health', 'explain-term']);
  });

  it('keeps every remaining capability read-only', () => {
    for (const capability of moduleAIPolicies.finance.capabilities) {
      expect(capability.mutatesData).toBe(false);
    }
  });

  it('reads no Finance record to build its context', () => {
    /*
      The privacy boundary, asserted at the file rather than trusted. The module AI screen imports no
      repository, storage boundary or record type, so only what the user types can be sent — which is
      also why `mutatesData: true` could never have been honoured.
    */
    /*
      Executable text only. The file's docblock *names* the record types it must never read — "no
      task, transaction, health entry…" — and prose that explains a rule must not be what a scan for
      the rule trips over.
    */
    const executable = fs
      .readFileSync(
        path.join(process.cwd(), 'src/features/modules/noor-ai/module-noor-ai-screen.tsx'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(executable).not.toMatch(/[Rr]epository|AsyncStorage|useFinance|useTransactions|ledger/);
  });

  it('keeps the standing disclaimer and both refusals', () => {
    const policy = moduleAIPolicies.finance;
    expect(policy.standingDisclaimer).toContain('not regulated financial advice');
    const subjects = policy.safetyRules.map((rule) => rule.subject);
    expect(subjects).toContain('investment, tax or legal advice');
    expect(subjects).toContain('predicting returns or recommending a product');
  });
});

describe('Finance state copy claims only what Finance does', () => {
  it('offline no longer offers an action or promises a sync', () => {
    expect(finance.stateCopy.offline.body).not.toMatch(
      /sync|upload|cloud|server|add transactions/i,
    );
  });

  it('error no longer names a server or stored records', () => {
    expect(finance.stateCopy.error.body).not.toMatch(/our side|server|request failed/i);
    expect(finance.stateCopy.error.body).toMatch(/this device/i);
    // The framework's own rules still hold.
    expect(finance.stateCopy.error.body.toLowerCase()).not.toContain('you did');
    expect(finance.stateCopy.error.title.toLowerCase()).not.toContain('something went wrong');
  });

  it('makes no unbuilt claim anywhere in the declaration', () => {
    for (const value of declaredStrings()) {
      expect(value).not.toMatch(UNBUILT_CLAIMS);
    }
  });
});

describe('the superseded Finance strings', () => {
  it.each(SUPERSEDED)('%s appears in no production source file', (superseded) => {
    const offenders = productionSourceFiles()
      .filter((file) => fs.readFileSync(file, 'utf8').includes(superseded))
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('the mutating AI capability appears in no production source file', () => {
    const offenders = productionSourceFiles()
      .filter((file) => fs.readFileSync(file, 'utf8').includes(OLD_AI_CAPABILITY))
      .map(rel);

    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What must survive
// ─────────────────────────────────────────────────────────────────────────────

describe('every live Finance surface is preserved', () => {
  it('keeps all three quick actions and their destinations', () => {
    expect(finance.quickActions.map((a) => [a.key, a.href])).toEqual([
      // Carries the typed intent since #93 built Spending; the destination is unchanged.
      ['add-expense', '/finance/transactions?intent=add-expense'],
      ['budgets', '/finance/budgets'],
      ['ask-money-ai', '/finance/ai'],
    ]);
  });

  it('keeps all six capabilities, four available and two not', () => {
    expect(finance.capabilities.map((c) => [c.key, c.available])).toEqual([
      ['overview', true],
      ['transactions', true],
      ['budgets', true],
      ['goals', true],
      ['bank-sync', false],
      ['receipts', false],
    ]);
  });

  it('keeps Bank sync and Receipts unavailable, with a reason and no destination', () => {
    for (const key of ['bank-sync', 'receipts']) {
      const capability = finance.capabilities.find((c) => c.key === key)!;
      expect(capability.available).toBe(false);
      expect(capability.href).toBeUndefined();
      expect((capability.unavailableReason ?? '').length).toBeGreaterThan(20);
    }
  });

  it('keeps its routes, navigation and hero', () => {
    expect(finance.routes).toEqual({
      home: '/finance',
      ai: '/finance/ai',
      help: '/settings/help',
    });
    expect(finance.navigation.map((item) => item.href)).toEqual([
      '/finance',
      '/finance/transactions',
      '/finance/ai',
      '/finance/budgets',
      '/finance/goals',
    ]);
    expect(finance.hero.headline).toBe('Know where it goes');
    expect(finance.hero.support).toBe('Nothing is counted until you record it.');
  });

  it.each([
    ['/finance', 'src/app/finance/index.tsx'],
    ['/finance/transactions', 'src/app/finance/transactions.tsx'],
    ['/finance/budgets', 'src/app/finance/budgets.tsx'],
    ['/finance/goals', 'src/app/finance/goals.tsx'],
    ['/finance/ai', 'src/app/finance/ai.tsx'],
  ])('%s remains reachable', (_href, file) => {
    expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
  });

  it('keeps the one remaining placeholder honest about not being built', () => {
    /*
      Spending is built (#93) and Budgets is built (#94), so neither route is a placeholder any
      more. Savings is, and stays that way until #95 — asserting it here is what stops a change
      quietly making it look finished.
    */
    const savings = fs.readFileSync(path.join(process.cwd(), 'src/app/finance/goals.tsx'), 'utf8');
    expect(savings).toContain('ModuleSectionScreen');
    expect(savings).toContain('Not built yet');

    for (const [file, screen] of [
      ['transactions', 'FinanceSpendingScreen'],
      ['budgets', 'FinanceBudgetsScreen'],
    ] as const) {
      const source = fs.readFileSync(
        path.join(process.cwd(), `src/app/finance/${file}.tsx`),
        'utf8',
      );
      expect(source).toContain(screen);
      expect(source).not.toContain('ModuleSectionScreen');
    }
  });
});

describe('the Finance home still renders its live surfaces', () => {
  it('shows the hero, quick actions and feature grid, and no removed claim', async () => {
    await render(<ModuleHomeScreen moduleId="finance" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('finance-hero')).toBeTruthy();
    expect(screen.getByTestId('finance-quick-actions')).toBeTruthy();

    const spoken = JSON.stringify(screen.toJSON());
    for (const superseded of SUPERSEDED) {
      expect(spoken).not.toContain(superseded);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Everything else, untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('no other module moved', () => {
  it.each([
    ['noor-ai', 2],
    ['faith', 2],
    ['health', 2],
    ['learning', 1],
    ['family', 3],
    ['goals', 1],
  ] as const)('%s keeps its permission count', (moduleId, count) => {
    expect(moduleRegistry[moduleId].permissions).toHaveLength(count);
  });

  it('leaves Planner and Finance as the only modules declaring none', () => {
    const empty = FRAMEWORK_MODULE_IDS.filter(
      (id) => moduleRegistry[id].permissions.length === 0,
    ).sort();

    expect(empty).toEqual(['finance', 'planner']);
  });

  it('leaves every other module’s AI capabilities alone', () => {
    // Faith's `set-reminder` mutates and stays — Faith actually schedules notifications.
    const faithKeys = moduleAIPolicies.faith.capabilities.map((c) => c.key);
    expect(faithKeys).toContain('set-reminder');
    expect(moduleAIPolicies.faith.capabilities.some((c) => c.mutatesData)).toBe(true);
  });
});
