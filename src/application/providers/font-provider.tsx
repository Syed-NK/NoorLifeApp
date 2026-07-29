import { useFonts } from 'expo-font';
import { createContext, useContext } from 'react';

import { fontsToLoad } from '@ds/typography/fonts';

export type FontReadiness = {
  /** True once every required face is registered with expo-font. */
  readonly ready: boolean;
  /** Set when loading failed; the app continues on system fonts. */
  readonly error: Error | null;
};

const FontContext = createContext<FontReadiness>({ ready: false, error: null });

/**
 * Font-readiness boundary.
 *
 * Poppins is loaded here and the readiness flag is published so the startup
 * gate can hold the splash screen until text can render in the correct face —
 * that is what prevents the unstyled-text flash (deliverable 7).
 *
 * Failure is non-fatal by design: if a face cannot load, `error` is set and
 * `ready` still becomes true, so the app renders on system fonts rather than
 * hanging on a splash screen forever. A missing font is a visual regression; a
 * permanent splash screen is a broken app.
 */
export function FontProvider({ children }: { readonly children: React.ReactNode }) {
  const [loaded, error] = useFonts(fontsToLoad);

  return (
    <FontContext.Provider value={{ ready: loaded || error !== null, error }}>
      {children}
    </FontContext.Provider>
  );
}

export function useFontReadiness(): FontReadiness {
  return useContext(FontContext);
}
