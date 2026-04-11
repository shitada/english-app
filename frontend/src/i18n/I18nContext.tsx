import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { translations, type Locale, type Translations } from './translations';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: keyof Translations) => string;
  tParam: (key: keyof Translations, params: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem('locale');
    if (stored === 'en' || stored === 'ja') return stored;
  } catch { /* SSR or private mode */ }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem('locale', next); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key: keyof Translations) => translations[locale][key], [locale]);

  const tParam = useCallback((key: keyof Translations, params: Record<string, string | number>) => {
    let result = translations[locale][key];
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return result;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, tParam }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

export { I18nContext };
