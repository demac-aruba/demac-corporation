'use client';

import { CareersLanguageSelector, useCareersLanguage } from './careers-language';
import { PublicFooter, PublicHeader } from '../public/public-site-shell';
import s from './careers.module.css';

/**
 * Careers reuses the exact public website header/footer components.
 * The lightweight brand wrapper supplies the public design tokens only; unlike
 * .public-site it does not reserve a full viewport or alter Careers layout.
 */
export function CareersHeader({ compactLabel: _compactLabel }: { compactLabel?: string }) {
  const { locale } = useCareersLanguage();
  return <>
    <div className={`public-subsite ${s.brandChrome}`} data-careers-chrome="site-header">
      <PublicHeader active="careers" locale={locale}/>
    </div>
    <CareersLanguageSelector/>
  </>;
}

export function CareersFooter() {
  return <div className={`public-subsite ${s.brandChrome}`} data-careers-chrome="site-footer">
    <PublicFooter/>
  </div>;
}
