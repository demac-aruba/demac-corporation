'use client';

import { CareersLanguageSelector, useCareersLanguage } from './careers-language';
import { PublicFooter, PublicHeader } from '../public/public-site-shell';

/**
 * Careers reuses the exact public website header/footer components.
 * Do not add Careers-specific sizing, spacing or replacement chrome here.
 */
export function CareersHeader({ compactLabel: _compactLabel }: { compactLabel?: string }) {
  const { locale } = useCareersLanguage();
  return <>
    <div className="public-site public-home-approved" data-careers-chrome="site-header">
      <PublicHeader active="careers" locale={locale}/>
    </div>
    <CareersLanguageSelector/>
  </>;
}

export function CareersFooter() {
  return <div className="public-site public-home-approved" data-careers-chrome="site-footer">
    <PublicFooter/>
  </div>;
}
