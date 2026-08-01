import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  UPGRADE_SHEET_TITLE,
  UpgradeSheetProvider,
  upgradeBodyFor,
  useUpgradeSheet,
  useUpgradeSheetActions,
  type UpgradeSheetActions,
  type UpgradeSheetState,
} from '../services/upgrade-sheet-context';
import { mockRouter } from '../../../../jest.setup';

/**
 * The shared contextual upgrade explanation.
 *
 * Eight Main Home surfaces will request this. The properties worth locking down are the ones that
 * would otherwise be re-implemented eight times: Faith can never raise it, dismissal never
 * navigates, only explicit confirmation does, and a second request cannot stack a second sheet.
 */

let state: UpgradeSheetState;
let actions: UpgradeSheetActions;

function Probe() {
  state = useUpgradeSheet();
  actions = useUpgradeSheetActions();
  return <Text>probe</Text>;
}

async function mount() {
  return render(
    <UpgradeSheetProvider>
      <Probe />
    </UpgradeSheetProvider>,
  );
}

const healthRequest = {
  featureTitle: 'Health',
  moduleId: 'health',
  moduleName: 'Health',
  source: 'quick-action',
} as const;

describe('requesting an explanation', () => {
  it('starts closed', async () => {
    await mount();
    expect(state.isVisible).toBe(false);
    expect(state.request).toBeNull();
  });

  it('opens with the requested context', async () => {
    await mount();
    await act(async () => actions.requestUpgrade(healthRequest));

    expect(state.isVisible).toBe(true);
    expect(state.request?.featureTitle).toBe('Health');
  });

  it('carries non-module feature names, not just module names', async () => {
    await mount();
    await act(async () =>
      actions.requestUpgrade({
        featureTitle: 'Family Check-in',
        moduleId: 'family',
        moduleName: 'Family',
        source: 'summary-card',
      }),
    );

    // The user tapped a summary card, so the sheet names that, not "Family".
    expect(upgradeBodyFor(state.request!)).toBe(
      'Family Check-in is included with NoorLife Premium.',
    );
  });

  it('uses the approved title', () => {
    expect(UPGRADE_SHEET_TITLE).toBe('Unlock this feature');
  });
});

describe('Faith can never raise it', () => {
  it('refuses a Faith request', async () => {
    await mount();
    await act(async () =>
      actions.requestUpgrade({
        featureTitle: 'Dhuhr Prayer',
        moduleId: 'faith',
        moduleName: 'Faith',
        source: 'timeline',
      }),
    );

    // Refused in the controller as well as in the sheet: a caller that forgets cannot cause it.
    expect(state.isVisible).toBe(false);
  });

  it('refuses Noor AI, which is scope-limited rather than locked', async () => {
    await mount();
    await act(async () =>
      actions.requestUpgrade({
        featureTitle: 'Noor AI',
        moduleId: 'noor-ai',
        moduleName: 'Noor AI',
        source: 'insight-card',
      }),
    );

    expect(state.isVisible).toBe(false);
  });
});

describe('dismissal never navigates', () => {
  it('closes without routing', async () => {
    await mount();
    await act(async () => actions.requestUpgrade(healthRequest));
    await act(async () => actions.dismiss());

    expect(state.isVisible).toBe(false);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

describe('only explicit confirmation navigates', () => {
  it('routes to the plans and closes', async () => {
    await mount();
    await act(async () => actions.requestUpgrade(healthRequest));
    await act(async () => actions.viewPlans());

    expect(mockRouter.push).toHaveBeenCalledWith('/subscription');
    expect(state.isVisible).toBe(false);
  });

  it('never navigates merely by opening', async () => {
    await mount();
    await act(async () => actions.requestUpgrade(healthRequest));

    // Opening an explanation is not a purchase and not a navigation.
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('duplicate requests', () => {
  it('replace rather than stack', async () => {
    await mount();
    await act(async () => actions.requestUpgrade(healthRequest));
    await act(async () =>
      actions.requestUpgrade({
        featureTitle: 'Add Task',
        moduleId: 'planner',
        moduleName: 'Planner',
        source: 'quick-action',
      }),
    );

    // One slot, not a stack — a double tap cannot mount two sheets.
    expect(state.request?.featureTitle).toBe('Add Task');
    expect(state.isVisible).toBe(true);
  });
});
