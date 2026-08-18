import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { MainHomeScreen } from '@features/home/screens/main-home-screen';

import { PersonalInformationScreen } from '../screens/personal-information-screen';
import { ProfileHomeScreen } from '../screens/profile-home-screen';

/**
 * A saved name reaches every surface that shows one, without an app restart.
 *
 * ── Why the screens are mounted together ────────────────────────────────────
 * On the device they *are* mounted together: Personal Information is pushed on top of Profile Home,
 * which sits on top of Main Home, and none of them unmounts. That is precisely the situation in
 * which a stale name survives — a screen that re-reads on mount would look correct in a test that
 * mounted it fresh, and be wrong on the device. So both readers stay mounted here while the write
 * happens beneath them.
 *
 * Nothing is stubbed: the real `AppProviders`, the real `AuthProvider` action, the real profile
 * service, and the Supabase double's `profiles` row, which genuinely changes when written.
 */

const NEW_NAME = 'Yusuf Al-Rashid';

async function renderProfileAndEditor() {
  await render(
    <AppProviders>
      <ProfileHomeScreen />
      <PersonalInformationScreen />
    </AppProviders>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('profile-identity-name')).toHaveTextContent('Ahmed Al-Rashid');
    expect(screen.getByTestId('personal-information-name')).toBeTruthy();
  });
}

async function save(name: string) {
  await fireEvent.changeText(screen.getByTestId('personal-information-name'), name);
  await fireEvent.press(screen.getByTestId('personal-information-save'));
  await screen.findByTestId('personal-information-success');
}

describe('after a successful save', () => {
  it('updates the compact Profile Home identity card in place', async () => {
    await renderProfileAndEditor();
    await save(NEW_NAME);

    // Profile Home was never unmounted or remounted — it re-read the row it was told changed.
    await waitFor(() =>
      expect(screen.getByTestId('profile-identity-name')).toHaveTextContent(NEW_NAME),
    );
    expect(screen.queryByText('Ahmed Al-Rashid')).toBeNull();
  });

  it('reads the new name aloud from the identity card, not the old one', async () => {
    await renderProfileAndEditor();
    await save(NEW_NAME);

    await waitFor(() =>
      expect(screen.getByTestId('profile-identity-name').props.accessibilityLabel).toBe(
        `Signed in as ${NEW_NAME}`,
      ),
    );
  });
});

describe('the Main Home greeting', () => {
  it('shows the new given name without a restart', async () => {
    await render(
      <AppProviders>
        <MainHomeScreen />
        <PersonalInformationScreen />
      </AppProviders>,
    );

    // The greeting renders the session's given name — "Ahmed" from "Ahmed Al-Rashid".
    await screen.findByTestId('main-home-hero');
    await waitFor(() => expect(screen.getByText('Ahmed')).toBeTruthy());
    await screen.findByTestId('personal-information-name');

    await save(NEW_NAME);

    // "Yusuf", derived from the saved full name by the shared auth state Main Home reads.
    await waitFor(() => expect(screen.getByText('Yusuf')).toBeTruthy());
    expect(screen.queryByText('Ahmed')).toBeNull();
  });
});
