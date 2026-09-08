'use client';
import { useEffect, useRef, useState } from 'react';
import { PublicHeader, PublicFooter, PublicBrand } from '../public/public-site-shell';
import { careersPublic, uploadApplicantDocument, type PublicJobs, type ApplicantSession, type Receipt, type DocumentRecord } from '../../lib/firebase/careers';
import { emptyDraft, validateStep, type ApplicationDraft, type Vacancy } from '../../lib/careers-preview';
import { ApplicationFunnel } from './application-funnel';
import { BackControl, CareerIcon, VacancyFacts } from './careers-visuals';
import { useCareersNavigation, type CareerRoute } from './use-careers-navigation';
import s from './careers.module.css';
async function sha(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) { const out = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(out), n => n.toString(16).padStart(2, '0')).join(''); }
async function keyFor(file: File, kind: string) { return sha(new TextEncoder().encode(`${kind}|${await sha(await file.arrayBuffer())}`)); }
export function CareersPublic() {
  const [data, setData] = useState<PublicJobs | null>(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ApplicationDraft>>({}), [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const sessions = useRef(new Map<string, ApplicantSession>()), loading = useRef(false);
  const current = useRef({ data, drafts, receipts }); current.current = { data, drafts, receipts };
  function normalize(route: CareerRoute): CareerRoute {
    if (route.view === 'admin') return { view: 'jobs' };
    if (route.view === 'success') return Object.values(current.current.receipts).some(r => r.id === route.receipt) ? route : { view: 'jobs' };
    if (!current.current.data) return route;
    if (route.view === 'detail' || route.view === 'form') {
      const job = current.current.data.jobs.find(j => j.id === route.role); if (!job) return { view: 'jobs' };
      if (route.view === 'detail') return route;
      const draft = current.current.drafts[job.id] || emptyDraft(); let step = Math.max(0, Math.min(2, route.step || 0)), review = !!route.reviewing;
      for (let i = 0; i < step; i++) if (Object.keys(validateStep(draft, job as Vacancy, i)).length) { step = i; review = false; break; }
      if (review && Object.keys(validateStep(draft, job as Vacancy, 2)).length) review = false;
      return { view: 'form', role: job.id, step, reviewing: review };
    }
    return { view: 'jobs' };
  }
  const nav = useCareersNavigation(normalize), route = nav.route;
  async function refresh() { setError(''); try { const result = await careersPublic<PublicJobs>('vacancies.list'); current.current = { ...current.current, data: result }; setData(result); } catch (e) { setError(e instanceof Error ? e.message : 'Careers is temporarily unavailable.'); } }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (data && nav.ready) nav.navigate(normalize(route), true); }, [data, nav.ready]);
  const job = data?.jobs.find(j => j.id === route.role), draft = job ? drafts[job.id] || emptyDraft() : emptyDraft();
  const received = job ? receipts[job.id] : Object.values(receipts).find(r => r.id === route.receipt);
  function change(next: ApplicationDraft) { if (!job) return; const updated = { ...current.current.drafts, [job.id]: next }; current.current = { ...current.current, drafts: updated }; setDrafts(updated); }
  useEffect(() => {
    if (!Object.values(drafts).some(d => d.givenName || d.email || d.photo)) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);
  async function submit(): Promise<string | null> {
    if (!job || !data?.privacy) return 'Reload the current vacancy information before applying.';
    if (received) { nav.navigate({ view: 'success', receipt: received.id }); return null; }
    if (loading.current) return null; loading.current = true;
    try {
      setStatus('Preparing application…');
      let session = sessions.current.get(job.id);
      if (!session || session.expiresAt <= Date.now()) { session = await careersPublic<ApplicantSession>('session.start', { jobId: job.id, version: job.version, website: '' }); sessions.current.set(job.id, session); }
      const existing = await careersPublic<{ files: DocumentRecord[]; receipt?: Receipt }>('session.status', session);
      if (existing.receipt) { complete(existing.receipt); return null; }
      const chosen: { file: File; kind: DocumentRecord['kind']; id?: string }[] = [];
      if (draft.photo) { const raw = atob(draft.photo.dataUrl.split(',')[1]), bytes = Uint8Array.from(raw, c => c.charCodeAt(0)); chosen.push({ file: new File([bytes], 'profile-photo.jpg', { type: 'image/jpeg' }), kind: 'photo' }); }
      if (draft.cv) chosen.push({ file: draft.cv, kind: 'cv' });
      draft.documents.forEach(file => chosen.push({ file, kind: 'document' }));
      for (const item of chosen) item.id = await keyFor(item.file, item.kind);
      for (const old of existing.files) if (!chosen.some(f => f.id === old.id)) await careersPublic('file.remove', { ...session, fileId: old.id });
      for (let i = 0; i < chosen.length; i++) { const item = chosen[i]; if (existing.files.some(f => f.id === item.id && f.status === 'clean')) continue; setStatus(`Processing document ${i + 1} / ${chosen.length}…`); await uploadApplicantDocument(session, item.file, item.kind); }
      setStatus('Saving application…');
      const { photo, cv, documents, ...fields } = draft;
      const receipt = await careersPublic<Receipt>('application.submit', { ...session, profile: { ...fields, privacyVersion: data.privacy.version } }); complete(receipt); return null;
    } catch (e) { return e instanceof Error ? e.message : 'Unable to submit. Please retry.'; }
    finally { loading.current = false; setStatus(''); }
  }
  function complete(receipt: Receipt) { if (!job) return; const saved = { ...current.current.receipts, [job.id]: receipt }; current.current = { ...current.current, receipts: saved }; setReceipts(saved); nav.navigate({ view: 'success', receipt: receipt.id }); }
  const form = route.view === 'form' && job && data?.privacy;
  return <main className={`public-site public-subsite ${s.root}`} data-careers-version="premium-v3">
    {form ? <header className={s.compactHeader}><PublicBrand/><span>Careers</span></header> : <PublicHeader/>}
    {error && <section className={s.container}><div className={s.alert} role="alert">{error}</div><button className={s.secondary} onClick={() => void refresh()}>Try again</button></section>}
    {!data && !error && <section className={s.container}><p role="status">Loading opportunities…</p></section>}
    {data && route.view === 'jobs' && <><section className={s.careerHero}><div className={s.heroInner}><span className={s.eyebrow}>BUILD YOUR NEXT CHAPTER</span><h1 tabIndex={-1}>Careers</h1><h2>Join the DEMAC team.</h2><p>Bring your skills. Make a difference in Aruba.</p></div></section><section className={s.container}><div className={s.catalogueHeader}><h2>Open positions</h2></div><label className={s.field}>Search opportunities<input value={query} onChange={e => setQuery(e.target.value)} type="search" placeholder="Position or department" /></label><div className={s.vacancyGrid} style={{ marginTop: 24 }}>{data.jobs.filter(j => `${j.title} ${j.department}`.toLowerCase().includes(query.toLowerCase())).map(j => <article className={s.jobCard} key={j.id}><h2>{j.title}</h2><div className={s.meta}><span>{j.department}</span><span>{j.location}</span><span>{j.contract}</span></div><p>{j.summary}</p><button className={s.jobLink} data-career-focus={`job-${j.id}`} onClick={() => nav.navigate({ view: 'detail', role: j.id })}>View position<CareerIcon name="arrow"/></button></article>)}</div>{!data.jobs.length && <div className={s.empty}><h2>No openings at the moment</h2><p>Please check back for future opportunities.</p></div>}</section></>}
    {route.view === 'detail' && job && <><section className={s.careerHero}><div className={s.heroInner}><BackControl label="Back to open positions" onClick={() => nav.backTo({ view: 'jobs' })}/><h1 tabIndex={-1}>{job.title}</h1><p>{job.summary}</p></div></section><section className={`${s.container} ${s.rolePage}`}><VacancyFacts vacancy={job as Vacancy}/><div className={s.roleDescription}><section><h2>About the role</h2><p>{job.summary}</p></section>{[['What you’ll do', job.responsibilities], ['What we’re looking for', job.requirements], ['Preferred qualifications', job.desired]].map(([heading, values]) => (values as string[])?.length ? <section key={String(heading)}><h2>{heading as string}</h2><ul>{(values as string[]).map((value, i) => <li key={i}>{value}</li>)}</ul></section> : null)}<section><h2>Documents to prepare</h2><p>A recent photo{job.cvRequired ? ' and your CV' : ''}. Relevant certificates and courses are optional.</p></section></div><div className={s.applyBar}><strong>{job.title}</strong><button className={s.primary} onClick={() => nav.navigate({ view: 'form', role: job.id, step: 0 })}>{received ? 'Review application' : 'Apply now'}<CareerIcon name="arrow"/></button></div></section></>}
    {form && job && data?.privacy && <ApplicationFunnel key={job.id} vacancy={job as Vacancy} draft={draft} step={route.step || 0} reviewing={!!route.reviewing} completed={!!received} onChange={change} onStep={(step, reviewing = false) => nav.navigate({ view: 'form', role: job.id, step, reviewing })} onBackToJob={() => nav.backTo({ view: 'detail', role: job.id })} onBack={() => nav.backTo(route.reviewing ? { view: 'form', role: job.id, step: 2, reviewing: false } : route.step ? { view: 'form', role: job.id, step: route.step - 1, reviewing: false } : { view: 'detail', role: job.id })} onSubmit={submit} live={{ privacyText: data.privacy.text, status }}/>} 
    {route.view === 'success' && received && <section className={s.successPage}><div className={s.successIcon}><CareerIcon name="check"/></div><h1 tabIndex={-1}>Application received</h1><p>Thank you for your interest in joining DEMAC.</p><div className={s.receiptCard}><strong>{received.reference}</strong><p>Your application and documents have been received.</p></div><p>Our team will contact you if your application advances to the next stage.</p><p className={s.helper}>Confirmation email status: {received.emailStatus}. Delivery is not guaranteed by submission.</p><button className={s.primary} onClick={() => nav.navigate({ view: 'jobs' })}>Explore opportunities<CareerIcon name="arrow"/></button></section>}
    {!form && <PublicFooter/>}
  </main>;
}
