import { createContext, useContext } from 'react';

import { useMainHomeMetrics, type MainHomeMetrics } from './main-home-metrics';

/**
 * Shares one computed `MainHomeMetrics` value across the whole screen.
 *
 * `useMainHomeMetrics` calls `useWindowDimensions`, which registers a Dimensions
 * listener per call site. Main Home has ~40 text nodes plus every section component,
 * so calling the hook in each would open ~50 listeners to compute one identical
 * value. The provider computes it once at the screen root and everything below reads
 * it from context.
 *
 * The provider is *required* rather than optional-with-fallback: a fallback would have
 * to call the hook unconditionally (hooks cannot be conditional), which would
 * reintroduce exactly the per-node subscription it was meant to remove.
 */
const MainHomeMetricsContext = createContext<MainHomeMetrics | null>(null);

export function MainHomeMetricsProvider({ children }: { readonly children: React.ReactNode }) {
  // The value is a fresh object each render, but it is only recomputed when the window
  // size actually changes — `useWindowDimensions` is the sole input.
  const metrics = useMainHomeMetrics();
  return (
    <MainHomeMetricsContext.Provider value={metrics}>{children}</MainHomeMetricsContext.Provider>
  );
}

/** Reads the shared metrics. Throws if used outside the Main Home screen. */
export function useMetrics(): MainHomeMetrics {
  const metrics = useContext(MainHomeMetricsContext);
  if (metrics === null) {
    throw new Error(
      'useMetrics was called outside MainHomeMetricsProvider. Main Home components must be rendered inside the Main Home screen.',
    );
  }
  return metrics;
}
