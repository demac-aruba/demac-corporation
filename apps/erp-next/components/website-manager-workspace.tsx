'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { PublicHeroSlider } from '@/components/public/public-hero-slider';
import { loadWebsiteDraft, loadWebsitePublishedForManager, publishWebsiteContent, saveWebsiteDraft } from '@/lib/firebase/website-content';
import { uploadPublicWebsiteImage } from '@/lib/firebase/storage-rest';
import {
  cloneWebsiteContent,
  defaultPublicWebsiteContent,
  WEBSITE_DRAFT_ID,
  type PublicWebsiteContent,
  type WebsiteHeroSlide,
} from '@/lib/public-website-content';

type StudioTab = 'hero' | 'contact';
type PreviewDevice = 'desktop' | 'mobile';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function newSlide(index: number): WebsiteHeroSlide {
  return {
    id: `hero-${Date.now()}`,
    name: `Banner ${index + 1}`,
    enabled: true,
    imageUrl: '/website/hero/hero-residential.webp',
    eyebrow: 'Premium air conditioning solutions',
    title: 'Professional Cooling Solutions in',
    accent: 'Aruba.',
    description: 'Add the message you want customers to see on this banner.',
    primaryCta: { label: 'Request Estimate', href: '/contact?request=estimate' },
    secondaryCta: { label: 'WhatsApp Us', href: '/contact?channel=whatsapp' },
    desktopPosition: 'center right',
    mobilePosition: '64% center',
  };
}

function formatDate(value?: string) {
  if (!value) return 'Not published yet';
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone: 'America/Aruba',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function WebsiteManagerWorkspace() {
  const { principal } = useAuth();
  const canManage = principal.role === 'super_admin';
  const [draft, setDraft] = useState<PublicWebsiteContent>(() => cloneWebsiteContent(defaultPublicWebsiteContent, WEBSITE_DRAFT_ID));
  const [published, setPublished] = useState<PublicWebsiteContent | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState(defaultPublicWebsiteContent.hero.slides[0]?.id ?? '');
  const [tab, setTab] = useState<StudioTab>('hero');
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [nextDraft, nextPublished] = await Promise.all([loadWebsiteDraft(), loadWebsitePublishedForManager()]);
        if (cancelled) return;
        setDraft(nextDraft);
        setPublished(nextPublished);
        setSelectedSlideId(nextDraft.hero.slides[0]?.id ?? '');
      } catch (loadError) {
        if (!cancelled) {
          setError(`Cloud content is not available yet. The studio is showing the bundled website defaults. ${errorText(loadError)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (canManage) void load(); else setLoading(false);
    return () => { cancelled = true; };
  }, [canManage]);

  const selectedIndex = useMemo(() => Math.max(0, draft.hero.slides.findIndex((slide) => slide.id === selectedSlideId)), [draft.hero.slides, selectedSlideId]);
  const selectedSlide = draft.hero.slides[selectedIndex];

  function patchDraft(patch: Partial<PublicWebsiteContent>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function patchHero(patch: Partial<PublicWebsiteContent['hero']>) {
    setDraft((current) => ({ ...current, hero: { ...current.hero, ...patch } }));
  }

  function patchSlide(patch: Partial<WebsiteHeroSlide>) {
    if (!selectedSlide) return;
    setDraft((current) => ({
      ...current,
      hero: {
        ...current.hero,
        slides: current.hero.slides.map((slide) => slide.id === selectedSlide.id ? { ...slide, ...patch } : slide),
      },
    }));
  }

  function patchContact(patch: Partial<PublicWebsiteContent['contact']>) {
    setDraft((current) => ({ ...current, contact: { ...current.contact, ...patch } }));
  }

  function addSlide() {
    const slide = newSlide(draft.hero.slides.length);
    patchHero({ slides: [...draft.hero.slides, slide] });
    setSelectedSlideId(slide.id);
  }

  function removeSlide() {
    if (!selectedSlide || draft.hero.slides.length <= 1) return;
    const remaining = draft.hero.slides.filter((slide) => slide.id !== selectedSlide.id);
    patchHero({ slides: remaining });
    setSelectedSlideId(remaining[Math.max(0, selectedIndex - 1)]?.id ?? remaining[0]?.id ?? '');
  }

  function moveSlide(direction: number) {
    if (!selectedSlide) return;
    const target = selectedIndex + direction;
    if (target < 0 || target >= draft.hero.slides.length) return;
    const slides = [...draft.hero.slides];
    const [moved] = slides.splice(selectedIndex, 1);
    slides.splice(target, 0, moved);
    patchHero({ slides });
  }

  async function saveDraft() {
    if (!canManage) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveWebsiteDraft(draft, principal.userId);
      setDraft(saved);
      setMessage('Draft saved. The public website has not changed.');
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!canManage) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await publishWebsiteContent(draft, principal.userId);
      setDraft(result.draft);
      setPublished(result.published);
      setMessage('Published. The public site will load this version when public website Firebase rules are active.');
    } catch (publishError) {
      setError(errorText(publishError));
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(file?: File) {
    if (!file || !selectedSlide) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const uploaded = await uploadPublicWebsiteImage(file, 'hero');
      patchSlide({ imageUrl: uploaded.mediaUrl });
      setMessage('Image uploaded and assigned to this banner. Save Draft or Publish to keep the change.');
    } catch (uploadError) {
      setError(`Image upload could not complete. You can still paste an image URL. ${errorText(uploadError)}`);
    } finally {
      setUploading(false);
    }
  }

  if (!canManage) {
    return <div className="ps-stack"><section className="page-head"><div><div className="eyebrow">Website · Content</div><h1>Website Manager</h1><p>This workspace is restricted to the Owner / Super Admin.</p></div></section></div>;
  }

  return (
    <div className="ps-stack website-manager">
      <section className="page-head website-manager-head">
        <div>
          <div className="eyebrow">Customer Frontend · Content Studio</div>
          <h1>Website Manager</h1>
          <p>Edit customer-facing banners and global website information without changing source code. Draft first, review the preview, then publish.</p>
        </div>
        <div className="page-actions">
          <a className="btn" href="/" target="_blank" rel="noreferrer">Open Live Site ↗</a>
          <button className="btn" type="button" onClick={() => void saveDraft()} disabled={saving || loading}>{saving ? 'Saving…' : 'Save Draft'}</button>
          <button className="btn primary" type="button" onClick={() => void publish()} disabled={saving || loading}>Publish</button>
        </div>
      </section>

      <section className="website-manager-status">
        <article><span>Draft</span><strong>{loading ? 'Loading…' : `${draft.hero.slides.length} banner${draft.hero.slides.length === 1 ? '' : 's'}`}</strong><small>{draft.updatedAt ? `Saved ${formatDate(draft.updatedAt)}` : 'Bundled defaults'}</small></article>
        <article><span>Published</span><strong>Version {published?.version ?? '—'}</strong><small>{formatDate(published?.publishedAt)}</small></article>
        <article><span>Slider</span><strong>{Math.round(draft.hero.autoplayMs / 1000)} sec</strong><small>Automatic rotation</small></article>
        <article><span>Permissions</span><strong>Owner only</strong><small>Draft + Publish protected</small></article>
      </section>

      {message ? <div className="website-manager-notice is-good"><strong>{message}</strong></div> : null}
      {error ? <div className="website-manager-notice is-error"><strong>Website Manager:</strong> {error}</div> : null}

      <div className="website-manager-tabs" role="tablist" aria-label="Website Manager sections">
        <button type="button" className={tab === 'hero' ? 'is-active' : ''} onClick={() => setTab('hero')}>Hero Slider</button>
        <button type="button" className={tab === 'contact' ? 'is-active' : ''} onClick={() => setTab('contact')}>Global Information</button>
      </div>

      {tab === 'hero' ? (
        <div className="website-manager-grid">
          <section className="panel website-manager-editor">
            <header className="panel-head">
              <div><h2>Hero Slider</h2><span>Manage the banners customers see at the top of the homepage.</span></div>
              <button className="btn" type="button" onClick={addSlide}>+ Add Banner</button>
            </header>

            <div className="website-manager-slider-settings">
              <label><span>Automatic change</span><select value={draft.hero.autoplayMs} onChange={(event) => patchHero({ autoplayMs: Number(event.target.value) })}><option value={4000}>4 seconds</option><option value={5000}>5 seconds · Recommended</option><option value={6000}>6 seconds</option><option value={8000}>8 seconds</option></select></label>
              <label><span>Transition</span><select value={draft.hero.transitionMs} onChange={(event) => patchHero({ transitionMs: Number(event.target.value) })}><option value={450}>Fast</option><option value={700}>Smooth · Recommended</option><option value={1000}>Slow</option></select></label>
            </div>

            <div className="website-manager-slide-list">
              {draft.hero.slides.map((slide, index) => (
                <button type="button" className={slide.id === selectedSlideId ? 'is-active' : ''} onClick={() => setSelectedSlideId(slide.id)} key={slide.id}>
                  <span className="website-manager-slide-thumb" style={{ backgroundImage: `url(${slide.imageUrl})` }} />
                  <span><strong>{index + 1}. {slide.name}</strong><small>{slide.enabled ? 'Visible' : 'Hidden'} · {slide.eyebrow}</small></span>
                </button>
              ))}
            </div>

            {selectedSlide ? (
              <div className="website-manager-form">
                <div className="website-manager-form-actions">
                  <label className="website-manager-toggle"><input type="checkbox" checked={selectedSlide.enabled} onChange={(event) => patchSlide({ enabled: event.target.checked })} /><span>Banner enabled</span></label>
                  <div><button type="button" onClick={() => moveSlide(-1)} disabled={selectedIndex === 0}>↑ Move</button><button type="button" onClick={() => moveSlide(1)} disabled={selectedIndex === draft.hero.slides.length - 1}>↓ Move</button><button className="danger" type="button" onClick={removeSlide} disabled={draft.hero.slides.length <= 1}>Delete</button></div>
                </div>

                <div className="website-manager-fields two">
                  <label><span>Internal banner name</span><input value={selectedSlide.name} onChange={(event) => patchSlide({ name: event.target.value })} /></label>
                  <label><span>Eyebrow</span><input value={selectedSlide.eyebrow} onChange={(event) => patchSlide({ eyebrow: event.target.value })} /></label>
                </div>
                <label><span>Main headline</span><input value={selectedSlide.title} onChange={(event) => patchSlide({ title: event.target.value })} /></label>
                <label><span>Highlighted text</span><input value={selectedSlide.accent} onChange={(event) => patchSlide({ accent: event.target.value })} /></label>
                <label><span>Description</span><textarea rows={3} value={selectedSlide.description} onChange={(event) => patchSlide({ description: event.target.value })} /></label>

                <div className="website-manager-image-editor">
                  <div className="website-manager-image-preview" style={{ backgroundImage: `url(${selectedSlide.imageUrl})` }} />
                  <div>
                    <label><span>Banner image URL</span><input value={selectedSlide.imageUrl} onChange={(event) => patchSlide({ imageUrl: event.target.value })} /></label>
                    <label className="website-manager-upload"><span>{uploading ? 'Uploading…' : 'Upload replacement image'}</span><input type="file" accept="image/*" disabled={uploading} onChange={(event) => void uploadImage(event.target.files?.[0])} /></label>
                    <small>Recommended: wide 16:9 image, under 8 MB. Keep important visual content toward the right so the headline remains readable.</small>
                  </div>
                </div>

                <div className="website-manager-fields two">
                  <label><span>Desktop focal point</span><select value={selectedSlide.desktopPosition} onChange={(event) => patchSlide({ desktopPosition: event.target.value })}><option>center right</option><option>right center</option><option>center center</option><option>70% center</option><option>80% center</option></select></label>
                  <label><span>Mobile focal point</span><select value={selectedSlide.mobilePosition} onChange={(event) => patchSlide({ mobilePosition: event.target.value })}><option>64% center</option><option>70% center</option><option>75% center</option><option>center center</option><option>right center</option></select></label>
                </div>

                <div className="website-manager-fields two">
                  <label><span>Primary button label</span><input value={selectedSlide.primaryCta.label} onChange={(event) => patchSlide({ primaryCta: { ...selectedSlide.primaryCta, label: event.target.value } })} /></label>
                  <label><span>Primary button link</span><input value={selectedSlide.primaryCta.href} onChange={(event) => patchSlide({ primaryCta: { ...selectedSlide.primaryCta, href: event.target.value } })} /></label>
                  <label><span>Secondary button label</span><input value={selectedSlide.secondaryCta.label} onChange={(event) => patchSlide({ secondaryCta: { ...selectedSlide.secondaryCta, label: event.target.value } })} /></label>
                  <label><span>Secondary button link</span><input value={selectedSlide.secondaryCta.href} onChange={(event) => patchSlide({ secondaryCta: { ...selectedSlide.secondaryCta, href: event.target.value } })} /></label>
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel website-manager-preview-panel">
            <header className="panel-head">
              <div><h2>Draft Preview</h2><span>This preview uses the unsaved form values. Nothing here is public until Publish.</span></div>
              <div className="website-manager-device"><button type="button" className={device === 'desktop' ? 'is-active' : ''} onClick={() => setDevice('desktop')}>Desktop</button><button type="button" className={device === 'mobile' ? 'is-active' : ''} onClick={() => setDevice('mobile')}>Mobile</button></div>
            </header>
            <div className={`website-manager-preview-frame is-${device}`}><PublicHeroSlider previewContent={draft} compactPreview /></div>
          </section>
        </div>
      ) : (
        <section className="panel website-manager-global">
          <header className="panel-head"><div><h2>Global Website Information</h2><span>Central values used by customer-facing contact and footer experiences.</span></div></header>
          <div className="website-manager-fields two website-manager-global-fields">
            <label><span>Office address</span><input value={draft.contact.officeAddress} onChange={(event) => patchContact({ officeAddress: event.target.value })} /></label>
            <label><span>Phone</span><input placeholder="Leave blank until confirmed" value={draft.contact.phone ?? ''} onChange={(event) => patchContact({ phone: event.target.value || undefined })} /></label>
            <label><span>Email</span><input placeholder="Leave blank until confirmed" value={draft.contact.email ?? ''} onChange={(event) => patchContact({ email: event.target.value || undefined })} /></label>
            <label><span>WhatsApp URL</span><input placeholder="https://wa.me/..." value={draft.contact.whatsappUrl ?? ''} onChange={(event) => patchContact({ whatsappUrl: event.target.value || undefined })} /></label>
            <label><span>Weekday hours</span><input value={draft.contact.weekdayHours} onChange={(event) => patchContact({ weekdayHours: event.target.value })} /></label>
            <label><span>Saturday hours</span><input value={draft.contact.saturdayHours} onChange={(event) => patchContact({ saturdayHours: event.target.value })} /></label>
            <label><span>Facebook URL</span><input value={draft.contact.facebookUrl ?? ''} onChange={(event) => patchContact({ facebookUrl: event.target.value || undefined })} /></label>
            <label><span>Instagram URL</span><input value={draft.contact.instagramUrl ?? ''} onChange={(event) => patchContact({ instagramUrl: event.target.value || undefined })} /></label>
          </div>
          <div className="website-manager-roadmap"><strong>Content model ready for expansion</strong><p>Services, project galleries, reviews, navigation labels and page-level SEO can use this same Draft → Preview → Publish workflow as we continue building the customer frontend.</p></div>
        </section>
      )}
    </div>
  );
}
