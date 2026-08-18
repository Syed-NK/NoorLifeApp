import { Asset } from 'expo-asset';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';

import { noorLifeAssets } from '@shared/assets/noorlife-assets';

/**
 * Hides the Android/iOS native launch screen, automatically and exactly once.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 * Before Phase 5C the only `hideAsync` trigger was `onLayout` on a view that was itself gated
 * behind a readiness flag:
 *
 *   if (!ready) return <View />;                    // no onLayout on this branch
 *   return <View onLayout={onLayoutRootView}>…      // only mounts once ready
 *
 * and `ready` included `auth.status !== 'unknown'`, which resolves over the network. When the
 * session never resolved — a flaky connection is enough — the view carrying `onLayout` never
 * mounted, `hideAsync` was never called, and the native splash stayed up **until the user
 * touched the screen**, because a touch is what eventually forced the re-render that mounted it.
 *
 * That is the whole bug: one trigger, and that trigger placed behind the slowest, least reliable
 * dependency in the app.
 *
 * ── The design here ─────────────────────────────────────────────────────────
 * The native layer waits for one thing only: the branded splash being ready to paint. It never
 * waits for session, onboarding, entitlement, or the branded splash's own 1800 ms minimum — all of
 * which run *behind* the branded splash once it is visible.
 *
 * Two signals, two independent automatic paths to dismissal, and an idempotent guard:
 *
 *   • normal   — artwork decoded **and** the splash view laid out, then one animation frame
 *   • fallback — a bounded ceiling after mount, so a missing signal degrades to a late dismissal
 *                rather than a frozen screen
 *
 * Neither path involves a touch handler. There is no gesture anywhere in this file.
 */

/**
 * Defensive ceiling after the React root mounts, in ms.
 *
 * 1500. Long enough that the normal path wins on any healthy launch, short enough that a user
 * never sits on a stuck native screen. It hides the *native* layer only — it does not route, does
 * not skip the branded splash, and does not touch the startup decision.
 */
export const NATIVE_SPLASH_FALLBACK_MS = 1500;

/**
 * Requested-once, for the whole process rather than per hook instance.
 *
 * ── Why this had to stop being a ref (Phase 6C-3C) ──────────────────────────
 * The guard was an instance ref, which was correct while `useNativeSplashHandoff` had exactly one
 * caller — the entry gate. A **cold-start deep link** broke that assumption in the worst possible
 * way: Expo Router makes the linked route the initial route, so `src/app/index.tsx` never mounts,
 * the hook never runs, its 1500 ms ceiling is never armed, and the *native* splash stays up over a
 * working app for ever. That is not a hypothetical — it is what a real emailed confirmation link did
 * on the emulator, and it looked exactly like a hang.
 *
 * The fix needs a second caller in the root layout, which mounts for every route. Two instances mean
 * two refs, and two calls to `hideAsync`. The hook's own comment already says relying on that being
 * harmless is relying on an implementation detail — so the guard moved to where the thing it guards
 * actually lives. The native splash is one global native resource; "has it been asked to hide?" is a
 * property of the process, not of a component.
 */
let hideRequestedForProcess = false;

/**
 * Clears the process-wide guard. **Tests only.**
 *
 * The application never calls it: once hidden, the native splash stays hidden for the life of the
 * process. A suite that mounts the harness repeatedly needs each mount to be a fresh launch.
 */
export function resetNativeSplashHandoff(): void {
  hideRequestedForProcess = false;
}

export type NativeSplashHandoff = {
  /** Attach to the branded splash's wrapper `onLayout`. */
  readonly onBrandedSplashLayout: () => void;
  /** True once the native layer has been hidden. */
  readonly isNativeSplashHidden: boolean;
};

export function useNativeSplashHandoff(): NativeSplashHandoff {
  const [artworkLoaded, setArtworkLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);

  const mountedAt = useRef<number | null>(null);
  mountedAt.current ??= Date.now();

  const hide = useCallback((reason: 'ready' | 'fallback' | 'route-backstop') => {
    // Process-wide, so the entry gate and the root layout's backstop cannot both ask. See the note
    // on `hideRequestedForProcess`.
    if (hideRequestedForProcess) {
      return;
    }
    hideRequestedForProcess = true;

    const elapsed = Date.now() - (mountedAt.current ?? Date.now());

    ExpoSplashScreen.hideAsync()
      .then(() => {
        setHidden(true);
        if (__DEV__) {
          console.log(`[splash] native layer hidden via ${reason} after ${elapsed}ms`);
        }
      })
      .catch((error: unknown) => {
        // Marked hidden regardless. A rejected hide almost always means it was already hidden, and
        // leaving the flag false would invite a retry loop against a splash that is already gone.
        setHidden(true);
        if (__DEV__) {
          console.warn(`[splash] hideAsync failed after ${elapsed}ms via ${reason}`, error);
        }
      });
  }, []);

  /**
   * Signal 1 — the artwork is decoded.
   *
   * `SplashScreen` is a design-locked component and takes no `onLoad`, so readiness is established
   * by resolving the same asset here. For a bundled local image this is effectively immediate; the
   * point is that it cannot resolve *later* than the image the component renders.
   */
  useEffect(() => {
    let cancelled = false;
    // The registry types the asset as `ImageSourcePropType` for React Native's `Image`, while
    // `Asset.fromModule` wants the bundler's module id. For a `require`d local asset those are the
    // same number at runtime; the cast reconciles the two type surfaces without changing anything.
    Asset.fromModule(noorLifeAssets.entryAuth.splash as number)
      .downloadAsync()
      .then(
        () => {
          if (!cancelled) {
            setArtworkLoaded(true);
          }
        },
        (error: unknown) => {
          if (!cancelled) {
            // Treated as loaded. A splash that cannot decode is a reason to move on, not a reason
            // to hold the native layer up in front of it.
            setArtworkLoaded(true);
            if (__DEV__) {
              console.warn('[splash] branded artwork failed to resolve; continuing', error);
            }
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  /** Signal 2 — the branded splash has been laid out. */
  const onBrandedSplashLayout = useCallback(() => {
    setMounted(true);
  }, []);

  // Normal path. One animation frame after both signals, so the branded frame is on screen before
  // the native layer is removed — hiding in the same frame can show a flash of whatever is behind.
  useEffect(() => {
    if (!artworkLoaded || !mounted || hideRequestedForProcess) {
      return;
    }
    const frame = requestAnimationFrame(() => hide('ready'));
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [artworkLoaded, mounted, hide]);

  // Fallback path. Independent of both signals, so a failure in either degrades to a late
  // dismissal rather than a frozen screen. Cleared automatically once the normal path wins.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (hideRequestedForProcess) {
        return;
      }
      if (__DEV__) {
        console.warn(
          `[splash] falling back after ${NATIVE_SPLASH_FALLBACK_MS}ms — ` +
            `artworkLoaded=${String(artworkLoaded)} mounted=${String(mounted)}`,
        );
      }
      hide('fallback');
    }, NATIVE_SPLASH_FALLBACK_MS);

    return () => {
      clearTimeout(timer);
    };
    // Deliberately mount-only: the ceiling is measured from the React root mounting, and
    // re-arming it whenever a signal changes would let a flapping signal postpone it indefinitely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { onBrandedSplashLayout, isNativeSplashHidden: hidden };
}

/**
 * The route-independent backstop, for the root layout.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 * `useNativeSplashHandoff` lives in the entry gate, because the gate owns the "branded splash has
 * painted" signal that makes the handoff seamless. Expo Router makes a **deep-linked route the
 * initial route**, so a cold-start authentication callback never mounts the gate — and with it never
 * mounted, not even the hook's own 1500 ms ceiling was armed. Measured on the emulator: launching
 * `noorlifeapp://auth/callback` from a force-stopped app left the *native* splash up over a working
 * callback screen indefinitely, which is indistinguishable from a hang.
 *
 * This hook is called from `RootNavigator`, which mounts for every route, so the ceiling is armed on
 * every launch however it started. It shares the process-wide guard, so on an ordinary launch the
 * gate's normal path still wins and this does nothing.
 *
 * ── Why the ceiling is longer than the handoff's ────────────────────────────
 * `NATIVE_SPLASH_BACKSTOP_MS` is deliberately later than `NATIVE_SPLASH_FALLBACK_MS`. On an ordinary
 * launch the gate is mounted and should be the one to decide, including via its own fallback; this
 * must not pre-empt the seamless handoff by hiding the native layer before the branded splash has
 * painted. It is a backstop, not a competitor.
 *
 * It takes no signal and returns nothing. There is nothing to couple it to, which is the point.
 */
export const NATIVE_SPLASH_BACKSTOP_MS = 2500;

export function useNativeSplashBackstop(): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (hideRequestedForProcess) {
        return;
      }
      hideRequestedForProcess = true;
      if (__DEV__) {
        console.warn(
          `[splash] route backstop hiding the native layer after ${NATIVE_SPLASH_BACKSTOP_MS}ms — ` +
            'the entry gate did not mount, which is expected for a cold-start deep link',
        );
      }
      // Marked hidden either way: a rejected hide almost always means it was already gone, and a
      // retry loop against an absent splash is worse than a no-op.
      ExpoSplashScreen.hideAsync().catch(() => undefined);
    }, NATIVE_SPLASH_BACKSTOP_MS);

    return () => {
      clearTimeout(timer);
    };
  }, []);
}
