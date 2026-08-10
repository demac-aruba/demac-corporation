'use client';

import { useMemo, useState } from 'react';
import { validateVoiceNoteDuration, voiceNoteMaxSeconds } from '../../lib/work-orders';
import styles from './field-execution.module.css';

type Step = 'work' | 'equipment' | 'intervention' | 'materials' | 'report' | 'complete';
type Condition = 'good' | 'attention' | 'critical';

type FieldAsset = {
  id: string;
  room: string;
  type: string;
  brand: string;
  capacity: string;
  qr: string;
  nameplateRegistered: boolean;
  lastService: string;
};

type AssetProgress = {
  condition?: Condition;
  refrigerant?: string;
  voltage?: string;
  pressure?: string;
  findings: string;
  workPerformed: string;
  beforePhoto: boolean;
  afterPhoto: boolean;
  gaugeAfterPhoto: boolean;
  completed: boolean;
};

const assets: FieldAsset[] = [
  { id: 'AC-104', room: 'Living Room', type: 'Split', brand: 'Adina Optima', capacity: '18,000 BTU', qr: 'QR-AC-104', nameplateRegistered: true, lastService: 'Apr 18, 2026' },
  { id: 'AC-105', room: 'Master Bedroom', type: 'Split', brand: 'Adina Optima', capacity: '12,000 BTU', qr: 'QR-AC-105', nameplateRegistered: true, lastService: 'Apr 18, 2026' },
  { id: 'AC-106', room: 'Guest Bedroom', type: 'Split', brand: 'Adina Optima', capacity: '12,000 BTU', qr: 'QR pending', nameplateRegistered: false, lastService: 'Jan 9, 2026' },
];

const emptyProgress = (): AssetProgress => ({ findings: '', workPerformed: '', beforePhoto: false, afterPhoto: false, gaugeAfterPhoto: false, completed: false });

export function FieldExecution() {
  const [step, setStep] = useState<Step>('work');
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0].id);
  const [progress, setProgress] = useState<Record<string, AssetProgress>>(() => Object.fromEntries(assets.map((asset) => [asset.id, emptyProgress()])));
  const [materialsReviewed, setMaterialsReviewed] = useState(false);
  const [switchInstalled, setSwitchInstalled] = useState(false);
  const [armaflexRecommended, setArmaflexRecommended] = useState(false);
  const [reportText, setReportText] = useState('');
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [transcriptionStatus, setTranscriptionStatus] = useState<'idle' | 'queued' | 'processing' | 'ready'>('idle');
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0];
  const current = progress[selectedAsset.id];
  const completedCount = Object.values(progress).filter((item) => item.completed).length;
  const allEquipmentComplete = completedCount === assets.length;
  const voiceValidation = voiceSeconds ? validateVoiceNoteDuration(voiceSeconds) : { valid: true, message: 'No voice note recorded.' };
  const canComplete = allEquipmentComplete && materialsReviewed && Boolean(reportText.trim()) && voiceValidation.valid;

  const updateCurrent = (patch: Partial<AssetProgress>) => setProgress((state) => ({ ...state, [selectedAsset.id]: { ...state[selectedAsset.id], ...patch } }));

  const requiredForAsset = useMemo(() => {
    const missing: string[] = [];
    if (!current.condition) missing.push('Equipment condition');
    if (!current.beforePhoto) missing.push('Before photo');
    if (!current.afterPhoto) missing.push('After photo');
    if (!current.gaugeAfterPhoto) missing.push('Gauge photo after service');
    if (!current.workPerformed.trim()) missing.push('Work performed');
    return missing;
  }, [current]);

  const completeAsset = () => {
    if (requiredForAsset.length) {
      setNotice(`Complete first: ${requiredForAsset.join(', ')}.`);
      return;
    }
    updateCurrent({ completed: true });
    setNotice(`${selectedAsset.room} saved. Your previous selections remain stored in this work session.`);
    setStep('equipment');
  };

  const simulateVoice = () => {
    setVoiceSeconds(68);
    setTranscriptionStatus('queued');
    setNotice('Voice note saved (1:08). Transcription queued and can continue while you work.');
  };

  const beginTranscription = () => {
    setTranscriptionStatus('processing');
    setTimeout(() => setTranscriptionStatus('ready'), 500);
  };

  const submit = () => {
    if (!canComplete) return;
    setSubmitted(true);
    setStep('complete');
    setNotice('Field work submitted. Office review and AI professional report happen after technician completion; nothing was sent to the customer automatically.');
  };

  return <section className={styles.page}>
    <header className={styles.mobileHeader}><div><span>DEMAC FIELD</span><strong>My Work</strong></div><div className={styles.avatar}>MR</div></header>

    <main className={styles.shell}>
      <section className={styles.workHero}>
        <div className={styles.statusLine}><span>WO-2308</span><b>IN PROGRESS</b></div>
        <h1>John Smith</h1>
        <p>Noord Residence · Standard service — 3 A/C units</p>
        <div className={styles.schedule}><div><span>Today</span><strong>8:30 AM – 11:30 AM</strong></div><div><span>Van</span><strong>Van 1 · Primary</strong></div></div>
        <div className={styles.instruction}><span>TECHNICIAN INSTRUCTIONS</span><p>Customer has gate access. Start with living-room unit.</p></div>
      </section>

      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <nav className={styles.stepNav} aria-label="Field workflow">
        {(['work','equipment','materials','report','complete'] as Step[]).map((item, index) => <button type="button" key={item} disabled={item === 'complete' && !submitted} className={step === item || (item === 'equipment' && step === 'intervention') ? styles.stepActive : ''} onClick={() => setStep(item)}><span>{index + 1}</span>{item === 'work' ? 'Job' : item === 'equipment' ? 'A/C Units' : item === 'materials' ? 'Add-ons' : item === 'report' ? 'Report' : 'Done'}</button>)}
      </nav>

      {step === 'work' ? <WorkOverview onContinue={() => setStep('equipment')} /> : null}
      {step === 'equipment' ? <EquipmentList progress={progress} onOpen={(assetId) => { setSelectedAssetId(assetId); setStep('intervention'); }} /> : null}
      {step === 'intervention' ? <Intervention asset={selectedAsset} value={current} update={updateCurrent} missing={requiredForAsset} onBack={() => setStep('equipment')} onComplete={completeAsset} /> : null}
      {step === 'materials' ? <Materials reviewed={materialsReviewed} setReviewed={setMaterialsReviewed} switchInstalled={switchInstalled} setSwitchInstalled={setSwitchInstalled} armaflexRecommended={armaflexRecommended} setArmaflexRecommended={setArmaflexRecommended} /> : null}
      {step === 'report' ? <Report reportText={reportText} setReportText={setReportText} voiceSeconds={voiceSeconds} voiceValidation={voiceValidation} transcriptionStatus={transcriptionStatus} simulateVoice={simulateVoice} beginTranscription={beginTranscription} canComplete={canComplete} completedCount={completedCount} materialsReviewed={materialsReviewed} onSubmit={submit} /> : null}
      {step === 'complete' ? <Completion submitted={submitted} /> : null}
    </main>
  </section>;
}

function WorkOverview({ onContinue }: { onContinue: () => void }) {
  return <section className={styles.section}><header><div><span>WORK ORDER</span><h2>Ready to continue</h2></div><b className={styles.ready}>READY</b></header><div className={styles.overviewCards}><article><span>Customer</span><strong>John Smith</strong><small>+297 560 1188</small></article><article><span>Property</span><strong>Noord Residence</strong><small>Primary service site</small></article><article><span>Equipment</span><strong>3 registered A/C units</strong><small>Auto-loaded from Customer 360</small></article><article><span>Last visit</span><strong>Apr 18, 2026</strong><small>History available per unit</small></article></div><div className={styles.dataRule}><strong>No “Search A/C” step</strong><p>The equipment registered at this property is already available below. Scan QR only when useful to identify a specific asset.</p></div><button type="button" className={styles.primaryWide} onClick={onContinue}>Open equipment list →</button></section>;
}

function EquipmentList({ progress, onOpen }: { progress: Record<string, AssetProgress>; onOpen: (assetId: string) => void }) {
  const complete = Object.values(progress).filter((item) => item.completed).length;
  return <section className={styles.section}><header><div><span>EQUIPMENT</span><h2>{complete}/{assets.length} completed</h2></div><b>{Math.round(complete / assets.length * 100)}%</b></header><div className={styles.progressBar}><i style={{ width: `${complete / assets.length * 100}%` }} /></div><div className={styles.assetList}>{assets.map((asset) => { const item = progress[asset.id]; return <button type="button" key={asset.id} onClick={() => onOpen(asset.id)}><span className={styles.assetIcon}>AC</span><div><strong>{asset.room}</strong><small>{asset.type} · {asset.brand} · {asset.capacity}</small><em>{asset.qr} · Last service {asset.lastService}</em></div><b className={item.completed ? styles.done : item.condition ? styles.attention : styles.pending}>{item.completed ? 'DONE' : item.condition ? 'IN PROGRESS' : 'START'}</b><i>›</i></button>; })}</div></section>;
}

function Intervention({ asset, value, update, missing, onBack, onComplete }: { asset: FieldAsset; value: AssetProgress; update: (patch: Partial<AssetProgress>) => void; missing: string[]; onBack: () => void; onComplete: () => void }) {
  return <section className={styles.section}><header><button type="button" className={styles.back} onClick={onBack}>‹</button><div><span>{asset.id}</span><h2>{asset.room}</h2></div><b>{asset.capacity}</b></header><div className={styles.assetSummary}><div className={styles.assetIconLarge}>AC</div><div><strong>{asset.brand}</strong><span>{asset.type} · {asset.capacity}</span><small>{asset.qr}</small></div></div>
    <div className={styles.formCard}><div className={styles.formTitle}><strong>1 · Condition</strong><span>Your selections are preserved if another requirement is missing.</span></div><div className={styles.conditionGrid}>{(['good','attention','critical'] as Condition[]).map((condition) => <button type="button" key={condition} className={value.condition === condition ? styles.conditionSelected : ''} onClick={() => update({ condition })}>{condition === 'good' ? '✓ Good' : condition === 'attention' ? '! Attention' : '× Critical'}</button>)}</div></div>
    <div className={styles.formCard}><div className={styles.formTitle}><strong>2 · Before evidence</strong><span>Use lightweight thumbnails in the workflow.</span></div><PhotoToggle label="Before service photo" active={value.beforePhoto} onClick={() => update({ beforePhoto: !value.beforePhoto })} />{asset.nameplateRegistered ? <div className={styles.nameplateOk}><span>✓</span><div><strong>Nameplate already registered</strong><small>Do not recapture unless missing, changed or correcting asset identity.</small></div></div> : <PhotoToggle label="Nameplate photo · required because registry is missing it" active={false} onClick={() => {}} />}</div>
    <div className={styles.formCard}><div className={styles.formTitle}><strong>3 · Measurements</strong><span>Only relevant measurements for this intervention.</span></div><div className={styles.inputGrid}><label><span>Voltage</span><div><input value={value.voltage ?? ''} onChange={(event) => update({ voltage: event.target.value })} inputMode="decimal" /><b>V</b></div></label><label><span>Pressure after service</span><div><input value={value.pressure ?? ''} onChange={(event) => update({ pressure: event.target.value })} inputMode="decimal" /><b>psi</b></div></label><label className={styles.full}><span>Refrigerant condition</span><select value={value.refrigerant ?? ''} onChange={(event) => update({ refrigerant: event.target.value })}><option value="">Select...</option><option>Normal</option><option>Low / investigate</option><option>Not applicable</option></select></label></div><PhotoToggle label="Gauge photo after service" active={value.gaugeAfterPhoto} onClick={() => update({ gaugeAfterPhoto: !value.gaugeAfterPhoto })} /></div>
    <div className={styles.formCard}><div className={styles.formTitle}><strong>4 · Findings & work performed</strong><span>Technical evidence stays separate from later AI wording.</span></div><label className={styles.textField}><span>Findings</span><textarea rows={3} value={value.findings} onChange={(event) => update({ findings: event.target.value })} placeholder="What did you find?" /></label><label className={styles.textField}><span>Work performed *</span><textarea rows={3} value={value.workPerformed} onChange={(event) => update({ workPerformed: event.target.value })} placeholder="What did you do?" /></label></div>
    <div className={styles.formCard}><div className={styles.formTitle}><strong>5 · After evidence</strong><span>Final visual condition.</span></div><PhotoToggle label="After service photo" active={value.afterPhoto} onClick={() => update({ afterPhoto: !value.afterPhoto })} /></div>
    {missing.length ? <div className={styles.missing}><strong>Before completing this unit</strong><p>{missing.join(' · ')}</p></div> : null}<button type="button" className={styles.primaryWide} onClick={onComplete}>{value.completed ? 'Update equipment result' : 'Complete this A/C unit'}</button>
  </section>;
}

function PhotoToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button type="button" className={`${styles.photoButton} ${active ? styles.photoDone : ''}`} onClick={onClick}><span>{active ? '✓' : '＋'}</span><div><strong>{label}</strong><small>{active ? 'Thumbnail saved in work session' : 'Take photo'}</small></div><b>{active ? 'DONE' : 'CAMERA'}</b></button>; }

function Materials({ reviewed, setReviewed, switchInstalled, setSwitchInstalled, armaflexRecommended, setArmaflexRecommended }: { reviewed: boolean; setReviewed: (v: boolean) => void; switchInstalled: boolean; setSwitchInstalled: (v: boolean) => void; armaflexRecommended: boolean; setArmaflexRecommended: (v: boolean) => void }) {
  return <section className={styles.section}><header><div><span>MATERIALS & ADD-ONS</span><h2>Review before field submission</h2></div><b>{reviewed ? 'READY' : 'OPEN'}</b></header><div className={styles.addOnList}><label><input type="checkbox" checked={switchInstalled} onChange={(event) => setSwitchInstalled(event.target.checked)} /><div><strong>220V switch installed</strong><small>Billable add-on · future van inventory deduction</small></div><b>Afl. 75</b></label><label><input type="checkbox" checked={armaflexRecommended} onChange={(event) => setArmaflexRecommended(event.target.checked)} /><div><strong>Armaflex replacement recommended</strong><small>Creates recommendation/opportunity; not automatically invoiced</small></div><b>Recommendation</b></label><div className={styles.materialLine}><span>Foam tape</span><strong>1 roll</strong><small>Pending inventory consumption</small></div><div className={styles.materialLine}><span>Electrical wire</span><strong>2 m</strong><small>Measured consumption</small></div></div><label className={styles.reviewBox}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><div><strong>I reviewed materials and add-ons</strong><span>This must remain checked when you return to the report screen.</span></div></label></section>;
}

function Report({ reportText, setReportText, voiceSeconds, voiceValidation, transcriptionStatus, simulateVoice, beginTranscription, canComplete, completedCount, materialsReviewed, onSubmit }: { reportText: string; setReportText: (v: string) => void; voiceSeconds: number; voiceValidation: { valid: boolean; message: string }; transcriptionStatus: string; simulateVoice: () => void; beginTranscription: () => void; canComplete: boolean; completedCount: number; materialsReviewed: boolean; onSubmit: () => void }) {
  return <section className={styles.section}><header><div><span>FIELD REPORT</span><h2>Technician original report</h2></div><b>{completedCount}/{assets.length} A/C</b></header><div className={styles.reportStatus}><div className={completedCount === assets.length ? styles.checkGood : styles.checkWarn}><span>{completedCount === assets.length ? '✓' : '!'}</span><div><strong>Equipment interventions</strong><small>{completedCount}/{assets.length} completed</small></div></div><div className={materialsReviewed ? styles.checkGood : styles.checkWarn}><span>{materialsReviewed ? '✓' : '!'}</span><div><strong>Materials & add-ons</strong><small>{materialsReviewed ? 'Reviewed' : 'Review required'}</small></div></div></div><label className={styles.textField}><span>Work summary *</span><textarea rows={6} value={reportText} onChange={(event) => setReportText(event.target.value)} placeholder="Summarize work performed, relevant findings and recommendations..." /></label><div className={styles.voicePanel}><header><div><strong>Voice note</strong><span>Maximum {voiceNoteMaxSeconds / 60} minutes</span></div>{voiceSeconds ? <b className={voiceValidation.valid ? styles.done : styles.critical}>{voiceSeconds}s</b> : null}</header>{voiceSeconds ? <div className={styles.audioRow}><button type="button">▶</button><div><strong>Field voice note</strong><small>{voiceValidation.message}</small></div><span>{transcriptionStatus}</span></div> : <button type="button" className={styles.recordButton} onClick={simulateVoice}>● Record voice note</button>}{voiceSeconds && transcriptionStatus === 'queued' ? <button type="button" className={styles.transcribeButton} onClick={beginTranscription}>Start background transcription</button> : null}{transcriptionStatus === 'processing' || transcriptionStatus === 'ready' ? <div className={styles.transcription}><strong>{transcriptionStatus === 'ready' ? 'Transcription ready' : 'Transcribing in background...'}</strong><p>{transcriptionStatus === 'ready' ? 'Preview transcript: technician described completed service and insulation deterioration on the bedroom outdoor line.' : 'You may continue working; this job does not need to block the UI.'}</p></div> : null}</div><button type="button" className={styles.primaryWide} disabled={!canComplete} onClick={onSubmit}>Complete field work</button><p className={styles.submitHelp}>Completing field work sends the report to AI processing / office review. It does not send a customer report.</p></section>;
}

function Completion({ submitted }: { submitted: boolean }) { return <section className={styles.section}><div className={styles.completeHero}><span>✓</span><h2>{submitted ? 'Field work submitted' : 'Work not submitted'}</h2><p>Technician execution is complete. The office now receives the original report, audio, asset results, evidence and add-ons for review.</p></div><div className={styles.nextSteps}><div><span>1</span><div><strong>AI processing</strong><small>Transcription and professional draft can run asynchronously.</small></div><b>QUEUED</b></div><div><span>2</span><div><strong>Office review</strong><small>Original evidence + professionalized version.</small></div><b>WAITING</b></div><div><span>3</span><div><strong>Customer delivery</strong><small>Office manually approves and chooses WhatsApp/email.</small></div><b>NOT SENT</b></div></div><button type="button" className={styles.primaryWide}>Return to My Work</button></section>; }
