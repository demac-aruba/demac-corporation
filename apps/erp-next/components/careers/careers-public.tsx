'use client';
import { selectPrivacy } from '../../../../functions/careers/privacy-contract';
import { uploadIdentityMaterial, type SupportingCategory } from '../../../../functions/careers/document-contract.js';
import { PRESENTATION_VERSION } from '../../../../functions/careers/submission-contract.js';
import { CareersLanguage } from './careers-language';
import { careersText, careersTemplate, careersIssue, careersIssueText, vacancyPresentation, type CareersIssue } from '../../lib/careers-locale';
import { useEffect, useRef, useState } from 'react';
import { CareersHeader, CareersFooter } from './careers-chrome';
import { CareersError, careersPublic, uploadApplicantDocument, type PublicJobs, type ApplicantSession, type Receipt, type DocumentRecord } from '../../lib/firebase/careers';
import { emptyDraft, validateApplication, documentSelections, type ApplicationDraft } from '../../lib/careers-preview';
import type { SelectedFileState } from './careers-visuals';
import { ApplicationFunnel } from './application-funnel';
import { formScreens, normalizeFormTarget } from '../../lib/careers-form-flow';
import { recoverRevisedDraft } from '../../lib/careers-recovery';
import { ApplicationReceipt, VacancyCatalogue, VacancyProfile } from './careers-pages';
import { defaultCareersContent, normalizeCareersContent } from '../../lib/public-website-content';
import { loadPublishedWebsiteContent } from '../../lib/public-website-public';
import { useCareersNavigation, type CareerRoute } from './use-careers-navigation';
import s from './careers.module.css';
async function sha(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) { const out = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(out), n => n.toString(16).padStart(2, '0')).join(''); }
async function keyFor(file: File, kind: string, category?:SupportingCategory) { return sha(new TextEncoder().encode(uploadIdentityMaterial(kind,await sha(await file.arrayBuffer()),category))); }
export function CareersPublic() {
  const [data, setData] = useState<PublicJobs | null>(null), [error, setError] = useState<CareersIssue | null>(null), [status, setStatus] = useState(''), [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ApplicationDraft>>({}), [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const [fileStates,setFileStates]=useState<{file:File;state:SelectedFileState}[]>([]);
  const [photoState,setPhotoState]=useState<SelectedFileState>('selected');
  const photoForState=useRef<ApplicationDraft['photo']>(null);
  const [needsRevision, setNeedsRevision] = useState(false), [revisionNotice, setRevisionNotice] = useState('');
  const [department, setDepartment] = useState('');
  const [presentation, setPresentation] = useState(defaultCareersContent);
  useEffect(() => {
    let active = true;
    void loadPublishedWebsiteContent().then(value => { if (active) setPresentation(normalizeCareersContent(value.careers)); });
    return () => { active = false; };
  }, []);
  const sessions = useRef(new Map<string, ApplicantSession>()), loading = useRef(false);
  const current = useRef({ data, drafts, receipts }); current.current = { data, drafts, receipts };
  function normalize(route: CareerRoute): CareerRoute {
    if (route.view === 'admin') return { view: 'jobs' };
    if (route.view === 'success') return Object.values(current.current.receipts).some(r => r.id === route.receipt) ? route : { view: 'jobs' };
    if (!current.current.data) return route;
    if (route.view === 'detail' || route.view === 'form') {
      const job = current.current.data.jobs.find(j => j.id === route.role); if (!job) return { view: 'jobs' };
      if (route.view === 'detail') return route;
      const draft = current.current.drafts[job.id] || emptyDraft();
      return { view: 'form', role: job.id, ...normalizeFormTarget(formScreens(job, draft), route, validateApplication(draft, job)) };
    }
    return { view: 'jobs' };
  }
  const nav = useCareersNavigation(normalize), route = nav.route;
  const text = (key: string) => careersText(nav.locale, key);
  async function refresh() { setError(null); try { const result = await careersPublic<PublicJobs>('vacancies.list'); current.current = { ...current.current, data: result }; setData(result); } catch (e) { setError(careersIssue(e, 'Careers is temporarily unavailable.')); } }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (data && nav.ready) nav.navigate(normalize(route), true); }, [data, nav.ready]);
  const job = data?.jobs.find(j => j.id === route.role), draft = job ? drafts[job.id] || emptyDraft() : emptyDraft();
  const received = job ? receipts[job.id] : Object.values(receipts).find(r => r.id === route.receipt);
  function change(next: ApplicationDraft) { if (!job) return; setFileStates(previous=>previous.filter(entry=>next.cv===entry.file||next.documents.includes(entry.file)));if(next.photo!==draft.photo)setPhotoState('selected'); const updated = { ...current.current.drafts, [job.id]: next }; current.current = { ...current.current, drafts: updated }; setDrafts(updated); }
  useEffect(() => {
    if (!Object.values(drafts).some(d => d.givenName || d.email || d.photo)) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);
  async function submit(): Promise<string | CareersIssue | null> {
    if (!job || !data?.privacy) return 'Reload the current vacancy information before applying.';
    if (received) { nav.navigate({ view: 'success', receipt: received.id }); return null; }
    if (loading.current) return null; loading.current = true;
    try {
      setStatus(text('Preparing application…'));
      let session = sessions.current.get(job.id);
      if (!session || session.expiresAt <= Date.now()) { session = await careersPublic<ApplicantSession>('session.start', { jobId: job.id, version: job.version, website: '' }); sessions.current.set(job.id, session); }
      const existing = await careersPublic<{ files: DocumentRecord[]; receipt?: Receipt }>('session.status', session);
      if (existing.receipt) { complete(existing.receipt); return null; }
      const chosen: { file: File; kind: DocumentRecord['kind']; category?: SupportingCategory; id?: string }[] = [];
      if (draft.photo) { const raw = atob(draft.photo.dataUrl.split(',')[1]), bytes = Uint8Array.from(raw, c => c.charCodeAt(0)); chosen.push({ file: new File([bytes], 'profile-photo.jpg', { type: 'image/jpeg' }), kind: 'photo' }); }
      if (draft.cv) chosen.push({ file: draft.cv, kind: 'cv' });
      documentSelections(draft).forEach(item => chosen.push(item));
      for (const item of chosen) item.id = await keyFor(item.file, item.kind, item.category);
      const obsolete=existing.files.filter(old=>!chosen.some(item=>item.id===old.id));
      // Clear failed reservations only. Accepted files are preserved until a
      // replacement has been acknowledged by the authority.
      for (const old of obsolete.filter(file=>file.status!=='clean')) await careersPublic('file.remove',{...session,fileId:old.id});
      const replacementPool=obsolete.filter(file=>file.status==='clean');
      const mark=(item:typeof chosen[number],state:SelectedFileState)=>{if(item.kind==='photo'){photoForState.current=draft.photo;setPhotoState(state);}else setFileStates(previous=>[...previous.filter(entry=>entry.file!==item.file),{file:item.file,state}]);};
      for (let i = 0; i < chosen.length; i++) {
        const item=chosen[i];
        if(existing.files.some(f=>f.id===item.id&&f.status==='clean')){mark(item,'stored');continue;}
        setStatus(careersTemplate(nav.locale,'Processing document {current} / {total}…',{current:i+1,total:chosen.length}));mark(item,'processing');
        const sameKind=replacementPool.filter(file=>file.kind===item.kind);
        const replaced=sameKind.find(file=>(file.category||'document')===(item.category||'document')) || sameKind[0];
        try {
          const saved=await uploadApplicantDocument(session,item.file,item.kind,item.category,replaced?.id);
          mark(item,saved.status==='clean'?'stored':'uncertain');
          if(replaced && saved.status==='clean') replacementPool.splice(replacementPool.indexOf(replaced),1);
        }
        catch(error){mark(item,error instanceof CareersError&&['connection-error','upload-busy','upload-conflict'].includes(error.code)?'uncertain':'error');throw error;}
      }
      // Confirm the actual server set before removing explicitly deselected
      // leftovers. An uncertain upload exits above with the previous file intact.
      const synchronized=await careersPublic<{files:DocumentRecord[];receipt?:Receipt}>('session.status',session);
      if(synchronized.receipt){complete(synchronized.receipt);return null;}
      for(const old of synchronized.files) if(!chosen.some(item=>item.id===old.id)) await careersPublic('file.remove',{...session,fileId:old.id});
      setStatus(text('Saving application…'));
      const { photo, cv, documents, documentAssignments, ...fields } = draft;
      const receipt = await careersPublic<Receipt>('application.submit', { ...session, localeAtSubmit: nav.locale, presentationVersion: PRESENTATION_VERSION, profile: { ...fields, privacyVersion: data.privacy.version } }); complete(receipt); return null;
    } catch (e) {
      if (e instanceof CareersError && ['version-conflict', 'privacy-version', 'vacancy-closed'].includes(e.code)) setNeedsRevision(true);
      return careersIssue(e);
    }
    finally { loading.current = false; setStatus(''); }
  }
  async function reviewUpdatedPosition() {
    if (!job || loading.current) return;
    loading.current = true; setError(null);
    try {
      const result = await careersPublic<PublicJobs>('vacancies.list');
      const latest = result.jobs.find(item => item.id === job.id);
      if (!latest) {
        setRevisionNotice('This position is no longer accepting applications. Your local answers have not been sent or deleted.');
        current.current = { ...current.current, data: result }; setData(result);
        setNeedsRevision(false); nav.navigate({ view: 'jobs' }, true); return;
      }
      const updated = { ...current.current.drafts, [job.id]: recoverRevisedDraft(job, latest, draft) };
      current.current = { ...current.current, data: result, drafts: updated };
      sessions.current.delete(job.id); // The old, unsubmitted server session expires privately.
      setDrafts(updated); setData(result); setNeedsRevision(false);
      setRevisionNotice('The position or privacy notice changed. Your contact details and selected documents are preserved. Review the current questions and consent before submitting.');
      nav.navigate({ view: 'form', role: job.id, step: 1 }, true);
    } catch (e) { setError(careersIssue(e, 'Unable to refresh the position. Your answers are still here.')); }
    finally { loading.current = false; }
  }
  function complete(receipt: Receipt) { if (!job) return; const saved = { ...current.current.receipts, [job.id]: receipt }; current.current = { ...current.current, receipts: saved }; setReceipts(saved); nav.navigate({ view: 'success', receipt: receipt.id }); }
  const receivedRole = Object.keys(receipts).find(id => receipts[id].id === route.receipt);
  const receivedJob = data?.jobs.find(value => value.id === receivedRole);
  const receivedDraft = receivedRole ? drafts[receivedRole] : undefined;
  const form = route.view === 'form' && job && data?.privacy;
  return <CareersLanguage locale={nav.locale} onChange={nav.setLocale} disabled={!!status || !nav.ready}><main lang={nav.locale} className={`${s.root}`} data-careers-version="premium-v3">
    <CareersHeader compactLabel={form ? 'Careers' : undefined}/>
    {revisionNotice && <section className={s.container}><p className={s.informationCard} role="status">{text(revisionNotice)}</p></section>}
    {needsRevision && <section className={s.container}><div className={s.alert} role="alert"><p>{text('This position or its privacy notice was updated. Review the latest version without losing your contact details or selected files.')}</p><button type="button" className={s.secondary} onClick={() => void reviewUpdatedPosition()}>{text('Review updated position')}</button></div></section>}
    {error && <section className={s.container}><div className={s.alert} role="alert">{careersIssueText(nav.locale, error)}</div><button className={s.secondary} onClick={() => void refresh()}>{text('Try again')}</button></section>}
    {!data && !error && <section className={s.container}><p role="status">{careersText(nav.locale, 'Loading opportunities…')}</p></section>}
    {data && route.view === 'jobs' && <VacancyCatalogue jobs={data.jobs} query={query} department={department} onQuery={setQuery} onDepartment={setDepartment} onSelect={value => nav.navigate({ view: 'detail', role: value.id })} available={data.available} content={presentation}/>}
    {route.view === 'detail' && job && <VacancyProfile vacancy={job} onBack={() => nav.backTo({ view: 'jobs' })} onApply={() => nav.navigate({ view: 'form', role: job.id, step: 0 })} applyLabel={received ? 'Review application' : 'Apply now'} content={presentation}/>}
    {form && job && data?.privacy && <div><ApplicationFunnel key={job.id} vacancy={job} draft={draft} step={route.step || 0} reviewing={!!route.reviewing} question={route.question} returnToReview={route.returnToReview} completed={!!received} onChange={change} onStep={target => nav.navigate({ view: 'form', role: job.id, ...target })} onBackToJob={() => nav.backTo({ view: 'detail', role: job.id })} onBack={target => nav.backTo(target ? { view: 'form', role: job.id, ...target } : { view: 'detail', role: job.id })} onSubmit={submit} live={{ privacyText: selectPrivacy(data.privacy,nav.locale).text,privacyContentLocale:selectPrivacy(data.privacy,nav.locale).contentLocale,privacyTranslationPending:selectPrivacy(data.privacy,nav.locale).translationPending,fileStates,photoState:photoForState.current===draft.photo?photoState:'selected',status }}/></div>}
    {route.view === 'success' && received && <ApplicationReceipt reference={received.reference} email={receivedDraft?.email || ''} jobTitle={receivedJob ? vacancyPresentation(receivedJob, nav.locale).job.title : ''} emailNotice={text('Your application is saved. Submission does not confirm email delivery.')} onExplore={() => nav.navigate({ view: 'jobs' })} content={presentation}/>}
    {!form && <CareersFooter/>}
  </main></CareersLanguage>;
}
