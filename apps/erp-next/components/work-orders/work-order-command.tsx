'use client';

import { useMemo, useState } from 'react';
import type { AddOnLine, EquipmentIntervention, FieldAssignment, MaterialUsageLine, OfficeReviewRecord, WorkOrderAsset, WorkOrderLifecycleStatus, WorkOrderRecord } from '../../lib/work-orders';
import { canSubmitFieldReport, createDefaultReportOutputs, nextLifecycleStatus, shouldRequestNameplateEvidence, validateVoiceNoteDuration, voiceNoteMaxSeconds } from '../../lib/work-orders';
import styles from './work-order-command.module.css';

type Tab = 'Overview' | 'Equipment' | 'Field Report' | 'Materials & Add-ons' | 'Evidence' | 'Office Review' | 'History';

const tabs: Tab[] = ['Overview', 'Equipment', 'Field Report', 'Materials & Add-ons', 'Evidence', 'Office Review', 'History'];

const seedAssets: WorkOrderAsset[] = [
  { id: 'AC-104', siteId: 'SITE-44', room: 'Living Room', systemType: 'Split', brand: 'Adina Optima', capacity: '18,000 BTU', serialNumber: 'AD18-24018', qrCode: 'QR-AC-104', lastServiceAt: '2026-04-18', nameplateRegistered: true },
  { id: 'AC-105', siteId: 'SITE-44', room: 'Master Bedroom', systemType: 'Split', brand: 'Adina Optima', capacity: '12,000 BTU', serialNumber: 'AD12-24051', qrCode: 'QR-AC-105', lastServiceAt: '2026-04-18', nameplateRegistered: true },
  { id: 'AC-106', siteId: 'SITE-44', room: 'Guest Bedroom', systemType: 'Split', brand: 'Adina Optima', capacity: '12,000 BTU', serialNumber: 'AD12-24059', lastServiceAt: '2026-01-09', nameplateRegistered: false },
];

const seedAssignments: FieldAssignment[] = [
  { id: 'ASG-1', workOrderId: 'WO-2308', vanId: 'VAN-1', teamLabel: 'Team 1', technicianNames: ['Miguel', 'Helper'], isPrimary: true, customerCommunicationOwner: true },
  { id: 'ASG-2', workOrderId: 'WO-2312', vanId: 'VAN-2', teamLabel: 'Team 2', technicianNames: ['Ronald', 'Edwin'], isPrimary: true, customerCommunicationOwner: true },
  { id: 'ASG-3', workOrderId: 'WO-2312', vanId: 'VAN-3', teamLabel: 'Team 3 · Support', technicianNames: ['Walter', 'Mario'], isPrimary: false, customerCommunicationOwner: false, supportForAssignmentId: 'ASG-2' },
];

const seedWorkOrders: WorkOrderRecord[] = [
  { id: 'WO-2308', customerId: 'C-0887', customerName: 'John Smith', siteId: 'SITE-44', siteName: 'Noord Residence', siteAddress: 'Noord, Aruba', workType: 'Standard service', customerFacingDescription: 'Standard service — 3 A/C units', technicianInstructions: 'Customer has gate access. Start with living-room unit.', appointmentId: 'APT-902', scheduledDate: '2026-08-10', scheduledStart: '08:30', scheduledEnd: '11:30', lifecycle: 'working', readiness: 'ready', assetIds: ['AC-104', 'AC-105', 'AC-106'], assignmentIds: ['ASG-1'], reportStatus: 'in_progress', priority: 'normal' },
  { id: 'WO-2312', customerId: 'C-1201', customerName: 'Ocean View Villas', siteId: 'SITE-72', siteName: 'Palm Beach Property', siteAddress: 'Palm Beach, Aruba', workType: 'Standard service', customerFacingDescription: 'Standard service — 10 A/C units', technicianInstructions: 'Primary + support van. One customer communication owner.', appointmentId: 'APT-910', scheduledDate: '2026-08-10', scheduledStart: '08:30', scheduledEnd: '16:30', lifecycle: 'scheduled', readiness: 'ready', assetIds: ['AC-201', 'AC-202', 'AC-203', 'AC-204', 'AC-205', 'AC-206', 'AC-207', 'AC-208', 'AC-209', 'AC-210'], assignmentIds: ['ASG-2', 'ASG-3'], reportStatus: 'not_started', priority: 'high' },
  { id: 'WO-2297', customerId: 'C-1042', customerName: 'ABC Aruba N.V.', siteId: 'SITE-12', siteName: 'Oranjestad Office', siteAddress: 'Oranjestad, Aruba', workType: 'Deep cleaning', customerFacingDescription: 'Deep cleaning — 2 A/C units', appointmentId: 'APT-877', scheduledDate: '2026-08-10', scheduledStart: '08:30', scheduledEnd: '11:30', lifecycle: 'office_review', readiness: 'ready', assetIds: ['AC-330', 'AC-331'], assignmentIds: ['ASG-4'], reportStatus: 'office_review', priority: 'normal' },
  { id: 'WO-2301', customerId: 'C-0741', customerName: 'Maria Croes', siteId: 'SITE-88', siteName: 'Santa Cruz Home', siteAddress: 'Santa Cruz, Aruba', workType: 'Diagnostic / checkup', customerFacingDescription: 'A/C diagnostic / checkup', appointmentId: 'APT-881', scheduledDate: '2026-08-10', scheduledStart: '13:30', scheduledEnd: '14:15', lifecycle: 'scheduled', readiness: 'blocked', assetIds: ['AC-501'], assignmentIds: ['ASG-5'], reportStatus: 'not_started', priority: 'high' },
];

const seedInterventions: EquipmentIntervention[] = [
  { id: 'INT-1', workOrderId: 'WO-2308', assetId: 'AC-104', assetLabel: 'Living Room · 18,000 BTU', condition: 'good', findings: ['Drain and evaporator condition normal'], actions: ['Standard service completed', 'Filter cleaned'], measurements: [{ id: 'M-1', label: 'Voltage', value: '228', unit: 'V', phase: 'diagnostic' }, { id: 'M-2', label: 'Low-side pressure', value: '126', unit: 'psi', phase: 'after' }], evidenceIds: ['EV-1', 'EV-2'], nameplateAlreadyRegistered: true },
  { id: 'INT-2', workOrderId: 'WO-2308', assetId: 'AC-105', assetLabel: 'Master Bedroom · 12,000 BTU', condition: 'attention', findings: ['Outdoor insulation showing UV deterioration'], actions: ['Standard service completed'], measurements: [{ id: 'M-3', label: 'Voltage', value: '226', unit: 'V', phase: 'diagnostic' }], evidenceIds: ['EV-3'], nameplateAlreadyRegistered: true },
];

const seedMaterials: MaterialUsageLine[] = [
  { id: 'MAT-1', workOrderId: 'WO-2308', itemId: 'INV-TAPE-01', itemName: 'Foam tape', quantity: 1, unitOfMeasure: 'roll', classification: 'consumable', inventoryEffect: 'pending' },
  { id: 'MAT-2', workOrderId: 'WO-2308', itemId: 'INV-WIRE-12', itemName: 'Electrical wire', quantity: 2, unitOfMeasure: 'm', classification: 'measured_consumable', inventoryEffect: 'pending' },
];

const seedAddOns: AddOnLine[] = [
  { id: 'ADD-1', workOrderId: 'WO-2308', type: 'switch_220v', label: '220V switch replacement', quantity: 1, unitPriceAfl: 75, status: 'accepted', assetId: 'AC-105' },
  { id: 'ADD-2', workOrderId: 'WO-2308', type: 'armaflex', label: 'Outdoor Armaflex replacement', quantity: 1, status: 'proposed', assetId: 'AC-105' },
];

const lifecycleSteps: Array<{ key: WorkOrderLifecycleStatus; label: string }> = [
  { key: 'scheduled', label: 'Scheduled' }, { key: 'en_route', label: 'En route' }, { key: 'on_site', label: 'On site' }, { key: 'working', label: 'Working' }, { key: 'technician_complete', label: 'Tech complete' }, { key: 'office_review', label: 'Office review' }, { key: 'closed', label: 'Closed' },
];

function statusIndex(status: WorkOrderLifecycleStatus) {
  return lifecycleSteps.findIndex((step) => step.key === status);
}

function readinessTone(readiness: WorkOrderRecord['readiness']) {
  return readiness === 'ready' ? styles.ready : readiness === 'blocked' ? styles.blocked : readiness === 'at_risk' ? styles.risk : styles.muted;
}

export function WorkOrderCommand() {
  const [orders, setOrders] = useState(seedWorkOrders);
  const [selectedId, setSelectedId] = useState(seedWorkOrders[0].id);
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [technicianText, setTechnicianText] = useState('Serviced living room and master bedroom units. Master bedroom outdoor insulation needs replacement. Guest bedroom unit still pending.');
  const [voiceSeconds, setVoiceSeconds] = useState(74);
  const [addOnsReviewed, setAddOnsReviewed] = useState(false);
  const [interventions, setInterventions] = useState(seedInterventions);
  const [officeReview, setOfficeReview] = useState<OfficeReviewRecord>({
    workOrderId: 'WO-2297', status: 'waiting', originalReport: 'Technician completed deep cleaning on both units. Drain lines cleaned and operation checked.', professionalReport: 'Deep cleaning was completed on both A/C systems. Drain lines were cleaned and operating condition was verified. No critical issues were identified during this visit.', outputs: createDefaultReportOutputs(),
  });
  const [notice, setNotice] = useState<string | null>(null);

  const selected = orders.find((order) => order.id === selectedId) ?? orders[0];
  const selectedAssignments = seedAssignments.filter((assignment) => selected.assignmentIds.includes(assignment.id));
  const selectedAssets = selected.id === 'WO-2308' ? seedAssets : selected.assetIds.map((id, index) => ({ id, siteId: selected.siteId, room: `Equipment ${index + 1}`, systemType: 'Split', brand: 'Registered asset', capacity: index % 2 ? '12,000 BTU' : '18,000 BTU', nameplateRegistered: true } satisfies WorkOrderAsset));
  const selectedInterventions = interventions.filter((item) => item.workOrderId === selected.id);
  const selectedMaterials = seedMaterials.filter((item) => item.workOrderId === selected.id);
  const selectedAddOns = seedAddOns.filter((item) => item.workOrderId === selected.id);
  const submission = useMemo(() => canSubmitFieldReport({ interventions: selectedInterventions, selectedAssetIds: selected.assetIds, reportText: technicianText, addOnsReviewed }), [selectedInterventions, selected.assetIds, technicianText, addOnsReviewed]);
  const voiceValidation = validateVoiceNoteDuration(voiceSeconds);

  const transition = () => {
    const next = nextLifecycleStatus(selected.lifecycle);
    if (next === selected.lifecycle) return;
    setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, lifecycle: next, reportStatus: next === 'technician_complete' ? 'submitted' : next === 'office_review' ? 'office_review' : order.reportStatus } : order));
    setNotice(`${selected.id} moved to ${next.replaceAll('_', ' ')} in preview.`);
  };

  const submitFieldReport = () => {
    if (!submission.allowed) return;
    setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, lifecycle: 'technician_complete', reportStatus: 'ai_processing' } : order));
    setNotice('Technician report submitted. AI professionalization/transcription can continue asynchronously while office review remains a separate step.');
  };

  const approveOfficeReview = () => {
    setOfficeReview((current) => ({ ...current, status: 'approved', reviewedBy: 'Office reviewer', reviewedAt: 'Now', outputs: current.outputs.map((output) => ({ ...output, status: 'reviewed' })) }));
    setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, lifecycle: 'office_review', reportStatus: 'approved' } : order));
    setNotice('Professional report approved. It is ready for manual customer delivery; nothing was auto-sent.');
  };

  return <section className={styles.page}>
    <header className={styles.pageHeader}><div><span>Operations · Execution</span><h1>Work Orders & Field Operations</h1><p>The calendar schedules the visit. The Work Order owns execution, equipment interventions, evidence, materials, technician reporting and office review.</p></div><div className={styles.pageActions}><button type="button">Filters</button><button type="button" className={styles.primary}>+ New work order</button></div></header>

    {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

    <div className={styles.metrics}><article><span>Today</span><strong>{orders.length}</strong><small>Scheduled work orders</small><i style={{ width: '72%' }} /></article><article><span>In Progress</span><strong>{orders.filter((order) => ['en_route','on_site','working'].includes(order.lifecycle)).length}</strong><small>Field execution active</small><i style={{ width: '42%' }} /></article><article><span>Office Review</span><strong>{orders.filter((order) => order.lifecycle === 'office_review').length}</strong><small>Reports waiting/reviewing</small><i style={{ width: '28%' }} /></article><article><span>Blocked</span><strong className={styles.dangerText}>{orders.filter((order) => order.readiness === 'blocked').length}</strong><small>Readiness requires action</small><i style={{ width: '18%' }} /></article></div>

    <div className={styles.workspace}>
      <aside className={styles.queuePanel}><header><div><strong>Work Queue</strong><span>Operational execution</span></div><button type="button">≡</button></header><div className={styles.queue}>{orders.map((order) => <button type="button" key={order.id} onClick={() => { setSelectedId(order.id); setActiveTab('Overview'); }} className={`${styles.queueItem} ${order.id === selected.id ? styles.queueSelected : ''}`}><div><span>{order.id}</span><b className={readinessTone(order.readiness)}>{order.readiness.replace('_',' ')}</b></div><strong>{order.customerName}</strong><small>{order.workType} · {order.scheduledStart}</small><em>{order.siteName}</em><i>{order.lifecycle.replaceAll('_',' ')}</i></button>)}</div></aside>

      <main className={styles.detail}>
        <section className={styles.hero}><div><span>{selected.id} · {selected.priority.toUpperCase()}</span><h2>{selected.customerName}</h2><p>{selected.siteName} · {selected.siteAddress}</p><small>{selected.customerFacingDescription}</small></div><div className={styles.heroActions}><b className={readinessTone(selected.readiness)}>{selected.readiness.replace('_',' ')}</b><button type="button" onClick={transition}>Advance status →</button></div></section>

        <section className={styles.lifecycle}>{lifecycleSteps.map((step, index) => { const active = index <= statusIndex(selected.lifecycle); return <div key={step.key} className={active ? styles.stepDone : ''}><span>{active ? '✓' : index + 1}</span><strong>{step.label}</strong></div>; })}</section>

        <nav className={styles.tabs}>{tabs.map((tab) => <button type="button" key={tab} className={tab === activeTab ? styles.tabActive : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>

        {activeTab === 'Overview' ? <OverviewTab order={selected} assignments={selectedAssignments} assets={selectedAssets} /> : null}
        {activeTab === 'Equipment' ? <EquipmentTab assets={selectedAssets} interventions={selectedInterventions} setInterventions={setInterventions} workOrderId={selected.id} /> : null}
        {activeTab === 'Field Report' ? <FieldReportTab order={selected} technicianText={technicianText} setTechnicianText={setTechnicianText} voiceSeconds={voiceSeconds} setVoiceSeconds={setVoiceSeconds} voiceValid={voiceValidation.valid} voiceMessage={voiceValidation.message} submission={submission} addOnsReviewed={addOnsReviewed} onSubmit={submitFieldReport} /> : null}
        {activeTab === 'Materials & Add-ons' ? <MaterialsTab materials={selectedMaterials} addOns={selectedAddOns} reviewed={addOnsReviewed} setReviewed={setAddOnsReviewed} /> : null}
        {activeTab === 'Evidence' ? <EvidenceTab assets={selectedAssets} /> : null}
        {activeTab === 'Office Review' ? <OfficeReviewTab order={selected} review={officeReview} setReview={setOfficeReview} onApprove={approveOfficeReview} /> : null}
        {activeTab === 'History' ? <HistoryTab order={selected} /> : null}
      </main>

      <aside className={styles.intelligence}><div className={styles.aiTitle}><span>AI</span><div><strong>Work Intelligence</strong><small>Evidence + workflow facts</small></div></div><section><span>Readiness</span><strong className={readinessTone(selected.readiness)}>{selected.readiness.toUpperCase()}</strong><p>{selected.readiness === 'blocked' ? 'Resolve blocking requirements before dispatch or manager override.' : 'Current preview readiness is compatible with execution.'}</p></section><section><span>Field completion</span><strong>{selectedInterventions.length}/{selected.assetIds.length} assets</strong><div className={styles.progress}><i style={{ width: `${Math.min(100, selectedInterventions.length / Math.max(1, selected.assetIds.length) * 100)}%` }} /></div><p>Each selected asset should receive its own intervention result.</p></section><section><span>Customer communication</span><strong>{selectedAssignments.filter((assignment) => assignment.customerCommunicationOwner).length} owner</strong><p>Support assignments can execute work without duplicating confirmations or reminders.</p></section><section><span>Report control</span><strong>{selected.reportStatus.replaceAll('_',' ')}</strong><p>AI can draft and translate, but office review controls customer delivery.</p></section></aside>
    </div>
  </section>;
}

function OverviewTab({ order, assignments, assets }: { order: WorkOrderRecord; assignments: FieldAssignment[]; assets: WorkOrderAsset[] }) {
  return <div className={styles.contentGrid}><section className={styles.card}><header><div><strong>Work Order Summary</strong><span>Execution truth</span></div><button type="button">Edit</button></header><div className={styles.infoGrid}><div><span>Appointment</span><strong>{order.appointmentId ?? 'None'}</strong></div><div><span>Schedule</span><strong>{order.scheduledDate} · {order.scheduledStart}–{order.scheduledEnd}</strong></div><div><span>Customer description</span><strong>{order.customerFacingDescription}</strong></div><div><span>Technician instructions</span><strong>{order.technicianInstructions || 'None'}</strong></div></div></section><section className={styles.card}><header><div><strong>Assignments</strong><span>Primary + support without duplicate job</span></div><button type="button">Manage</button></header><div className={styles.assignmentList}>{assignments.map((assignment) => <article key={assignment.id}><div className={styles.vanBadge}>{assignment.vanId.replace('VAN-','V')}</div><div><strong>{assignment.teamLabel}</strong><span>{assignment.technicianNames.join(' · ')}</span><small>{assignment.isPrimary ? 'Primary assignment' : 'Support assignment'} · {assignment.customerCommunicationOwner ? 'Customer communication owner' : 'No customer messages'}</small></div><b>{assignment.isPrimary ? 'PRIMARY' : 'SUPPORT'}</b></article>)}</div></section><section className={`${styles.card} ${styles.fullWidth}`}><header><div><strong>Equipment Scope</strong><span>Assets belong to property; Work Order references them</span></div><button type="button">Open equipment</button></header><div className={styles.assetStrip}>{assets.slice(0,6).map((asset) => <article key={asset.id}><span>AC</span><div><strong>{asset.room}</strong><small>{asset.brand} · {asset.capacity}</small></div><b>{asset.qrCode ? 'QR' : 'ID'}</b></article>)}{assets.length > 6 ? <article className={styles.moreAssets}><strong>+{assets.length - 6}</strong><small>more assets</small></article> : null}</div></section></div>;
}

function EquipmentTab({ assets, interventions, setInterventions, workOrderId }: { assets: WorkOrderAsset[]; interventions: EquipmentIntervention[]; setInterventions: React.Dispatch<React.SetStateAction<EquipmentIntervention[]>>; workOrderId: string }) {
  const addResult = (asset: WorkOrderAsset) => {
    if (interventions.some((item) => item.assetId === asset.id)) return;
    setInterventions((current) => [...current, { id: `INT-${Date.now()}`, workOrderId, assetId: asset.id, assetLabel: `${asset.room} · ${asset.capacity}`, condition: 'good', findings: [], actions: ['Service result recorded'], measurements: [], evidenceIds: [], nameplateAlreadyRegistered: asset.nameplateRegistered }]);
  };
  return <section className={styles.cardPanel}><header><div><strong>Equipment Interventions</strong><span>One result per selected HVAC asset</span></div><b>{interventions.length}/{assets.length} complete</b></header><div className={styles.equipmentList}>{assets.map((asset) => { const intervention = interventions.find((item) => item.assetId === asset.id); const needsPlate = shouldRequestNameplateEvidence(asset); return <article key={asset.id}><div className={styles.assetLarge}>AC</div><div className={styles.assetInfo}><div><strong>{asset.room}</strong><span>{intervention ? intervention.condition.toUpperCase() : 'PENDING'}</span></div><p>{asset.systemType} · {asset.brand} · {asset.capacity}</p><small>{asset.qrCode ?? asset.id} · Last service {asset.lastServiceAt ?? 'not recorded'}</small><em>{needsPlate ? 'Nameplate evidence required — missing in asset registry' : 'Nameplate already registered — do not recapture unless changed/corrected'}</em></div>{intervention ? <button type="button">Open result</button> : <button type="button" className={styles.primarySmall} onClick={() => addResult(asset)}>Record result</button>}</article>; })}</div></section>;
}

function FieldReportTab({ order, technicianText, setTechnicianText, voiceSeconds, setVoiceSeconds, voiceValid, voiceMessage, submission, addOnsReviewed, onSubmit }: { order: WorkOrderRecord; technicianText: string; setTechnicianText: (value: string) => void; voiceSeconds: number; setVoiceSeconds: (value: number) => void; voiceValid: boolean; voiceMessage: string; submission: ReturnType<typeof canSubmitFieldReport>; addOnsReviewed: boolean; onSubmit: () => void }) {
  return <div className={styles.reportGrid}><section className={styles.card}><header><div><strong>Technician Original Report</strong><span>Preserved exactly as field evidence</span></div><b>{order.reportStatus.replaceAll('_',' ')}</b></header><label className={styles.textArea}><span>Work performed / findings</span><textarea rows={8} value={technicianText} onChange={(event) => setTechnicianText(event.target.value)} /></label><div className={styles.voiceCard}><div><span>🎙</span><div><strong>Voice note</strong><small>Maximum {voiceNoteMaxSeconds / 60} minutes · transcription can continue in background</small></div></div><label><span>Preview duration</span><input type="number" min={1} max={180} value={voiceSeconds} onChange={(event) => setVoiceSeconds(Number(event.target.value) || 0)} /><b className={voiceValid ? styles.goodText : styles.dangerText}>{voiceMessage}</b></label></div></section><section className={styles.card}><header><div><strong>Submission Gate</strong><span>Technician completion must be structurally complete</span></div><b className={submission.allowed ? styles.goodText : styles.dangerText}>{submission.allowed ? 'READY' : 'BLOCKED'}</b></header><div className={styles.gateList}><div className={styles.goodText}>✓ Work summary entered</div><div className={addOnsReviewed ? styles.goodText : styles.warningText}>{addOnsReviewed ? '✓ Materials/add-ons reviewed' : '! Review materials/add-ons before submit'}</div>{submission.blockers.map((blocker) => <div className={styles.dangerText} key={blocker}>! {blocker}</div>)}</div><button type="button" className={styles.primaryWide} disabled={!submission.allowed || !voiceValid} onClick={onSubmit}>Complete field work & generate AI draft</button><p className={styles.helper}>This does not send anything to the customer. It moves the report into AI processing / office review.</p></section></div>;
}

function MaterialsTab({ materials, addOns, reviewed, setReviewed }: { materials: MaterialUsageLine[]; addOns: AddOnLine[]; reviewed: boolean; setReviewed: (value: boolean) => void }) {
  return <div className={styles.contentGrid}><section className={styles.card}><header><div><strong>Materials Used</strong><span>Future inventory consumption source</span></div><button type="button">+ Add material</button></header><div className={styles.lineList}>{materials.length ? materials.map((item) => <div key={item.id}><div><strong>{item.itemName}</strong><span>{item.classification.replace('_',' ')}</span></div><b>{item.quantity} {item.unitOfMeasure}</b><small>{item.inventoryEffect}</small></div>) : <p className={styles.empty}>No materials recorded.</p>}</div></section><section className={styles.card}><header><div><strong>Add-ons / Billable Work</strong><span>Before office review and invoice generation</span></div><button type="button">+ Add item</button></header><div className={styles.lineList}>{addOns.length ? addOns.map((item) => <div key={item.id}><div><strong>{item.label}</strong><span>{item.assetId ?? 'Work order level'}</span></div><b>{item.quantity}× {item.unitPriceAfl ? `Afl. ${item.unitPriceAfl}` : 'price pending'}</b><small>{item.status}</small></div>) : <p className={styles.empty}>No add-ons recorded.</p>}</div></section><label className={`${styles.reviewCheck} ${styles.fullWidth}`}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><div><strong>Materials & add-ons reviewed</strong><span>Confirm field usage/recommendations before technician submission.</span></div></label></div>;
}

function EvidenceTab({ assets }: { assets: WorkOrderAsset[] }) {
  return <section className={styles.cardPanel}><header><div><strong>Evidence Library</strong><span>Low-resolution thumbnails in workflow; original files retained separately</span></div><button type="button">+ Capture evidence</button></header><div className={styles.evidenceGrid}>{assets.map((asset, index) => <article key={asset.id}><div className={styles.photoPlaceholder}><span>PHOTO</span><small>{index % 2 ? 'After service' : 'Gauge / condition'}</small></div><strong>{asset.room}</strong><span>{asset.id} · asset-linked evidence</span></article>)}</div></section>;
}

function OfficeReviewTab({ order, review, setReview, onApprove }: { order: WorkOrderRecord; review: OfficeReviewRecord; setReview: React.Dispatch<React.SetStateAction<OfficeReviewRecord>>; onApprove: () => void }) {
  const activeReview = order.lifecycle === 'office_review' || order.reportStatus === 'office_review' || order.reportStatus === 'approved';
  return <div className={styles.reviewLayout}><section className={styles.card}><header><div><strong>Original Technician Report</strong><span>Never overwritten</span></div><b>ORIGINAL</b></header><div className={styles.reportText}>{activeReview ? review.originalReport : 'The original technician report will appear here after field submission.'}</div><div className={styles.audioPreview}><span>▶</span><div><strong>Field voice note</strong><small>Audio remains available to office reviewer</small></div></div></section><section className={styles.card}><header><div><strong>AI Professionalized Report</strong><span>Concise client-suitable draft</span></div><b>AI DRAFT</b></header><textarea className={styles.reviewEditor} rows={8} value={activeReview ? review.professionalReport : ''} placeholder="AI professional report appears after technician submission." onChange={(event) => setReview((current) => ({ ...current, status: 'editing', professionalReport: event.target.value }))} /><div className={styles.languageList}>{review.outputs.map((output) => <div key={output.language}><span>{output.label}</span><b>{activeReview ? output.status : 'pending'}</b></div>)}</div><button type="button" className={styles.primaryWide} disabled={!activeReview} onClick={onApprove}>Approve professional report</button></section><section className={`${styles.deliveryCard} ${styles.fullWidth}`}><div><strong>Customer delivery is manual/controlled</strong><p>After approval, office chooses WhatsApp or email. ERP Next does not auto-send technician reports at field completion.</p></div><button type="button" disabled={review.status !== 'approved'}>Send to customer</button></section></div>;
}

function HistoryTab({ order }: { order: WorkOrderRecord }) {
  return <section className={styles.cardPanel}><header><div><strong>Work Order History</strong><span>Append-only operational audit preview</span></div><button type="button">Audit details</button></header><div className={styles.history}><div><time>08:04</time><span /><div><strong>Readiness checked</strong><p>Van, team, route and work scope validated.</p></div></div><div><time>{order.scheduledStart}</time><span /><div><strong>Scheduled start</strong><p>Appointment {order.appointmentId ?? 'not linked'} provided schedule context.</p></div></div><div><time>09:02</time><span /><div><strong>Field execution updated</strong><p>Status moved to {order.lifecycle.replaceAll('_',' ')}.</p></div></div></div></section>;
}
