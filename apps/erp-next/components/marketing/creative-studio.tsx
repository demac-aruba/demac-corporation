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

export function CreativeStudio({ initialView = 'studio' }: { initialView?: View }) {
  const { principal } = useAuth();
  const allowed = principal.role === 'super_admin' || principal.role === 'office_operator';
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<MarketingData>(EMPTY_DATA);
  const [creatives, setCreatives] = useState<MarketingCreative[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<'build' | 'approve' | 'strategy' | ''>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!allowed) return;
    try {
      setError('');
      const [marketing, creativeState] = await Promise.all([
        loadMarketingData(),
        listMarketingCreatives(),
      ]);
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

  const selectedSession = useMemo(
    () => data.sessions.find((session) => session.id === selectedSessionId),
    [data.sessions, selectedSessionId],
  );
  const selectedCampaign = useMemo(
    () => data.campaigns.find((campaign) => campaign.sessionId === selectedSessionId),
    [data.campaigns, selectedSessionId],
  );
  const selectedHero = useMemo(
    () => data.assets.find((asset) => asset.id === selectedCampaign?.heroAssetId),
    [data.assets, selectedCampaign],
  );
  const selectedCreatives = useMemo(
    () => creatives
      .filter((creative) => creative.sessionId === selectedSessionId)
      .sort((a, b) => b.version - a.version),
    [creatives, selectedSessionId],
  );
  const latestCreative = selectedCreatives[0];
  const approved = useMemo(
    () => creatives.filter((creative) => creative.status === 'approved').sort((a, b) => Date.parse(b.approvedAt || b.updatedAt) - Date.parse(a.approvedAt || a.updatedAt)),
    [creatives],
  );

  if (!allowed) {
    return <section className={styles.locked}><strong>Marketing access restricted</strong><p>Creative Studio is available only to DEMAC Super Admin and Office Operator accounts.</p></section>;
  }

  const build = async () => {
    if (!selectedSessionId || working) return;
    setWorking('build');
    setError('');
    setNotice('');
    try {
      await requestMarketingCreativeBuild(selectedSessionId);
      await refresh();
      setNotice('Creative render completed. Visual QA results are ready below.');
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : 'Creative build failed.');
    } finally {
      setWorking('');
    }
  };

  const approve = async (creative: MarketingCreative) => {
    if (working) return;
    setWorking('approve');
    setError('');
    setNotice('');
    try {
      await approveMarketingCreative(creative.id);
      await refresh();
      setNotice('Creative approved and copied to the immutable Approved Creatives library.');
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
      setNotice('Campaign strategy was regenerated. Review the Papiamento status before rendering.');
    } catch (strategyError) {
      setError(strategyError instanceof Error ? strategyError.message : 'Campaign strategy regeneration failed.');
    } finally {
      setWorking('');
    }
  };

  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>DEMAC MARKETING AGENT · V1G</div>
          <h1>{view === 'approved' ? 'Approved Creatives' : 'Creative Studio'}</h1>
          <p>{view === 'approved'
            ? 'Immutable, QA-passed advertising creatives approved for export and publishing.'
            : 'Campaign strategy → AI art direction → deterministic exact text → Visual QA → approval.'}</p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={view === 'studio' ? styles.activeView : ''} onClick={() => setView('studio')}>Creative Studio</button>
          <button type="button" className={view === 'approved' ? styles.activeView : ''} onClick={() => setView('approved')}>Approved ({approved.length})</button>
          <Link href="/marketing">Marketing Center</Link>
        </div>
      </section>

      <section className={styles.metrics}>
        <article><span>Campaigns Ready</span><strong>{data.campaigns.length}</strong><small>Strategy records</small></article>
        <article><span>Creative Versions</span><strong>{creatives.length}</strong><small>Every render preserved</small></article>
        <article><span>QA Passed</span><strong>{creatives.filter((creative) => creative.qa?.status === 'passed').length}</strong><small>Eligible for approval</small></article>
        <article><span>Approved</span><strong>{approved.length}</strong><small>Final export library</small></article>
      </section>

      {error ? <div className={styles.error}>{error}<button type="button" onClick={() => setError('')}>×</button></div> : null}
      {notice ? <div className={styles.notice}>{notice}<button type="button" onClick={() => setNotice('')}>×</button></div> : null}
      {loading ? <div className={styles.loading}>Loading Creative Studio…</div> : null}

      {!loading && view === 'approved' ? <ApprovedGallery creatives={approved} /> : null}
      {!loading && view === 'studio' ? (
        <StudioView
          data={data}
          sessions={data.sessions}
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
        />
      ) : null}
    </div>
  );
}

function StudioView({
  data,
  sessions,
  selectedSessionId,
  setSelectedSessionId,
  selectedSession,
  selectedCampaign,
  selectedHeroUrl,
  selectedCreatives,
  latestCreative,
  working,
  onBuild,
  onApprove,
  onRegenerateStrategy,
}: {
  data: MarketingData;
  sessions: MarketingUploadSession[];
  selectedSessionId: string;
  setSelectedSessionId: (value: string) => void;
  selectedSession?: MarketingUploadSession;
  selectedCampaign?: MarketingCampaign;
  selectedHeroUrl?: string;
  selectedCreatives: MarketingCreative[];
  latestCreative?: MarketingCreative;
  working: string;
  onBuild: () => void;
  onApprove: (creative: MarketingCreative) => void;
  onRegenerateStrategy: () => void;
}) {
  const campaignSessions = sessions.filter((session) => data.campaigns.some((campaign) => campaign.sessionId === session.id));
  const languagePassed = selectedCampaign?.papiamentoValidationStatus === 'passed';
  const ready = Boolean(selectedCampaign && data.brandIsLive && languagePassed);

  return <div className={styles.stack}>
    <section className={styles.controlPanel}>
      <div>
        <span>CAMPAIGN INPUT</span>
        <h2>Select campaign</h2>
        <p>Creative Studio only renders campaigns that already have Visual AI analysis and Campaign Strategy.</p>
      </div>
      <label>
        <span>Campaign / upload session</span>
        <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
          {!campaignSessions.length ? <option value="">No generated campaigns</option> : null}
          {campaignSessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
        </select>
      </label>
      <button type="button" className={styles.primaryButton} disabled={!ready || Boolean(working)} onClick={onBuild}>
        {working === 'build' ? 'Building + QA…' : latestCreative ? 'Regenerate + Auto-revise' : 'Build Creative'}
      </button>
    </section>

    {!data.brandIsLive ? <div className={styles.blocker}><strong>Brand Center must be LIVE before rendering.</strong><span>Open Marketing Center → Brand Center, review the approved facts and click Save Brand Center.</span><Link href="/marketing">Open Marketing Center</Link></div> : null}

    {selectedCampaign && !languagePassed ? <div className={styles.blocker}>
      <strong>Papiamento copy has not passed validation.</strong>
      <span>Unknown / review words: {selectedCampaign.papiamentoUnknownWords?.join(', ') || 'language review required'}.</span>
      <button type="button" onClick={onRegenerateStrategy} disabled={Boolean(working)}>{working === 'strategy' ? 'Regenerating…' : 'Regenerate Campaign Copy'}</button>
    </div> : null}

    {!selectedCampaign ? <section className={styles.emptyState}><strong>No campaign strategy yet</strong><p>Go to Marketing Center → Media Library, analyze a photo session, then generate Campaign Strategy.</p><Link href="/marketing">Open Marketing Center</Link></section> : null}

    {selectedCampaign ? <section className={styles.inputGrid}>
      <article className={styles.panel}>
        <header><span>STRATEGY</span><h2>{selectedSession?.name || 'Campaign'}</h2></header>
        <div className={styles.strategyGrid}>
          <div><span>Campaign type</span><strong>{selectedCampaign.campaignType.replaceAll('_', ' ')}</strong></div>
          <div><span>Papiamento</span><strong className={languagePassed ? styles.goodText : styles.warnText}>{selectedCampaign.papiamentoValidationStatus}</strong></div>
          <div><span>Objective</span><p>{selectedCampaign.objective}</p></div>
          <div><span>Angle</span><p>{selectedCampaign.angle}</p></div>
        </div>
        <div className={styles.copyPreview}>
          <span>EXACT COPY INPUT</span>
          <h3>{selectedCampaign.copy.headline}</h3>
          <strong>{selectedCampaign.copy.subheadline}</strong>
          <p>{selectedCampaign.copy.primaryText}</p>
          <b>{selectedCampaign.copy.cta}</b>
        </div>
      </article>
      <article className={styles.panel}>
        <header><span>HERO PHOTO</span><h2>AI-selected source image</h2></header>
        {selectedHeroUrl ? <img className={styles.heroPhoto} src={selectedHeroUrl} alt="Campaign hero source" /> : <div className={styles.noImage}>Hero image unavailable</div>}
        <small className={styles.muted}>The original photo remains preserved. Creative Builder edits a derivative only.</small>
      </article>
    </section> : null}

    {latestCreative ? <CreativeReview creative={latestCreative} working={working} onApprove={onApprove} /> : selectedCampaign ? <section className={styles.emptyState}><strong>Ready for first creative render</strong><p>Build Creative will prepare the art, add exact deterministic text, run Visual QA and auto-revise the layout when needed.</p></section> : null}

    {selectedCreatives.length > 1 ? <section className={styles.panel}>
      <header><span>VERSION HISTORY</span><h2>{selectedCreatives.length} preserved renders</h2></header>
      <div className={styles.versionGrid}>{selectedCreatives.map((creative) => <article key={creative.id}>
        <img src={creative.approvedUrl || creative.imageUrl} alt={`Creative version ${creative.version}`} />
        <div><strong>Version {creative.version}</strong><span className={statusClass(creative.status)}>{statusLabel(creative.status)}</span></div>
        <small>QA {creative.qa?.score || 0}/100 · {creative.renderMode.replaceAll('_', ' ')}</small>
      </article>)}</div>
    </section> : null}
  </div>;
}

function CreativeReview({ creative, working, onApprove }: { creative: MarketingCreative; working: string; onApprove: (creative: MarketingCreative) => void }) {
  const qaPassed = creative.qa?.status === 'passed';
  const approved = creative.status === 'approved';
  const displayUrl = creative.approvedUrl || creative.imageUrl;
  return <section className={styles.reviewGrid}>
    <article className={styles.creativePanel}>
      <header><div><span>RENDERED CREATIVE</span><h2>Version {creative.version}</h2></div><b className={statusClass(creative.status)}>{statusLabel(creative.status)}</b></header>
      <div className={styles.imageFrame}><img src={displayUrl} alt={`DEMAC creative version ${creative.version}`} /></div>
      <div className={styles.renderMeta}>
        <span>{creative.width}×{creative.height}</span>
        <span>{creative.renderTemplate.replaceAll('_', ' ')}</span>
        <span>{creative.renderMode === 'ai_edit' ? `AI edit · ${creative.imageModel || 'GPT Image'}` : 'Deterministic photo fallback'}</span>
        <span>Footer reserve {creative.reservedFooterPx}px</span>
      </div>
      <div className={styles.actionRow}>
        {qaPassed && !approved ? <button type="button" className={styles.approveButton} disabled={Boolean(working)} onClick={() => onApprove(creative)}>{working === 'approve' ? 'Approving…' : 'Approve Creative'}</button> : null}
        {approved ? <a className={styles.downloadButton} href={displayUrl} target="_blank" rel="noreferrer">Open / Download PNG</a> : null}
      </div>
      <div className={styles.captionBox}><span>SOCIAL CAPTION</span><p>{creative.captionText || 'No caption stored.'}</p><button type="button" onClick={() => void navigator.clipboard?.writeText(creative.captionText || '')}>Copy Caption</button></div>
    </article>

    <article className={styles.qaPanel}>
      <header><div><span>VISUAL QA</span><h2>{creative.qa?.score || 0}/100</h2></div><b className={statusClass(creative.qa?.status || 'needs_review')}>{statusLabel(creative.qa?.status || 'needs_review')}</b></header>
      <div className={styles.scoreGrid}>
        <Score label="Mobile legibility" value={creative.qa?.mobileLegibility} />
        <Score label="Hierarchy" value={creative.qa?.visualHierarchy} />
        <Score label="Contrast" value={creative.qa?.contrast} />
        <Score label="Footer clearance" value={creative.qa?.footerClearance} />
        <Score label="Authenticity" value={creative.qa?.authenticity} />
        <Score label="Professionalism" value={creative.qa?.professionalism} />
      </div>
      <div className={styles.hardChecks}>
        <span>HARD CHECKS</span>
        {creative.qa?.hardChecks ? Object.entries(creative.qa.hardChecks).filter(([key]) => key !== 'allPassed').map(([key, value]) => <div key={key}><b>{value ? '✓' : '!'}</b><span>{key.replace(/([A-Z])/g, ' $1')}</span></div>) : <p>No hard-check details.</p>}
      </div>
      <div className={styles.issueBox}>
        <span>QA ISSUES</span>
        {creative.qa?.issues?.length ? <ul>{creative.qa.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p>No blocking visual issues detected.</p>}
      </div>
      {creative.qa?.revisionInstructions?.length ? <div className={styles.issueBox}><span>AUTO-REVISION NOTES</span><ul>{creative.qa.revisionInstructions.map((note) => <li key={note}>{note}</li>)}</ul></div> : null}
      <small className={styles.muted}>QA source: {creative.qa?.source || 'unknown'} · render attempt {creative.qa?.attempt || 1} · created {friendlyDate(creative.createdAt)}</small>
    </article>
  </section>;
}

function Score({ label, value = 0 }: { label: string; value?: number }) {
  return <div><span>{label}</span><strong>{value || 0}</strong><i><b style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></i></div>;
}

function ApprovedGallery({ creatives }: { creatives: MarketingCreative[] }) {
  if (!creatives.length) return <section className={styles.emptyState}><strong>No approved creatives yet</strong><p>Build a creative, pass Visual QA, then approve it. Approved PNGs will appear here.</p><Link href="/marketing/creative-studio">Open Creative Studio</Link></section>;
  return <div className={styles.approvedGrid}>{creatives.map((creative) => <article className={styles.approvedCard} key={creative.id}>
    <img src={creative.approvedUrl || creative.imageUrl} alt={`Approved DEMAC creative ${creative.version}`} />
    <div><span>APPROVED</span><strong>{creative.exactText.headline}</strong><p>{creative.exactText.subheadline}</p></div>
    <dl><div><dt>QA</dt><dd>{creative.qa?.score || 0}/100</dd></div><div><dt>Approved</dt><dd>{friendlyDate(creative.approvedAt)}</dd></div><div><dt>By</dt><dd>{creative.approvedByName || 'DEMAC'}</dd></div></dl>
    <a href={creative.approvedUrl || creative.imageUrl} target="_blank" rel="noreferrer">Open / Download PNG</a>
  </article>)}</div>;
}
