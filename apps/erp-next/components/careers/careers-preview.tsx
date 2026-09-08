'use client';

import { useEffect, useRef, useState } from 'react';
import { PublicBrand, PublicHeader, PublicFooter } from '../public/public-site-shell';
import { copyForSubmission, emptyDraft, exampleVacancies, totalFileBytes, validateStep, type ApplicationDraft, type PreviewApplication, type Vacancy } from '../../lib/careers-preview';
import { ApplicationFunnel } from './application-funnel';
import { RecruitmentPreview } from './recruitment-preview';
import { Field } from './careers-ui';
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
  const draft = selected ? drafts[selected.id] || emptyDraft() : emptyDraft();
  const hasDraft = Object.values(drafts).some(item => item.givenName || item.email || item.photo || item.cv);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('view') === 'admin') setView('admin'); }, []);
  useEffect(() => { heading.current?.focus(); window.scrollTo({ top: 0, behavior: 'auto' }); }, [view]);
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
  return <main className={`public-site public-subsite ${s.root} ${view === 'admin' ? s.admin : ''}`} onClickCapture={event => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (anchor && !anchor.hasAttribute('download') && !anchor.href.startsWith('blob:') && (hasDraft || applications.length) && !window.confirm('Leave this preview? The application details in this session will be cleared.')) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <div className={s.previewBar}><div><strong>CAREERS · PREVIEW</strong><span>Test information only · No live applications or emails · Not merged</span></div><nav aria-label="Preview experience"><button type="button" aria-pressed={view !== 'admin'} onClick={() => setView(selected && drafts[selected.id] ? 'form' : 'jobs')}>Candidate view</button><button type="button" aria-pressed={view === 'admin'} onClick={() => { setSubmittedId(''); setView('admin'); }}>Recruitment preview</button></nav></div>
    {view === 'jobs' || view === 'detail' ? <PublicHeader /> : <header className={s.compactHeader}><PublicBrand /><span>{view === 'admin' ? 'ERP NEXT · RECRUITMENT' : 'Careers'}</span></header>}
    {view === 'jobs' && <>
      <section className={`public-page-hero ${s.hero}`}><div className="public-page-hero-inner"><div><span className="public-page-kicker">CAREERS AT DEMAC</span><h1 ref={heading} tabIndex={-1}>Your next chapter.<br /><em>A cooler Aruba.</em></h1><p>Bring your skills, curiosity and experience to our team.</p><div className={s.heroTags}><span>Technical & office roles</span><span>Apply from any device</span><span>No account needed</span></div></div><div className="public-page-hero-panel" aria-hidden="true"><div className="public-page-panel-unit" /><div className="public-page-panel-air" /></div></div></section>
      <section className={s.container} aria-label="Open positions"><div className={s.catalogueHeader}><div><h2>Find your opportunity</h2><p>{openJobs.length} {openJobs.length === 1 ? 'position' : 'positions'} · Preview vacancies</p></div><div className={s.catalogueFilters}><Field id="job-search" label="Search positions"><input id="job-search" type="search" value={search} placeholder="Role or keyword" onChange={event => setSearch(event.target.value)} /></Field><Field id="department-filter" label="Department"><select id="department-filter" value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</select></Field></div></div>
        <div className={s.vacancyGrid}>{openJobs.map(job => <article className={s.jobCard} key={job.id}><span className={s.eyebrow}>{job.department}</span><h2>{job.title}</h2><div className={s.meta}><span>{job.location}</span><span>{job.contract}</span></div><p>{job.summary}</p><button type="button" className={s.jobLink} aria-label={`View ${job.title}`} onClick={() => detail(job)}>View position <span aria-hidden="true">→</span></button></article>)}</div>
        {!openJobs.length && <div className={s.empty}><h2>No matching positions</h2><p>Try another keyword or department.</p><button type="button" className={s.secondary} onClick={() => { setSearch(''); setDepartment(''); }}>Clear filters</button></div>}
        <p className={s.catalogueNote}>Example roles for your review. These are not live job advertisements.</p>
      </section>
    </>}
    {view === 'detail' && selected && <section className={`${s.container} ${s.rolePage}`}>
      <button className={s.textButton} type="button" onClick={() => setView('jobs')}>← All positions</button>
      <div className={s.roleHero}><div><span className={s.eyebrow}>{selected.department}</span><h1 ref={heading} tabIndex={-1}>{selected.title}</h1><div className={s.meta}><span>{selected.location}</span><span>{selected.contract}</span><span>Preview vacancy</span></div></div><button type="button" className={s.primary} onClick={start}>{drafts[selected.id] ? 'Continue application →' : 'Apply for this role →'}</button></div>
      <div className={s.roleDetailGrid}><div className={s.roleDescription}><section><h2>About the role</h2><p>{selected.summary}</p></section><section><h2>What you’ll do</h2><ul>{selected.responsibilities.filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ul></section><section><h2>What we’re looking for</h2><ul>{selected.requirements.filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ul></section></div>
        <aside className={s.prepareCard}><span className={s.eyebrow}>BEFORE YOU START</span><h2>A simple application.</h2><ol><li>Your contact details</li><li>Your experience and role questions</li><li>A recent photo, documents and review</li></ol><p>Have a recent photo{selected.cvRequired ? ' and your CV' : ''} ready. Certificates are optional. A professional photo is not necessary.</p><button className={s.primary} type="button" onClick={start}>{drafts[selected.id] ? 'Resume application →' : 'Start application →'}</button><small>No account. No password.</small></aside>
      </div>
    </section>}
    {view === 'form' && selected && <ApplicationFunnel key={selected.id} vacancy={selected} draft={draft} step={wizard.step} reviewing={wizard.reviewing} onChange={next => setDrafts(previous => ({ ...previous, [selected.id]: next }))} onStep={(step, reviewing = false) => setWizard({ step, reviewing })} onBackToJob={() => setView('detail')} onSubmit={submit} />}
    {view === 'success' && <section className={s.successPage}><div className={s.successIcon} aria-hidden="true">✓</div><span className={s.eyebrow}>PREVIEW APPLICATION COMPLETE</span><h1 ref={heading} tabIndex={-1}>Thank you for<br />your interest.</h1><p>You completed the {selected?.title} application flow.</p><div className={s.reviewCard}><strong>{submittedId}</strong><p>Your test profile is ready to review in Recruitment in this browser session. No application, documents or email have been sent to production.</p></div><h2>What happens next?</h2><p>In the live module, the candidate receives confirmation from the Careers address selected by DEMAC. The team then reviews their profile.</p><button type="button" className={s.primary} onClick={() => setView('admin')}>See this profile in recruitment preview →</button><button type="button" className={s.textButton} onClick={tryApplication}>Back to positions</button></section>}
    {view === 'admin' && <RecruitmentPreview vacancies={vacancies} applications={applications} onVacancies={setVacancies} onApplications={setApplications} initialApplication={submittedId} onTryApplication={tryApplication} />}
    {(view === 'jobs' || view === 'detail') && <PublicFooter />}
  </main>;
}
