'use client';

import type { ReactNode } from 'react';
import type { Vacancy } from '../../lib/careers-preview';
import { defaultCareersContent, type WebsiteCareersContent } from '../../lib/public-website-content';
import { BackControl, CareerIcon, VacancyFacts } from './careers-visuals';
import s from './careers.module.css';
import p from './careers-pages.module.css';

type DisplayVacancy = Vacancy & { desired?: string[] };
/** Shared by the authority-backed public route and the isolated preview. */
export function CareersHero({ content = defaultCareersContent, vacancy, onBack, titleAsHeading = true }: {
  content?: WebsiteCareersContent; vacancy?: DisplayVacancy; onBack?: () => void; titleAsHeading?: boolean;
}) {
  const Title = titleAsHeading ? 'h1' : 'h2';
  return <section className={`${p.hero} ${vacancy ? p.positionHero : ''}`} data-careers-hero>
    <img src={vacancy ? content.roleImageUrl : content.imageUrl} alt="" width="1440" height="640" fetchPriority="high" decoding="async"/>
    <div className={p.heroInner}>
      {onBack && <div className={p.backRow} data-career-navrow><BackControl label="Back to open positions" onClick={onBack}/><span>Careers</span></div>}
      <div className={p.heroCopy}>
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
  const departments = Array.from(new Set(jobs.map(job => job.department))).sort();
  const filtered = jobs.filter(job => (!department || job.department === department) && `${job.title} ${job.department} ${job.summary}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><CareersHero content={content}/><section className={p.catalogue} aria-label="Open positions">
    <div className={p.filters}>
      <label className={p.search} htmlFor="job-search"><span className={p.srOnly}>Search positions</span><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="job-search" type="search" value={query} placeholder="Search jobs, keywords…" onChange={event => onQuery(event.target.value)}/></label>
      <div className={p.filterRow}><label><span className={p.srOnly}>Department</span><select id="department-filter" value={department} onChange={event => onDepartment(event.target.value)}><option value="">All departments</option>{departments.map(value => <option key={value}>{value}</option>)}</select></label>
        {(query || department) && <button type="button" className={p.clear} onClick={() => { onQuery(''); onDepartment(''); }}>Clear filters</button>}
      </div>
    </div>
    <div className={p.results}><span role="status">{filtered.length} {filtered.length === 1 ? 'open position' : 'open positions'}{preview ? ' · Preview' : ''}</span><span>Explore opportunities</span></div>
    <div className={p.list}>{filtered.map(job => <article className={p.jobCard} key={job.id}>
      <h2>{job.title}</h2>
      <div className={p.meta}><span><CareerIcon name="briefcase"/>{job.department}</span><span><CareerIcon name="location"/>{job.location}</span><span><CareerIcon name="clock"/>{job.contract}</span></div>
      <p>{job.summary}</p>
      <button type="button" className={p.positionButton} data-career-focus={`job-${job.id}`} aria-label={`View ${job.title}`} onClick={() => onSelect(job)}>View position <CareerIcon name="arrow"/></button>
    </article>)}</div>
    {!filtered.length && <div className={s.empty}><h2>{!available ? 'Applications are temporarily unavailable' : jobs.length ? 'No matching positions' : 'No openings at the moment'}</h2><p>{jobs.length ? 'Try another keyword or department.' : 'Please check back for future opportunities.'}</p>{(query || department) && <button type="button" className={s.secondary} onClick={() => { onQuery(''); onDepartment(''); }}>Reset search</button>}</div>}
    {preview && <p className={p.previewNote}>Layout preview · These sample roles are not live job advertisements.</p>}
  </section></>;
}

export function VacancyProfile({ vacancy, onBack, onApply, applyLabel = 'Apply now', content }: {
  vacancy: DisplayVacancy; onBack: () => void; onApply: () => void; applyLabel?: string; content?: WebsiteCareersContent;
}) {
  const sections: [string, string[]][] = [['What you’ll do', vacancy.responsibilities], ['What we’re looking for', vacancy.requirements], ['Preferred qualifications', vacancy.desired || []]];
  return <><CareersHero content={content} vacancy={vacancy} onBack={onBack}/>
    <section className={`${p.rolePage} ${s.container}`}><VacancyFacts vacancy={vacancy}/>
      <div className={p.description}><section><h2>About the role</h2><p>{vacancy.summary}</p></section>
        {sections.filter(([, values]) => values.length).map(([title, values]) => <section key={title}><h2>{title}</h2><ul>{values.filter(Boolean).map((text, index) => <li key={index}>{text}</li>)}</ul></section>)}
        <section className={p.documents}><span className={s.iconTile}><CareerIcon name="file"/></span><div><h2>Documents to prepare</h2><p>Please prepare the following for your application:</p><ul><li>A recent profile photo. No professional photo needed.</li><li>Updated CV / Resume{vacancy.cvRequired ? '' : ' (optional)'}</li><li>Relevant certificates or courses, when available (optional).</li></ul></div></section>
      </div>
      <div className={p.apply}><button type="button" className={s.primary} onClick={onApply}>{applyLabel}<CareerIcon name="arrow"/></button><span><CareerIcon name="lock"/>No account or password needed</span></div>
    </section></>;
}

export function ApplicationReceipt({ reference, email, jobTitle, preview = false, emailNotice, onExplore, content }: {
  reference: string; email: string; jobTitle: string; preview?: boolean; emailNotice?: ReactNode;
  onExplore: () => void; content?: WebsiteCareersContent;
}) {
  return <><CareersHero content={content} titleAsHeading={false}/><section className={p.receipt}>
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
