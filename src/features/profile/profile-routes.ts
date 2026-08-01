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
 * ── Why three rows point somewhere ──────────────────────────────────────────
 * `/profile/edit` and `/profile/family-membership` are the two detail screens Phase 6C-2A built;
 * `/settings/help` is the existing help destination, reused because sending a user to a screen that
 * exists is better than telling them it does not. `/family/members` was never substituted for
 * `/profile/family-membership` — it is the family-plan seat manager over a development fixture,
 * which is not what this row promises.
 *
 * Preferences and Privacy & Security remain deferred and keep the centralized note. Undoing that is
 * still one line each, and Profile Home is still not touched to do it.
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
    // Built in Phase 6C-2A. One line changed from `null` — Profile Home itself was not touched.
    available: '/profile/family-membership' as Href,
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
