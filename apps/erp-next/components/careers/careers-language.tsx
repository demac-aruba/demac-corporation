'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { careersText, type CareersLocale } from '../../lib/careers-locale';
import s from './careers-language.module.css';

const Language = createContext<{ locale: CareersLocale; setLocale?: (locale: CareersLocale) => void; disabled?: boolean }>({ locale: 'en' });
export function CareersLanguage({ locale, onChange, disabled = false, children }: { locale: CareersLocale; onChange: (locale: CareersLocale) => void; disabled?: boolean; children: ReactNode }) {
  return <Language.Provider value={{ locale, setLocale: onChange, disabled }}>{children}</Language.Provider>;
}
export function useCareersLanguage() {
  const value = useContext(Language);
  return { ...value, text: (key: string) => careersText(value.locale, key) };
}
export function CareersLanguageSelector() {
  const { locale, setLocale, disabled } = useCareersLanguage();
  if (!setLocale) return null;
  return <div className={s.row}><div className={s.selector} role="group" aria-label="Language / Idioma" data-careers-language-selector>
    {(['en', 'es'] as const).map(value => <button key={value} type="button" lang={value} aria-pressed={locale === value}
      disabled={disabled} onClick={() => setLocale(value)}>{value === 'en' ? 'English' : 'Español'}</button>)}
  </div></div>;
}
