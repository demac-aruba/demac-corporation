'use client';

import { useEffect, useRef, useState } from 'react';
import { PublicBrand, PublicHeader, PublicFooter } from '../public/public-site-shell';
import { copyForSubmission, emptyDraft, exampleVacancies, totalFileBytes, validateStep, type ApplicationDraft, type PreviewApplication, type Vacancy } from '../../lib/careers-preview';
import { ApplicationFunnel } from './application-funnel';
import { RecruitmentPreview } from './recruitment-preview';
import { Field } from './careers-ui';
import { BackControl, CareerIcon, VacancyFacts } from './careers-visuals';
import { useCareersNavigation, type CareerRoute } from './use-careers-navigation';
import s from './careers.module.css';

export function CareersPreview() {
  const [vacancies, setVacancies] = useState<Vacancy[]>(exampleVacancies);
  const [applications, setApplications] = useState<PreviewApplication[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ApplicationDraft>>({});
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const tools = useRef<HTMLDetailsElement>(null);
  const snapshots = useRef(new Map<string, Vacancy>());
  const submittedByRole = useRef(new Map<string, string>());
  const submitLock = useRef(false);
  const live = useRef({ vacancies, applications, drafts });
  live.current = { vacancies, applications, drafts };
  function normalizeRoute(requested: CareerRoute): CareerRoute {
    if (requested.view === 'detail' || requested.view === 'form') {
      const job = live.current.vacancies.find(item => item.id === requested.role);
      if (!job) return { view: 'jobs' };
      if (requested.view === 'detail' || job.status !== 'Open') return { view: 'detail', role: job.id };
      const snapshot = snapshots.current.get(job.id) || job;
      const draft = live.current.drafts[job.id] || emptyDraft();
      let step = Math.max(0, Math.min(requested.step || 0, 2));
      let reviewing = !!requested.reviewing;
      for (let previous = 0; previous < step; previous += 1) {
        if (Object.keys(validateStep(draft, snapshot, previous)).length) { step = previous; reviewing = false; break; }
      }
      if (reviewing && (step !== 2 || Object.keys(validateStep(draft, snapshot, 2)).length || totalFileBytes(draft) > 30 * 1024 * 1024)) reviewing = false;
      return { view: 'form', role: job.id, step, reviewing };
    }
    if (requested.view === 'success') return live.current.applications.some(item => item.id === requested.receipt) ? requested : { view: 'jobs' };
    if (requested.view === 'admin') return { view: 'admin', tab: requested.tab || 'applications', candidate: live.current.applications.some(item => item.id === requested.candidate) ? requested.candidate : undefined };
    return { view: 'jobs' };
  }
  const navigation = useCareersNavigation(normalizeRoute);
  const route = navigation.route;
  const view = route.view;
  const selected = route.role ? snapshots.current.get(route.role) || vacancies.find(job => job.id === route.role) : undefined;
  const draft = selected ? drafts[selected.id] || emptyDraft() : emptyDraft();
  const submitted = applications.find(application => application.id === route.receipt);
  const hasDraft = Object.values(drafts).some(item => item.givenName || item.email || item.photo || item.cv);
  useEffect(() => {
    document.title = `${view === 'admin' ? 'Recruitment' : selected ? `${selected.title}${view === 'form' ? ' · Application' : ''}` : 'Careers'} · DEMAC preview`;
  }, [view, selected, route.step, route.reviewing]);
  useEffect(() => {
    if (!hasDraft && !applications.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft, applications.length]);
  function changeDraft(id: string, next: ApplicationDraft) {
    const updated = { ...live.current.drafts, [id]: next };
    live.current = { ...live.current, drafts: updated };
    setDrafts(updated);
  }
  function changeVacancies(next: Vacancy[]) { live.current = { ...live.current, vacancies: next }; setVacancies(next); }
  function changeApplications(next: PreviewApplication[]) { live.current = { ...live.current, applications: next }; setApplications(next); }
  function detail(job: Vacancy) { navigation.navigate({ view: 'detail', role: job.id }); }
  function start() {
    if (!selected) return;
    const previousReceipt = submittedByRole.current.get(selected.id);
    if (previousReceipt) { navigation.navigate({ view: 'success', receipt: previousReceipt }); return; }
    if (!drafts[selected.id]) {
      snapshots.current.set(selected.id, JSON.parse(JSON.stringify(selected)) as Vacancy);
      changeDraft(selected.id, emptyDraft());
    }
    submitLock.current = false;
    navigation.navigate({ view: 'form', role: selected.id, step: 0, reviewing: false });
  }
  function submit(): string | null {
    if (!selected) return 'Select a role before applying.';
    const previousReceipt = submittedByRole.current.get(selected.id);
    if (previousReceipt) { navigation.navigate({ view: 'success', receipt: previousReceipt }); return null; }
    if (submitLock.current) return null;
    if (live.current.vacancies.find(job => job.id === selected.id)?.status !== 'Open') return 'This preview vacancy is no longer open. Your answers are still available in this session.';
    const errors = { ...validateStep(draft, selected, 0), ...validateStep(draft, selected, 1), ...validateStep(draft, selected, 2, true) };
    if (Object.keys(errors).length || totalFileBytes(draft) > 30 * 1024 * 1024) return 'Please review all required answers and file limits before submitting.';
    submitLock.current = true;
    const id = `PREVIEW-${String(live.current.applications.length + 1).padStart(4, '0')}`;
    const at = new Date().toISOString();
    const snapshot: PreviewApplication = { id, vacancy: JSON.parse(JSON.stringify(selected)) as Vacancy, draft: copyForSubmission(draft, selected), stage: 'New', createdAt: at, notes: [], timeline: [{ text: 'Preview application completed · No production data sent', at }] };
    changeApplications([...live.current.applications, snapshot]);
    submittedByRole.current.set(selected.id, id);
    // Retain a read-only draft for browser Back/Forward. Never resubmit on popstate.
    navigation.navigate({ view: 'success', receipt: id });
    return null;
  }
  function reviewView(next: CareerRoute) { if (tools.current) tools.current.open = false; navigation.navigate(next); }
  const openJobs = vacancies.filter(job => job.status === 'Open' && (!department || job.department === department) && (!search || `${job.title} ${job.summary}`.toLowerCase().includes(search.toLowerCase())));
  const departments = Array.from(new Set(vacancies.map(job => job.department))).sort();
  return <main className={`public-site public-subsite ${s.root} ${view === 'admin' ? s.admin : ''}`} data-careers-version="premium-v3" data-career-view={view} onClickCapture={event => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (anchor && !anchor.hasAttribute('download') && !anchor.href.startsWith('blob:') && (hasDraft || applications.length) && !window.confirm('Leave this preview? The application details in this session will be cleared.')) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <div className={s.previewRibbon}><span><i aria-hidden="true"/>Preview v3 · Test data only</span><details ref={tools} className={s.reviewTools}><summary>Review tools <span aria-hidden="true">⌄</span></summary><div><strong>Design review · Not merged</strong><p>Test details and files stay in this tab. No live applications or emails.</p><button type="button" className={s.secondary} onClick={() => reviewView({ view: 'jobs' })}>Candidate view</button><button type="button" className={s.primary} onClick={() => reviewView({ view: 'admin', tab: 'applications' })}>Recruitment preview</button></div></details></div>
    {view === 'jobs' || view === 'detail' ? <PublicHeader/> : <header className={s.compactHeader}><PublicBrand/><span>{view === 'admin' ? 'Recruitment' : 'Careers'}</span></header>}
    {!navigation.ready && <div className={s.container} role="status">Opening Careers…</div>}
    {navigation.ready && view === 'jobs' && <>
      <section className={s.careerHero}><div className={s.heroInner}><span className={s.eyebrow}>BUILD YOUR NEXT CHAPTER</span><h1 data-career-page-title tabIndex={-1}>Careers</h1><h2>Join the DEMAC team.</h2><p>Bring your skills. Make a difference in Aruba.</p><div className={s.heroTags}><span><CareerIcon name="location"/>Aruba</span><span><CareerIcon name="users"/>Technical & office roles</span></div></div></section>
      <section className={s.container} aria-label="Open positions"><div className={s.catalogueHeader}><div><h2>Find your opportunity</h2><p>{openJobs.length} {openJobs.length === 1 ? 'position' : 'positions'} · Preview vacancies</p></div></div>
        <div className={s.catalogueFilters}><Field id="job-search" label="Search positions"><div className={s.searchInput}><CareerIcon name="filters"/><input id="job-search" type="search" value={search} placeholder="Search jobs or keywords…" onChange={event => setSearch(event.target.value)}/></div></Field><Field id="department-filter" label="Department"><select id="department-filter" value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</select></Field></div>
        <div className={s.vacancyGrid}>{openJobs.map(job => <article className={s.jobCard} key={job.id}><div className={s.jobTitleRow}><h2>{job.title}</h2><span className={s.jobArrow} aria-hidden="true"><CareerIcon name="arrow"/></span></div><div className={s.meta}><span><CareerIcon name="briefcase"/>{job.department}</span><span><CareerIcon name="location"/>{job.location}</span><span><CareerIcon name="clock"/>{job.contract}</span></div><p>{job.summary}</p><button type="button" className={s.jobLink} data-career-focus={`job-${job.id}`} aria-label={`View ${job.title}`} onClick={() => detail(job)}>View position <CareerIcon name="arrow"/></button></article>)}</div>
        {!openJobs.length && <div className={s.empty}><h2>No matching positions</h2><p>Try another keyword or department.</p><button type="button" className={s.secondary} onClick={() => { setSearch(''); setDepartment(''); }}>Clear filters</button></div>}
        <p className={s.catalogueNote}>These roles are for preview review, not live job advertisements.</p>
      </section>
    </>}
    {navigation.ready && view === 'detail' && selected && <>
      <section className={`${s.careerHero} ${s.detailHero}`}><div className={s.heroInner}><div data-career-navrow><BackControl label="Back to open positions" onClick={() => navigation.backTo({ view: 'jobs' })}/><span>Careers / Position</span></div><span className={s.eyebrow}>{selected.department}</span><h1 data-career-page-title tabIndex={-1}>{selected.title}</h1><p>{selected.summary}</p></div></section>
      <section className={`${s.container} ${s.rolePage}`}><VacancyFacts vacancy={selected}/><div className={s.roleDetailGrid}><div className={s.roleDescription}>
        <section><h2>About the role</h2><p>{selected.summary}</p></section>
        <section><h2>What you’ll do</h2><ul>{selected.responsibilities.filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ul></section>
        <section><h2>What we’re looking for</h2><ul>{selected.requirements.filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ul></section>
        <section className={s.prepareDocuments}><span className={s.iconTile}><CareerIcon name="file"/></span><div><h2>Documents to prepare</h2><p>A recent photo{selected.cvRequired ? ' and your CV' : ''}. Add relevant certificates or courses, when available.</p><small>CV {selected.cvRequired ? 'required' : 'optional'} · Certificates optional · No professional photo needed</small></div></section>
      </div><aside className={s.prepareCard}><span className={s.eyebrow}>YOUR APPLICATION</span><h2>Three simple steps.</h2><ol><li>Your details</li><li>Experience & role questions</li><li>Photo, documents & review</li></ol><small><CareerIcon name="lock"/>No account or password needed.</small></aside></div>
      <div className={s.applyBar}><div><strong>{selected.title}</strong><small>{selected.location} · {selected.contract}</small></div><button type="button" className={s.primary} onClick={start}>{submittedByRole.current.has(selected.id) ? 'View confirmation' : drafts[selected.id] ? 'Continue application' : 'Apply now'}<CareerIcon name="arrow"/></button></div></section>
    </>}
    {navigation.ready && view === 'form' && selected && <ApplicationFunnel key={selected.id} vacancy={selected} draft={draft} step={route.step || 0} reviewing={!!route.reviewing} completed={submittedByRole.current.has(selected.id)} onChange={next => changeDraft(selected.id, next)} onStep={(step, reviewing = false) => navigation.navigate({ view: 'form', role: selected.id, step, reviewing })} onBack={() => {
      const step = route.step || 0;
      navigation.backTo(route.reviewing ? { view: 'form', role: selected.id, step: 2, reviewing: false } : step > 0 ? { view: 'form', role: selected.id, step: step - 1, reviewing: false } : { view: 'detail', role: selected.id });
    }} onBackToJob={() => navigation.backTo({ view: 'detail', role: selected.id })} onSubmit={submit}/>}
    {navigation.ready && view === 'success' && submitted && <section className={s.successPage}><div className={s.successIcon}><CareerIcon name="check"/></div><span className={s.eyebrow}>PREVIEW COMPLETE</span><h1 data-career-page-title tabIndex={-1}>Application completed</h1><p>Thank you for your interest in joining the DEMAC team.</p><strong className={s.successRole}>{submitted.vacancy.title}</strong>
      <dl className={s.receiptCard}><div><CareerIcon name="file"/><dt>Reference number</dt><dd>{submitted.id}</dd></div><div><CareerIcon name="mail"/><dt>Your email</dt><dd>{submitted.draft.email}</dd></div></dl>
      <div className={s.informationCard}><span className={s.iconTile}><CareerIcon name="mail"/></span><div><strong>Confirmation email · Preview only</strong><p>No email has been sent. This test profile is available in Recruitment in this tab.</p></div></div>
      <section className={s.nextSteps}><h2>What happens next?</h2><ol><li><span>1</span><div><strong>Review the application</strong><p>See the information and documents in the recruitment preview.</p></div></li><li><span>2</span><div><strong>Follow the selection process</strong><p>Explore review stages and add a test recruiter note.</p></div></li></ol></section>
      <button type="button" className={s.primary} onClick={() => navigation.navigate({ view: 'admin', tab: 'applications', candidate: submitted.id })}>Review this candidate <CareerIcon name="arrow"/></button><button type="button" className={s.secondary} onClick={() => navigation.navigate({ view: 'jobs' })}>Explore positions</button><small>Test information only. Refreshing or closing the tab clears this session.</small>
    </section>}
    {navigation.ready && view === 'admin' && <RecruitmentPreview vacancies={vacancies} applications={applications} onVacancies={changeVacancies} onApplications={changeApplications} initialApplication={route.candidate} onTryApplication={() => navigation.navigate({ view: 'jobs' })}/>}
    {(view === 'jobs' || view === 'detail') && <PublicFooter/>}
    {(view === 'form' || view === 'success') && <footer className={s.funnelFooter}><span>DEMAC · Professional Cooling Solutions</span><span>Careers · Aruba</span></footer>}
  </main>;
}
