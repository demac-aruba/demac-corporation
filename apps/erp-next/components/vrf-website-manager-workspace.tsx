'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { uploadPublicWebsiteImage } from '@/lib/firebase/storage-rest';
import {
  loadVrfWebsiteDraft,
  loadVrfWebsitePublishedForManager,
  publishVrfWebsiteContent,
  saveVrfWebsiteDraft,
} from '@/lib/firebase/vrf-website-content';
import {
  clonePublicVrfContent,
  defaultPublicVrfContent,
  VRF_DRAFT_ID,
  type PublicVrfContent,
  type VrfCard,
} from '@/lib/public-vrf-content';
import styles from './vrf-website-manager.module.css';

type Tab = 'hero' | 'content' | 'trust' | 'faq';

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

function formatDate(value?: string) {
  if (!value) return 'Not published yet';
  try { return new Intl.DateTimeFormat('en', { timeZone: 'America/Aruba', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return value; }
}

function CardEditor({ title, items, onChange }: { title: string; items: VrfCard[]; onChange: (items: VrfCard[]) => void }) {
  function patch(index: number, patch: Partial<VrfCard>) {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  return (
    <section className={styles.cardGroup}>
      <header><h3>{title}</h3><span>{items.length} items</span></header>
      <div className={styles.cardEditorGrid}>
        {items.map((item, index) => (
          <article key={item.id}>
            <label><span>Title</span><input value={item.title} onChange={(event) => patch(index, { title: event.target.value })} /></label>
            <label><span>Description</span><textarea rows={3} value={item.description} onChange={(event) => patch(index, { description: event.target.value })} /></label>
            {'detail' in item ? <label><span>Detail / ideal for</span><input value={item.detail ?? ''} onChange={(event) => patch(index, { detail: event.target.value })} /></label> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function VrfWebsiteManagerWorkspace() {
  const { principal } = useAuth();
  const canManage = principal.role === 'super_admin';
  const [draft, setDraft] = useState<PublicVrfContent>(() => clonePublicVrfContent(defaultPublicVrfContent, VRF_DRAFT_ID));
  const [published, setPublished] = useState<PublicVrfContent | null>(null);
  const [tab, setTab] = useState<Tab>('hero');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'hero' | 'trust' | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!canManage) { setLoading(false); return; }
      setLoading(true);
      try {
        const [nextDraft, nextPublished] = await Promise.all([loadVrfWebsiteDraft(), loadVrfWebsitePublishedForManager()]);
        if (!cancelled) { setDraft(nextDraft); setPublished(nextPublished); }
      } catch (loadError) {
        if (!cancelled) setError(errorText(loadError));
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [canManage]);

  function patch<K extends keyof PublicVrfContent>(key: K, value: PublicVrfContent[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveDraft() {
    if (!canManage) return;
    setSaving(true); setMessage(''); setError('');
    try { const saved = await saveVrfWebsiteDraft(draft, principal.userId); setDraft(saved); setMessage('VRF draft saved. The live website has not changed.'); }
    catch (saveError) { setError(errorText(saveError)); }
    finally { setSaving(false); }
  }

  async function publish() {
    if (!canManage) return;
    setSaving(true); setMessage(''); setError('');
    try {
      const result = await publishVrfWebsiteContent(draft, principal.userId);
      setDraft(result.draft); setPublished(result.published); setMessage('VRF page published successfully.');
    } catch (publishError) { setError(errorText(publishError)); }
    finally { setSaving(false); }
  }

  async function uploadImage(file: File | undefined, target: 'hero' | 'trust') {
    if (!file) return;
    setUploading(target); setMessage(''); setError('');
    try {
      const uploaded = await uploadPublicWebsiteImage(file, `vrf/${target}`);
      if (target === 'hero') setDraft((current) => ({ ...current, hero: { ...current.hero, imageUrl: uploaded.mediaUrl } }));
      else setDraft((current) => ({ ...current, trust: { ...current.trust, imageUrl: uploaded.mediaUrl } }));
      setMessage(`${target === 'hero' ? 'Hero' : 'Trust'} image assigned. Save Draft or Publish to keep the change.`);
    } catch (uploadError) { setError(errorText(uploadError)); }
    finally { setUploading(''); }
  }

  if (!canManage) return <section className="panel"><h2>VRF Website Manager</h2><p>This workspace is restricted to the Owner / Super Admin.</p></section>;

  return (
    <div className={`ps-stack ${styles.workspace}`}>
      <section className="page-head">
        <div><div className="eyebrow">Website Manager · VRF Systems</div><h1>VRF Page Manager</h1><p>Manage the approved VRF service-page copy and hero without changing source code. Draft, review, then publish.</p></div>
        <div className="page-actions"><a className="btn" href="/website-manager">← Website Manager</a><a className="btn" href="/services/vrf-systems" target="_blank" rel="noreferrer">Open VRF Page ↗</a><button className="btn" type="button" disabled={saving || loading} onClick={() => void saveDraft()}>{saving ? 'Saving…' : 'Save Draft'}</button><button className="btn primary" type="button" disabled={saving || loading} onClick={() => void publish()}>Publish VRF Page</button></div>
      </section>

      <section className={styles.statusGrid}>
        <article><span>Draft</span><strong>{loading ? 'Loading…' : `Version ${draft.version}`}</strong><small>{draft.updatedAt ? `Saved ${formatDate(draft.updatedAt)}` : 'Bundled approved defaults'}</small></article>
        <article><span>Published</span><strong>Version {published?.version ?? '—'}</strong><small>{formatDate(published?.publishedAt)}</small></article>
        <article><span>Route</span><strong>/services/vrf-systems</strong><small>Customer-facing VRF page</small></article>
        <article><span>Workflow</span><strong>Draft → Publish</strong><small>Independent from homepage slider</small></article>
      </section>

      {message ? <div className="website-manager-notice is-good"><strong>{message}</strong></div> : null}
      {error ? <div className="website-manager-notice is-error"><strong>VRF Website Manager:</strong> {error}</div> : null}

      <nav className={styles.tabs} aria-label="VRF Website Manager sections">
        {([['hero','Hero & CTA'],['content','Page Sections'],['trust','Trust & Final CTA'],['faq','FAQ']] as const).map(([value,label]) => <button key={value} type="button" className={tab === value ? styles.active : ''} onClick={() => setTab(value)}>{label}</button>)}
      </nav>

      {tab === 'hero' ? <div className={styles.editorGrid}>
        <section className="panel">
          <header className="panel-head"><div><h2>VRF Hero</h2><span>This is the first message customers see on the VRF page.</span></div></header>
          <div className={styles.fields}>
            <label><span>Eyebrow</span><input value={draft.hero.eyebrow} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, eyebrow: e.target.value } }))} /></label>
            <label><span>Main headline</span><textarea rows={2} value={draft.hero.title} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, title: e.target.value } }))} /></label>
            <label><span>Highlighted text</span><input value={draft.hero.accent} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, accent: e.target.value } }))} /></label>
            <label><span>Description</span><textarea rows={4} value={draft.hero.description} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, description: e.target.value } }))} /></label>
            <div className={styles.twoCols}><label><span>Primary button</span><input value={draft.hero.primaryCta.label} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, primaryCta: { ...c.hero.primaryCta, label: e.target.value } } }))} /></label><label><span>Primary link</span><input value={draft.hero.primaryCta.href} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, primaryCta: { ...c.hero.primaryCta, href: e.target.value } } }))} /></label></div>
            <div className={styles.twoCols}><label><span>Secondary button</span><input value={draft.hero.secondaryCta.label} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, secondaryCta: { ...c.hero.secondaryCta, label: e.target.value } } }))} /></label><label><span>Secondary link</span><input value={draft.hero.secondaryCta.href} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, secondaryCta: { ...c.hero.secondaryCta, href: e.target.value } } }))} /></label></div>
            <label><span>Hero image URL</span><input value={draft.hero.imageUrl} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, imageUrl: e.target.value } }))} /></label>
            <div className={styles.twoCols}><label className={styles.upload}><span>{uploading === 'hero' ? 'Uploading…' : 'Upload hero image'}</span><input type="file" accept="image/*" disabled={Boolean(uploading)} onChange={(e) => void uploadImage(e.target.files?.[0], 'hero')} /></label><label><span>Image focal point</span><select value={draft.hero.imagePosition} onChange={(e) => setDraft((c) => ({ ...c, hero: { ...c.hero, imagePosition: e.target.value } }))}><option>center center</option><option>center right</option><option>60% center</option><option>70% center</option><option>right center</option></select></label></div>
          </div>
        </section>
        <aside className={styles.preview} style={{ backgroundImage: `linear-gradient(90deg,rgba(247,252,255,.96),rgba(247,252,255,.62) 48%,rgba(1,39,85,.07)),url(${draft.hero.imageUrl})`, backgroundPosition: draft.hero.imagePosition }}><span>{draft.hero.eyebrow}</span><h2>{draft.hero.title} <b>{draft.hero.accent}</b></h2><p>{draft.hero.description}</p><div><button type="button">{draft.hero.secondaryCta.label}</button><button type="button">{draft.hero.primaryCta.label}</button></div></aside>
      </div> : null}

      {tab === 'content' ? <div className={styles.contentStack}>
        <section className="panel"><div className={styles.headingFields}><label><span>VRF solutions heading</span><input value={draft.solutionsHeading} onChange={(e) => patch('solutionsHeading', e.target.value)} /></label><label><span>VRF solutions intro</span><textarea rows={2} value={draft.solutionsIntro} onChange={(e) => patch('solutionsIntro', e.target.value)} /></label></div></section>
        <CardEditor title="Large / Modular / Mini VRF" items={draft.solutions} onChange={(items) => patch('solutions', items)} />
        <section className="panel"><div className={styles.twoCols}><label><span>Benefits heading</span><input value={draft.benefitsHeading} onChange={(e) => patch('benefitsHeading', e.target.value)} /></label><label><span>Indoor units heading</span><input value={draft.indoorHeading} onChange={(e) => patch('indoorHeading', e.target.value)} /></label><label><span>Indoor units intro</span><input value={draft.indoorIntro} onChange={(e) => patch('indoorIntro', e.target.value)} /></label><label><span>Applications heading</span><input value={draft.applicationsHeading} onChange={(e) => patch('applicationsHeading', e.target.value)} /></label></div></section>
        <CardEditor title="VRF Benefits" items={draft.benefits} onChange={(items) => patch('benefits', items)} />
        <CardEditor title="Indoor Unit Options" items={draft.indoorUnits} onChange={(items) => patch('indoorUnits', items)} />
        <CardEditor title="Where VRF Works Best" items={draft.applications} onChange={(items) => patch('applications', items)} />
        <section className="panel"><div className={styles.twoCols}><label><span>Process heading</span><input value={draft.processHeading} onChange={(e) => patch('processHeading', e.target.value)} /></label><label><span>Services heading</span><input value={draft.servicesHeading} onChange={(e) => patch('servicesHeading', e.target.value)} /></label></div></section>
        <CardEditor title="Project Process" items={draft.process} onChange={(items) => patch('process', items)} />
        <CardEditor title="Service Capabilities" items={draft.services} onChange={(items) => patch('services', items)} />
      </div> : null}

      {tab === 'trust' ? <div className={styles.editorGrid}>
        <section className="panel"><header className="panel-head"><div><h2>Trust Section</h2><span>Local expertise and after-sales value proposition.</span></div></header><div className={styles.fields}>
          <label><span>Eyebrow</span><input value={draft.trust.eyebrow} onChange={(e) => setDraft((c) => ({ ...c, trust: { ...c.trust, eyebrow: e.target.value } }))} /></label>
          <label><span>Title</span><input value={draft.trust.title} onChange={(e) => setDraft((c) => ({ ...c, trust: { ...c.trust, title: e.target.value } }))} /></label>
          <label><span>Description</span><textarea rows={4} value={draft.trust.description} onChange={(e) => setDraft((c) => ({ ...c, trust: { ...c.trust, description: e.target.value } }))} /></label>
          <label><span>Image URL</span><input value={draft.trust.imageUrl} onChange={(e) => setDraft((c) => ({ ...c, trust: { ...c.trust, imageUrl: e.target.value } }))} /></label>
          <label className={styles.upload}><span>{uploading === 'trust' ? 'Uploading…' : 'Upload trust image'}</span><input type="file" accept="image/*" disabled={Boolean(uploading)} onChange={(e) => void uploadImage(e.target.files?.[0], 'trust')} /></label>
          <div className={styles.bulletEditor}>{draft.trust.bullets.map((bullet, index) => <label key={index}><span>Benefit {index + 1}</span><input value={bullet} onChange={(e) => setDraft((c) => ({ ...c, trust: { ...c.trust, bullets: c.trust.bullets.map((item, itemIndex) => itemIndex === index ? e.target.value : item) } }))} /></label>)}</div>
        </div></section>
        <section className="panel"><header className="panel-head"><div><h2>Final CTA</h2><span>The last conversion block before the footer.</span></div></header><div className={styles.fields}>
          <label><span>Eyebrow</span><input value={draft.finalCta.eyebrow} onChange={(e) => setDraft((c) => ({ ...c, finalCta: { ...c.finalCta, eyebrow: e.target.value } }))} /></label>
          <label><span>Title</span><textarea rows={2} value={draft.finalCta.title} onChange={(e) => setDraft((c) => ({ ...c, finalCta: { ...c.finalCta, title: e.target.value } }))} /></label>
          <label><span>Description</span><textarea rows={3} value={draft.finalCta.description} onChange={(e) => setDraft((c) => ({ ...c, finalCta: { ...c.finalCta, description: e.target.value } }))} /></label>
          <div className={styles.twoCols}><label><span>Primary button</span><input value={draft.finalCta.primaryCta.label} onChange={(e) => setDraft((c) => ({ ...c, finalCta: { ...c.finalCta, primaryCta: { ...c.finalCta.primaryCta, label: e.target.value } } }))} /></label><label><span>Primary link</span><input value={draft.finalCta.primaryCta.href} onChange={(e) => setDraft((c) => ({ ...c, finalCta: { ...c.finalCta, primaryCta: { ...c.finalCta.primaryCta, href: e.target.value } } }))} /></label><label><span>Secondary button</span><input value={draft.finalCta.secondaryCta.label} onChange={(e) => setDraft((c) => ({ ...c, finalCta: { ...c.finalCta, secondaryCta: { ...c.finalCta.secondaryCta, label: e.target.value } } }))} /></label><label><span>Secondary link</span><input value={draft.finalCta.secondaryCta.href} onChange={(e) => setDraft((c) => ({ ...c, finalCta: { ...c.finalCta, secondaryCta: { ...c.finalCta.secondaryCta, href: e.target.value } } }))} /></label></div>
        </div></section>
      </div> : null}

      {tab === 'faq' ? <div className={styles.contentStack}><section className="panel"><label><span>FAQ heading</span><input value={draft.faqHeading} onChange={(e) => patch('faqHeading', e.target.value)} /></label></section><CardEditor title="VRF Frequently Asked Questions" items={draft.faq} onChange={(items) => patch('faq', items)} /></div> : null}
    </div>
  );
}
