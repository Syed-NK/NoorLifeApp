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
 * ── Why four rows point somewhere ───────────────────────────────────────────
 * `/profile/edit` and `/profile/family-membership` are Phase 6C-2A's two detail screens;
 * `/profile/preferences` and `/profile/help` are Phase 6C-2B's. `/family/members` was never
 * substituted for `/profile/family-membership` — it is the family-plan seat manager over a
 * development fixture, which is not what that row promises.
 *
 * Help & Support left `/settings/help` in Phase 6C-2B. That route is the *module* help placeholder
 * — every module registry entry still points at it — so it was not deleted, and it was not
 * upgraded either: a module's help and an account's help are different destinations that happened
 * to share a placeholder while neither existed.
 *
 * Privacy & Security remains deferred and keeps the centralized note. Undoing that is still one
 * line, and Profile Home is still not touched to do it.
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
    // Built in Phase 6C-2B. One line changed from `null` — Profile Home itself was not touched.
    available: '/profile/preferences' as Href,
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
    // Phase 6C-2B. Moved off the shared `/settings/help` placeholder onto Profile's own screen.
    available: '/profile/help' as Href,
    testID: 'profile-menu-help-support',
  },
];

/** The Edit control on the identity card shares Personal Information's destination. */
export const PROFILE_EDIT_ROUTE = PROFILE_MENU[0]?.available ?? null;

/**
 * Where the header's Help control goes. Null would mean the honest note instead.
 *
 * The same destination as the Help & Support row, because there is one help screen and two ways to
 * ask for it. The loop that would create is closed on the screen itself: `/profile/help` does not
 * pass `onHelp` to the shared scaffold, so the control is absent there rather than pointing at the
 * page the user is already reading.
 */
export const PROFILE_HELP_ROUTE: Href | null = '/profile/help' as Href;
