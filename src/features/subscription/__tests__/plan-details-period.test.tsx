import { render, screen, userEvent, waitFor } from '@testing-library/react-native';

import { EntitlementProvider } from '../services/entitlement-context';
import { MockPurchaseAdapter } from '../services/mock-purchase-adapter';
import { PlanDetailsScreen } from '../screens/plan-details-screen';

/**
 * The billing period on a plan details screen.
 *
 * ── The bug these lock down ─────────────────────────────────────────────────
 * The period was `useState(initialPeriod)`, which reads its initial value once per mount. Arriving
 * at an already-mounted screen with a different `period` parameter therefore changed the parameter
 * and left the toggle where it was. Two real paths hit it — a deep link, and Manage's "Switch
 * billing period", whose entire purpose is to arrive here with the other period.
 *
 * It was found through screenshot evidence rather than through a test: the monthly and yearly
 * captures came out byte-identical.
 */

function renderDetails(period: 'monthly' | 'yearly') {
  return render(
    <EntitlementProvider adapter={new MockPurchaseAdapter()}>
      <PlanDetailsScreen plan="premium_single" initialPeriod={period} />
    </EntitlementProvider>,
  );
}

describe('the period route parameter', () => {
  it('selects monthly and shows the monthly price', async () => {
    await renderDetails('monthly');

    await waitFor(() =>
      expect(screen.getByTestId('plan-details-toggle-monthly-selected')).toBeTruthy(),
    );
    expect(screen.getByText('AED 19.99')).toBeTruthy();
    // No trial language on monthly: the approved model puts the trial on yearly only.
    expect(screen.queryByTestId('plan-details-trial-eligible')).toBeNull();
  });

  it('selects yearly and shows the yearly price with trial terms', async () => {
    await renderDetails('yearly');

    await waitFor(() =>
      expect(screen.getByTestId('plan-details-toggle-yearly-selected')).toBeTruthy(),
    );
    expect(screen.getByText('AED 189.99')).toBeTruthy();
    expect(screen.getByTestId('plan-details-trial-eligible')).toBeTruthy();
  });

  it('follows the parameter when the screen is re-entered with a different period', async () => {
    const view = await renderDetails('yearly');
    await waitFor(() =>
      expect(screen.getByTestId('plan-details-toggle-yearly-selected')).toBeTruthy(),
    );

    // Re-render the same mounted screen with the other parameter, which is what a deep link or
    // "Switch billing period" does. Before the fix the toggle stayed on yearly.
    view.rerender(
      <EntitlementProvider adapter={new MockPurchaseAdapter()}>
        <PlanDetailsScreen plan="premium_single" initialPeriod="monthly" />
      </EntitlementProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('plan-details-toggle-monthly-selected')).toBeTruthy(),
    );
    expect(screen.getByText('AED 19.99')).toBeTruthy();
  });

  it('still lets the user override the parameter with the toggle', async () => {
    await renderDetails('yearly');
    await waitFor(() => expect(screen.getByTestId('plan-details-toggle-monthly')).toBeTruthy());

    const user = userEvent.setup();
    await user.press(screen.getByTestId('plan-details-toggle-monthly'));

    // A user choice wins over the parameter it arrived with, until the parameter itself changes.
    await waitFor(() =>
      expect(screen.getByTestId('plan-details-toggle-monthly-selected')).toBeTruthy(),
    );
    expect(screen.getByText('AED 19.99')).toBeTruthy();
  });
});
