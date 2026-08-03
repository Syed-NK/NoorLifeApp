import type { Href } from 'expo-router';

/**
 * Where the authentication callback and its recovery screen live.
 *
 * ── Why `/auth/...` and not the existing `(auth)` group ─────────────────────
 * `src/app/(auth)` is an Expo Router *group*, so it contributes no URL segment: its twelve screens are
 * flat (`/welcome`, `/sign-in`, `/new-password`). These two need a real `auth` segment, because the
 * first of them is the URL Supabase redirects to and that URL has to be written into a dashboard
 * allow-list. A group cannot supply a segment, so a `src/app/auth` directory does.
 *
 * The two do not collide. A group adds no path, so `(auth)/welcome` is `/welcome` and `auth/callback`
 * is `/auth/callback`.
 *
 * ── Why Set New Password is here rather than beside `/new-password` ─────────
 * The existing `/new-password` screen is reachable by ordinary navigation and, before this phase,
 * would submit `updateUser({ password })` against whatever session happened to exist — so reached with
 * a live ordinary session it changed the signed-in account's password. This screen is reachable only
 * through a recovery grant that a successful recovery exchange minted, which is a different guarantee
 * and therefore a different screen. Putting it under `/auth` keeps that distinction visible in the
 * route rather than resting on a parameter.
 */

/** The single approved callback route. Mirrors `AUTH_CALLBACK_PATH` in the service configuration. */
export const AUTH_CALLBACK_ROUTE = '/auth/callback' as Href;

/** Reachable only with a live recovery grant. */
export const SET_NEW_PASSWORD_ROUTE = '/auth/set-new-password' as Href;

/** The two routes as plain strings, for the route-contract test. */
export const AUTH_CALLBACK_ROUTE_PATHS = ['/auth/callback', '/auth/set-new-password'] as const;
