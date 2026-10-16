export type Language = 'en' | 'ru';

export interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number | undefined | null>) => string;
}
