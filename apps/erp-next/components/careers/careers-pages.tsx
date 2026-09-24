'use client';

import { useCareersLanguage } from './careers-language';
import { vacancyPresentation } from '../../lib/careers-locale';
import type { ReactNode } from 'react';
import type { Vacancy } from '../../lib/careers-preview';
import { defaultCareersContent, type WebsiteCareersContent } from '../../lib/public-website-content';
import { BackControl, CareerIcon, VacancyFacts } from './careers-visuals';
import s from './careers.module.css';
import p from './careers-pages.module.css';

type DisplayVacancy = Vacancy & { desired?: string[] };
/** Shared by the authority-backed public route and the isolated preview. */
export function CareersHero({ content = defaultCareersContent, vacancy, onBack, titleAsHeading = true, contentLocale = 'en' }: {
  content?: WebsiteCareersContent; vacancy?: DisplayVacancy; onBack?: () => void; titleAsHeading?: boolean; contentLocale?: 'en' | 'es';
}) {
  const { text } = useCareersLanguage();
  const Title = titleAsHeading ? 'h1' : 'h2';
  return <section className={`${p.hero} ${vacancy ? p.positionHero : ''}`} data-careers-hero>
    <img src={vacancy ? content.roleImageUrl : content.imageUrl} alt="" width="1440" height="640" fetchPriority="high" decoding="async"/>
    <div className={p.heroInner}>
      {onBack && <div className={p.backRow} data-career-navrow><BackControl label="Back to open positions" onClick={onBack}/><span>{text('Careers')}</span></div>}
      <div className={p.heroCopy} lang={contentLocale}>
        <span className={p.eyebrow}>{vacancy ? vacancy.department : content.eyebrow}</span>
        <Title data-career-page-title={titleAsHeading ? true : undefined} tabIndex={titleAsHeading ? -1 : undefined}>{vacancy?.title || content.title}</Title>
        {!vacancy && <strong>{content.subtitle}</strong>}
        <p>{vacancy?.summary || content.description}</p>
      </div>
    </div>
  </section>;
}

export function VacancyCatalogue({ jobs, query, department, onQuery, onDepartment, onSelect, preview = false, available = true, content }: {
  jobs: DisplayVacancy[]; query: string; department: string; onQuery: (value: string) => void;
  onDepartment: (value: string) => void; onSelect: (job: DisplayVacancy) => void;
  preview?: boolean; available?: boolean; content?: WebsiteCareersContent;
}) {
  const { locale, text } = useCareersLanguage();
  const presentations = new Map(jobs.map(job => [job.id, vacancyPresentation(job, locale)]));
  const departments = Array.from(new Set(jobs.map(job => job.department))).sort();
  const searchPresentations = new Map(jobs.map(job => [job.id, vacancyPresentation(job, 'es').job]));
  const filtered = jobs.filter(job => (!department || job.department === department) && `${job.title} ${job.department} ${job.summary} ${searchPresentations.get(job.id)!.title} ${searchPresentations.get(job.id)!.department} ${searchPresentations.get(job.id)!.summary}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><CareersHero content={content}/><section className={p.catalogue} aria-label={text('Open positions')}>
    <div className={p.filters}>
      <label className={p.search} htmlFor="job-search"><span className={p.srOnly}>{text('Search positions')}</span><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="job-search" type="search" value={query} placeholder={text('Search jobs, keywords…')} onChange={event => onQuery(event.target.value)}/></label>
      <div className={p.filterRow}><label><span className={p.srOnly}>{text('Department')}</span><select id="department-filter" value={department} onChange={event => onDepartment(event.target.value)}><option value="">{text('All departments')}</option>{departments.map(value => <option key={value} value={value}>{presentations.get(jobs.find(job => job.department === value)!.id)!.job.department}</option>)}</select></label>
        {(query || department) && <button type="button" className={p.clear} onClick={() => { onQuery(''); onDepartment(''); }}>{text('Clear filters')}</button>}
      </div>
    </div>
    <div className={p.results}><span role="status">{filtered.length} {filtered.length === 1 ? text('open position') : text('open positions')}{preview ? ` · ${text('Preview')}` : ''}</span><span>{text('Explore opportunities')}</span></div>
    <div className={p.list}>{filtered.map(job => <article data-career-content-locale={presentations.get(job.id)!.contentLocale} className={p.jobCard} key={job.id}>
      <h2 lang={presentations.get(job.id)!.contentLocale}>{presentations.get(job.id)!.job.title}</h2>
      <div className={p.meta} lang={presentations.get(job.id)!.contentLocale}><span><CareerIcon name="briefcase"/>{presentations.get(job.id)!.job.department}</span><span><CareerIcon name="location"/>{presentations.get(job.id)!.job.location}</span><span><CareerIcon name="clock"/>{presentations.get(job.id)!.job.contract}</span></div>
      <p lang={presentations.get(job.id)!.contentLocale}>{presentations.get(job.id)!.job.summary}{locale === 'es' && presentations.get(job.id)!.contentLocale === 'en' && <small lang="es"> · Información en inglés</small>}</p>
      <button type="button" className={p.positionButton} data-career-focus={`job-${job.id}`} aria-label={`${text('View')} ${presentations.get(job.id)!.job.title}`} onClick={() => onSelect(job)}>{text('View position')} <CareerIcon name="arrow"/></button>
    </article>)}</div>
    {!filtered.length && <div className={s.empty}><h2>{!available ? text('Applications are temporarily unavailable') : jobs.length ? text('No matching positions') : text('No openings at the moment')}</h2><p>{text(jobs.length ? 'Try another keyword or department.' : 'Please check back for future opportunities.')}</p>{(query || department) && <button type="button" className={s.secondary} onClick={() => { onQuery(''); onDepartment(''); }}>{text('Reset search')}</button>}</div>}
    {preview && <p className={p.previewNote}>{text('Layout preview · These sample roles are not live job advertisements.')}</p>}
  </section></>;
}

export function VacancyProfile({ vacancy, onBack, onApply, applyLabel = 'Apply now', content }: {
  vacancy: DisplayVacancy; onBack: () => void; onApply: () => void; applyLabel?: string; content?: WebsiteCareersContent;
}) {
  const { locale, text } = useCareersLanguage();
  const presented = vacancyPresentation(vacancy, locale);
  const display = presented.job;
  const sections: [string, string[]][] = [['What you’ll do', display.responsibilities], ['What we’re looking for', display.requirements], ['Preferred qualifications', display.desired || []]];
  return <><CareersHero content={content} vacancy={display} contentLocale={presented.contentLocale} onBack={onBack}/>
    <section className={`${p.rolePage} ${s.container}`}><VacancyFacts vacancy={vacancy} presentation={display}/>
      <div className={p.description} data-career-content-locale={presented.contentLocale}>
        {locale !== presented.contentLocale && <p className={s.helper} role="status">{text('Position information is available in English.')}</p>}<section><h2>{text('About the role')}</h2><p lang={presented.contentLocale}>{display.summary}</p></section>
        {sections.filter(([, values]) => values.length).map(([title, values]) => <section key={title}><h2>{text(title)}</h2><ul>{values.filter(Boolean).map((text, index) => <li key={index} lang={presented.contentLocale}>{text}</li>)}</ul></section>)}
        <section className={p.documents}><span className={s.iconTile}><CareerIcon name="file"/></span><div><h2>{text('Documents to prepare')}</h2><p>{text('Please prepare the following for your application:')}</p><ul><li>{text('A recent profile photo. No professional photo needed.')}</li><li>{text('Updated CV / Resume')}{vacancy.cvRequired ? '' : text(' (optional)')}</li><li>{text('Relevant certificates or courses, when available (optional).')}</li></ul></div></section>
      </div>
      <div className={p.apply}><button type="button" className={s.primary} onClick={onApply}>{text(applyLabel)}<CareerIcon name="arrow"/></button><span><CareerIcon name="lock"/>{text('No account or password needed')}</span></div>
    </section></>;
}

export function ApplicationReceipt({ reference, email, jobTitle, preview = false, emailNotice, onExplore, content }: {
  reference: string; email: string; jobTitle: string; preview?: boolean; emailNotice?: ReactNode;
  onExplore: () => void; content?: WebsiteCareersContent;
}) {
  return <><CareersHero content={content} titleAsHeading={false}/><section className={p.receipt} lang="en">
    <div className={p.successMark}><CareerIcon name="check"/></div>
    <h1 data-career-page-title tabIndex={-1}>{preview ? 'Application completed' : 'Application received'}</h1>
    <p>Thank you for applying to join the DEMAC team.<br/>{preview ? 'You completed the preview application for' : 'We have received your application for'}<br/><strong>{jobTitle}</strong></p>
    <dl className={p.receiptDetails}><div><CareerIcon name="file"/><dt>Reference number</dt><dd>{reference}</dd></div><div><CareerIcon name="mail"/><dt>Your email</dt><dd>{email}</dd></div></dl>
    <div className={p.mailNotice} role="status">{preview ? 'Preview only. No email has been sent and no live application has been saved.' : emailNotice}</div>
    <section className={p.next}><h2>{preview ? 'Selection process · Live applications' : 'What happens next?'}</h2><ol><li>Our team reviews your application.</li><li>We contact qualified candidates.</li><li>If selected, we invite you to the next stage.</li></ol></section>
    <button type="button" className={s.primary} onClick={onExplore}>Explore positions <CareerIcon name="arrow"/></button>
    {preview && <small>Test information only. Refreshing or closing the tab clears this session.</small>}
  </section></>;
}
