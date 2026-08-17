import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { AuthProvider } from '@application/providers/auth-provider';
import { AuthError } from '@services/auth/auth-service.contract';
import * as authService from '@services/auth/auth.service';
import * as profileService from '@services/profile/profile.service';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { mockRouter } from '../../../../jest.setup';
import { PROFILE_LAYOUT } from '../profile-metrics';
import { PROFILE_NAME_MAX_LENGTH } from '../profile-name';
import { PersonalInformationScreen } from '../screens/personal-information-screen';

// Mounts screens backed by simulated-latency mocks. Advancing those timers rather than
// sleeping through them is what keeps this suite inside Jest's default per-test budget.
installMockLatencyTimers();

/**
 * Personal Information — the one editable field in Profile.
 *
 * The jest environment signs in as Ahmed Al-Rashid / ahmed@example.com through the real
 * `AuthProvider` and the real Supabase double (see jest.setup.ts), so every identity assertion here
 * is against an actual authenticated session rather than a fixture the screen was handed.
 *
 * The write is **observed, not replaced**. `jest.spyOn` with no implementation records the call and
 * lets it through, so the screen calls the real provider action, which calls the real service
 * function, which writes to the Supabase double — and the double's `profiles` row genuinely changes,
 * so a later read returns the new value. Only the tests that need a *failure* substitute one.
 */

const SESSION_NAME = 'Ahmed Al-Rashid';
const SESSION_EMAIL = 'ahmed@example.com';

let updateFullName: jest.SpyInstance<Promise<profileService.ProfileNameUpdate>, [string, string]>;

beforeEach(() => {
  updateFullName = jest.spyOn(profileService, 'updateFullName');
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderScreen() {
  const utils = await render(
    <AuthProvider>
      <PersonalInformationScreen />
    </AuthProvider>,
  );
  // The session resolves through several awaited hops; the field is seeded only once a real name
  // has arrived, so waiting for it is waiting for the screen to be genuinely ready.
  await screen.findByTestId('personal-information-name');
  return utils;
}

/** Types a complete replacement value into the name field. */
async function typeName(value: string) {
  await fireEvent.changeText(screen.getByTestId('personal-information-name'), value);
}

function flatStyle(testID: string): Record<string, unknown> {
  const style = screen.getByTestId(testID).props.style;
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
}

describe('the data it shows', () => {
  it('populates the field with the real authenticated name', async () => {
    await renderScreen();
    expect(screen.getByTestId('personal-information-name').props.value).toBe(SESSION_NAME);
  });

  it('displays the real authenticated email, read only', async () => {
    await renderScreen();

    expect(screen.getByTestId('personal-information-email-value')).toHaveTextContent(SESSION_EMAIL);
    // Not an input: there is no editable control for the address anywhere on this screen.
    expect(screen.queryByDisplayValue(SESSION_EMAIL)).toBeNull();
    expect(screen.getByTestId('personal-information-email-supporting')).toHaveTextContent(
      'Email changes are managed in Privacy & Security.',
    );
  });

  it('names the actual sign-in provider rather than assuming one', async () => {
    await renderScreen();

    // The session double reports `app_metadata.provider: 'email'`.
    await waitFor(() =>
      expect(screen.getByTestId('personal-information-provider-value')).toHaveTextContent('Email'),
    );
  });

  it('hardcodes no identity of its own', async () => {
    await renderScreen();

    for (const invented of ['Test User', 'user@example.com', 'Syed Gmail', 'John Doe', 'test']) {
      expect(screen.queryByText(invented)).toBeNull();
    }
  });

  it('does not present a working avatar upload', async () => {
    await renderScreen();

    expect(screen.getByTestId('personal-information-avatar')).toBeTruthy();
    expect(screen.getByTestId('personal-information-photo-note')).toHaveTextContent(
      'Profile photo changes are coming later.',
    );
    // No control that would imply the capability exists — not even a disabled one.
    for (const label of [
      'Upload',
      'Change photo',
      'Upload photo',
      'Choose photo',
      'Remove photo',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('holds the field’s geometry while the name is still loading', async () => {
    /*
      A session that never arrives is the only way to hold the screen in its pre-resolution state long
      enough to assert on it.

      Both entry points have to be held. The launch reads `resolveSession` — not `getSession`, which
      is now a convenience wrapper the provider does not call — and Supabase's own event stream can
      deliver a session independently, which would settle the screen this case exists to catch
      mid-resolution.
    */
    jest.spyOn(authService, 'resolveSession').mockReturnValue(new Promise<never>(() => undefined));
    jest.spyOn(authService, 'subscribeToAuthChanges').mockReturnValue(() => undefined);

    await render(
      <AuthProvider>
        <PersonalInformationScreen />
      </AuthProvider>,
    );

    // The field is a skeleton *inside the same reserved box*, so the rows beneath it do not move
    // when the real value arrives.
    expect(flatStyle('personal-information-name-field').minHeight).toBe(
      PROFILE_LAYOUT.detail.nameFieldHeight,
    );
    expect(screen.getByTestId('personal-information-name-loading')).toBeTruthy();
    // No input seeded with a guess, and no empty field pretending the account has no name.
    expect(screen.queryByTestId('personal-information-name')).toBeNull();
  });
});

describe('validation', () => {
  it('accepts an international name', async () => {
    await renderScreen();
    await typeName('أحمد الراشد');

    expect(screen.queryByTestId('personal-information-name-error')).toBeNull();
    expect(screen.getByTestId('personal-information-save').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('rejects a whitespace-only name', async () => {
    await renderScreen();
    await typeName('    ');

    expect(screen.getByTestId('personal-information-name-error')).toHaveTextContent(
      'Enter your name.',
    );
    expect(screen.getByTestId('personal-information-save').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('rejects an overly long name', async () => {
    await renderScreen();
    await typeName('a'.repeat(PROFILE_NAME_MAX_LENGTH + 1));

    expect(screen.getByTestId('personal-information-name-error')).toHaveTextContent(
      `Use ${PROFILE_NAME_MAX_LENGTH} characters or fewer.`,
    );
    expect(screen.getByTestId('personal-information-save').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('shows the error inside the field’s reserved box, so nothing below it moves', async () => {
    await renderScreen();
    const before = flatStyle('personal-information-name-field');

    await typeName('  ');

    expect(screen.getByTestId('personal-information-name-error')).toBeTruthy();
    // The box that holds label, input and error keeps exactly the height it already had.
    expect(flatStyle('personal-information-name-field').minHeight).toBe(before.minHeight);
  });

  it('announces the problem to a screen reader rather than only colouring the border', async () => {
    await renderScreen();
    await typeName('');

    const input = screen.getByTestId('personal-information-name');
    expect(input.props.accessibilityLiveRegion).toBe('polite');
    // The field and its problem are read together, not as two unrelated fragments.
    expect(input.props.accessibilityLabel).toBe('Full Name. Enter your name.');
  });

  it('shows no error before the user has typed anything', async () => {
    await renderScreen();
    expect(screen.queryByTestId('personal-information-name-error')).toBeNull();
  });
});

describe('saving', () => {
  it('disables Save while the name is unchanged', async () => {
    await renderScreen();

    const save = screen.getByTestId('personal-information-save');
    expect(save.props.accessibilityState.disabled).toBe(true);
    expect(save.props.accessibilityHint).toBe('Change your name to enable saving.');
  });

  it('stays disabled when only surrounding whitespace was added', async () => {
    await renderScreen();
    await typeName(`  ${SESSION_NAME}  `);

    expect(screen.getByTestId('personal-information-save').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('calls the profile service exactly once for a valid edit', async () => {
    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-save'));

    await waitFor(() => expect(updateFullName).toHaveBeenCalledTimes(1));
    expect(updateFullName).toHaveBeenCalledWith('test-user-id', 'Ahmed Rashid');
  });

  it('trims the value it stores', async () => {
    await renderScreen();
    await typeName('   Ahmed Rashid   ');
    await fireEvent.press(screen.getByTestId('personal-information-save'));

    await waitFor(() =>
      expect(updateFullName).toHaveBeenCalledWith('test-user-id', 'Ahmed Rashid'),
    );
  });

  it('does not write twice when the button is tapped twice', async () => {
    let release: (value: profileService.ProfileNameUpdate) => void = () => undefined;
    updateFullName.mockImplementation(
      () =>
        new Promise<profileService.ProfileNameUpdate>((resolve) => {
          release = resolve;
        }),
    );

    await renderScreen();
    await typeName('Ahmed Rashid');

    const save = screen.getByTestId('personal-information-save');
    await fireEvent.press(save);
    // The second tap lands while the first request is still in flight.
    await fireEvent.press(save);

    expect(updateFullName).toHaveBeenCalledTimes(1);
    release({ fullName: 'Ahmed Rashid' });
    await waitFor(() => expect(screen.getByTestId('personal-information-success')).toBeTruthy());
  });

  it('keeps the button’s dimensions while it is saving', async () => {
    let release: (value: profileService.ProfileNameUpdate) => void = () => undefined;
    updateFullName.mockImplementation(
      () =>
        new Promise<profileService.ProfileNameUpdate>((resolve) => {
          release = resolve;
        }),
    );

    await renderScreen();
    const idle = flatStyle('personal-information-save');
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-save'));

    // The spinner replaces the label *in place* — same height, same radius, no reflow.
    expect(screen.getByTestId('personal-information-save-spinner')).toBeTruthy();
    const busy = flatStyle('personal-information-save');
    expect(busy.height).toBe(idle.height);
    expect(busy.borderRadius).toBe(idle.borderRadius);
    expect(screen.getByTestId('personal-information-save').props.accessibilityState.busy).toBe(
      true,
    );

    release({ fullName: 'Ahmed Rashid' });
    await waitFor(() => expect(screen.getByTestId('personal-information-success')).toBeTruthy());
  });

  it('confirms the save in a way a screen reader announces', async () => {
    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-save'));

    const banner = await screen.findByTestId('personal-information-success');
    expect(banner).toHaveTextContent('Name updated');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
  });

  it('disables Save again once the edit has been saved', async () => {
    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-save'));

    await screen.findByTestId('personal-information-success');
    expect(screen.getByTestId('personal-information-save').props.accessibilityState.disabled).toBe(
      true,
    );
  });
});

describe('when the save fails', () => {
  it('keeps the entered name on screen and offers a retryable error', async () => {
    updateFullName.mockRejectedValue(new AuthError('server-error'));

    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-save'));

    const error = await screen.findByTestId('personal-information-error');
    expect(error).toHaveTextContent('Something went wrong on our side. Please try again.');
    // The edit survives, so the user retries rather than retypes.
    expect(screen.getByTestId('personal-information-name').props.value).toBe('Ahmed Rashid');
    expect(screen.getByTestId('personal-information-save').props.accessibilityState.disabled).toBe(
      false,
    );
    expect(screen.queryByTestId('personal-information-success')).toBeNull();
  });

  it('does not claim success when the device is offline', async () => {
    updateFullName.mockRejectedValue(new AuthError('offline'));

    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-save'));

    expect(await screen.findByTestId('personal-information-error')).toHaveTextContent(
      'You appear to be offline. Check your connection and try again.',
    );
    expect(screen.queryByTestId('personal-information-success')).toBeNull();
    expect(screen.getByTestId('personal-information-name').props.value).toBe('Ahmed Rashid');
  });

  it('retries successfully after a failure, without the user retyping', async () => {
    updateFullName.mockRejectedValueOnce(new AuthError('offline'));

    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-save'));
    await screen.findByTestId('personal-information-error');

    await fireEvent.press(screen.getByTestId('personal-information-save'));

    await waitFor(() => expect(screen.getByTestId('personal-information-success')).toBeTruthy());
    expect(screen.queryByTestId('personal-information-error')).toBeNull();
  });
});

describe('leaving the screen', () => {
  it('returns to Profile Home when nothing has been edited', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('personal-information-header-back'));

    // Profile Home, not Main Home. `dismissTo` pops to it when it is on the stack.
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
    expect(mockRouter.dismissTo).not.toHaveBeenCalledWith('/home');
  });

  it('names its destination for a screen reader', async () => {
    await renderScreen();
    expect(screen.getByTestId('personal-information-header-back').props.accessibilityLabel).toBe(
      'Back to Profile',
    );
  });

  it('asks before discarding an unsaved edit', async () => {
    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-header-back'));

    expect(await screen.findByTestId('personal-information-discard-panel')).toBeTruthy();
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  });

  it('stays on the screen with the edit intact when Keep Editing is chosen', async () => {
    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-header-back'));
    await fireEvent.press(await screen.findByTestId('personal-information-discard-keep'));

    await waitFor(() =>
      expect(screen.queryByTestId('personal-information-discard-panel')).toBeNull(),
    );
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('personal-information-name').props.value).toBe('Ahmed Rashid');
  });

  it('returns to Profile Home when Discard Changes is chosen', async () => {
    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-header-back'));
    await fireEvent.press(await screen.findByTestId('personal-information-discard-confirm'));

    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
    // Discarding is not saving: nothing was written.
    expect(updateFullName).not.toHaveBeenCalled();
  });

  it('does not ask after the edit has been saved', async () => {
    await renderScreen();
    await typeName('Ahmed Rashid');
    await fireEvent.press(screen.getByTestId('personal-information-save'));
    await screen.findByTestId('personal-information-success');

    await fireEvent.press(screen.getByTestId('personal-information-header-back'));

    expect(screen.queryByTestId('personal-information-discard-panel')).toBeNull();
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
  });
});

describe('the Android hardware back button', () => {
  /** The most recently registered `hardwareBackPress` handler. */
  function pressHardwareBack(): boolean {
    const calls = (BackHandler.addEventListener as unknown as jest.Mock).mock.calls.filter(
      (call: readonly unknown[]) => call[0] === 'hardwareBackPress',
    );
    const handler = calls[calls.length - 1]?.[1] as (() => boolean) | undefined;
    if (handler === undefined) {
      throw new Error('The screen registered no hardwareBackPress handler.');
    }
    return handler();
  }

  beforeEach(() => {
    jest.spyOn(BackHandler, 'addEventListener');
  });

  it('leaves to Profile Home when nothing has been edited', async () => {
    await renderScreen();

    expect(pressHardwareBack()).toBe(true);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
  });

  it('raises the same discard confirmation as the header’s Back', async () => {
    await renderScreen();
    await typeName('Ahmed Rashid');

    // Handled — the confirmation is now the only way out, in both directions.
    expect(pressHardwareBack()).toBe(true);
    expect(await screen.findByTestId('personal-information-discard-panel')).toBeTruthy();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  });
});

describe('accessibility and layout', () => {
  it('gives Save at least a 44 dp target', async () => {
    await renderScreen();
    expect(flatStyle('personal-information-save').height).toBeGreaterThanOrEqual(44);
  });

  it('gives the header controls at least a 44 dp target', async () => {
    await renderScreen();
    expect(flatStyle('personal-information-header-back').width).toBeGreaterThanOrEqual(44);
    expect(flatStyle('personal-information-header-back').height).toBeGreaterThanOrEqual(44);
  });

  it('associates a visible label with the input rather than relying on a placeholder', async () => {
    await renderScreen();

    expect(screen.getByText('Full Name')).toBeTruthy();
    expect(screen.getByTestId('personal-information-name').props.accessibilityLabel).toBe(
      'Full Name',
    );
  });

  it('associates the read-only rows with their labels', async () => {
    await renderScreen();

    expect(screen.getByLabelText(`Email, ${SESSION_EMAIL}`)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Signed in with, Email')).toBeTruthy());
  });

  it('keeps taps working with the keyboard open', async () => {
    await renderScreen();

    const scroll = screen.getByTestId('personal-information-scroll');
    // Without this the first tap on Save is consumed dismissing the keyboard.
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('keeps Save inside the scrolling content, so the keyboard cannot clip it', async () => {
    await renderScreen();

    // The device pass found Save clipped by the top row of keys while it was a pinned footer: under
    // edge-to-edge the keyboard-avoiding view does not shrink by quite the full keyboard height.
    // Inside the scroll area there is no geometry left to get wrong.
    const scroll = screen.getByTestId('personal-information-scroll');
    expect(within(scroll).getByTestId('personal-information-save')).toBeTruthy();
    expect(screen.queryByTestId('personal-information-footer')).toBeNull();
  });

  it('lets the OS text size grow the type', async () => {
    await renderScreen();
    // Never disabled on a form: the accessibility rules call that out as a defect.
    expect(screen.getByTestId('personal-information-name').props.allowFontScaling).not.toBe(false);
  });
});
