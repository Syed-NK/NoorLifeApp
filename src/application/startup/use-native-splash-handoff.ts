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

  /**
   * The idempotency guard.
   *
   * A ref, not state: both paths can fire in the same tick, and a state flag would not have been
   * committed in time to stop the second. `hideAsync` twice is harmless on Android today, but
   * relying on that is relying on an implementation detail.
   */
  const hideRequested = useRef(false);
  const mountedAt = useRef<number | null>(null);
  mountedAt.current ??= Date.now();

  const hide = useCallback((reason: 'ready' | 'fallback') => {
    if (hideRequested.current) {
      return;
    }
    hideRequested.current = true;

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
    if (!artworkLoaded || !mounted || hideRequested.current) {
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
      if (hideRequested.current) {
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
