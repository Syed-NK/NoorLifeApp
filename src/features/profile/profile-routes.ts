import type { Href } from 'expo-router';
import type { IconName } from '@shared/models/icon';

import { profileCopy } from './profile-copy';

/**
 * The five primary Profile destinations, and what each one can honestly do today.
 *
 * ── Why every row carries two routes ────────────────────────────────────────
 * `intended` is the Phase 6C-2 contract — the route each detail screen will occupy. `available` is
 * what exists *now*. A row navigates when `available` is set and presents the centralized
 * "Coming later" note when it is not.
 *
 * Recording both is what makes the deferral cheap to undo: when `/profile/preferences` is built,
 * one line here changes from `null` to the route, and Profile Home is not touched, redesigned or
 * re-measured. It also keeps the contract visible — a reader can see what is promised and what is
 * shipped without diffing two sessions of work.
 *
 * ── Why two rows already point somewhere ────────────────────────────────────
 * `/profile/edit` and `/settings/help` are declared routes that render today. Sending a user to a
 * screen that exists is better than telling them it does not, and the brief says as much for the
 * header's Help control ("route to the existing help destination if available"). The same rule is
 * applied to the menu rows rather than a different one — but only where the existing screen is
 * unambiguously the same destination. `/family/members` is *not* substituted for
 * `/profile/family-membership`: it is the family-plan seat manager, which is not what a Free
 * account's "Family & Membership" row promises.
 */
export type ProfileMenuItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  /** The Phase 6C-2 destination. Recorded whether or not it exists yet. */
  readonly intended: string;
  /** Where the row goes today, or null when nothing equivalent exists. */
  readonly available: Href | null;
  readonly testID: string;
};

export const PROFILE_MENU: readonly ProfileMenuItem[] = [
  {
    key: 'personal-information',
    label: profileCopy.menu.personalInformation,
    icon: 'profile',
    intended: '/profile/edit',
    available: '/profile/edit' as Href,
    testID: 'profile-menu-personal-information',
  },
  {
    key: 'family-membership',
    label: profileCopy.menu.familyMembership,
    icon: 'family',
    intended: '/profile/family-membership',
    available: null,
    testID: 'profile-menu-family-membership',
  },
  {
    key: 'preferences',
    label: profileCopy.menu.preferences,
    icon: 'settings',
    intended: '/profile/preferences',
    available: null,
    testID: 'profile-menu-preferences',
  },
  {
    key: 'privacy-security',
    label: profileCopy.menu.privacySecurity,
    icon: 'shield',
    intended: '/profile/privacy-security',
    available: null,
    testID: 'profile-menu-privacy-security',
  },
  {
    key: 'help-support',
    label: profileCopy.menu.helpSupport,
    icon: 'help',
    intended: '/profile/help',
    available: '/settings/help' as Href,
    testID: 'profile-menu-help-support',
  },
];

/** The Edit control on the identity card shares Personal Information's destination. */
export const PROFILE_EDIT_ROUTE = PROFILE_MENU[0]?.available ?? null;

/** Where the header's Help control goes. Null would mean the honest note instead. */
export const PROFILE_HELP_ROUTE: Href | null = '/settings/help' as Href;
