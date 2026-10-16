import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Language, I18nContextType } from './types.js';
import { en } from './locales/en.js';
import { ru } from './locales/ru.js';

export * from './types.js';

export function detectBrowserLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = localStorage.getItem('nonstop_language');
    if (saved === 'en' || saved === 'ru') return saved;

    const navLangs = navigator.languages || [navigator.language || ''];
    for (const lang of navLangs) {
      if (lang && lang.toLowerCase().startsWith('ru')) {
        return 'ru';
      }
    }
  } catch {}
  return 'en';
}

const translations: Record<Language, any> = { en, ru };

function getNested(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr == null) return undefined;
    curr = curr[part];
  }
  return typeof curr === 'string' ? curr : undefined;
}

export const I18nContext = createContext<I18nContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key) => key,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(detectBrowserLanguage);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem('nonstop_language', lang);
      document.documentElement.lang = lang;
    } catch {}
  };

  useEffect(() => {
    try {
      document.documentElement.lang = language;
    } catch {}
  }, [language]);

  const t = (key: string, params?: Record<string, string | number | undefined | null>): string => {
    let str = getNested(translations[language], key);
    if (!str && language !== 'en') {
      str = getNested(translations.en, key);
    }
    if (!str) {
      str = key;
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v !== undefined && v !== null ? String(v) : '');
      }
    }
    return str;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
