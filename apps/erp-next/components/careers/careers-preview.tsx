'use client';

import { useEffect, useRef, useState } from 'react';
import { PublicBrand, PublicHeader, PublicFooter } from '../public/public-site-shell';
import { copyForSubmission, emptyDraft, exampleVacancies, totalFileBytes, validateStep, type ApplicationDraft, type PreviewApplication, type Vacancy } from '../../lib/careers-preview';
import { ApplicationFunnel } from './application-funnel';
import { RecruitmentPreview } from './recruitment-preview';
import { Field } from './careers-ui';
import { CareerIcon, VacancyFacts } from './careers-visuals';
import s from './careers.module.css';

type View = 'jobs' | 'detail' | 'form' | 'success' | 'admin';
export function CareersPreview() {
  const [vacancies, setVacancies] = useState<Vacancy[]>(exampleVacancies);
  const [applications, setApplications] = useState<PreviewApplication[]>([]);
  const [view, setView] = useState<View>('jobs');
  const [selected, setSelected] = useState<Vacancy | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ApplicationDraft>>({});
  const [wizard, setWizard] = useState({ step: 0, reviewing: false });
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [submittedId, setSubmittedId] = useState('');
  const submitLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const tools = useRef<HTMLDetailsElement>(null);
  const draft = selected ? drafts[selected.id] || emptyDraft() : emptyDraft();
  const submitted = applications.find(application => application.id === submittedId);
  const hasDraft = Object.values(drafts).some(item => item.givenName || item.email || item.photo || item.cv);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('view') === 'admin') setView('admin'); }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'auto' }); }, [view]);
  useEffect(() => {
    if (!hasDraft && !applications.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft, applications.length]);
  const openJobs = vacancies.filter(job => job.status === 'Open' && (!department || job.department === department) && (!search || `${job.title} ${job.summary}`.toLowerCase().includes(search.toLowerCase())));
  const departments = Array.from(new Set(vacancies.map(job => job.department))).sort();
  function detail(job: Vacancy) { setSelected(JSON.parse(JSON.stringify(job)) as Vacancy); setWizard({ step: 0, reviewing: false }); setView('detail'); }
  function start() {
    if (!selected) return;
    if (!drafts[selected.id]) { setDrafts(previous => ({ ...previous, [selected.id]: emptyDraft() })); setWizard({ step: 0, reviewing: false }); }
    submitLock.current = false; setView('form');
  }
  function submit(): string | null {
    if (submitLock.current) return null;
    if (!selected || vacancies.find(job => job.id === selected.id)?.status !== 'Open') return 'This preview vacancy is no longer open. Your answers are still available in this session.';
    const errors = { ...validateStep(draft, selected, 0), ...validateStep(draft, selected, 1), ...validateStep(draft, selected, 2, true) };
    if (Object.keys(errors).length || totalFileBytes(draft) > 30 * 1024 * 1024) return 'Please review all required answers and file limits before submitting.';
    submitLock.current = true;
    const id = `PREVIEW-${String(applications.length + 1).padStart(4, '0')}`;
    const at = new Date().toISOString();
    const snapshot: PreviewApplication = { id, vacancy: JSON.parse(JSON.stringify(selected)) as Vacancy, draft: copyForSubmission(draft, selected), stage: 'New', createdAt: at, notes: [], timeline: [{ text: 'Preview application completed · No production data sent', at }] };
    setApplications(previous => [...previous, snapshot]); setSubmittedId(id); setView('success');
    setDrafts(previous => { const next = { ...previous }; delete next[selected.id]; return next; });
    return null;
  }
  function tryApplication() { setView('jobs'); setSubmittedId(''); }
  function reviewView(next: View) { if (tools.current) tools.current.open = false; setView(next); }
  return <main className={`public-site public-subsite ${s.root} ${view === 'admin' ? s.admin : ''}`} data-careers-version="premium-v2" onClickCapture={event => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (anchor && !anchor.hasAttribute('download') && !anchor.href.startsWith('blob:') && (hasDraft || applications.length) && !window.confirm('Leave this preview? The application details in this session will be cleared.')) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <div className={s.previewRibbon}><span><i aria-hidden="true"/>Preview v2 · Test data only</span><details ref={tools} className={s.reviewTools}><summary>Review tools <span aria-hidden="true">⌄</span></summary><div><strong>Design review · Not merged</strong><p>Test details and files stay in this tab. No live applications or emails.</p><button type="button" className={s.secondary} onClick={() => reviewView(selected && drafts[selected.id] ? 'form' : 'jobs')}>Candidate view</button><button type="button" className={s.primary} onClick={() => { setSubmittedId(''); reviewView('admin'); }}>Recruitment preview</button></div></details></div>
    {view === 'jobs' || view === 'detail' ? <PublicHeader/> : <header className={s.compactHeader}><PublicBrand/><span>{view === 'admin' ? 'Recruitment' : 'Careers'}</span></header>}
    {view === 'jobs' && <>
      <section className={s.careerHero}><div className={s.heroInner}><span className={s.eyebrow}>BUILD YOUR NEXT CHAPTER</span><h1 ref={heading} tabIndex={-1}>Careers</h1><h2>Join the DEMAC team.</h2><p>Bring your skills. Make a difference in Aruba.</p><div className={s.heroTags}><span><CareerIcon name="location"/>Aruba</span><span><CareerIcon name="users"/>Technical & office roles</span></div></div></section>
      <section className={s.container} aria-label="Open positions"><div className={s.catalogueHeader}><div><h2>Find your opportunity</h2><p>{openJobs.length} {openJobs.length === 1 ? 'position' : 'positions'} · Preview vacancies</p></div></div>
        <div className={s.catalogueFilters}><Field id="job-search" label="Search positions"><div className={s.searchInput}><CareerIcon name="filters"/><input id="job-search" type="search" value={search} placeholder="Search jobs or keywords…" onChange={event => setSearch(event.target.value)}/></div></Field><Field id="department-filter" label="Department"><select id="department-filter" value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</select></Field></div>
        <div className={s.vacancyGrid}>{openJobs.map(job => <article className={s.jobCard} key={job.id}><div className={s.jobTitleRow}><h2>{job.title}</h2><span className={s.jobArrow} aria-hidden="true"><CareerIcon name="arrow"/></span></div><div className={s.meta}><span><CareerIcon name="briefcase"/>{job.department}</span><span><CareerIcon name="location"/>{job.location}</span><span><CareerIcon name="clock"/>{job.contract}</span></div><p>{job.summary}</p><button type="button" className={s.jobLink} aria-label={`View ${job.title}`} onClick={() => detail(job)}>View position <CareerIcon name="arrow"/></button></article>)}</div>
        {!openJobs.length && <div className={s.empty}><h2>No matching positions</h2><p>Try another keyword or department.</p><button type="button" className={s.secondary} onClick={() => { setSearch(''); setDepartment(''); }}>Clear filters</button></div>}
        <p className={s.catalogueNote}>These roles are for preview review, not live job advertisements.</p>
      </section>
    </>}
    {view === 'detail' && selected && <>
      <section className={`${s.careerHero} ${s.detailHero}`}><div className={s.heroInner}><button className={s.textButton} type="button" onClick={() => setView('jobs')}>← All positions</button><span className={s.eyebrow}>{selected.department}</span><h1 ref={heading} tabIndex={-1}>{selected.title}</h1><p>{selected.summary}</p></div></section>
      <section className={`${s.container} ${s.rolePage}`}><VacancyFacts vacancy={selected}/><div className={s.roleDetailGrid}><div className={s.roleDescription}>
        <section><h2>About the role</h2><p>{selected.summary}</p></section>
        <section><h2>What you’ll do</h2><ul>{selected.responsibilities.filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ul></section>
        <section><h2>What we’re looking for</h2><ul>{selected.requirements.filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ul></section>
        <section className={s.prepareDocuments}><span className={s.iconTile}><CareerIcon name="file"/></span><div><h2>Documents to prepare</h2><p>A recent photo{selected.cvRequired ? ' and your CV' : ''}. Add relevant certificates or courses, when available.</p><small>CV {selected.cvRequired ? 'required' : 'optional'} · Certificates optional · No professional photo needed</small></div></section>
      </div><aside className={s.prepareCard}><span className={s.eyebrow}>YOUR APPLICATION</span><h2>Three simple steps.</h2><ol><li>Your details</li><li>Experience & role questions</li><li>Photo, documents & review</li></ol><small><CareerIcon name="lock"/>No account or password needed.</small></aside></div>
      <div className={s.applyBar}><div><strong>{selected.title}</strong><small>{selected.location} · {selected.contract}</small></div><button type="button" className={s.primary} onClick={start}>{drafts[selected.id] ? 'Continue application' : 'Apply now'}<CareerIcon name="arrow"/></button></div></section>
    </>}
    {view === 'form' && selected && <ApplicationFunnel key={selected.id} vacancy={selected} draft={draft} step={wizard.step} reviewing={wizard.reviewing} onChange={next => setDrafts(previous => ({ ...previous, [selected.id]: next }))} onStep={(step, reviewing = false) => { setWizard({ step, reviewing }); window.scrollTo({ top: 0, behavior: 'auto' }); }} onBackToJob={() => setView('detail')} onSubmit={submit}/>}
    {view === 'success' && submitted && <section className={s.successPage}><div className={s.successIcon}><CareerIcon name="check"/></div><span className={s.eyebrow}>PREVIEW COMPLETE</span><h1 ref={heading} tabIndex={-1}>Application completed</h1><p>Thank you for your interest in joining the DEMAC team.</p><strong className={s.successRole}>{submitted.vacancy.title}</strong>
      <dl className={s.receiptCard}><div><CareerIcon name="file"/><dt>Reference number</dt><dd>{submitted.id}</dd></div><div><CareerIcon name="mail"/><dt>Your email</dt><dd>{submitted.draft.email}</dd></div></dl>
      <div className={s.informationCard}><span className={s.iconTile}><CareerIcon name="mail"/></span><div><strong>Confirmation email · Preview only</strong><p>No email has been sent. This test profile is available in Recruitment in this tab.</p></div></div>
      <section className={s.nextSteps}><h2>What happens next?</h2><ol><li><span>1</span><div><strong>Review the application</strong><p>See the information and documents in the recruitment preview.</p></div></li><li><span>2</span><div><strong>Follow the selection process</strong><p>Explore review stages and add a test recruiter note.</p></div></li></ol></section>
      <button type="button" className={s.primary} onClick={() => setView('admin')}>Review this candidate <CareerIcon name="arrow"/></button><button type="button" className={s.secondary} onClick={tryApplication}>Back to Careers</button><small>Test information only. Refreshing or closing the tab clears this session.</small>
    </section>}
    {view === 'admin' && <RecruitmentPreview vacancies={vacancies} applications={applications} onVacancies={setVacancies} onApplications={setApplications} initialApplication={submittedId} onTryApplication={tryApplication}/>}
    {(view === 'jobs' || view === 'detail') && <PublicFooter/>}
    {(view === 'form' || view === 'success') && <footer className={s.funnelFooter}><span>DEMAC · Professional Cooling Solutions</span><span>Careers · Aruba</span></footer>}
  </main>;
}
