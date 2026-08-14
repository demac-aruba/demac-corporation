'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  createMarketingSessionWithFiles,
  DEFAULT_MARKETING_BRAND_SETTINGS,
  loadMarketingData,
  type MarketingAsset,
  type MarketingBrandSettings,
  type MarketingCampaign,
  type MarketingCampaignType,
  type MarketingUploadSession,
  requestMarketingCampaignStrategy,
  requestMarketingImageAnalysis,
  saveMarketingBrandSettings,
} from '@/lib/firebase/marketing';
import styles from './marketing-workspace.module.css';

type Tab = 'agent' | 'media' | 'campaigns' | 'brand' | 'approved';

type MarketingData = {
  sessions: MarketingUploadSession[];
  assets: MarketingAsset[];
  campaigns: MarketingCampaign[];
  brand: MarketingBrandSettings;
  brandIsLive: boolean;
};

const tabs: { key: Tab; label: string; short: string }[] = [
  { key: 'agent', label: 'Marketing Agent', short: 'AI' },
  { key: 'media', label: 'Media Library', short: 'ML' },
  { key: 'campaigns', label: 'Campaigns', short: 'CP' },
  { key: 'brand', label: 'Brand Center', short: 'BC' },
  { key: 'approved', label: 'Approved Creatives', short: 'AC' },
];

const campaignLabels: Record<MarketingCampaignType, string> = {
  otro_cliente_contento: 'Otro Cliente Contento',
  airco_sales: 'Airco Sales',
  installation: 'Installation',
  service: 'Service',
  seasonal_heat: 'Seasonal Heat',
  other: 'Other',
};

const emptyData: MarketingData = {
  sessions: [],
  assets: [],
  campaigns: [],
  brand: DEFAULT_MARKETING_BRAND_SETTINGS,
  brandIsLive: false,
};

function scoreTone(score?: number) {
  if (score == null) return styles.neutral;
  if (score >= 80) return styles.good;
  if (score >= 60) return styles.warn;
  return styles.bad;
}

function readableSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function LinesEditor({ value, onChange, placeholder }: { value: string[]; onChange: (value: string[]) => void; placeholder?: string }) {
  return <textarea value={value.join('\n')} onChange={(event) => onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} placeholder={placeholder} rows={5} />;
}

export function MarketingWorkspace() {
  const { principal } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('agent');
  const [data, setData] = useState<MarketingData>(emptyData);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const allowed = principal.role === 'super_admin' || principal.role === 'office_operator';

  const refresh = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    try {
      const next = await loadMarketingData();
      setData(next);
      setSelectedSessionId((current) => current || next.sessions[0]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Marketing data.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
  }, []);

  const selectedSession = useMemo(() => data.sessions.find((session) => session.id === selectedSessionId), [data.sessions, selectedSessionId]);
  const selectedAssets = useMemo(() => data.assets.filter((asset) => asset.sessionId === selectedSessionId), [data.assets, selectedSessionId]);
  const selectedCampaign = useMemo(() => data.campaigns.find((campaign) => campaign.sessionId === selectedSessionId), [data.campaigns, selectedSessionId]);

  if (!allowed) {
    return <section className={styles.locked}><strong>Marketing access restricted</strong><p>This workspace is available only to DEMAC Super Admin and Office Operator accounts.</p></section>;
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>DEMAC MARKETING OPERATIONS</div>
          <h1>Marketing Center</h1>
          <p>Real installation photos → AI image ranking → campaign strategy → Aruba Papiamento copy → creative production.</p>
        </div>
        <div className={styles.version}><span>V1C.1</span><strong>LIVE</strong></div>
      </section>

      <section className={styles.metrics}>
        <article><span>Upload Sessions</span><strong>{data.sessions.length}</strong><small>Media batches in Firebase</small></article>
        <article><span>Analyzed Photos</span><strong>{data.assets.filter((asset) => asset.analysisStatus === 'completed').length}</strong><small>Vision-ranked assets</small></article>
        <article><span>Campaign Strategies</span><strong>{data.campaigns.length}</strong><small>AI-generated briefs</small></article>
        <article><span>Brand Source</span><strong>{data.brandIsLive ? 'LIVE' : 'DEFAULT'}</strong><small>{data.brandIsLive ? 'Firestore source of truth' : 'Save Brand Center to activate'}</small></article>
      </section>

      <nav className={styles.tabs} aria-label="Marketing workspace sections">
        {tabs.map((tab) => <button type="button" key={tab.key} onClick={() => setActiveTab(tab.key)} className={activeTab === tab.key ? styles.tabActive : ''}><b>{tab.short}</b><span>{tab.label}</span></button>)}
      </nav>

      {error ? <div className={styles.error}>{error}<button type="button" onClick={() => setError(null)}>×</button></div> : null}
      {notice ? <div className={styles.notice}>{notice}<button type="button" onClick={() => setNotice(null)}>×</button></div> : null}
      {loading ? <div className={styles.loading}>Loading Marketing workspace…</div> : null}

      {!loading && activeTab === 'agent' ? <AgentHome data={data} selectedSession={selectedSession} selectedCampaign={selectedCampaign} onOpenMedia={() => setActiveTab('media')} onOpenCampaigns={() => setActiveTab('campaigns')} /> : null}
      {!loading && activeTab === 'media' ? <MediaLibrary data={data} selectedSessionId={selectedSessionId} setSelectedSessionId={setSelectedSessionId} selectedSession={selectedSession} assets={selectedAssets} folderInputRef={folderInputRef} working={working} setWorking={setWorking} refresh={refresh} principal={principal} setError={setError} setNotice={setNotice} /> : null}
      {!loading && activeTab === 'campaigns' ? <CampaignLibrary campaigns={data.campaigns} assets={data.assets} /> : null}
      {!loading && activeTab === 'brand' ? <BrandCenter initial={data.brand} isLive={data.brandIsLive} working={working} setWorking={setWorking} principal={principal} refresh={refresh} setError={setError} setNotice={setNotice} /> : null}
      {!loading && activeTab === 'approved' ? <ApprovedCreatives /> : null}
    </div>
  );
}

function AgentHome({ data, selectedSession, selectedCampaign, onOpenMedia, onOpenCampaigns }: { data: MarketingData; selectedSession?: MarketingUploadSession; selectedCampaign?: MarketingCampaign; onOpenMedia: () => void; onOpenCampaigns: () => void }) {
  const topAssets = data.assets.filter((asset) => asset.analysisStatus === 'completed' && !asset.doNotUse).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).slice(0, 5);
  return <div className={styles.stack}>
    <section className={styles.twoCol}>
      <article className={styles.panel}>
        <header><div><span>MARKETING AGENT</span><h2>Production pipeline</h2></div><b className={styles.liveDot}>ACTIVE</b></header>
        <div className={styles.pipeline}>
          {[['01', 'Media intake', data.assets.length > 0], ['02', 'Visual analysis + ranking', data.assets.some((asset) => asset.analysisStatus === 'completed')], ['03', 'Campaign strategy + Papiamento', data.campaigns.length > 0], ['04', 'Creative / Ad Builder', false], ['05', 'Visual QA + auto-revision', false]].map(([step, label, done]) => <div key={String(step)} className={done ? styles.doneStep : ''}><b>{step}</b><span>{label}</span><em>{done ? 'READY' : 'NEXT'}</em></div>)}
        </div>
      </article>
      <article className={styles.panel}>
        <header><div><span>CURRENT SESSION</span><h2>{selectedSession?.name || 'No upload session yet'}</h2></div></header>
        {selectedSession ? <div className={styles.sessionSummary}><div><span>Campaign type</span><strong>{campaignLabels[selectedSession.campaignType]}</strong></div><div><span>Photos</span><strong>{selectedSession.uploadedAssetCount}/{selectedSession.expectedAssetCount}</strong></div><div><span>Visual AI</span><strong>{selectedSession.analysisStatus || 'not started'}</strong></div><div><span>Strategist</span><strong>{selectedSession.campaignStrategyStatus || 'not started'}</strong></div></div> : <p className={styles.muted}>Create a Media Library upload session to start the pipeline.</p>}
        <div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={onOpenMedia}>Open Media Library</button>{selectedCampaign ? <button type="button" className={styles.secondaryButton} onClick={onOpenCampaigns}>Open Campaign</button> : null}</div>
      </article>
    </section>

    <section className={styles.panel}>
      <header><div><span>TOP VISUAL ASSETS</span><h2>Best photos selected by Marketing AI</h2></div></header>
      {topAssets.length ? <div className={styles.assetStrip}>{topAssets.map((asset) => <article key={asset.id}><img src={asset.thumbnailUrl || asset.downloadUrl} alt={asset.originalFileName} /><div><b>#{asset.rank ?? '—'}</b><span>Rank {asset.rankingScore ?? '—'} · Quality {asset.qualityScore ?? '—'}</span></div></article>)}</div> : <div className={styles.empty}>No analyzed photos yet.</div>}
    </section>
  </div>;
}

function MediaLibrary({ data, selectedSessionId, setSelectedSessionId, selectedSession, assets, folderInputRef, working, setWorking, refresh, principal, setError, setNotice }: {
  data: MarketingData;
  selectedSessionId: string;
  setSelectedSessionId: (id: string) => void;
  selectedSession?: MarketingUploadSession;
  assets: MarketingAsset[];
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  working: boolean;
  setWorking: (value: boolean) => void;
  refresh: () => Promise<void>;
  principal: { userId: string; displayName: string };
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [campaignType, setCampaignType] = useState<MarketingCampaignType>('otro_cliente_contento');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = async () => {
    if (!files.length || working) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const sessionId = await createMarketingSessionWithFiles({
        name,
        campaignType,
        files,
        createdByUserId: principal.userId,
        createdByName: principal.displayName,
        onProgress: (done, total) => setProgress(`Uploading ${done}/${total}`),
      });
      setFiles([]); setName(''); setProgress('');
      await refresh(); setSelectedSessionId(sessionId);
      setNotice('Upload complete. The session is ready for Marketing AI analysis.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally { setWorking(false); }
  };

  const analyze = async () => {
    if (!selectedSession || working) return;
    setWorking(true); setError(null); setNotice(null);
    try { await requestMarketingImageAnalysis(selectedSession.id); await refresh(); setNotice('Visual analysis completed and rankings were refreshed.'); }
    catch (analysisError) { setError(analysisError instanceof Error ? analysisError.message : 'Visual analysis failed.'); }
    finally { setWorking(false); }
  };

  const strategy = async () => {
    if (!selectedSession || selectedSession.analysisStatus !== 'completed' || working) return;
    setWorking(true); setError(null); setNotice(null);
    try { await requestMarketingCampaignStrategy(selectedSession.id); await refresh(); setNotice('Campaign strategy and Aruba Papiamento copy are ready.'); }
    catch (strategyError) { setError(strategyError instanceof Error ? strategyError.message : 'Campaign strategy failed.'); }
    finally { setWorking(false); }
  };

  return <div className={styles.stack}>
    <section className={styles.panel}>
      <header><div><span>MEDIA INTAKE</span><h2>Create upload session</h2><p>Upload real DEMAC installation/customer photos. Originals remain preserved in Firebase Storage.</p></div></header>
      <div className={styles.formGrid}>
        <label><span>Session name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Installation - Client / location" /></label>
        <label><span>Campaign type</span><select value={campaignType} onChange={(event) => setCampaignType(event.target.value as MarketingCampaignType)}>{Object.entries(campaignLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <div className={styles.uploadBox} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFiles(Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'))); }}>
        <strong>{files.length ? `${files.length} image${files.length === 1 ? '' : 's'} selected` : 'Drop photos here'}</strong>
        <span>JPG, PNG, WebP and supported image formats · max 25 MB each</span>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={() => fileInputRef.current?.click()}>Choose Photos</button>
          <button type="button" className={styles.secondaryButton} onClick={() => folderInputRef.current?.click()}>Choose Folder</button>
          <button type="button" className={styles.primaryButton} disabled={!files.length || working} onClick={() => void upload()}>{working && progress ? progress : 'Upload to Media Library'}</button>
        </div>
        <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} />
        <input ref={folderInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/')))} />
      </div>
    </section>

    <section className={styles.libraryGrid}>
      <aside className={styles.panel}>
        <header><div><span>SESSIONS</span><h2>{data.sessions.length} batches</h2></div></header>
        <div className={styles.sessionList}>{data.sessions.map((session) => <button type="button" key={session.id} onClick={() => setSelectedSessionId(session.id)} className={selectedSessionId === session.id ? styles.sessionActive : ''}><strong>{session.name}</strong><span>{campaignLabels[session.campaignType]} · {session.uploadedAssetCount} photos</span><em>{session.analysisStatus || session.status}</em></button>)}</div>
      </aside>
      <div className={styles.stack}>
        <section className={styles.panel}>
          <header><div><span>SELECTED SESSION</span><h2>{selectedSession?.name || 'Select a session'}</h2></div>{selectedSession ? <div className={styles.actions}><button type="button" disabled={!assets.length || working} className={styles.secondaryButton} onClick={() => void analyze()}>{working ? 'Working…' : selectedSession.analysisStatus === 'completed' ? 'Re-analyze Photos' : 'Analyze Photos'}</button><button type="button" disabled={selectedSession.analysisStatus !== 'completed' || working} className={styles.primaryButton} onClick={() => void strategy()}>{selectedSession.campaignStrategyStatus === 'completed' ? 'Regenerate Strategy' : 'Generate Campaign Strategy'}</button></div> : null}</header>
          {selectedSession ? <div className={styles.sessionSummary}><div><span>Uploaded</span><strong>{selectedSession.uploadedAssetCount}</strong></div><div><span>Usable AI assets</span><strong>{selectedSession.usableAssetCount ?? '—'}</strong></div><div><span>Best photo</span><strong>{selectedSession.primaryAssetId ? 'Selected' : '—'}</strong></div><div><span>Campaign AI</span><strong>{selectedSession.campaignStrategyStatus || '—'}</strong></div></div> : null}
        </section>
        <section className={styles.assetGrid}>{assets.map((asset) => <article className={styles.assetCard} key={asset.id}><div className={styles.imageWrap}><img src={asset.thumbnailUrl || asset.downloadUrl} alt={asset.originalFileName} />{asset.rank ? <b className={styles.rank}>#{asset.rank}</b> : null}{asset.doNotUse ? <span className={styles.reject}>DO NOT USE</span> : null}</div><div className={styles.assetInfo}><strong title={asset.originalFileName}>{asset.originalFileName}</strong><span>{readableSize(asset.sizeBytes)}</span><div className={styles.scoreRow}><b className={scoreTone(asset.rankingScore)}>Rank {asset.rankingScore ?? '—'}</b><b className={scoreTone(asset.qualityScore)}>Quality {asset.qualityScore ?? '—'}</b><b className={scoreTone(asset.marketingSuitabilityScore)}>Marketing {asset.marketingSuitabilityScore ?? '—'}</b></div>{asset.analysisSummary ? <p>{asset.analysisSummary}</p> : null}{asset.containsReadableSensitiveData ? <small className={styles.badText}>Privacy review: {asset.sensitiveDataNote || 'Readable sensitive data detected.'}</small> : null}</div></article>)}</section>
        {!assets.length ? <div className={styles.empty}>No images in this session.</div> : null}
      </div>
    </section>
  </div>;
}

function CampaignLibrary({ campaigns, assets }: { campaigns: MarketingCampaign[]; assets: MarketingAsset[] }) {
  if (!campaigns.length) return <div className={styles.empty}>No campaign strategy has been generated yet. Analyze photos in Media Library first.</div>;
  return <div className={styles.campaignGrid}>{campaigns.map((campaign) => { const hero = assets.find((asset) => asset.id === campaign.heroAssetId); return <article className={styles.campaignCard} key={campaign.id}><div className={styles.campaignHero}>{hero ? <img src={hero.thumbnailUrl || hero.downloadUrl} alt="Campaign hero" /> : <div>No hero preview</div>}<span>{campaignLabels[campaign.campaignType]}</span></div><div className={styles.campaignBody}><div className={campaign.papiamentoValidationStatus === 'passed' ? styles.pass : styles.review}>{campaign.papiamentoValidationStatus === 'passed' ? 'PAPIAMENTO PASS' : 'LANGUAGE REVIEW'}</div><h2>{campaign.copy.headline}</h2><h3>{campaign.copy.subheadline}</h3><p>{campaign.copy.primaryText}</p><button type="button" className={styles.cta}>{campaign.copy.cta}</button><dl><div><dt>Objective</dt><dd>{campaign.objective}</dd></div><div><dt>Angle</dt><dd>{campaign.angle}</dd></div><div><dt>Hero treatment</dt><dd>{campaign.visualDirection.heroTreatment}</dd></div><div><dt>Commercial facts</dt><dd>{campaign.factPolicy.priceOrPromoIncluded ? 'Approved price/promo used' : 'No unapproved promotion inserted'}</dd></div></dl>{campaign.papiamentoUnknownWords?.length ? <small className={styles.badText}>Review words: {campaign.papiamentoUnknownWords.join(', ')}</small> : null}</div></article>; })}</div>;
}

function BrandCenter({ initial, isLive, working, setWorking, principal, refresh, setError, setNotice }: { initial: MarketingBrandSettings; isLive: boolean; working: boolean; setWorking: (value: boolean) => void; principal: { userId: string; displayName: string }; refresh: () => Promise<void>; setError: (value: string | null) => void; setNotice: (value: string | null) => void }) {
  const [brand, setBrand] = useState<MarketingBrandSettings>(initial);
  useEffect(() => setBrand(initial), [initial]);
  const save = async () => { setWorking(true); setError(null); setNotice(null); try { await saveMarketingBrandSettings(brand, principal.userId, principal.displayName); await refresh(); setNotice('Brand Center saved. These facts are now the Marketing Agent source of truth.'); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save Brand Center.'); } finally { setWorking(false); } };
  return <div className={styles.stack}>
    <section className={styles.panel}><header><div><span>APPROVED MARKETING FACTS</span><h2>Brand Center</h2><p>Only facts stored here may be treated as approved commercial truth by the Campaign Strategist.</p></div><div className={isLive ? styles.pass : styles.review}>{isLive ? 'LIVE CONFIG' : 'DEFAULTS · NOT SAVED'}</div></header>
      <div className={styles.formGrid}><label><span>Company name</span><input value={brand.companyName} onChange={(event) => setBrand({ ...brand, companyName: event.target.value })} /></label><label><span>WhatsApp</span><input value={brand.whatsapp} onChange={(event) => setBrand({ ...brand, whatsapp: event.target.value })} /></label><label><span>Primary color</span><input value={brand.primaryColor} onChange={(event) => setBrand({ ...brand, primaryColor: event.target.value })} /></label><label><span>Default language</span><input value={brand.language} onChange={(event) => setBrand({ ...brand, language: event.target.value })} /></label></div>
      <div className={styles.editorGrid}><label><span>Approved products / exact facts</span><LinesEditor value={brand.approvedProducts} onChange={(approvedProducts) => setBrand({ ...brand, approvedProducts })} /></label><label><span>Active offers / promotions</span><LinesEditor value={brand.approvedOffers} onChange={(approvedOffers) => setBrand({ ...brand, approvedOffers })} placeholder="Leave empty when no promotion is active." /></label><label><span>Approved claims</span><LinesEditor value={brand.approvedClaims} onChange={(approvedClaims) => setBrand({ ...brand, approvedClaims })} /></label><label><span>Approved Aruba Papiamento phrases</span><LinesEditor value={brand.approvedPapiamentoPhrases} onChange={(approvedPapiamentoPhrases) => setBrand({ ...brand, approvedPapiamentoPhrases })} /></label></div>
      <div className={styles.ruleGrid}><article><span>Footer rule</span><p>{brand.footerRule}</p></article><article><span>Real-photo rule</span><p>{brand.realPhotoRule}</p></article></div>
      <div className={styles.actions}><button type="button" className={styles.secondaryButton} disabled={working} onClick={() => setBrand(DEFAULT_MARKETING_BRAND_SETTINGS)}>Restore DEMAC Defaults</button><button type="button" className={styles.primaryButton} disabled={working} onClick={() => void save()}>{working ? 'Saving…' : 'Save Brand Center'}</button></div>
    </section>
  </div>;
}

function ApprovedCreatives() {
  return <section className={styles.panel}><header><div><span>CREATIVE OUTPUT</span><h2>Approved Creatives</h2></div><div className={styles.review}>V1D NEXT</div></header><div className={styles.empty}><strong>The production destination is ready.</strong><p>V1D will place finished 1:1 advertisements here after deterministic text rendering, footer-clearance checks and Visual QA.</p></div></section>;
}
