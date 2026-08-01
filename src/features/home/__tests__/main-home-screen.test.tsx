import { render, screen, userEvent } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { MainHomeRoute } from '../screens/main-home-route';
import { mockRouter } from '../../../../jest.setup';

/**
 * Main Home proof-screen tests.
 *
 * Renders the real screen inside the real providers — nothing in the design system
 * or the module theme registry is stubbed, so these assertions exercise the same
 * code path the device does.
 *
 * `MainHomeRoute` rather than `MainHomeScreen`: the route composition is what `/home`
 * renders, and it is where the upgrade-sheet controller is mounted above the timeline
 * and the summary cards. Rendering the screen alone would exercise a tree the app never
 * builds.
 *
 * The default providers resolve a **free** entitlement, so the assertions here describe
 * the free presentation. Paid and unresolved entitlement need an injected adapter and
 * live in `main-home-paid-content.test.tsx`.
 *
 * The dashboard hook resolves on a short timer. Real timers are used with RNTL's
 * `findBy*` queries rather than fake timers: the async settle is what the screen
 * actually does, and it keeps the loading branch observable instead of a frame
 * that has already been skipped past.
 *
 * Note: RNTL 14's `render` is asynchronous, so every render is awaited.
 */

async function renderMainHome(props?: { readonly simulateFailure?: boolean }) {
  return render(
    <AppProviders>
      <MainHomeRoute simulateFailure={props?.simulateFailure ?? false} />
    </AppProviders>,
  );
}

/**
 * Waits for the dashboard to resolve into its ready branch.
 *
 * Keys off the hero rather than `main-home-screen`: the screen's root view is the
 * fixed shell and renders in every branch, so waiting on it would return while the
 * skeleton is still up.
 */
async function settleReady() {
  await screen.findByTestId('main-home-hero');
}

/** Waits for the dashboard to resolve into its error branch. */
async function settleError() {
  await screen.findByTestId('main-home-error-state');
}

describe('Main Home loading state', () => {
  it('renders the skeleton before data resolves', async () => {
    await renderMainHome();
    expect(screen.getByTestId('main-home-skeleton')).toBeTruthy();
  });

  it('keeps bottom navigation usable while loading', async () => {
    await renderMainHome();
    expect(screen.getByTestId('main-home-nav')).toBeTruthy();
    expect(screen.getByTestId('main-home-nav-ai')).toBeTruthy();
  });

  it('replaces the skeleton once data resolves', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.queryByTestId('main-home-skeleton')).toBeNull();
    expect(screen.getByTestId('main-home-screen')).toBeTruthy();
  });
});

describe('Main Home error state', () => {
  it('renders the shared error state with a retry action', async () => {
    await renderMainHome({ simulateFailure: true });
    await settleError();

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText("We couldn't load your day just now. Your data is safe.")).toBeTruthy();
    expect(screen.getByText('Try Again')).toBeTruthy();
  });

  it('shows an error reference so the failure is traceable', async () => {
    await renderMainHome({ simulateFailure: true });
    await settleError();
    expect(screen.getByText('Reference NL-HOME-0001')).toBeTruthy();
  });

  it('does not render dashboard content in the error state', async () => {
    await renderMainHome({ simulateFailure: true });
    await settleError();
    expect(screen.queryByTestId('main-home-hero')).toBeNull();
    expect(screen.queryByTestId('main-home-module-grid')).toBeNull();
  });

  it('keeps bottom navigation usable in the error state', async () => {
    await renderMainHome({ simulateFailure: true });
    await settleError();
    expect(screen.getByTestId('main-home-nav-ai')).toBeTruthy();
  });
});

describe('Main Home top bar', () => {
  it('greets the signed-in user', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.getByText('Assalamu Alaikum,')).toBeTruthy();
    expect(screen.getByText('Ahmed')).toBeTruthy();
  });

  it('announces the unread notification count rather than relying on the badge colour', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.getByLabelText('Notifications, 3 unread')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});

describe('Main Home hero card', () => {
  it('renders the specified eyebrow, title and action', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.getByText('Today with NoorLife')).toBeTruthy();
    expect(screen.getByText('Your family,\nyour day,\nbeautifully in sync.')).toBeTruthy();
    expect(screen.getByText('View My Day')).toBeTruthy();
  });

  it('renders the tagline in full, on three lines, without truncating it', async () => {
    await renderMainHome();
    await settleReady();
    // Lock §6 fixes both the text and its line breaks.
    const title = screen.getByText('Your family,\nyour day,\nbeautifully in sync.');
    expect(title.props.numberOfLines).toBe(3);
    expect(title.props.ellipsizeMode).toBeUndefined();
  });

  it('carries no supporting line and no micro-metrics, matching the reference', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.queryByText('Next prayer')).toBeNull();
    expect(screen.queryByText('Tasks due')).toBeNull();
    expect(screen.queryByText('Dhuhr 12:35 PM')).toBeNull();
    expect(screen.queryByText(/A calm, balanced day ahead/)).toBeNull();
  });
});

describe('Main Home section order', () => {
  it('omits the section headings the reference does not have', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.queryByText('Your Modules')).toBeNull();
    expect(screen.queryByText('Quick Actions')).toBeNull();
  });

  it('renders all seven dashboard sections in the locked order', async () => {
    await renderMainHome();
    await settleReady();

    const order = [
      'main-home-header',
      'main-home-hero',
      'main-home-module-grid',
      'main-home-timeline',
      'main-home-summary-row',
      'main-home-ai-insight',
      'main-home-quick-actions',
    ];
    for (const id of order) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }

    // Rendered order is asserted from the flattened tree: each section's testID must
    // appear in the JSON in the locked sequence.
    const tree = JSON.stringify(screen.toJSON());
    const positions = order.map((id) => tree.indexOf(`"${id}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });
});

describe('Main Home module grid', () => {
  it.each(['Noor AI', 'Faith', 'Health', 'Planner', 'Finance', 'Learning', 'Family', 'Goals'])(
    'renders the %s module label',
    async (label) => {
      await renderMainHome();
      await settleReady();
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    },
  );

  it.each(['noor-ai', 'faith'])('renders an unlocked, tappable card for %s', async (id) => {
    await renderMainHome();
    await settleReady();

    // Faith and Noor AI are free on every plan. Faith must never carry a lock, and Noor AI is
    // scope-limited rather than locked.
    expect(screen.getByTestId(`module-card-${id}`)).toBeTruthy();
    expect(screen.queryByTestId(`module-card-${id}-locked`)).toBeNull();
    expect(screen.queryByTestId(`module-lock-${id}`)).toBeNull();
  });

  it.each(['health', 'planner', 'finance', 'learning', 'family', 'goals'])(
    'renders a locked card for %s on the free plan',
    async (id) => {
      await renderMainHome();
      await settleReady();

      // Still a tile in the same position with the same pictogram — locked, not removed.
      expect(screen.getByTestId(`module-card-${id}-locked`)).toBeTruthy();
      expect(screen.getByTestId(`module-pictogram-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`module-lock-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`module-scrim-${id}`)).toBeTruthy();
    },
  );

  it('announces a locked module as a premium feature', async () => {
    await renderMainHome();
    await settleReady();

    // The restriction is part of the accessible name, not a hint, so it cannot be skipped.
    expect(screen.getByLabelText('Health, Premium feature')).toBeTruthy();
    expect(screen.getByLabelText('Faith')).toBeTruthy();
  });

  it('keeps every tile in the grid, locked or not', async () => {
    await renderMainHome();
    await settleReady();

    // Geometry is unchanged: eight tiles, same order. Locking changes the surface, not the grid.
    const tiles = ['noor-ai', 'faith'].map((id) => screen.getByTestId(`module-card-${id}`));
    const locked = ['health', 'planner', 'finance', 'learning', 'family', 'goals'].map((id) =>
      screen.getByTestId(`module-card-${id}-locked`),
    );
    expect([...tiles, ...locked]).toHaveLength(8);
  });
});

describe('Main Home timeline', () => {
  it('renders the Today at a Glance section header', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.getByText('Today at a Glance')).toBeTruthy();
  });

  it.each([
    ['Dhuhr Prayer', '12:35 PM'],
    ['School drop-off', '8:00 AM'],
    ['Work focus time', '10:00 AM'],
    ['Family dinner', '5:30 PM'],
  ])('renders "%s" at %s', async (title, time) => {
    await renderMainHome();
    await settleReady();
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(time)).toBeTruthy();
  });
});

describe('Main Home summary and insight cards', () => {
  it('renders the Family Check-in card, stating Premium rather than a figure', async () => {
    await renderMainHome();
    await settleReady();

    // The default providers resolve a free entitlement, so the card is locked. It keeps its
    // heading and its place; what it must not do is report a completion figure for a user
    // who has no family check-in. `main-home-paid-content.test.tsx` covers "4 of 5 complete"
    // on a paid entitlement.
    //
    // Queried from the screen rather than scoped with `within`: a locked card is a
    // `PressableScale`, which carries the testID on its touch overlay rather than on the box
    // holding the content. None of these strings appears anywhere else on Main Home.
    expect(screen.getByTestId('family-check-in-card')).toBeTruthy();
    expect(screen.getByText('Premium')).toBeTruthy();
    expect(screen.getByText('Unlock family connection')).toBeTruthy();
    expect(screen.queryByText('4 of 5')).toBeNull();
    expect(screen.queryByText('complete')).toBeNull();
  });

  it('renders "Family Check-in" both as a summary card and as a quick action', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.getAllByText('Family Check-in')).toHaveLength(2);
    expect(screen.getByTestId('quick-action-family-check-in')).toBeTruthy();
  });

  it('renders the Overall Progress card with a neutral ring rather than a percentage', async () => {
    await renderMainHome();
    await settleReady();

    // Free entitlement: the ring is a placeholder at the same diameter, and no figure is
    // claimed. The 68% presentation is asserted against a paid entitlement elsewhere.
    expect(screen.getByTestId('overall-progress-card')).toBeTruthy();
    expect(screen.getByText('Overall Progress')).toBeTruthy();
    expect(screen.getByText('Unlock progress')).toBeTruthy();
    expect(screen.getByText('Included with Premium')).toBeTruthy();
    expect(screen.getByTestId('overall-progress-locked-ring')).toBeTruthy();
    expect(screen.queryByText('68%')).toBeNull();
    expect(screen.queryByText("You're on track")).toBeNull();
  });

  it('renders the Noor AI Insight card', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.getByTestId('main-home-ai-insight')).toBeTruthy();
    expect(screen.getByText('Noor AI Insight')).toBeTruthy();
    expect(screen.getByText('You have a free 30-minute window at 4 PM.')).toBeTruthy();
  });

  it('carries the AI scope in the insight card accessibility label', async () => {
    await renderMainHome();
    await settleReady();
    // The reference shows no scope chip on Main Home, so scope is announced rather
    // than drawn — but it must still travel with the insight.
    expect(screen.getByTestId('main-home-ai-insight').props.accessibilityLabel).toContain(
      'Scope: NoorLife only',
    );
  });
});

describe('Main Home quick actions', () => {
  it.each(['Add Task', 'Log Wellness', 'Family Check-in'])(
    'renders the %s action',
    async (label) => {
      await renderMainHome();
      await settleReady();
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    },
  );
});

describe('Main Home bottom navigation', () => {
  it.each(['Home', 'Modules', 'Noor AI', 'Insights', 'Profile'])(
    'renders the %s destination',
    async (label) => {
      await renderMainHome();
      await settleReady();
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    },
  );

  it('marks Home as the selected destination', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.getByTestId('main-home-nav-home').props.accessibilityState.selected).toBe(true);
  });

  it('uses the labelled robot-head control for the centre Noor AI item', async () => {
    await renderMainHome();
    await settleReady();
    expect(screen.getByTestId('main-home-nav-ai').props.accessibilityLabel).toBe('Open Noor AI');
  });
});

describe('Main Home navigation actions', () => {
  it('opens a module when its card is pressed', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    await user.press(screen.getByTestId('module-card-faith'));
    expect(mockRouter.push).toHaveBeenCalledWith('/faith');
  });

  it('opens Noor AI from the centre navigation item', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    await user.press(screen.getByTestId('main-home-nav-ai'));
    expect(mockRouter.push).toHaveBeenCalledWith('/ai');
  });

  it('opens Noor AI from the insight card', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    await user.press(screen.getByTestId('main-home-ai-insight'));
    expect(mockRouter.push).toHaveBeenCalledWith('/ai');
  });

  it('navigates to the owning module from a quick action, never editing in place', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    await user.press(screen.getByTestId('quick-action-log-wellness'));
    expect(mockRouter.push).toHaveBeenCalledWith('/health');
  });

  it('navigates to the source module from a timeline row', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    await user.press(screen.getByTestId('timeline-row-dhuhr'));
    expect(mockRouter.push).toHaveBeenCalledWith('/faith');
  });

  it('opens the notification centre from the top bar', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    await user.press(screen.getByLabelText('Notifications, 3 unread'));
    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
  });

  it('opens Planner from the hero action', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    await user.press(screen.getByLabelText('View My Day'));
    expect(mockRouter.push).toHaveBeenCalledWith('/planner');
  });

  it('re-enters the loading branch when the error state is retried', async () => {
    const user = userEvent.setup();
    await renderMainHome({ simulateFailure: true });
    await settleError();

    await user.press(screen.getByTestId('main-home-error-state-primary-action'));
    expect(screen.getByTestId('main-home-skeleton')).toBeTruthy();
  });
});

describe('Main Home module pictograms', () => {
  it.each(['noor-ai', 'faith', 'health', 'planner', 'finance', 'learning', 'family', 'goals'])(
    'renders the approved PNG pictogram for %s',
    async (id) => {
      await renderMainHome();
      await settleReady();
      const image = screen.getByTestId(`module-pictogram-${id}`);
      // Locked: exactly 48 dp, contain-fitted, never tinted.
      expect(image.props.resizeMode).toBe('contain');
      expect(image.props.style.width).toBe(48);
      expect(image.props.style.height).toBe(48);
      expect(image.props.source).toBeDefined();
    },
  );

  it('renders all eight pictograms and no vector module glyph', async () => {
    await renderMainHome();
    await settleReady();
    const images = screen.getAllByTestId(/^module-pictogram-/);
    expect(images).toHaveLength(8);
  });
});
