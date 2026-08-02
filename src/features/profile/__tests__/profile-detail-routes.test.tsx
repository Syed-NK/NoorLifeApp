import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react-native';

import EditRoute from '@app/profile/edit';
import FamilyMembershipRoute from '@app/profile/family-membership';
import HelpRoute from '@app/profile/help';
import PreferencesRoute from '@app/profile/preferences';
import { AppProviders } from '@application/providers/app-providers';

import { PROFILE_EDIT_ROUTE, PROFILE_HELP_ROUTE, PROFILE_MENU } from '../profile-routes';

/**
 * The route contract for the four detail screens.
 *
 * ── Why the route files are rendered rather than inspected ──────────────────
 * A declared route that exports a placeholder is indistinguishable from a working one until it is
 * mounted. `/profile/edit` was exactly that until this phase — a declared route rendering "Editable
 * profile fields with save and validation" — so the useful assertion is that mounting the route
 * produces the screen, not that a file exists at the path.
 */

const APP_PROFILE = join(__dirname, '..', '..', '..', 'app', 'profile');

/** Mounts a route's default export exactly as Expo Router does — inside the app's own providers. */
async function renderRoute(Route: () => React.JSX.Element) {
  return await render(
    <AppProviders>
      <Route />
    </AppProviders>,
  );
}

describe('the declared routes', () => {
  it('mounts Personal Information at /profile/edit', async () => {
    await renderRoute(EditRoute);

    expect(await screen.findByTestId('personal-information')).toBeTruthy();
    expect(screen.getByTestId('personal-information-header-title')).toHaveTextContent(
      'Personal Information',
    );
  });

  it('mounts Family & Membership at /profile/family-membership', async () => {
    await renderRoute(FamilyMembershipRoute);

    expect(await screen.findByTestId('family-membership')).toBeTruthy();
    expect(screen.getByTestId('family-membership-header-title')).toHaveTextContent(
      'Family & Membership',
    );
  });

  it('mounts Preferences at /profile/preferences', async () => {
    await renderRoute(PreferencesRoute);

    expect(await screen.findByTestId('preferences')).toBeTruthy();
    expect(screen.getByTestId('preferences-header-title')).toHaveTextContent('Preferences');
  });

  it('mounts Help & Support at /profile/help', async () => {
    await renderRoute(HelpRoute);

    expect(await screen.findByTestId('help-support')).toBeTruthy();
    expect(screen.getByTestId('help-support-header-title')).toHaveTextContent('Help & Support');
  });

  it.each(['edit.tsx', 'family-membership.tsx', 'preferences.tsx', 'help.tsx'])(
    'leaves no placeholder behind at %s',
    (file) => {
      const source = readFileSync(join(APP_PROFILE, file), 'utf8');
      // The placeholder is what a "declared but dead" route looks like in this codebase.
      expect(source).not.toContain('SimplePlaceholderScreen');
      expect(source).not.toContain('specReference');
    },
  );
});

describe('the Profile Home menu contract', () => {
  it('sends both Edit and Personal Information to /profile/edit', () => {
    expect(PROFILE_EDIT_ROUTE).toBe('/profile/edit');
    expect(PROFILE_MENU[0]?.key).toBe('personal-information');
    expect(PROFILE_MENU[0]?.available).toBe('/profile/edit');
  });

  it('sends Family & Membership to its own new route', () => {
    const row = PROFILE_MENU.find((item) => item.key === 'family-membership');
    expect(row?.available).toBe('/profile/family-membership');
    // Never the fixture-backed family seat manager.
    expect(row?.available).not.toBe('/family/members');
  });

  it('sends Preferences to its own new route', () => {
    const row = PROFILE_MENU.find((item) => item.key === 'preferences');
    expect(row?.available).toBe('/profile/preferences');
  });

  it('moves Help & Support off the shared module help placeholder', () => {
    const row = PROFILE_MENU.find((item) => item.key === 'help-support');
    expect(row?.available).toBe('/profile/help');
    // `/settings/help` is still every module's help destination. It was not repurposed, and the
    // account's help screen is not it.
    expect(row?.available).not.toBe('/settings/help');
    expect(PROFILE_HELP_ROUTE).toBe('/profile/help');
  });

  it('keeps Privacy & Security on the centralized note', () => {
    const row = PROFILE_MENU.find((item) => item.key === 'privacy-security');
    expect(row?.available).toBeNull();
  });

  it('leaves exactly one row deferred', () => {
    expect(PROFILE_MENU.filter((item) => item.available === null)).toHaveLength(1);
  });

  it('leaves no row without either a destination or an honest explanation', () => {
    for (const item of PROFILE_MENU) {
      // `available` is a route or null; null is answered by the Coming Later controller, which the
      // Profile Home navigation suite proves. Either way, no row is inert.
      expect(item.intended.startsWith('/')).toBe(true);
      if (item.available !== null) {
        expect(String(item.available).startsWith('/')).toBe(true);
      }
    }
  });

  it('still records the intended destination for every row', () => {
    expect(PROFILE_MENU.map((item) => item.intended)).toEqual([
      '/profile/edit',
      '/profile/family-membership',
      '/profile/preferences',
      '/profile/privacy-security',
      '/profile/help',
    ]);
  });
});
