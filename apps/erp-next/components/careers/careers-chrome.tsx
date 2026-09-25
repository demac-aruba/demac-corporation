'use client';
import { CareersLanguageSelector, useCareersLanguage } from './careers-language';
import type { ReactNode } from 'react';
import Link from 'next/link';
import chrome from './careers-chrome.module.css';
import { PublicBrand, PublicHeader } from '../public/public-site-shell';
import s from './careers.module.css';

/** The existing website owns its chrome; Careers owns the application content.
 * The page-wide `.public-site` class includes viewport layout and illustration
 * sizing. Reuse branded components and their tokens, not that page wrapper.
 */
function BrandChrome({ children }: { children: ReactNode }) {
  return <div className={`public-subsite ${s.brandChrome}`} data-careers-chrome>{children}</div>;
}
export function CareersHeader({ compactLabel }: { compactLabel?: string }) {
  const { text, locale } = useCareersLanguage();
  return <BrandChrome>{compactLabel ? <header className={s.compactHeader}><PublicBrand/><span>{text(compactLabel)}</span></header> : <div className={chrome.header} lang={locale}><PublicHeader active="careers" locale={locale}/></div>}<CareersLanguageSelector/></BrandChrome>;
}
/** No marketing widgets or data requests on the application route. */
export function CareersFooter() {
  const { text, locale } = useCareersLanguage();
  return <BrandChrome><footer className={chrome.footer}>
    <div className={chrome.top}><PublicBrand/><p>{locale==='es'?'JUNTOS POR UNA':'A COOLER ARUBA'}<br/>{locale==='es'?'ARUBA MÁS FRESCA':'TOGETHER'}</p></div>
    <div className={chrome.bottom}><nav aria-label={text('Careers footer')}><Link href={`/careers?lang=${locale}`}>{text('Careers')}</Link><Link href="/contact">{text('Contact')}</Link></nav><small>© {new Date().getFullYear()} DEMAC. {text('All rights reserved.')}</small></div>
  </footer></BrandChrome>;
}
