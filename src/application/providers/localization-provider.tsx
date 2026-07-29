import { createContext, useContext, useMemo } from 'react';
import { I18nManager } from 'react-native';

/**
 * Localization boundary (spec §8, workflow §14 `/settings/language`).
 *
 * This is a *boundary*, not an i18n implementation. Phase 1 ships English only,
 * so adding an i18n library now would be unjustified weight. What it does provide
 * is the seam every later change needs:
 *
 *   • the active locale and its text direction, read from one place
 *   • `isRTL`, so layout decisions never read `I18nManager` ad hoc
 *   • the font family a locale should use — Arabic must not render in Poppins,
 *     and that decision belongs here rather than in each component
 *
 * Adding a locale later means extending `SupportedLocale` and wiring a message
 * catalogue; no screen or component has to change shape.
 */

export type SupportedLocale = 'en' | 'ar';

export type TextDirection = 'ltr' | 'rtl';

export type Localization = {
  readonly locale: SupportedLocale;
  readonly direction: TextDirection;
  readonly isRTL: boolean;
  /** `'latin'` selects Poppins; `'arabic'` selects Noto Sans Arabic. */
  readonly script: 'latin' | 'arabic';
};

const localeDirection: Readonly<Record<SupportedLocale, TextDirection>> = {
  en: 'ltr',
  ar: 'rtl',
};

const localeScript: Readonly<Record<SupportedLocale, 'latin' | 'arabic'>> = {
  en: 'latin',
  ar: 'arabic',
};

const LocalizationContext = createContext<Localization>({
  locale: 'en',
  direction: 'ltr',
  isRTL: false,
  script: 'latin',
});

export function LocalizationProvider({
  children,
  locale = 'en',
}: {
  readonly children: React.ReactNode;
  readonly locale?: SupportedLocale;
}) {
  const value = useMemo<Localization>(() => {
    const direction = localeDirection[locale];
    return {
      locale,
      direction,
      // `I18nManager.isRTL` is the authority at runtime: a forced-RTL dev build
      // must win over the locale table so RTL can be exercised without Arabic
      // content existing yet.
      isRTL: I18nManager.isRTL || direction === 'rtl',
      script: localeScript[locale],
    };
  }, [locale]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): Localization {
  return useContext(LocalizationContext);
}
