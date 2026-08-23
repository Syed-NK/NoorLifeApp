import { Dimensions } from 'react-native';

/**
 * Pins the window a module screen renders into, for tests that assert a width- or text-size-dependent
 * layout.
 *
 * ── Why a test has to say which device it means ─────────────────────────────
 * React Native's Jest mock reports a 750 dp window at **font scale 2**. Neither number describes a
 * phone: 750 dp is a tablet, and 2.0 is the top of Android's accessibility range. A suite that
 * asserts "the module home draws its hero artwork" is therefore asserting it at the most extreme
 * text size the platform offers, which is exactly the configuration where issue #50's rule gives the
 * copy the whole card and drops the artwork.
 *
 * That made those assertions read as if they were about the ordinary layout while actually testing
 * the accessibility one. Calling this in a suite states the device it means, so "ordinary
 * presentation" and "constrained presentation" can both be asserted, each at a configuration where
 * it is the truthful answer.
 *
 * Defaults to a 393 dp phone at font scale 1 — the reference width the module tokens are drawn for.
 */
export function pinModuleWindow(
  overrides: {
    readonly width?: number;
    readonly height?: number;
    readonly fontScale?: number;
    readonly scale?: number;
  } = {},
): void {
  const window = {
    width: overrides.width ?? 393,
    height: overrides.height ?? 852,
    scale: overrides.scale ?? 3,
    fontScale: overrides.fontScale ?? 1,
  };
  // The Jest mock exposes `set`, which is what `useWindowDimensions` reads through.
  (Dimensions as unknown as { set: (dimensions: unknown) => void }).set({
    window,
    screen: window,
  });
}
