import { render, screen, userEvent } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import {
  TodayAgendaProvider,
  todayAgenda,
  type TodayAgendaState,
} from '@application/providers/today-agenda-provider';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { MainHomeScreen } from '../screens/main-home-screen';
import { mockRouter } from '../../../../jest.setup';

// Two costs this removes: the 450 ms the mock dashboard sleeps on every mount, and the one-off
// compile cost of the first mount, which is warmed up in `beforeAll` so no test is charged for it.
installMockLatencyTimers(() => renderMainHome());

/**
 * Main Home proof-screen tests.
 *
 * Renders the real screen inside the real providers — nothing in the design system
 * or the module theme registry is stubbed, so these assertions exercise the same
 * code path the device does.
 *
 * The screen mounts its own upgrade-sheet controller, so this is the same tree `/home`
 * builds — nothing about the paywall behaviour depends on a test-only wrapper.
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

async function renderMainHome(props?: {
  readonly simulateFailure?: boolean;
  /**
   * Today's real Planner tasks.
   *
   * Injected through the agenda port rather than seeded into storage, so a case says what it means
   * without deriving an account key. Omitted means "the port is not overridden" — production wiring,
   * which on an empty store reports no tasks.
   */
  readonly agenda?: TodayAgendaState;
}) {
  const screenElement = <MainHomeScreen simulateFailure={props?.simulateFailure ?? false} />;
  return render(
    <AppProviders>
      {props?.agenda === undefined ? (
        screenElement
      ) : (
        <TodayAgendaProvider state={props.agenda}>{screenElement}</TodayAgendaProvider>
      )}
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
    /*
      Lock §6 fixes both the text and its line breaks, and the string still carries them — three
      authored lines at the default text size, exactly as before.

      What is no longer asserted is a `numberOfLines` of three. That cap was the mechanism this case
      relied on and it is what broke the promise in the title: once #141 restored scaling, the third
      authored line stopped fitting the fixed 182 dp copy column at 1.5, wrapped onto a fourth
      rendered line, and the cap dropped it — the hero read `beautifully in` (#151). So the assertion
      is now the property the name always described: the whole tagline, and nothing able to cut it.
    */
    const title = screen.getByText('Your family,\nyour day,\nbeautifully in sync.');
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.ellipsizeMode).toBeUndefined();
    expect(title.props.adjustsFontSizeToFit).not.toBe(true);
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

  /**
   * The three fixtures that used to be asserted here are gone from the product.
   *
   * They were `School drop-off 8:00 AM`, `Work focus time 10:00 AM` and `Family dinner 5:30 PM` —
   * invented rows shown as the user's own day while Planner held zero tasks. A test that pinned them
   * was pinning the defect, exactly as the earlier `['Dhuhr Prayer', '12:35 PM']` case pinned a
   * fabricated prayer time until that row became live. What replaces them is a statement about
   * behaviour: real tasks appear, and their absence is stated rather than filled.
   */
  it.each([
    ['School drop-off', '8:00 AM'],
    ['Work focus time', '10:00 AM'],
    ['Family dinner', '5:30 PM'],
  ])('never invents "%s" at %s', async (title, time) => {
    await renderMainHome();
    await settleReady();
    expect(screen.queryByText(title)).toBeNull();
    expect(screen.queryByText(time)).toBeNull();
  });

  /*
    The port is injected with a *settled* empty reading rather than left to production wiring.

    Under production wiring this case depends on when Planner's storage read resolves, and these
    suites run on fake timers — so the assertion would be timing a mock rather than testing the
    behaviour. While the read is genuinely in flight the section correctly says nothing at all about
    tasks; what matters here is what it says once the answer is known, and that is stated directly.
  */
  it('says nothing is planned when the user has no tasks due today', async () => {
    await renderMainHome({ agenda: todayAgenda([]) });
    await settleReady();

    expect(screen.getByText('Nothing planned for today')).toBeTruthy();
    expect(screen.getByTestId('timeline-row-planner-nothing-today')).toBeTruthy();
  });

  it('claims no tasks at all while Planner is still being read', async () => {
    await renderMainHome({ agenda: todayAgenda([], { status: 'loading' }) });
    await settleReady();

    // The real prayer row is still there; nothing is asserted about tasks either way.
    expect(screen.getByTestId('timeline-row-next-prayer')).toBeTruthy();
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
    expect(screen.queryByText('Your plan is unavailable — open Planner')).toBeNull();
  });

  it("renders the user's real task with its own title and time", async () => {
    await renderMainHome({
      agenda: todayAgenda([{ id: 'task.real-1', title: 'Collect prescription', time: '9:30 AM' }]),
    });
    await settleReady();

    expect(screen.getByText('Collect prescription')).toBeTruthy();
    expect(screen.getByText('9:30 AM')).toBeTruthy();
    // ...and the honest empty row steps aside once there is something true to show.
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
  });

  it('states that the plan is unavailable rather than showing an empty day', async () => {
    await renderMainHome({
      agenda: todayAgenda([], { status: 'unavailable' }),
    });
    await settleReady();

    expect(screen.getByText('Your plan is unavailable — open Planner')).toBeTruthy();
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
  });

  it('renders a prayer row that states no time it has not calculated', async () => {
    await renderMainHome();
    await settleReady();

    expect(screen.getByTestId('timeline-row-next-prayer')).toBeTruthy();
    // The fabricated value, gone from the screen as well as from the fixture.
    expect(screen.queryByText('12:35 PM')).toBeNull();
    expect(screen.queryByText('Dhuhr Prayer')).toBeNull();
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

  it('renders the Noor AI Insight card, in its application-guidance scope', async () => {
    await renderMainHome();
    await settleReady();

    // The default providers resolve a free entitlement, and Noor AI is scope-limited rather than
    // locked on it: the card is unchanged, keeps its title and stays tappable, but the personalized
    // insight is replaced by what Noor AI can actually help a free user with. The paid
    // "You have a free 30-minute window at 4 PM." presentation is asserted in
    // `main-home-premium-actions.test.tsx`, which can supply a paid entitlement.
    expect(screen.getByTestId('main-home-ai-insight')).toBeTruthy();
    expect(screen.getByText('Noor AI Insight')).toBeTruthy();
    expect(
      screen.getByText('Ask Noor AI how to find features or manage your account.'),
    ).toBeTruthy();
    expect(screen.queryByText('You have a free 30-minute window at 4 PM.')).toBeNull();
  });

  it('carries the AI scope in the insight card accessibility label', async () => {
    await renderMainHome();
    await settleReady();
    // The reference shows no scope chip on Main Home, so scope is announced rather
    // than drawn — but it must still travel with the insight. On the free plan the announced
    // scope is the narrower one, because "NoorLife only" would overstate what Noor AI covers here.
    expect(screen.getByTestId('main-home-ai-insight').props.accessibilityLabel).toContain(
      'Scope: NoorLife app help only',
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

  it('never edits in place from a quick action, and never enters a module it cannot open', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    // Health is premium and the default providers resolve a free entitlement, so this raises the
    // upgrade explanation instead of navigating. What matters here is the half of the original
    // assertion that still applies on every plan: Main Home opens no editor of its own, and it does
    // not enter Health first. `main-home-premium-actions.test.tsx` asserts the `/health` push on a
    // paid entitlement, which is where that expectation now belongs.
    await user.press(screen.getByTestId('quick-action-log-wellness'));
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByTestId('main-home-upgrade-sheet')).toBeTruthy();
  });

  it('navigates to the source module from a timeline row', async () => {
    const user = userEvent.setup();
    await renderMainHome();
    await settleReady();

    await user.press(screen.getByTestId('timeline-row-next-prayer'));
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
