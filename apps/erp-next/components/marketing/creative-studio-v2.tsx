'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  loadMarketingData,
  requestMarketingCampaignStrategy,
  type MarketingCampaign,
  type MarketingUploadSession,
} from '@/lib/firebase/marketing';
import {
  approveMarketingCreative,
  listMarketingCreatives,
  requestMarketingCreativeBuild,
  type MarketingCreative,
} from '@/lib/firebase/marketing-creative';
import styles from './creative-studio.module.css';

type View = 'studio' | 'approved';
type MarketingData = Awaited<ReturnType<typeof loadMarketingData>>;

type CreativeProgress = {
  stage: string;
  percent: number;
  label: string;
  updatedAt?: string;
  currentVariant?: string;
};

type SessionV2 = MarketingUploadSession & {
  creativeProgress?: CreativeProgress;
  creativeStatus?: string;
  creativeError?: string;
};

type QaV2 = MarketingCreative['qa'] & {
  selectionScore?: number;
  creativeQuality?: number;
  scrollStoppingPower?: number;
  agencyFeel?: number;
  photoIntegration?: number;
  ctaProminence?: number;
  visualSophistication?: number;
};

type CreativeVariant = {
  id: string;
  conceptId: string;
  name: string;
  rationale: string;
  imageStoragePath: string;
  imageUrl: string;
  imageModel: string;
  selectionScore: number;
  revised?: boolean;
  qa: QaV2;
  layout?: {
    headlineZone?: string;
    ctaZone?: string;
    textPanelStyle?: string;
    textAlign?: string;
    accentStyle?: string;
    photoFocus?: string;
  };
};

type CreativeV2 = MarketingCreative & {
  builderVersion?: string;
  artDirectorModel?: string;
  qaModel?: string;
  selectedVariantId?: string;
  variantCount?: number;
  autoRevised?: boolean;
  variants?: CreativeVariant[];
  artDirection?: {
    campaignSummary?: string;
    creativeNorthStar?: string;
  };
  qa: QaV2;
};

const EMPTY_DATA: MarketingData = {
  sessions: [],
  assets: [],
  campaigns: [],
  brand: {
    id: 'default',
    companyName: '',
    brandName: '',
    whatsapp: '',
    primaryContact: '',
    primaryColor: '',
    secondaryColor: '',
    style: '',
    language: '',
    defaultFormat: '',
    footerRule: '',
    realPhotoRule: '',
    approvedClaims: [],
    approvedProducts: [],
    approvedOffers: [],
    approvedPapiamentoPhrases: [],
    campaignNotes: [],
  },
  brandIsLive: false,
};

function statusLabel(status: string) {
  if (status === 'approved') return 'APPROVED';
  if (status === 'qa_passed') return 'QA PASSED';
  if (status === 'qa_failed') return 'QA FAILED';
  if (status === 'needs_review') return 'REVIEW';
  return status.replaceAll('_', ' ').toUpperCase();
}

function statusClass(status: string) {
  if (status === 'approved' || status === 'qa_passed' || status === 'passed') return styles.goodPill;
  if (status === 'qa_failed' || status === 'failed') return styles.badPill;
  return styles.warnPill;
}

function friendlyDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function metric(label: string, value?: number) {
  const score = Number(value) || 0;
  return <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 42px', gap: 10, alignItems: 'center', marginBottom: 9 }}>
    <span style={{ fontSize: 12, color: '#66758b' }}>{label}</span>
    <div style={{ height: 7, borderRadius: 999, background: '#e7edf5', overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: '100%', background: score >= 85 ? '#1769e0' : score >= 75 ? '#e8a317' : '#d94c4c' }} /></div>
    <strong style={{ fontSize: 12 }}>{score}</strong>
  </div>;
}

function ProgressPanel({ progress }: { progress?: CreativeProgress }) {
  const percent = Math.max(3, Math.min(100, Number(progress?.percent) || 5));
  const steps = [
    ['art_direction', 'Art direction'],
    ['premium_clean', 'Premium'],
    ['sales_impact', 'Impact'],
    ['social_proof', 'Social proof'],
    ['compare', 'QA + selection'],
  ];
  const stage = progress?.stage || 'prepare';
  return <section className={styles.panel} style={{ border: '1px solid #b7d5ff', background: '#f8fbff' }}>
    <header><span>CREATIVE BUILD PROGRESS</span><h2>{progress?.label || 'Starting Creative Builder V2…'}</h2></header>
    <div style={{ height: 12, borderRadius: 999, background: '#dfe9f7', overflow: 'hidden', margin: '16px 0 12px' }}>
      <div style={{ width: `${percent}%`, height: '100%', background: 'linear-gradient(90deg,#1769e0,#4ba4ff)', transition: 'width .4s ease' }} />
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      {steps.map(([key, label]) => {
        const active = stage.includes(key) || (key === 'compare' && ['compare', 'auto_revision', 'finalize', 'completed'].some((item) => stage.includes(item)));
        return <span key={key} style={{ padding: '7px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: active ? '#dcecff' : '#eef2f7', color: active ? '#0d58c7' : '#7b8798' }}>{active ? '● ' : ''}{label}</span>;
      })}
    </div>
    <p style={{ margin: '12px 0 0', color: '#68778d', fontSize: 12 }}>Do not refresh while image variants are being generated. The page is polling live progress from Firebase.</p>
  </section>;
}

export function CreativeStudioV2({ initialView = 'studio' }: { initialView?: View }) {
  const { principal } = useAuth();
  const allowed = principal.role === 'super_admin' || principal.role === 'office_operator';
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<MarketingData>(EMPTY_DATA);
  const [creatives, setCreatives] = useState<CreativeV2[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<'build' | 'approve' | 'strategy' | ''>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!allowed) return;
    try {
      setError('');
      const [marketing, creativeState] = await Promise.all([loadMarketingData(), listMarketingCreatives()]);
      setData(marketing);
      setCreatives(creativeState.creatives as CreativeV2[]);
      setSelectedSessionId((current) => {
        if (current && marketing.campaigns.some((campaign) => campaign.sessionId === current)) return current;
        return marketing.campaigns[0]?.sessionId || '';
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Creative Studio.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (working !== 'build' || !selectedSessionId) return;
    const timer = window.setInterval(() => {
      void loadMarketingData().then((marketing) => setData(marketing)).catch(() => undefined);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [working, selectedSessionId]);

  const sessions = data.sessions as SessionV2[];
  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId), [sessions, selectedSessionId]);
  const selectedCampaign = useMemo(() => data.campaigns.find((campaign) => campaign.sessionId === selectedSessionId), [data.campaigns, selectedSessionId]);
  const selectedHero = useMemo(() => data.assets.find((asset) => asset.id === selectedCampaign?.heroAssetId), [data.assets, selectedCampaign]);
  const selectedCreatives = useMemo(() => creatives.filter((creative) => creative.sessionId === selectedSessionId).sort((a, b) => b.version - a.version), [creatives, selectedSessionId]);
  const latestCreative = selectedCreatives[0];
  const approved = useMemo(() => creatives.filter((creative) => creative.status === 'approved').sort((a, b) => Date.parse(b.approvedAt || b.updatedAt) - Date.parse(a.approvedAt || a.updatedAt)), [creatives]);

  if (!allowed) return <section className={styles.locked}><strong>Marketing access restricted</strong><p>Creative Studio is available only to DEMAC Super Admin and Office Operator accounts.</p></section>;

  const build = async () => {
    if (!selectedSessionId || working) return;
    setWorking('build');
    setError('');
    setNotice('');
    try {
      await requestMarketingCreativeBuild(selectedSessionId);
      await refresh();
      setNotice('Creative Builder V2 completed. Review the selected winner and all generated variants below.');
    } catch (buildError) {
      await refresh().catch(() => undefined);
      setError(buildError instanceof Error ? buildError.message : 'Creative build failed.');
    } finally {
      setWorking('');
    }
  };

  const approve = async (creative: CreativeV2) => {
    if (working) return;
    setWorking('approve');
    setError('');
    setNotice('');
    try {
      await approveMarketingCreative(creative.id);
      await refresh();
      setNotice('Creative approved and copied to Approved Creatives.');
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : 'Creative approval failed.');
    } finally {
      setWorking('');
    }
  };

  const regenerateStrategy = async () => {
    if (!selectedSessionId || working) return;
    setWorking('strategy');
    setError('');
    setNotice('');
    try {
      await requestMarketingCampaignStrategy(selectedSessionId);
      await refresh();
      setNotice('Campaign copy regenerated. Review Papiamento status before rendering.');
    } catch (strategyError) {
      setError(strategyError instanceof Error ? strategyError.message : 'Campaign strategy regeneration failed.');
    } finally {
      setWorking('');
    }
  };

  return <div className={styles.workspace}>
    <section className={styles.hero}>
      <div><div className={styles.eyebrow}>DEMAC MARKETING AGENT · CREATIVE V2</div><h1>{view === 'approved' ? 'Approved Creatives' : 'Creative Studio V2'}</h1><p>{view === 'approved' ? 'QA-passed advertising creatives approved for export and publishing.' : 'GPT-5.6 Sol Art Director → 3 GPT Image 2 concepts → exact text → agency QA → winner selection.'}</p></div>
      <div className={styles.heroActions}><button type="button" className={view === 'studio' ? styles.activeView : ''} onClick={() => setView('studio')}>Creative Studio</button><button type="button" className={view === 'approved' ? styles.activeView : ''} onClick={() => setView('approved')}>Approved ({approved.length})</button><Link href="/marketing">Marketing Center</Link></div>
    </section>

    <section className={styles.metrics}>
      <article><span>Campaigns Ready</span><strong>{data.campaigns.length}</strong><small>Strategy records</small></article>
      <article><span>Creative Builds</span><strong>{creatives.length}</strong><small>V1 + V2 preserved</small></article>
      <article><span>QA Passed</span><strong>{creatives.filter((creative) => creative.qa?.status === 'passed').length}</strong><small>Strict agency QA</small></article>
      <article><span>Approved</span><strong>{approved.length}</strong><small>Final library</small></article>
    </section>

    {error ? <div className={styles.error}>{error}<button type="button" onClick={() => setError('')}>×</button></div> : null}
    {notice ? <div className={styles.notice}>{notice}<button type="button" onClick={() => setNotice('')}>×</button></div> : null}
    {loading ? <div className={styles.loading}>Loading Creative Studio…</div> : null}
    {!loading && view === 'approved' ? <ApprovedGallery creatives={approved} /> : null}
    {!loading && view === 'studio' ? <StudioView
      data={data}
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      setSelectedSessionId={setSelectedSessionId}
      selectedSession={selectedSession}
      selectedCampaign={selectedCampaign}
      selectedHeroUrl={selectedHero?.thumbnailUrl || selectedHero?.downloadUrl}
      selectedCreatives={selectedCreatives}
      latestCreative={latestCreative}
      working={working}
      onBuild={() => void build()}
      onApprove={(creative) => void approve(creative)}
      onRegenerateStrategy={() => void regenerateStrategy()}
    /> : null}
  </div>;
}

function StudioView({ data, sessions, selectedSessionId, setSelectedSessionId, selectedSession, selectedCampaign, selectedHeroUrl, selectedCreatives, latestCreative, working, onBuild, onApprove, onRegenerateStrategy }: {
  data: MarketingData;
  sessions: SessionV2[];
  selectedSessionId: string;
  setSelectedSessionId: (value: string) => void;
  selectedSession?: SessionV2;
  selectedCampaign?: MarketingCampaign;
  selectedHeroUrl?: string;
  selectedCreatives: CreativeV2[];
  latestCreative?: CreativeV2;
  working: string;
  onBuild: () => void;
  onApprove: (creative: CreativeV2) => void;
  onRegenerateStrategy: () => void;
}) {
  const campaignSessions = sessions.filter((session) => data.campaigns.some((campaign) => campaign.sessionId === session.id));
  const languagePassed = selectedCampaign?.papiamentoValidationStatus === 'passed';
  const ready = Boolean(selectedCampaign && data.brandIsLive && languagePassed);
  return <div className={styles.stack}>
    <section className={styles.controlPanel}>
      <div><span>CAMPAIGN INPUT</span><h2>Select campaign</h2><p>V2 creates three distinct premium concepts and selects the strongest one after strict agency QA.</p></div>
      <label><span>Campaign / upload session</span><select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>{!campaignSessions.length ? <option value="">No generated campaigns</option> : null}{campaignSessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>
      <button type="button" className={styles.primaryButton} disabled={!ready || Boolean(working)} onClick={onBuild}>{working === 'build' ? `${selectedSession?.creativeProgress?.percent || 5}% · Building…` : latestCreative ? 'Generate 3 New Concepts' : 'Build 3 Creative Concepts'}</button>
    </section>

    {working === 'build' ? <ProgressPanel progress={selectedSession?.creativeProgress} /> : null}
    {!data.brandIsLive ? <div className={styles.blocker}><strong>Brand Center must be LIVE before rendering.</strong><span>Open Marketing Center → Brand Center and save the approved facts.</span><Link href="/marketing">Open Marketing Center</Link></div> : null}
    {selectedCampaign && !languagePassed ? <div className={styles.blocker}><strong>Papiamento copy has not passed validation.</strong><span>Unknown / review words: {selectedCampaign.papiamentoUnknownWords?.join(', ') || 'language review required'}.</span><button type="button" onClick={onRegenerateStrategy} disabled={Boolean(working)}>{working === 'strategy' ? 'Regenerating…' : 'Regenerate Campaign Copy'}</button></div> : null}
    {!selectedCampaign ? <section className={styles.emptyState}><strong>No campaign strategy yet</strong><p>Go to Marketing Center → Media Library, analyze a photo session, then generate Campaign Strategy.</p><Link href="/marketing">Open Marketing Center</Link></section> : null}

    {selectedCampaign ? <section className={styles.inputGrid}>
      <article className={styles.panel}><header><span>STRATEGY</span><h2>{selectedSession?.name || 'Campaign'}</h2></header><div className={styles.strategyGrid}><div><span>Campaign type</span><strong>{selectedCampaign.campaignType.replaceAll('_', ' ')}</strong></div><div><span>Papiamento</span><strong className={languagePassed ? styles.goodText : styles.warnText}>{selectedCampaign.papiamentoValidationStatus}</strong></div><div><span>Objective</span><p>{selectedCampaign.objective}</p></div><div><span>Angle</span><p>{selectedCampaign.angle}</p></div></div><div className={styles.copyPreview}><span>EXACT COPY INPUT</span><h3>{selectedCampaign.copy.headline}</h3><strong>{selectedCampaign.copy.subheadline}</strong><p>{selectedCampaign.copy.primaryText}</p><b>{selectedCampaign.copy.cta}</b></div></article>
      <article className={styles.panel}><header><span>HERO PHOTO</span><h2>AI-selected source image</h2></header>{selectedHeroUrl ? <img className={styles.heroPhoto} src={selectedHeroUrl} alt="Campaign hero source" /> : <div className={styles.noImage}>Hero image unavailable</div>}<small className={styles.muted}>The original real photo remains preserved. V2 edits derivatives only.</small></article>
    </section> : null}

    {latestCreative && working !== 'build' ? <CreativeReview creative={latestCreative} working={working} onApprove={onApprove} /> : selectedCampaign && working !== 'build' ? <section className={styles.emptyState}><strong>Ready for Creative Builder V2</strong><p>The next build creates Premium, High Impact and Social Proof concepts with GPT Image 2, then selects the strongest one.</p></section> : null}

    {selectedCreatives.length > 1 ? <section className={styles.panel}><header><span>BUILD HISTORY</span><h2>{selectedCreatives.length} preserved versions</h2></header><div className={styles.versionGrid}>{selectedCreatives.map((creative) => <article key={creative.id}><img src={creative.approvedUrl || creative.imageUrl} alt={`Creative version ${creative.version}`} /><div><strong>Version {creative.version} {creative.builderVersion === 'V2' ? '· V2' : '· V1'}</strong><span className={statusClass(creative.status)}>{statusLabel(creative.status)}</span></div><small>QA {creative.qa?.score || 0}/100 · {creative.imageModel || creative.renderMode}</small></article>)}</div></section> : null}
  </div>;
}

function CreativeReview({ creative, working, onApprove }: { creative: CreativeV2; working: string; onApprove: (creative: CreativeV2) => void }) {
  const qaPassed = creative.qa?.status === 'passed';
  const approved = creative.status === 'approved';
  const variants = creative.variants || [];
  return <div className={styles.stack}>
    {variants.length ? <section className={styles.panel}><header><span>CREATIVE CONCEPTS</span><h2>{variants.length} generated variants · AI winner selected</h2></header><p style={{ marginTop: 0, color: '#66758b' }}>{creative.artDirection?.creativeNorthStar || 'Three materially distinct agency concepts generated from the same real DEMAC photo.'}</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 16 }}>{variants.map((variant) => {
      const selected = variant.id === creative.selectedVariantId;
      return <article key={variant.id} style={{ border: selected ? '2px solid #1769e0' : '1px solid #dce3ec', borderRadius: 16, padding: 10, background: selected ? '#f6faff' : '#fff' }}><div style={{ position: 'relative' }}><img src={variant.imageUrl} alt={variant.name} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 12 }} />{selected ? <b style={{ position: 'absolute', top: 10, left: 10, padding: '6px 9px', borderRadius: 999, background: '#1769e0', color: '#fff', fontSize: 10 }}>AI WINNER</b> : null}</div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 10 }}><strong>{variant.name}</strong><span className={statusClass(variant.qa.status)}>{variant.qa.status.toUpperCase()}</span></div><p style={{ fontSize: 12, color: '#66758b', minHeight: 48 }}>{variant.rationale}</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}><span>Selection {variant.selectionScore}</span><span>Creative {variant.qa.creativeQuality || 0}</span><span>Agency {variant.qa.agencyFeel || 0}</span><span>Scroll {variant.qa.scrollStoppingPower || 0}</span></div></article>;
    })}</div></section> : null}

    <section className={styles.reviewGrid}>
      <article className={styles.creativePanel}><header><div><span>SELECTED CREATIVE</span><h2>Version {creative.version} · {creative.builderVersion || 'V1'}</h2></div><b className={statusClass(creative.status)}>{statusLabel(creative.status)}</b></header><div className={styles.imageFrame}><img src={creative.approvedUrl || creative.imageUrl} alt={`DEMAC creative version ${creative.version}`} /></div><div className={styles.renderMeta}><span>{creative.width}×{creative.height}</span><span>{creative.builderVersion === 'V2' ? '3-concept AI Art Director' : creative.renderTemplate.replaceAll('_', ' ')}</span><span>{creative.imageModel || creative.renderMode}</span><span>Footer Reserve {creative.reservedFooterPx}px</span></div>{qaPassed && !approved ? <button type="button" className={styles.primaryButton} disabled={Boolean(working)} onClick={() => onApprove(creative)}>{working === 'approve' ? 'Approving…' : 'Approve Creative'}</button> : null}{approved ? <a href={creative.approvedUrl || creative.imageUrl} target="_blank" rel="noreferrer" className={styles.primaryButton}>Open Approved PNG</a> : null}<div className={styles.copyPreview}><span>SOCIAL CAPTION</span><p>{creative.captionText}</p></div></article>

      <article className={styles.panel}><header><span>STRICT VISUAL QA V2</span><h2>{creative.qa?.score || 0}/100 <b className={statusClass(creative.qa?.status || 'needs_review')}>{(creative.qa?.status || 'review').toUpperCase()}</b></h2></header>{metric('Creative Quality', creative.qa?.creativeQuality)}{metric('Agency Feel', creative.qa?.agencyFeel)}{metric('Scroll-stopping', creative.qa?.scrollStoppingPower)}{metric('Photo Integration', creative.qa?.photoIntegration)}{metric('Visual Sophistication', creative.qa?.visualSophistication)}{metric('CTA Prominence', creative.qa?.ctaProminence)}{metric('Mobile Legibility', creative.qa?.mobileLegibility)}{metric('Professionalism', creative.qa?.professionalism)}{metric('Footer Clearance', creative.qa?.footerClearance)}<div style={{ marginTop: 16 }}><strong style={{ fontSize: 12 }}>QA ISSUES</strong>{creative.qa?.issues?.length ? <ul>{creative.qa.issues.map((issue) => <li key={issue} style={{ margin: '7px 0', fontSize: 12, color: '#66758b' }}>{issue}</li>)}</ul> : <p style={{ fontSize: 12, color: '#26744c' }}>No blocking creative issues detected.</p>}</div>{creative.qa?.status !== 'passed' ? <p style={{ padding: 12, borderRadius: 10, background: '#fff4dd', color: '#7b5310', fontSize: 12 }}><strong>Not eligible for approval.</strong> Generate new concepts so V2 can use this QA feedback.</p> : null}<small className={styles.muted}>Art Director: {creative.artDirectorModel || 'legacy'} · Image: {creative.imageModel || 'legacy'} · QA: {creative.qaModel || creative.qa?.source}</small></article>
    </section>
  </div>;
}

function ApprovedGallery({ creatives }: { creatives: CreativeV2[] }) {
  if (!creatives.length) return <section className={styles.emptyState}><strong>No approved creatives yet</strong><p>Approve a strict-QA-passed creative from Creative Studio V2 and it will appear here.</p></section>;
  return <section className={styles.panel}><header><span>APPROVED LIBRARY</span><h2>{creatives.length} final creatives</h2></header><div className={styles.versionGrid}>{creatives.map((creative) => <article key={creative.id}><img src={creative.approvedUrl || creative.imageUrl} alt={`Approved creative ${creative.version}`} /><div><strong>{creative.builderVersion || 'V1'} · Version {creative.version}</strong><span className={styles.goodPill}>APPROVED</span></div><small>QA {creative.qa?.score || 0}/100 · {friendlyDate(creative.approvedAt)}</small><a href={creative.approvedUrl || creative.imageUrl} target="_blank" rel="noreferrer">Open PNG</a></article>)}</div></section>;
}
