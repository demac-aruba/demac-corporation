'use client';
import { candidateMessage } from '../../../../functions/careers/mail-contract';

import { PRESENTATION_VERSION, createSubmissionSnapshot } from '../../../../functions/careers/submission-contract.js';
import { validateDetails, validateExperience } from '../../../../functions/careers/form-contract.js';
import { CareersLanguage } from './careers-language';
import { withSpanishPreview } from '../../lib/careers-preview-locales';
import { careersText, vacancyPresentation } from '../../lib/careers-locale';
import { useEffect, useRef, useState } from 'react';
import { CareersHeader, CareersFooter } from './careers-chrome';
import { copyForSubmission, emptyDraft, exampleVacancies, totalFileBytes, validateStep, validateApplication, type ApplicationDraft, type PreviewApplication, type Vacancy } from '../../lib/careers-preview';
import { ApplicationFunnel } from './application-funnel';
import { formScreens, normalizeFormTarget } from '../../lib/careers-form-flow';
import { RecruitmentPreview } from './recruitment-preview';
import { ApplicationReceipt, VacancyCatalogue, VacancyProfile } from './careers-pages';
import { useCareersNavigation, type CareerRoute } from './use-careers-navigation';
import s from './careers.module.css';

export function CareersPreview() {
  const [vacancies, setVacancies] = useState<Vacancy[]>(() => withSpanishPreview(exampleVacancies()));
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
      return { view: 'form', role: job.id, ...normalizeFormTarget(formScreens(snapshot, draft), requested, validateApplication(draft, snapshot)) };
    }
    if (requested.view === 'success') return live.current.applications.some(item => item.id === requested.receipt) ? requested : { view: 'jobs' };
    if (requested.view === 'admin') return { view: 'admin', tab: requested.tab || 'applications', candidate: live.current.applications.some(item => item.id === requested.candidate) ? requested.candidate : undefined };
    return { view: 'jobs' };
  }
  const navigation = useCareersNavigation(normalizeRoute);
  const route = navigation.route;
  const text = (key: string) => careersText(navigation.locale, key);
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
    let submissionSnapshot;
    try {
      const canonical = { ...validateDetails(draft).value, ...validateExperience(draft, selected.questions).value, futureTalent: draft.futureTalent };
      submissionSnapshot = createSubmissionSnapshot(selected, draft, canonical, navigation.locale, PRESENTATION_VERSION,
        { version: 'preview-only', text: careersText(navigation.locale, 'This is a design preview, not a live recruitment service. Details, photos and files remain in memory in this browser tab. They are not sent to DEMAC, a database or an email provider. Refreshing or closing this page clears the session. Use fictional details and test files. Production privacy and retention settings still require approval.') });
    } catch { return 'Please review all required answers and file limits before submitting.'; }
    submitLock.current = true;
    const id = `PREVIEW-${String(live.current.applications.length + 1).padStart(4, '0')}`;
    const at = new Date().toISOString();
    const snapshot: PreviewApplication = { id, submissionSnapshot, vacancy: JSON.parse(JSON.stringify(selected)) as Vacancy, draft: copyForSubmission(draft, selected), stage: 'New', createdAt: at, notes: [], timeline: [{ text: 'Preview application completed · No production data sent', at }] };
    snapshot.candidateMessage = candidateMessage({reference:id,profile:snapshot.draft,jobSnapshot:snapshot.vacancy,submissionSnapshot});
    changeApplications([...live.current.applications, snapshot]);
    submittedByRole.current.set(selected.id, id);
    // Retain a read-only draft for browser Back/Forward. Never resubmit on popstate.
    navigation.navigate({ view: 'success', receipt: id });
    return null;
  }
  function reviewView(next: CareerRoute) { if (tools.current) tools.current.open = false; navigation.navigate(next); }
  return <CareersLanguage locale={navigation.locale} onChange={navigation.setLocale} disabled={!navigation.ready}><main lang={view === 'admin' ? 'en' : navigation.locale} className={`${s.root} ${view === 'admin' ? s.admin : ''}`} data-careers-version="premium-v3" data-careers-increment="questions-v4" data-career-view={view} onClickCapture={event => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (anchor && !anchor.hasAttribute('download') && !anchor.href.startsWith('blob:') && (hasDraft || applications.length) && !window.confirm(text('Leave this preview? The application details in this session will be cleared.'))) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <div className={s.previewRibbon}><span><i aria-hidden="true"/>{text('Preview V4 · Test data only')}</span><details ref={tools} className={s.reviewTools}><summary>Review tools <span aria-hidden="true">⌄</span></summary><div><strong>Design review · Not merged</strong><p>Test details and files stay in this tab. No live applications or emails.</p><button type="button" className={s.secondary} onClick={() => reviewView({ view: 'jobs' })}>Candidate view</button><button type="button" className={s.primary} onClick={() => reviewView({ view: 'admin', tab: 'applications' })}>Recruitment preview</button>{submitted && <button type="button" className={s.secondary} onClick={() => reviewView({ view: 'admin', tab: 'applications', candidate: submitted.id })}>Review this candidate</button>}</div></details></div>
    <CareersHeader compactLabel={view === 'jobs' || view === 'detail' ? undefined : view === 'admin' ? 'Recruitment' : 'Careers'}/>
    {!navigation.ready && <div className={s.container} role="status">{careersText(navigation.locale, 'Opening Careers…')}</div>}
    {navigation.ready && view === 'jobs' && <VacancyCatalogue jobs={vacancies.filter(job => job.status === 'Open')} query={search} department={department} onQuery={setSearch} onDepartment={setDepartment} onSelect={detail} preview/>}
    {navigation.ready && view === 'detail' && selected && <VacancyProfile vacancy={selected} onBack={() => navigation.backTo({ view: 'jobs' })} onApply={start} applyLabel={submittedByRole.current.has(selected.id) ? 'View confirmation' : drafts[selected.id] ? 'Continue application' : 'Apply now'}/>}
    {navigation.ready && view === 'form' && selected && <div><ApplicationFunnel key={selected.id} vacancy={selected} draft={draft} step={route.step || 0} reviewing={!!route.reviewing} question={route.question} returnToReview={route.returnToReview} completed={submittedByRole.current.has(selected.id)} onChange={next => changeDraft(selected.id, next)} onStep={target => navigation.navigate({ view: 'form', role: selected.id, ...target })} onBack={target => navigation.backTo(target ? { view: 'form', role: selected.id, ...target } : { view: 'detail', role: selected.id })} onBackToJob={() => navigation.backTo({ view: 'detail', role: selected.id })} onSubmit={submit}/></div>}
    {navigation.ready && view === 'success' && submitted && <ApplicationReceipt reference={submitted.id} email={submitted.draft.email} jobTitle={vacancyPresentation(submitted.vacancy, navigation.locale).job.title} onExplore={() => navigation.navigate({ view: 'jobs' })} preview/>}
    {navigation.ready && view === 'admin' && <RecruitmentPreview vacancies={vacancies} applications={applications} onVacancies={changeVacancies} onApplications={changeApplications} initialApplication={route.candidate} onTryApplication={() => navigation.navigate({ view: 'jobs' })}/>}
    {(view === 'jobs' || view === 'detail' || view === 'success') && <CareersFooter/>}
    {view === 'form' && <footer className={s.funnelFooter}><span>DEMAC · Professional Cooling Solutions</span><span>{text('Careers')} · Aruba</span></footer>}
  </main></CareersLanguage>;
}
