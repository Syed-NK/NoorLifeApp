import type { Href } from 'expo-router';

/**
 * Where Privacy & Security and its two detail screens live.
 *
 * ── Why the children nest under the parent path ─────────────────────────────
 * `/profile/privacy-security/change-password` rather than `/profile/change-password`. The URL then
 * states the relationship the navigation already has: Back from either child returns to Privacy &
 * Security, not to Profile Home, and a reader can tell from the route alone which screen owns it.
 *
 * The directory carries no `_layout.tsx` on purpose — Expo Router adds routes from a layout-less
 * folder to the nearest parent navigator, so all three screens live in the Profile stack that
 * `app/profile/_layout.tsx` already declares. A second Stack here would push a redundant navigator
 * between Profile and its own children and break `dismissTo`.
 */

export const PRIVACY_SECURITY_ROUTE = '/profile/privacy-security' as Href;
export const CHANGE_PASSWORD_ROUTE = '/profile/privacy-security/change-password' as Href;
export const CHANGE_EMAIL_ROUTE = '/profile/privacy-security/change-email' as Href;

/** The three routes as plain strings, for the route-contract test. */
export const PRIVACY_SECURITY_ROUTE_PATHS = [
  '/profile/privacy-security',
  '/profile/privacy-security/change-password',
  '/profile/privacy-security/change-email',
] as const;
