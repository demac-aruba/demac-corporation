'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { loadFirebasePrincipal } from '@/lib/firebase/principal';
import { EDITOR_PROTOCOL, PAGE, SESSION_TTL_MS, applyChanges, values, isOwner, isEditorEnabled, isReviewBuild, sameMessage, type EditorialField, type EditorialChange } from '@/lib/website-editor/contract';
import { createEditorialRepository, PublicationRecoveryRequired, type EditorialRepository, type RevisionEntry } from '@/lib/website-editor/client';
import type { PublicVrfContent } from '@/lib/public-vrf-content';
import styles from './website-editor.module.css';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The operation did not complete.';
function delta(base: PublicVrfContent, next: PublicVrfContent): EditorialChange[] {
  const before = values(base); return Object.entries(values(next)).filter(([key, value]) => before[key] !== value).map(([key, value]) => ({ key, value }));
}
type DocumentState = { original: PublicVrfContent; saved: PublicVrfContent; working: PublicVrfContent; revision: number; savedAt: string; pendingPublicationId?: string; legacyDraftChanged?: boolean };

export default function WebsiteEditorWorkspace() {
  const { principal, mode, status } = useAuth();
  const [grant, setGrant] = useState<{ actorId: string; until: number } | null>(null);
  const [launchStatus, setLaunchStatus] = useState('Authorizing your editing tab…');
  const [path, setPath] = useState<string>(PAGE.route);
  const [documentState, setDocumentState] = useState<DocumentState | null>(null);
  const [renderedPublic, setRenderedPublic] = useState<PublicVrfContent | null>(null);
  const [fields, setFields] = useState<EditorialField[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(true);
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'phone'>('desktop');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [history, setHistory] = useState<RevisionEntry[] | null>(null);
  const [undo, setUndo] = useState<PublicVrfContent[]>([]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const channel = useRef('');
  const repo = useRef<EditorialRepository | null>(null);
  const current = useRef(documentState); current.current = documentState;
  const saving = useRef(false);
  const loading = useRef(false);
  const nonceRef = useRef('');
  const active = isEditorEnabled() && isOwner(principal, mode) && grant?.actorId === principal.userId && Date.now() < grant.until;
  const isVrf = /^\/services\/vrf-systems\/?$/.test(path);
  const review = isReviewBuild();
  const selected = documentState ? fields.find((item) => item.key === selectedKey) : undefined;
  const changes = useMemo(() => documentState ? delta(documentState.original, documentState.working) : [], [documentState]);
  const frameChanges = useMemo(() => documentState ? delta(renderedPublic || documentState.original, documentState.working) : [], [documentState, renderedPublic]);
  const unsaved = documentState ? delta(documentState.saved, documentState.working).length : 0;

  useEffect(() => {
    const nonce = window.location.hash.slice(1); nonceRef.current = nonce;
    if (!isEditorEnabled() || !/^[0-9a-f-]{36}$/.test(nonce) || !window.opener) { setLaunchStatus('Open Settings → Website Manager → Edit Front End to activate editing.'); return; }
    const source: Window = window.opener;
    function receive(event: MessageEvent) {
      if (event.source !== source || event.origin !== location.origin || event.data?.protocol !== EDITOR_PROTOCOL || event.data?.nonce !== nonce) return;
      if (event.data.type === 'launch-granted' && typeof event.data.actorId === 'string') {
        setGrant({ actorId: event.data.actorId, until: Date.now() + SESSION_TTL_MS });
        window.history.replaceState(null, '', '/website-editor/');
        // The editing grant is consumed, not persisted or copied into other tabs.
        try { window.opener = null; } catch { /* source binding still applies */ }
      }
      if (event.data.type === 'launch-denied') setLaunchStatus('Your account is not authorized to edit this website.');
    }
    window.addEventListener('message', receive);
    source.postMessage({ protocol: EDITOR_PROTOCOL, type: 'request-launch', nonce }, location.origin);
    const timeout = setTimeout(() => setLaunchStatus('Activation expired. Return to Settings and open a new editing tab.'), 60_000);
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
  }, []);

  useEffect(() => {
    if (!active || !grant) return;
    repo.current = createEditorialRepository(grant.actorId);
    const timer = setInterval(() => {
      if (Date.now() >= grant.until) { setGrant(null); setLaunchStatus('Editing session expired. Your live site was not changed. Return to Settings.'); }
      else void loadFirebasePrincipal().then((next) => { if (!next.active || next.role !== 'super_admin' || next.userId !== grant.actorId) setGrant(null); }).catch(() => { setGrant(null); setLaunchStatus('Session verification failed. Sign in from Settings again.'); });
    }, 60_000);
    return () => { clearInterval(timer); repo.current?.dispose(); repo.current = null; };
  }, [active, grant?.actorId]);

  useEffect(() => {
    if (!active) return;
    const revoke = () => { setGrant(null); setLaunchStatus('Editing ended because your DEMAC session was signed out.'); };
    window.addEventListener('demac-editor-revoke', revoke);
    let broadcast: BroadcastChannel | null = null;
    try { broadcast = new BroadcastChannel('demac-website-editor-session'); broadcast.onmessage = (event) => { if (event.data?.type === 'signed-out') revoke(); }; } catch { /* Periodic validation remains active. */ }
    return () => { window.removeEventListener('demac-editor-revoke', revoke); broadcast?.close(); };
  }, [active]);

  const post = useCallback((payload: Record<string, unknown>) => {
    if (frameRef.current?.contentWindow && channel.current) frameRef.current.contentWindow.postMessage({ protocol: EDITOR_PROTOCOL, channel: channel.current, ...payload }, location.origin);
  }, []);
  const initializeFrame = useCallback(() => {
    if (!active) return;
    if (!channel.current) channel.current = crypto.randomUUID();
    post({ type: 'initialize' });
  }, [active, post]);

  useEffect(() => {
    if (!active) return;
    function receive(event: MessageEvent) {
      const target = frameRef.current?.contentWindow;
      if (event.source !== target || event.origin !== location.origin || event.data?.protocol !== EDITOR_PROTOCOL) return;
      if (event.data.type === 'frame-ready') { initializeFrame(); return; }
      if (!sameMessage(event, target || null, channel.current)) return;
      if (event.data.type === 'route' && typeof event.data.pathname === 'string') { setPath(event.data.pathname); setSelectedKey(''); }
      if (event.data.type === 'page' && event.data.pageId === 'vrf' && event.data.content && Array.isArray(event.data.fields)) {
        setFields(event.data.fields); setRenderedPublic(event.data.content);
        if (current.current) { post({ type: 'state', pageId: 'vrf', changes: delta(event.data.content, current.current.working), editing }); return; }
        if (loading.current || !repo.current) return;
        loading.current = true;
        void repo.current.load(event.data.content).then((snapshot) => {
          setDocumentState({ original: snapshot.publishedContent || event.data.content, legacyDraftChanged: snapshot.legacyDraftChanged, saved: snapshot.content, working: snapshot.content, revision: snapshot.revision, savedAt: snapshot.savedAt, pendingPublicationId: snapshot.pendingPublicationId });
        }).catch((cause) => setError(message(cause))).finally(() => { loading.current = false; });
      }
      if (event.data.type === 'navigation-blocked') setNotice('Staff pages and external actions are outside this website editor. Exit editing to use them.');
      if (event.data.type === 'form-blocked') setNotice('Forms cannot be submitted from edit mode. Exit the editor to send a real request.');
      if (event.data.type === 'select' && typeof event.data.key === 'string') { setSelectedKey(event.data.key); setError(''); }
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [active, initializeFrame, post, editing]);

  useEffect(() => { if (active && documentState && isVrf) post({ type: 'state', pageId: 'vrf', changes: frameChanges, editing }); }, [active, documentState, isVrf, editing, post, frameChanges]);
  useEffect(() => { setInput(documentState && selectedKey ? values(documentState.working)[selectedKey] || '' : ''); }, [selectedKey, documentState?.working]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (unsaved) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  useEffect(() => {
    if (!reviewOpen && !history) return;
    const previous = window.document.activeElement as HTMLElement | null;
    const dialog = window.document.querySelector<HTMLElement>('[role="dialog"]');
    const focusables = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea, select') || [])];
    focusables()[0]?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) { setReviewOpen(false); setHistory(null); }
      if (event.key !== 'Tab') return;
      const nodes = focusables(), first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    window.document.addEventListener('keydown', keyboard);
    return () => { window.document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [reviewOpen, history, busy]);

  const save = useCallback(async () => {
    const state = current.current, repository = repo.current;
    if (!state || !repository || saving.current) return false;
    const pending = delta(state.saved, state.working); if (!pending.length) return true;
    saving.current = true; setBusy('Saving draft…'); setError('');
    try {
      const result = await repository.save(pending, state.revision);
      setDocumentState((latest) => latest ? { ...latest, original: result.publishedContent || latest.original, legacyDraftChanged: result.legacyDraftChanged, saved: result.content, revision: result.revision, savedAt: result.savedAt, pendingPublicationId: result.pendingPublicationId } : latest);
      setNotice(review ? 'Draft saved in this review tab. Your live site is unchanged.' : 'Draft saved in the cloud. Not published.');
      return true;
    } catch (cause) { setError(message(cause)); return false; }
    finally { saving.current = false; setBusy(''); }
  }, [review]);
  // Do not auto-retry failed writes indefinitely. A manual retry preserves the
  // same draft and visibly reports conflicts, offline state or permission errors.
  useEffect(() => {
    if (!active || !unsaved || busy || error || documentState?.pendingPublicationId || documentState?.legacyDraftChanged) return;
    const timer = setTimeout(() => void save(), 1400); return () => clearTimeout(timer);
  }, [active, unsaved, busy, error, save, documentState?.pendingPublicationId, documentState?.legacyDraftChanged]);

  function apply(key: string, value: string) {
    if (!documentState || documentState.pendingPublicationId) return;
    try {
      const next = applyChanges(documentState.working, [{ key, value }], { allowPreviewImages: review });
      setUndo((items) => [...items.slice(-39), documentState.working]);
      setDocumentState((state) => state ? { ...state, working: next } : state); setError(''); setNotice('');
    } catch (cause) { setError(message(cause)); }
  }
  async function applyImage(key: string, value: string) {
    if (busy) return;
    setBusy('Checking image…'); setError('');
    try {
      if (!documentState) return;
      applyChanges(documentState.working, [{ key, value }], { allowPreviewImages: review });
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(() => { image.src = ''; reject(new Error('This image did not load. Choose another file or URL.')); }, 12_000);
        image.onload = () => { clearTimeout(timer); image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error('This image has invalid dimensions.')); };
        image.onerror = () => { clearTimeout(timer); reject(new Error('This image cannot be opened. The previous image was retained.')); };
        image.src = value;
      });
      apply(key, value);
    } catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  }
  async function upload(file?: File) {
    if (!file || !selected || !repo.current) return;
    setBusy('Checking image…'); setError('');
    try { apply(selected.key, await repo.current.upload(file)); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(''); }
  }
  async function publish() {
    if (!documentState || !repo.current || busy || unsaved) return;
    setBusy(review ? 'Publishing review version…' : 'Publishing and verifying…'); setError('');
    try {
      const result = await repo.current.publish(documentState.revision, crypto.randomUUID());
      setDocumentState((state) => state ? { ...state, original: result.content, legacyDraftChanged: false, saved: result.content, working: result.content, revision: result.revision, savedAt: result.savedAt, pendingPublicationId: result.pendingPublicationId } : state);
      setReviewOpen(false); setNotice(review ? 'Review version published in this tab only. No production data was written.' : 'Published version verified.');
    } catch (cause) {
      if (cause instanceof PublicationRecoveryRequired) {
        setDocumentState((state) => state ? { ...state, pendingPublicationId: cause.requestId } : state);
      }
      setError(message(cause));
    } finally { setBusy(''); }
  }
  function exit() {
    if (unsaved && !window.confirm('Leave without saving the latest changes?')) return;
    post({ type: 'stop' }); repo.current?.dispose(); setGrant(null);
    location.replace(path.startsWith('/services/') ? path : '/');
  }
  function selectField(key: string) { setSelectedKey(key); post({ type: 'locate', key }); setError(''); }
  async function restore(entry: RevisionEntry) {
    if (!documentState || !repo.current || busy) return;
    if (unsaved && !window.confirm('Replace your unsaved changes with this revision?')) return;
    setBusy('Restoring draft…');
    try { const result = await repo.current.restore(entry.id, documentState.revision); setDocumentState((state) => state ? { ...state, original: result.publishedContent || state.original, legacyDraftChanged: result.legacyDraftChanged, working: result.content, saved: result.content, revision: result.revision, savedAt: result.savedAt, pendingPublicationId: result.pendingPublicationId } : state); setHistory(null); setNotice('Previous version restored to draft, not published.'); }
    catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  }

  async function reloadDraft(reset = false) {
    if (!repo.current || busy || (!documentState && !renderedPublic)) return;
    if (documentState && !window.confirm(reset ? 'Replace this editing draft with the current published content? Any older Website Manager draft is preserved and archived, not imported or deleted. No public content is changed.' : 'Reload the shared draft? Unsaved edits in this tab will be replaced.')) return;
    setBusy('Loading draft…'); setError('');
    try {
      const result = reset && documentState ? await repo.current.reset(documentState.revision) : await repo.current.load(documentState?.original || renderedPublic!);
      setDocumentState((state) => ({ original: result.publishedContent || (reset ? result.content : state?.original || renderedPublic!), legacyDraftChanged: result.legacyDraftChanged, working: result.content, saved: result.content, revision: result.revision, savedAt: result.savedAt, pendingPublicationId: result.pendingPublicationId }));
      setUndo([]); setNotice(reset ? 'Draft reset to published content. The public page was not changed.' : 'Shared draft reloaded.');
    } catch (cause) { setError(message(cause)); } finally { setBusy(''); }
  }

  if (!active) return <main className={styles.gate}><span className={styles.gateMark}>✎</span><h1>Website Content Editor</h1><p>{status === 'loading' ? 'Verifying your DEMAC session…' : launchStatus}</p><a href="/website-manager/">Return to Website Manager</a><p className={styles.muted}>Being signed in does not activate editing. This mode is opened explicitly from Settings.</p></main>;
  const fieldList = (documentState ? fields : []).filter((field) => `${field.label} ${field.group}`.toLowerCase().includes(search.toLowerCase()));
  return <main className={styles.workspace} data-website-editor-session>
    <header className={styles.toolbar}>
      <div className={styles.brand}><span>✎</span><div><strong>Edit Front End</strong><small>{isVrf ? 'VRF Systems' : path.startsWith('/careers') ? 'Careers · managed in Settings' : 'Page not yet connected'}</small></div><b className={styles.draftTag}>{review ? 'REVIEW' : 'DRAFT'}</b></div>
      <div className={styles.devices} aria-label="Preview width">{(['desktop','tablet','phone'] as const).map((size) => <button key={size} type="button" aria-pressed={device === size} onClick={() => setDevice(size)}>{size === 'desktop' ? 'Desktop' : size === 'tablet' ? 'Tablet' : 'Phone'}</button>)}</div>
      <div className={styles.tools}><span role="status" className={styles.saveState}>{busy || (unsaved ? 'Unsaved changes' : documentState?.savedAt ? review ? 'Saved in review tab' : 'Saved in cloud' : 'No changes')}</span><button type="button" disabled={!isVrf || !unsaved || Boolean(busy)} onClick={() => void save()}>Save Draft</button><button type="button" aria-pressed={!editing} onClick={() => setEditing((value) => !value)}>{editing ? 'Preview' : 'Back to edit'}</button><button type="button" className={styles.publish} disabled={!isVrf || (!changes.length && !documentState?.pendingPublicationId) || Boolean(documentState?.legacyDraftChanged) || Boolean(busy) || Boolean(unsaved)} onClick={() => setReviewOpen(true)}>{documentState?.pendingPublicationId ? 'Recover publication' : review ? 'Publish preview' : 'Publish page'}</button><button type="button" onClick={exit}>Exit</button></div>
    </header>
    <div className={styles.reviewRibbon}>{review ? 'Private review · Drafts, image uploads and publishing are isolated to this editing tab. The live website is unchanged.' : 'Editing a private draft · Changes are not public until you publish this page.'}</div>
    {!isVrf ? <div className={styles.readOnlyNotice}>This page is view-only here. {path.startsWith('/careers') ? 'Careers remains managed by its existing recruitment module.' : 'New commercial pages will connect to this editor after design approval.'}<button type="button" onClick={() => post({ type: 'navigate', href: PAGE.route })}>Return to VRF</button></div> : null}
    {documentState?.pendingPublicationId && isVrf ? <div className={styles.readOnlyNotice}>A previous publication needs verification. Recover it before editing more content.</div> : null}
    <div className={styles.canvas} data-device={device} inert={Boolean(reviewOpen || history)}>
      <iframe sandbox="allow-scripts allow-same-origin" ref={frameRef} src={PAGE.route} title="Actual DEMAC website editing canvas" onLoad={initializeFrame} className={styles.frame} />
    </div>
    {editing && isVrf ? <aside className={styles.panel} role="region" aria-label="Content editing panel">
      <header><div><small>EDITING CONTENT</small><h2>{selected?.label || 'Choose an element'}</h2></div>{selected ? <button type="button" aria-label="Close selected element" onClick={() => setSelectedKey('')}>×</button> : null}</header>
      <div className={styles.panelBody}>
      {documentState?.legacyDraftChanged ? <p role="alert">An older Website Manager tab changed its draft. Saving and publishing are paused. Use Reset draft to published to reconcile after review; the older draft remains preserved.</p> : null}
      {!documentState ? <p role="status">{error ? 'Draft loading failed. Use Reload shared draft to try again.' : 'Loading the draft. Editing starts only after it is available.'}</p> : null}
      {selected ? <>
        <div className={styles.contentOnly}>Content only · Layout and behavior are protected</div>
        {selected.kind === 'image' ? <>
          <div className={styles.imagePreview}><img src={input || values(documentState!.working)[selected.key]} alt="Selected image preview" /></div>
          <label className={styles.uploadButton}>Replace image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy) || Boolean(documentState?.pendingPublicationId)} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label>
          <small>JPEG, PNG or WebP · up to 8 MB. Images are checked before use.</small>
          <label>Image URL<input value={input} onChange={(event) => setInput(event.target.value)} maxLength={4096} /></label>
          {selected.key === 'hero.imageUrl' ? <><label>Desktop focal point<select value={values(documentState!.working)['hero.imagePosition']} onChange={(event) => apply('hero.imagePosition', event.target.value)}><option value="left center">Left</option><option value="center center">Center</option><option value="74% center">Right of center</option><option value="right center">Right</option></select></label><label>Phone focal point<select value={values(documentState!.working)['hero.mobileImagePosition']} onChange={(event) => apply('hero.mobileImagePosition', event.target.value)}><option value="left center">Left</option><option value="center center">Center</option><option value="74% center">Right of center</option><option value="right center">Right</option></select></label></> : null}
          <details className={styles.library}><summary>Reuse an image from this page</summary><div>{fields.filter((field) => field.kind === 'image').map((field) => <button type="button" key={field.key} onClick={() => void applyImage(selected.key, values(documentState!.working)[field.key])}><img src={values(documentState!.working)[field.key]} alt={field.label} /><span>{field.label}</span></button>)}</div></details>
        </> : <label>{selected.kind === 'position' ? 'Focal point' : 'Text'}<textarea rows={selected.max <= 240 ? 4 : 7} value={input} maxLength={selected.max} onChange={(event) => setInput(event.target.value)} /><small>{input.length} / {selected.max}</small></label>}
        <button type="button" className={styles.applyButton} disabled={Boolean(busy) || Boolean(documentState?.pendingPublicationId)} onClick={() => selected.kind === 'image' ? void applyImage(selected.key, input) : apply(selected.key, input)}>Apply to draft</button>
        <button type="button" className={styles.linkButton} disabled={!undo.length || Boolean(busy) || Boolean(documentState?.pendingPublicationId)} onClick={() => { const previous = undo[undo.length - 1]; if (previous) { setDocumentState((state) => state ? { ...state, working: previous } : state); setUndo((items) => items.slice(0, -1)); } }}>↶ Undo last edit</button>
      </> : <><p>Click a title, paragraph or image on the page. Navigation, tabs and accordions continue working normally.</p><label>Find content<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hero, Cassette, FAQ…" /></label><div className={styles.fieldList}>{fieldList.map((field) => <button type="button" key={field.key} onClick={() => selectField(field.key)}><span>{field.kind === 'image' ? '▧' : 'T'}</span><span><strong>{field.label}</strong><small>{field.group}</small></span><b>›</b></button>)}</div></>}
      <button className={styles.linkButton} type="button" disabled={Boolean(busy)} onClick={() => void reloadDraft()}>Reload shared draft</button>
      <button className={styles.linkButton} type="button" disabled={Boolean(busy) || Boolean(documentState?.pendingPublicationId)} onClick={() => void reloadDraft(true)}>Reset draft to published</button>
      <button className={styles.linkButton} type="button" disabled={Boolean(busy)} onClick={() => void repo.current?.history().then(setHistory).catch((cause) => setError(message(cause)))}>Version history</button>
      </div>
    </aside> : null}
    {(notice || error) ? <div className={styles.toast} role={error ? 'alert' : 'status'} data-error={Boolean(error)}>{error || notice}<button aria-label="Dismiss message" type="button" onClick={() => { setError(''); setNotice(''); }}>×</button></div> : null}
    {reviewOpen || history ? <div className={styles.modalShade}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={history ? 'Version history' : 'Review publication'}><button type="button" className={styles.closeModal} aria-label="Close dialog" onClick={() => { setReviewOpen(false); setHistory(null); }}>×</button>{history ? <><h2>Version history</h2><p>Restoring creates a draft. It does not publish automatically.</p>{!history.length ? <p>No previous published versions in this {review ? 'review tab' : 'page'} yet.</p> : history.map((entry) => <div className={styles.historyRow} key={entry.id}><span>{new Date(entry.savedAt).toLocaleString()}</span><button type="button" disabled={Boolean(busy)} onClick={() => void restore(entry)}>Restore to draft</button></div>)}</> : <><span className={styles.draftTag}>{review ? 'PRIVATE PREVIEW' : 'VRF PAGE ONLY'}</span><h2>Review your changes</h2><p>{review ? 'This publishes a review version only inside this tab. It does not update demac-aruba.com.' : 'Only VRF editorial content will be published. Other pages and ERP operations are not changed.'}</p><ul>{changes.map((change) => <li key={change.key}><strong>{fields.find((field) => field.key === change.key)?.label || change.key}</strong><small>{fields.find((field) => field.key === change.key)?.kind === 'image' ? 'Image replaced' : change.value.slice(0, 180)}</small></li>)}</ul><button type="button" className={styles.applyButton} disabled={Boolean(busy) || Boolean(unsaved)} onClick={() => void publish()}>{busy || (review ? 'Publish this preview version' : 'Publish VRF page')}</button></>}</section></div> : null}
  </main>;
}
