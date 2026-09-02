import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, AppState, Text } from 'react-native';

import { AccessibilityProvider } from '@application/providers/accessibility-provider';
import type {
  NotificationCapability,
  NotificationPermissionPort,
  NotificationPermissionStatus,
} from '@services/notifications/notification-permission.service';
import { preferenceStorageKey } from '@services/preferences/device-preferences';
import { useReducedMotion } from '@shared/utils/a11y';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { mockRouter } from '../../../../jest.setup';
import { preferencesCopy } from '../preferences-copy';
import { PreferencesScreen } from '../screens/preferences-screen';

// Two costs this removes: the simulated latency the mock data sources sleep through on every
// mount, and the one-off compile cost of the first mount, warmed up in `beforeAll` so that no
// individual test is charged for it.
installMockLatencyTimers(renderPreferences);

/**
 * Preferences — what it shows, what it refuses to fake, and the one control that is real.
 *
 * ── Why the notification port is injected ───────────────────────────────────
 * The shipped port reports `unavailable`, because this build has no notification stack. The rules
 * around permission — never on mount, once per press, settings after a refusal, re-read on return
 * — are still the part most likely to be implemented wrongly, so they are driven here through a
 * fake port that can occupy every state the real one cannot yet reach. When reminders land, the
 * fake is replaced by the real adapter and none of these expectations change.
 */

const CAPABLE: NotificationCapability = {
  canReadStatus: true,
  canRequest: true,
  canOpenSettings: true,
  canDeliver: true,
};

type FakePort = NotificationPermissionPort & {
  readonly reads: jest.Mock;
  readonly requests: jest.Mock;
  readonly settings: jest.Mock;
};

function fakePort(options: {
  readonly initial: NotificationPermissionStatus;
  readonly afterRequest?: NotificationPermissionStatus;
  readonly capability?: Partial<NotificationCapability>;
  readonly settingsOpen?: boolean;
}): FakePort {
  let current = options.initial;

  const reads = jest.fn(() => Promise.resolve(current));
  const requests = jest.fn(async () => {
    // A real prompt is not instantaneous. Resolving on a later tick is what lets the
    // "exactly once" test press twice while the first request is genuinely still open.
    await Promise.resolve();
    current = options.afterRequest ?? 'allowed';
    return current;
  });
  const settings = jest.fn(() => Promise.resolve(options.settingsOpen ?? true));

  return {
    capability: { ...CAPABLE, ...options.capability },
    read: reads,
    request: requests,
    openSettings: settings,
    reads,
    requests,
    settings,
  };
}

async function renderPreferences(port?: NotificationPermissionPort) {
  const view = await render(
    <AccessibilityProvider>
      <PreferencesScreen {...(port === undefined ? {} : { notificationPort: port })} />
    </AccessibilityProvider>,
  );
  // The stored Reduce Motion value and the first permission read both resolve asynchronously.
  await waitFor(() => expect(screen.getByTestId('preferences-notifications-status')).toBeTruthy());
  return view;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  // Pinned rather than left to the host: the system setting overrides the in-app preference, so a
  // test that did not fix it would pass or fail on whatever the previous test left behind.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});

describe('the four preference areas', () => {
  it('shows exactly four, in the order the brief fixes', async () => {
    await renderPreferences();

    for (const testID of [
      'preferences-notifications',
      'preferences-language',
      'preferences-appearance',
      'preferences-accessibility',
    ]) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }

    // Five headings: the screen title plus one per section. A sixth would mean a section was
    // added without the brief, and a fourth would mean one is missing.
    expect(screen.getAllByRole('header')).toHaveLength(5);
  });

  it('scrolls rather than clipping when the content outgrows the viewport', async () => {
    await renderPreferences();

    // The shared scaffold's scroll view — the same one the Phase 6C-2A screens use, which is what
    // lets a large OS text size expand the page instead of hiding the last section.
    expect(screen.getByTestId('preferences-scroll')).toBeTruthy();

    // No honest sentence on this screen is truncated to fit. `numberOfLines` on any of them would
    // turn a large font size into an ellipsis, which is the clipping this asserts against.
    for (const testID of [
      'preferences-notifications-note',
      'preferences-language-note',
      'preferences-language-quran-note',
      'preferences-appearance-note',
    ]) {
      expect(screen.getByTestId(testID).props.numberOfLines).toBeUndefined();
    }
  });

  it('returns to Profile, never to Main Home', async () => {
    await renderPreferences();
    await fireEvent.press(screen.getByTestId('preferences-header-back'));

    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
  });
});

describe('notifications', () => {
  it('renders the real permission state rather than a default', async () => {
    await renderPreferences(fakePort({ initial: 'not-allowed' }));

    await waitFor(() =>
      expect(screen.getByTestId('preferences-notifications-status-value')).toHaveTextContent(
        'Not allowed',
      ),
    );
  });

  it('reports this build honestly when there is no notification stack', async () => {
    // No port injected: the service the application actually ships.
    await renderPreferences();

    await waitFor(() =>
      expect(screen.getByTestId('preferences-notifications-status-value')).toHaveTextContent(
        'Unavailable',
      ),
    );
    expect(screen.getByTestId('preferences-notifications-note')).toHaveTextContent(
      'Notification preferences will become available when NoorLife reminders are connected.',
    );
    // Nothing to press: there is no prompt to reach and nothing in device settings to change.
    expect(screen.queryByTestId('preferences-notifications-allow')).toBeNull();
    expect(screen.queryByTestId('preferences-notifications-settings')).toBeNull();
  });

  it('never requests permission just because the screen opened', async () => {
    const port = fakePort({ initial: 'not-requested' });
    await renderPreferences(port);

    // Read, yes. Requested, no — on Android a refusal is permanent, and opening a settings screen
    // must not be able to spend the user's one remaining answer.
    expect(port.reads).toHaveBeenCalled();
    expect(port.requests).not.toHaveBeenCalled();
  });

  it('requests exactly once, however fast the button is pressed', async () => {
    const port = fakePort({ initial: 'not-requested', afterRequest: 'allowed' });
    await renderPreferences(port);

    const allow = await screen.findByTestId('preferences-notifications-allow');
    // Two presses inside one tick, while the first request is still open.
    await act(async () => {
      void fireEvent.press(allow);
      void fireEvent.press(allow);
    });

    await waitFor(() => expect(port.requests).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('preferences-notifications-status-value')).toHaveTextContent(
        'Allowed',
      ),
    );
  });

  it('offers device settings once permission has been refused', async () => {
    const port = fakePort({ initial: 'not-allowed' });
    await renderPreferences(port);

    // The prompt is gone after a refusal, so settings is the only route left — and Allow must not
    // be offered, because pressing it could not produce a dialog.
    const settings = await screen.findByTestId('preferences-notifications-settings');
    expect(screen.queryByTestId('preferences-notifications-allow')).toBeNull();

    await fireEvent.press(settings);
    await waitFor(() => expect(port.settings).toHaveBeenCalledTimes(1));
  });

  it('says so when the settings app will not open', async () => {
    const port = fakePort({ initial: 'not-allowed', settingsOpen: false });
    await renderPreferences(port);

    await fireEvent.press(await screen.findByTestId('preferences-notifications-settings'));

    expect(
      await screen.findByTestId('preferences-notifications-settings-failed'),
    ).toHaveTextContent('Your device did not open its settings app.');
  });

  it('re-reads the permission when the app returns to the foreground', async () => {
    let listener: ((state: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      handler: (state: string) => void,
    ) => {
      listener = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener);

    const port = fakePort({ initial: 'not-allowed' });
    await renderPreferences(port);
    const readsBefore = port.reads.mock.calls.length;

    // The user changed the permission in the settings app and came back. The status on screen is
    // now a claim about their device that may no longer be true.
    await act(async () => {
      listener?.('active');
    });

    await waitFor(() => expect(port.reads.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('offers no category toggles at all', async () => {
    await renderPreferences(fakePort({ initial: 'allowed' }));

    // A switch that persists its position and controls nothing is the fake this section exists to
    // avoid — so there is no control of any kind in the notification, language or appearance
    // sections beyond the permission actions themselves.
    for (const section of [
      'preferences-notifications',
      'preferences-language',
      'preferences-appearance',
    ]) {
      expect(within(screen.getByTestId(section)).queryAllByRole('switch')).toHaveLength(0);
    }

    // The one switch in the application's preferences is Reduce Motion, which is genuinely wired.
    // Two nodes carry the role: the labelled row, and the native control inside it.
    const labelled = screen
      .getAllByRole('switch')
      .filter((node) => node.props.accessibilityLabel !== undefined);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]?.props.accessibilityLabel).toBe('Reduce Motion');
  });

  it('keeps the honest note even when permission is granted but nothing can send', async () => {
    await renderPreferences(fakePort({ initial: 'allowed', capability: { canDeliver: false } }));

    // Permission is not the same as a reminder existing to deliver.
    expect(screen.getByTestId('preferences-notifications-note')).toBeTruthy();
  });
});

describe('language', () => {
  it('shows English as the current interface language', async () => {
    await renderPreferences();

    expect(screen.getByTestId('preferences-language-current-value')).toHaveTextContent('English');
  });

  it('defers Arabic rather than offering it as a choice', async () => {
    await renderPreferences();

    const arabic = screen.getByTestId('preferences-language-arabic');
    expect(screen.getByTestId('preferences-language-arabic-marker')).toHaveTextContent(
      'Coming later',
    );
    // Not a control: there is no translated interface to switch to, so nothing here is pressable.
    expect(arabic.props.onStartShouldSetResponder).toBeUndefined();
    expect(screen.getByTestId('preferences-language-note')).toHaveTextContent(
      preferencesCopy.language.interfaceNote,
    );
  });

  it('separates Quran Arabic from interface Arabic', async () => {
    await renderPreferences();

    // The confusion is specific and real: NoorLife already renders Arabic scripture, which makes
    // "the app supports Arabic" look true without the interface being translated at all.
    expect(screen.getByTestId('preferences-language-quran-note')).toHaveTextContent(
      preferencesCopy.language.quranNote,
    );
    expect(preferencesCopy.language.quranNote).toContain('not the app’s interface language');
  });
});

describe('appearance', () => {
  it('shows Light as the active theme', async () => {
    await renderPreferences();

    expect(screen.getByTestId('preferences-appearance-current-value')).toHaveTextContent('Light');
    expect(screen.getByTestId('preferences-appearance-current-marker')).toHaveTextContent('Active');
  });

  it('defers System and Dark honestly', async () => {
    await renderPreferences();

    for (const testID of ['preferences-appearance-system', 'preferences-appearance-dark']) {
      expect(screen.getByTestId(`${testID}-marker`)).toHaveTextContent('Coming later');
    }
    // No control: a theme switch here would darken this screen and leave every other one light.
    expect(screen.getByTestId('preferences-appearance-note')).toHaveTextContent(
      preferencesCopy.appearance.note,
    );
  });
});

describe('accessibility', () => {
  it('persists Reduce Motion through the shared preference service', async () => {
    await renderPreferences();

    await fireEvent(screen.getByTestId('preferences-reduce-motion-switch'), 'valueChange', true);

    await waitFor(async () => {
      // The shared service's namespaced key — not a key this screen invented.
      expect(await AsyncStorage.getItem(preferenceStorageKey('reduceMotion'))).toBe('true');
    });
  });

  it('restores the stored preference on the next mount', async () => {
    await AsyncStorage.setItem(preferenceStorageKey('reduceMotion'), 'true');
    await renderPreferences();

    await waitFor(() =>
      expect(screen.getByTestId('preferences-reduce-motion').props.accessibilityState.checked).toBe(
        true,
      ),
    );
  });

  it('lets the system setting win, and says why the switch will not move', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderPreferences();

    await waitFor(() =>
      expect(screen.getByTestId('preferences-reduce-motion-system')).toBeTruthy(),
    );

    const row = screen.getByTestId('preferences-reduce-motion');
    // On because the operating system says so, and locked because an in-app preference does not
    // get to overrule a decision the user made for their whole phone.
    expect(row.props.accessibilityState.checked).toBe(true);
    expect(row.props.accessibilityState.disabled).toBe(true);
  });

  it('applies a change everywhere immediately, with no restart', async () => {
    function MotionProbe() {
      return <Text testID="motion-probe">{useReducedMotion() ? 'reduced' : 'full'}</Text>;
    }

    await render(
      <AccessibilityProvider>
        <PreferencesScreen />
        <MotionProbe />
      </AccessibilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('motion-probe')).toHaveTextContent('full'));

    await fireEvent(screen.getByTestId('preferences-reduce-motion-switch'), 'valueChange', true);

    // The probe consumes `useReducedMotion`, which is what every animation in the application
    // reads. It flipping is the proof that the change reached them and not just this screen.
    await waitFor(() => expect(screen.getByTestId('motion-probe')).toHaveTextContent('reduced'));
  });

  it('offers a retry instead of a guessed switch when storage cannot be read', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'));
    await renderPreferences();

    // An off switch would be a claim about a value nobody could read.
    expect(await screen.findByTestId('preferences-reduce-motion-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('preferences-reduce-motion-switch')).toBeNull();

    await fireEvent.press(screen.getByTestId('preferences-reduce-motion-retry'));
    await waitFor(() =>
      expect(screen.getByTestId('preferences-reduce-motion-switch')).toBeTruthy(),
    );
  });

  it('reports a change that could not be saved', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage unavailable'));
    await renderPreferences();

    await fireEvent(screen.getByTestId('preferences-reduce-motion-switch'), 'valueChange', true);

    expect(await screen.findByTestId('preferences-reduce-motion-save-failed')).toBeTruthy();
  });

  it('points text size at the system setting instead of adding a slider', async () => {
    await renderPreferences();

    expect(screen.getByTestId('preferences-text-size-row-supporting')).toHaveTextContent(
      preferencesCopy.accessibility.textSize.supporting,
    );
    expect(screen.getByTestId('preferences-text-size-settings')).toBeTruthy();
    // An in-app scale would multiply against the OS one and produce a size neither asked for.
    expect(screen.queryByTestId('preferences-text-size-slider')).toBeNull();
  });

  it('states screen-reader support without claiming certification', async () => {
    await renderPreferences();

    const supporting = screen.getByTestId('preferences-screen-reader-supporting');
    expect(supporting).toHaveTextContent(preferencesCopy.accessibility.screenReader.supporting);
    expect(preferencesCopy.accessibility.screenReader.supporting).toContain(
      'TalkBack and VoiceOver',
    );
    for (const word of ['certified', 'compliant', 'WCAG']) {
      expect(preferencesCopy.accessibility.screenReader.supporting).not.toContain(word);
    }
  });
});
