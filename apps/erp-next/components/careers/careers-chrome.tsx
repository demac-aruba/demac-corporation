import type { ReactNode } from 'react';
import { PublicBrand, PublicHeader, PublicFooter } from '../public/public-site-shell';
import s from './careers.module.css';

/** The existing website owns its chrome; Careers owns the application content.
 * The page-wide `.public-site` class includes viewport layout and illustration
 * sizing. Reuse branded components and their tokens, not that page wrapper.
 */
function BrandChrome({ children }: { children: ReactNode }) {
  return <div className={`public-subsite ${s.brandChrome}`} data-careers-chrome>{children}</div>;
}
export function CareersHeader({ compactLabel }: { compactLabel?: string }) {
  return <BrandChrome>{compactLabel ? <header className={s.compactHeader}><PublicBrand/><span>{compactLabel}</span></header> : <PublicHeader/>}</BrandChrome>;
}
export function CareersFooter() { return <BrandChrome><PublicFooter/></BrandChrome>; }
