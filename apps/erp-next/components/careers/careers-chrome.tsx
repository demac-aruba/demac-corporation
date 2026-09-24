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
  return <BrandChrome>{compactLabel ? <header className={s.compactHeader}><PublicBrand/><span>{compactLabel}</span></header> : <div className={chrome.header}><PublicHeader active="careers"/></div>}</BrandChrome>;
}
/** No marketing widgets or data requests on the application route. */
export function CareersFooter() {
  return <BrandChrome><footer className={chrome.footer}>
    <div className={chrome.top}><PublicBrand/><p>A COOLER ARUBA<br/>TOGETHER</p></div>
    <div className={chrome.bottom}><nav aria-label="Careers footer"><Link href="/careers">Careers</Link><Link href="/contact">Contact</Link></nav><small>© {new Date().getFullYear()} DEMAC. All rights reserved.</small></div>
  </footer></BrandChrome>;
}
