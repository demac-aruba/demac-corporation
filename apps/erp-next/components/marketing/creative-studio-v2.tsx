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

type SessionCreative = MarketingUploadSession & {
  creativeProgress?: CreativeProgress;
  creativeStatus?: string;
  creativeError?: string;
};

type CreativeRecord = MarketingCreative;

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
    <div style={{ height: 7, borderRadius: 999, background: '#e7edf5', overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: '100%', background: score >= 88 ? '#1769e0' : score >= 78 ? '#e8a317' : '#d94c4c' }} /></div>
    <strong style={{ fontSize: 12 }}>{score}</strong>
  </div>;
}

function ProgressPanel({ progress }: { progress?: CreativeProgress }) {
  const percent = Math.max(3, Math.min(100, Number(progress?.percent) || 5));
  const steps = [
    ['explore', '12 concepts'],
    ['shortlist', 'Shortlist 4'],
    ['render_shortlist', 'Render 4'],
    ['refine', 'Refine top 2'],
    ['jury', 'Final jury'],
    ['finalize', 'Finalize'],
  ];
  const stage = progress?.stage || 'prepare';
  return <section className={styles.panel} style={{ border: '1px solid #b7d5ff', background: '#f8fbff' }}>
    <header><span>CREATIVE ENGINE V3</span><h2>{progress?.label || 'Starting Design Intelligence pipeline…'}</h2></header>
    <div style={{ height: 12, borderRadius: 999, background: '#dfe9f7', overflow: 'hidden', margin: '16px 0 12px' }}>
      <div style={{ width: `${percent}%`, height: '100%', background: 'linear-gradient(90deg,#1769e0,#4ba4ff)', transition: 'width .4s ease' }} />
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      {steps.map(([key, label]) => {
        const active = stage.includes(key) || (key === 'finalize' && stage === 'completed');
        return <span key={key} style={{ padding: '7px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: active ? '#dcecff' : '#eef2f7', color: active ? '#0d58c7' : '#7b8798' }}>{active ? '● ' : ''}{label}</span>;
      })}
    </div>
    <p style={{ margin: '12px 0 0', color: '#68778d', fontSize: 12 }}>V3 explores broadly before rendering. Do not refresh while the page is polling live progress from Firebase.</p>
  </section>;
}

export function CreativeStudioV2({ initialView = 'studio' }: { initialView?: View }) {
  const { principal } = useAuth();
  const allowed = principal.role === 'super_admin' || principal.role === 'office_operator';
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<MarketingData>(EMPTY_DATA);
  const [creatives, setCreatives] = useState<CreativeRecord[]>([]);
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
      setCreatives(creativeState.creatives);
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

  const sessions = data.sessions as SessionCreative[];
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
      setNotice('Creative Engine V3 completed. Review the exploration, finalists, refined candidates, and selected winner below.');
    } catch (buildError) {
      await refresh().catch(() => undefined);
      setError(buildError instanceof Error ? buildError.message : 'Creative build failed.');
    } finally {
      setWorking('');
    }
  };

  const approve = async (creative: CreativeRecord) => {
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
      <div><div className={styles.eyebrow}>DEMAC MARKETING AGENT · DESIGN INTELLIGENCE V3</div><h1>{view === 'approved' ? 'Approved Creatives' : 'Creative Studio V3'}</h1><p>{view === 'approved' ? 'Paid-media benchmark creatives approved for export and publishing.' : '12 concepts → shortlist 4 → full AI designs → benchmark QA → refine top 2 → executive jury.'}</p></div>
      <div className={styles.heroActions}><button type="button" className={view === 'studio' ? styles.activeView : ''} onClick={() => setView('studio')}>Creative Studio</button><button type="button" className={view === 'approved' ? styles.activeView : ''} onClick={() => setView('approved')}>Approved ({approved.length})</button><Link href="/marketing">Marketing Center</Link></div>
    </section>

    <section className={styles.metrics}>
      <article><span>Campaigns Ready</span><strong>{data.campaigns.length}</strong><small>Strategy records</small></article>
      <article><span>Creative Builds</span><strong>{creatives.length}</strong><small>V1 → V3 preserved</small></article>
      <article><span>QA Passed</span><strong>{creatives.filter((creative) => creative.qa?.status === 'passed').length}</strong><small>Paid-media benchmark</small></article>
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
  sessions: SessionCreative[];
  selectedSessionId: string;
  setSelectedSessionId: (value: string) => void;
  selectedSession?: SessionCreative;
  selectedCampaign?: MarketingCampaign;
  selectedHeroUrl?: string;
  selectedCreatives: CreativeRecord[];
  latestCreative?: CreativeRecord;
  working: string;
  onBuild: () => void;
  onApprove: (creative: CreativeRecord) => void;
  onRegenerateStrategy: () => void;
}) {
  const campaignSessions = sessions.filter((session) => data.campaigns.some((campaign) => campaign.sessionId === session.id));
  const languagePassed = selectedCampaign?.papiamentoValidationStatus === 'passed';
  const ready = Boolean(selectedCampaign && data.brandIsLive && languagePassed);
  return <div className={styles.stack}>
    <section className={styles.controlPanel}>
      <div><span>CAMPAIGN INPUT</span><h2>Select campaign</h2><p>V3 explores twelve different creative territories before spending image-generation budget on four finalists.</p></div>
      <label><span>Campaign / upload session</span><select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>{!campaignSessions.length ? <option value="">No generated campaigns</option> : null}{campaignSessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>
      <button type="button" className={styles.primaryButton} disabled={!ready || Boolean(working)} onClick={onBuild}>{working === 'build' ? `${selectedSession?.creativeProgress?.percent || 5}% · Building V3…` : latestCreative ? 'Run New V3 Exploration' : 'Build V3 Creative Campaign'}</button>
    </section>

    {working === 'build' ? <ProgressPanel progress={selectedSession?.creativeProgress} /> : null}
    {!data.brandIsLive ? <div className={styles.blocker}><strong>Brand Center must be LIVE before rendering.</strong><span>Open Marketing Center → Brand Center and save the approved facts.</span><Link href="/marketing">Open Marketing Center</Link></div> : null}
    {selectedCampaign && !languagePassed ? <div className={styles.blocker}><strong>Papiamento copy has not passed validation.</strong><span>Unknown / review words: {selectedCampaign.papiamentoUnknownWords?.join(', ') || 'language review required'}.</span><button type="button" onClick={onRegenerateStrategy} disabled={Boolean(working)}>{working === 'strategy' ? 'Regenerating…' : 'Regenerate Campaign Copy'}</button></div> : null}
    {!selectedCampaign ? <section className={styles.emptyState}><strong>No campaign strategy yet</strong><p>Go to Marketing Center → Media Library, analyze a photo session, then generate Campaign Strategy.</p><Link href="/marketing">Open Marketing Center</Link></section> : null}

    {selectedCampaign ? <section className={styles.inputGrid}>
      <article className={styles.panel}><header><span>STRATEGY</span><h2>{selectedSession?.name || 'Campaign'}</h2></header><div className={styles.strategyGrid}><div><span>Campaign type</span><strong>{selectedCampaign.campaignType.replaceAll('_', ' ')}</strong></div><div><span>Papiamento</span><strong className={languagePassed ? styles.goodText : styles.warnText}>{selectedCampaign.papiamentoValidationStatus}</strong></div><div><span>Objective</span><p>{selectedCampaign.objective}</p></div><div><span>Angle</span><p>{selectedCampaign.angle}</p></div></div><div className={styles.copyPreview}><span>EXACT COPY INPUT</span><h3>{selectedCampaign.copy.headline}</h3><strong>{selectedCampaign.copy.subheadline}</strong><p>{selectedCampaign.copy.primaryText}</p><b>{selectedCampaign.copy.cta}</b></div></article>
      <article className={styles.panel}><header><span>HERO PHOTO</span><h2>AI-selected source image</h2></header>{selectedHeroUrl ? <img className={styles.heroPhoto} src={selectedHeroUrl} alt="Campaign hero source" /> : <div className={styles.noImage}>Hero image unavailable</div>}<small className={styles.muted}>The original real photo remains preserved. V3 creates derivatives only.</small></article>
    </section> : null}

    {latestCreative && working !== 'build' ? <CreativeReview creative={latestCreative} working={working} onApprove={onApprove} /> : selectedCampaign && working !== 'build' ? <section className={styles.emptyState}><strong>Ready for Creative Engine V3</strong><p>The next build explores 12 concepts, renders four complete designs, refines the top two and selects the strongest paid-media candidate.</p></section> : null}

    {selectedCreatives.length > 1 ? <section className={styles.panel}><header><span>BUILD HISTORY</span><h2>{selectedCreatives.length} preserved versions</h2></header><div className={styles.versionGrid}>{selectedCreatives.map((creative) => <article key={creative.id}><img src={creative.approvedUrl || creative.imageUrl} alt={`Creative version ${creative.version}`} /><div><strong>Version {creative.version} · {creative.builderVersion || 'V1'}</strong><span className={statusClass(creative.status)}>{statusLabel(creative.status)}</span></div><small>QA {creative.qa?.score || 0}/100 · {creative.qa?.benchmarkLevel || creative.imageModel || creative.renderMode}</small></article>)}</div></section> : null}
  </div>;
}

function CreativeReview({ creative, working, onApprove }: { creative: CreativeRecord; working: string; onApprove: (creative: CreativeRecord) => void }) {
  const qaPassed = creative.qa?.status === 'passed';
  const approved = creative.status === 'approved';
  const variants = creative.variants || [];
  const v3 = creative.builderVersion === 'V3';
  const design = creative.designIntelligence;
  return <div className={styles.stack}>
    {v3 && design ? <section className={styles.panel}><header><span>DESIGN INTELLIGENCE</span><h2>{design.explorationCount || 12} explored → {design.shortlistCount || 4} finalists → {design.refinementCount || 2} refined</h2></header><p style={{ marginTop: 0, color: '#66758b' }}>{design.creativeNorthStar || creative.artDirection?.creativeNorthStar}</p><div className={styles.strategyGrid}><div><span>Benchmark</span><p>{design.benchmarkDefinition || 'Professional paid-social agency standard.'}</p></div><div><span>Final jury</span><p>{design.finalJury?.reason || 'Executive jury result unavailable.'}</p></div><div><span>Spend confidence</span><strong>{design.finalJury?.spendConfidence || 0}/100</strong></div><div><span>Provider</span><strong>{creative.providerManifest?.activeProvider || 'openai_full_design'}</strong></div></div></section> : null}

    {variants.length ? <section className={styles.panel}><header><span>{v3 ? 'FINALISTS + REFINEMENTS' : 'CREATIVE CONCEPTS'}</span><h2>{variants.length} preserved rendered candidates · AI winner selected</h2></header><p style={{ marginTop: 0, color: '#66758b' }}>{creative.artDirection?.creativeNorthStar || 'Materially distinct concepts generated from the same real DEMAC photo.'}</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 16 }}>{variants.map((variant) => {
      const selected = variant.id === creative.selectedVariantId;
      return <article key={variant.id} style={{ border: selected ? '2px solid #1769e0' : '1px solid #dce3ec', borderRadius: 16, padding: 10, background: selected ? '#f6faff' : '#fff' }}><div style={{ position: 'relative' }}><img src={variant.imageUrl} alt={variant.name} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 12 }} />{selected ? <b style={{ position: 'absolute', top: 10, left: 10, padding: '6px 9px', borderRadius: 999, background: '#1769e0', color: '#fff', fontSize: 10 }}>AI WINNER</b> : null}</div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 10 }}><strong>{variant.name}</strong><span className={statusClass(variant.qa.status)}>{variant.qa.status.toUpperCase()}</span></div><p style={{ fontSize: 12, color: '#66758b', minHeight: 48 }}>{variant.rationale}</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}><span>{variant.stage || (variant.revised ? 'refined' : 'candidate')}</span><span>Selection {variant.selectionScore || 0}</span><span>{variant.qa.benchmarkLevel || 'legacy QA'}</span>{variant.qa.adSpendReady ? <span>Spend-ready</span> : null}</div></article>;
    })}</div></section> : null}

    <section className={styles.reviewGrid}>
      <article className={styles.creativePanel}><header><div><span>SELECTED CREATIVE</span><h2>Version {creative.version} · {creative.builderVersion || 'V1'}</h2></div><b className={statusClass(creative.status)}>{statusLabel(creative.status)}</b></header><div className={styles.imageFrame}><img src={creative.approvedUrl || creative.imageUrl} alt={`DEMAC creative version ${creative.version}`} /></div><div className={styles.renderMeta}><span>{creative.width}×{creative.height}</span><span>{v3 ? '12→4→2 Design Intelligence' : creative.renderTemplate.replaceAll('_', ' ')}</span><span>{creative.imageModel || creative.renderMode}</span><span>Footer Reserve {creative.reservedFooterPx}px</span></div>{qaPassed && !approved ? <button type="button" className={styles.primaryButton} disabled={Boolean(working)} onClick={() => onApprove(creative)}>{working === 'approve' ? 'Approving…' : 'Approve Creative'}</button> : null}{approved ? <a href={creative.approvedUrl || creative.imageUrl} target="_blank" rel="noreferrer" className={styles.primaryButton}>Open Approved PNG</a> : null}<div className={styles.copyPreview}><span>SOCIAL CAPTION</span><p>{creative.captionText}</p></div></article>

      <article className={styles.panel}><header><span>{v3 ? 'PAID-MEDIA BENCHMARK QA V3' : 'STRICT VISUAL QA'}</span><h2>{creative.qa?.score || 0}/100 <b className={statusClass(creative.qa?.status || 'needs_review')}>{(creative.qa?.status || 'review').toUpperCase()}</b></h2></header>{v3 ? <>{metric('Creative Direction', creative.qa?.creativeDirection)}{metric('Composition', creative.qa?.composition)}{metric('Typography', creative.qa?.typography)}{metric('Professional Finish', creative.qa?.professionalFinish)}{metric('Brand Distinctiveness', creative.qa?.brandDistinctiveness)}{metric('Conversion Clarity', creative.qa?.conversionClarity)}{metric('Thumbnail Impact', creative.qa?.thumbnailImpact)}{metric('Authenticity', creative.qa?.authenticity)}{metric('Text Fidelity', creative.qa?.textFidelity)}{metric('Footer Safety', creative.qa?.footerSafety)}<div style={{ margin: '14px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}><span className={creative.qa?.adSpendReady ? styles.goodPill : styles.badPill}>{creative.qa?.adSpendReady ? 'AD SPEND READY' : 'NOT SPEND READY'}</span><span className={styles.warnPill}>Benchmark: {(creative.qa?.benchmarkLevel || 'unknown').replaceAll('_', ' ')}</span>{creative.qa?.visibleTextExact ? <span className={styles.goodPill}>TEXT EXACT</span> : <span className={styles.badPill}>TEXT CHECK</span>}{creative.qa?.inventedFacts ? <span className={styles.badPill}>INVENTED FACTS</span> : null}</div>{creative.qa?.amateurSignals?.length ? <div><strong style={{ fontSize: 12 }}>AMATEUR SIGNALS</strong><ul>{creative.qa.amateurSignals.map((issue) => <li key={issue} style={{ margin: '7px 0', fontSize: 12, color: '#9a3f3f' }}>{issue}</li>)}</ul></div> : null}</> : <>{metric('Creative Quality', creative.qa?.creativeQuality)}{metric('Agency Feel', creative.qa?.agencyFeel)}{metric('Scroll-stopping', creative.qa?.scrollStoppingPower)}{metric('Photo Integration', creative.qa?.photoIntegration)}{metric('Visual Sophistication', creative.qa?.visualSophistication)}{metric('CTA Prominence', creative.qa?.ctaProminence)}{metric('Mobile Legibility', creative.qa?.mobileLegibility)}{metric('Professionalism', creative.qa?.professionalism)}{metric('Footer Clearance', creative.qa?.footerClearance)}</>}<div style={{ marginTop: 16 }}><strong style={{ fontSize: 12 }}>QA ISSUES</strong>{creative.qa?.issues?.length ? <ul>{creative.qa.issues.map((issue) => <li key={issue} style={{ margin: '7px 0', fontSize: 12, color: '#66758b' }}>{issue}</li>)}</ul> : <p style={{ fontSize: 12, color: '#26744c' }}>No blocking creative issues detected.</p>}</div>{creative.qa?.status !== 'passed' ? <p style={{ padding: 12, borderRadius: 10, background: '#fff4dd', color: '#7b5310', fontSize: 12 }}><strong>Not eligible for approval.</strong> Run another V3 exploration so the engine can use this benchmark feedback.</p> : null}<small className={styles.muted}>Art Director: {creative.artDirectorModel || 'legacy'} · Image: {creative.imageModel || 'legacy'} · QA: {creative.qaModel || creative.qa?.source}</small></article>
    </section>
  </div>;
}

function ApprovedGallery({ creatives }: { creatives: CreativeRecord[] }) {
  if (!creatives.length) return <section className={styles.emptyState}><strong>No approved creatives yet</strong><p>Approve a paid-media-benchmark creative from Creative Studio and it will appear here.</p></section>;
  return <section className={styles.panel}><header><span>APPROVED LIBRARY</span><h2>{creatives.length} final creatives</h2></header><div className={styles.versionGrid}>{creatives.map((creative) => <article key={creative.id}><img src={creative.approvedUrl || creative.imageUrl} alt={`Approved creative ${creative.version}`} /><div><strong>{creative.builderVersion || 'V1'} · Version {creative.version}</strong><span className={styles.goodPill}>APPROVED</span></div><small>QA {creative.qa?.score || 0}/100 · {creative.qa?.benchmarkLevel || friendlyDate(creative.approvedAt)}</small><a href={creative.approvedUrl || creative.imageUrl} target="_blank" rel="noreferrer">Open PNG</a></article>)}</div></section>;
}
