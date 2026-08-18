import { useCallback, useState } from 'react';

import type { LocationPermission } from '../data/location/location.port';
import { useFaithRepositories } from '../di/faith-repository-context';

/**
 * Raises the location prompt, in response to something the user pressed.
 *
 * ── The rule this exists to keep ────────────────────────────────────────────
 * **NoorLife asks for location only when a feature the user has opened needs it, and only when they
 * press the control that says so.** Never on app launch, never on Faith home mount, never as a side
 * effect of a data read.
 *
 * That is why `LocationPort` splits `getPermission` from `requestPermission`, and why this hook is
 * the only caller of the second. A repository that prompted while resolving a coordinate would fire
 * on render, from a screen the user was merely scrolling past.
 *
 * ── What happens after a refusal is deliberately *not* another prompt ───────
 * Android stops showing the system dialog after two refusals and iOS after one, so a "Grant" button
 * that kept calling `requestPermission` would do nothing at all and look broken. `outcome` carries
 * the resulting state so the screen can say "open Settings" instead of offering the same button
 * again — the state is reported, not hidden behind a boolean.
 */

export type UseLocationPermission = {
  /** The state after the most recent request, or `null` before one has been made. */
  readonly outcome: LocationPermission | null;
  /** True while the OS dialog is up. */
  readonly requesting: boolean;
  /** Prompts, then reports. Safe to call twice — the second call is ignored while the first is open. */
  readonly request: () => Promise<LocationPermission>;
};

export function useLocationPermission(onGranted?: () => void): UseLocationPermission {
  const { location } = useFaithRepositories();
  const [outcome, setOutcome] = useState<LocationPermission | null>(null);
  const [requesting, setRequesting] = useState(false);

  const request = useCallback(async (): Promise<LocationPermission> => {
    if (requesting) {
      return outcome ?? 'undetermined';
    }
    setRequesting(true);
    try {
      const result = await location.requestPermission();
      setOutcome(result);
      if (result === 'granted') {
        // The caller reloads whatever was blocked. Only on success: reloading after a refusal would
        // re-run a request that fails identically and flash the same screen back.
        onGranted?.();
      }
      return result;
    } finally {
      setRequesting(false);
    }
  }, [location, onGranted, requesting, outcome]);

  return { outcome, requesting, request };
}

/** What to tell the user after a permission attempt that did not grant. Null when there is nothing to say. */
export function permissionAdvice(outcome: LocationPermission | null): string | null {
  switch (outcome) {
    case 'denied':
      return 'Location is turned off for NoorLife. You can turn it on in your device settings, or choose a place manually.';
    case 'services-disabled':
      return 'Location services are switched off on this device. Turn them on, or choose a place manually.';
    case 'granted':
    case 'undetermined':
    case null:
      return null;
  }
}
