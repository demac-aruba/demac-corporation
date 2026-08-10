'use client';

import { useMemo, useState } from 'react';
import type { DispatchJob, BookingRequest, CandidateSlot, WorkPresetId } from '../../lib/scheduling';
import { customerFacingDescription, defaultWorkPresets, evaluateReadiness, findCandidateSlots, getHalfDayAnchor, previewVans } from '../../lib/scheduling';
import styles from './dispatch-board.module.css';

const previewJobs: DispatchJob[] = [
  { id: 'WO-2184', customer: 'John Smith', site: 'Noord Residence', sector: 'Noord', start: '08:30', end: '09:30', segment: 'am', vanId: 'VAN-1', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2188', customer: 'Maria Croes', site: 'Noord Apartment', sector: 'Noord', start: '09:30', end: '10:30', segment: 'am', vanId: 'VAN-1', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2196', customer: 'Palm Beach Villas', site: 'Villa 12', sector: 'Palm Beach', start: '13:30', end: '15:00', segment: 'pm', vanId: 'VAN-1', presetId: 'repair', quantity: 1, status: 'confirmed', readiness: 'at_risk', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2185', customer: 'ABC Aruba N.V.', site: 'Oranjestad Office', sector: 'Oranjestad', start: '08:30', end: '10:30', segment: 'am', vanId: 'VAN-2', presetId: 'deep_cleaning', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2191', customer: 'Ocean View Villas', site: 'Palm Beach Property', sector: 'Palm Beach', start: '13:30', end: '14:30', segment: 'pm', vanId: 'VAN-2', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2186', customer: 'Renaissance Engineering', site: 'Oranjestad Hotel', sector: 'Oranjestad', start: '08:30', end: '09:15', segment: 'am', vanId: 'VAN-3', presetId: 'diagnostic', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2190', customer: 'Commercial Client', site: 'Oranjestad Site B', sector: 'Oranjestad', start: '10:30', end: '11:30', segment: 'am', vanId: 'VAN-3', presetId: 'standard_service', quantity: 1, status: 'temporary_hold', readiness: 'at_risk', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2194', customer: 'Santa Cruz Market', site: 'Santa Cruz', sector: 'Santa Cruz', start: '13:30', end: '15:00', segment: 'pm', vanId: 'VAN-3', presetId: 'repair', quantity: 1, status: 'confirmed', readiness: 'blocked', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2187', customer: 'Residential Client', site: 'Santa Cruz Home', sector: 'Santa Cruz', start: '08:30', end: '09:30', segment: 'am', vanId: 'VAN-4', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
  { id: 'WO-2192', customer: 'Paradera Residence', site: 'Paradera', sector: 'Paradera', start: '13:30', end: '14:30', segment: 'pm', vanId: 'VAN-4', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
];

const readinessPreview = evaluateReadiness({ crewAssigned: true, requiredSkillAvailable: true, vanAssigned: true, routeCompatible: true, requiredToolsReady: true, requiredPartsReady: false, customerConfirmed: true, commercialClearance: true, accessConfirmed: false });

function labelTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function presetLabel(id: WorkPresetId) {
  return defaultWorkPresets.find((preset) => preset.id === id)?.label ?? 'Other work';
}

function readinessClass(value: DispatchJob['readiness']) {
  return value === 'ready' ? styles.ready : value === 'at_risk' ? styles.risk : value === 'blocked' ? styles.blocked : styles.neutral;
}

export function DispatchBoard() {
  const [jobs, setJobs] = useState(previewJobs);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedVan, setSelectedVan] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const confirmed = jobs.filter((job) => job.status === 'confirmed').length;
  const holds = jobs.filter((job) => job.status === 'temporary_hold').length;
  const attention = jobs.filter((job) => job.readiness === 'blocked' || job.readiness === 'at_risk').length;
  const activeVans = previewVans.filter((van) => van.active).length;

  const addAppointment = (request: BookingRequest, slot: CandidateSlot, technicianInstructions: string) => {
    const jobId = `WO-${2200 + jobs.length}`;
    const primaryQty = slot.primaryUnits ?? request.quantity;
    const primary: DispatchJob = { id: jobId, customer: request.customer, site: request.site, sector: request.sector, start: slot.start, end: slot.end, segment: slot.segment, vanId: slot.vanId, presetId: request.presetId, quantity: primaryQty, status: 'temporary_hold', readiness: 'at_risk', isPrimaryAssignment: true, customerCommunicationOwner: true };
    const additions: DispatchJob[] = [primary];
    if (slot.requiresSupportVan && slot.supportVanId) additions.push({ ...primary, id: `${jobId}-S`, vanId: slot.supportVanId, quantity: slot.supportUnits ?? Math.max(1, request.quantity - primaryQty), isPrimaryAssignment: false, customerCommunicationOwner: false, supportForJobId: jobId });
    setJobs((current) => [...current, ...additions]);
    setDrawerOpen(false);
    setSelectedVan(slot.vanId);
    setNotice(`${customerFacingDescription(request)} reserved as a temporary hold. ${slot.requiresSupportVan ? 'Support van linked; only the primary assignment owns customer communication.' : technicianInstructions ? 'Technician instructions saved separately from customer-facing description.' : ''}`);
  };

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>Operations · Aruba</span><h1>Scheduling & Dispatch</h1><p>Capacity, geography, vans and readiness decide the schedule — not an unrestricted customer time picker.</p></div>
        <div className={styles.pageActions}><button type="button" className={styles.secondary}>Week view</button><button type="button" className={styles.primary} onClick={() => setDrawerOpen(true)}>+ New appointment</button></div>
      </header>

      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.metrics}>
        <article><span>Confirmed Today</span><strong>{confirmed}</strong><small>Across {activeVans} active vans</small><i style={{ width: `${Math.min(100, confirmed / 24 * 100)}%` }} /></article>
        <article><span>Temporary Holds</span><strong>{holds}</strong><small>Awaiting confirmation / transaction</small><i style={{ width: `${Math.min(100, holds * 18)}%` }} /></article>
        <article><span>Need Attention</span><strong className={attention ? styles.metricWarning : ''}>{attention}</strong><small>Readiness at risk or blocked</small><i style={{ width: `${Math.min(100, attention * 20)}%` }} /></article>
        <article><span>Route Anchors</span><strong>8</strong><small>AM + PM anchors across 4 vans</small><i style={{ width: '76%' }} /></article>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.dayNav}><button type="button">‹</button><div><strong>Today</strong><span>Operational day · Aruba time</span></div><button type="button">›</button></div>
        <div className={styles.legend}><span><i className={styles.readyDot} /> Ready</span><span><i className={styles.riskDot} /> At risk</span><span><i className={styles.blockedDot} /> Blocked</span><span><i className={styles.holdDot} /> Hold</span></div>
      </div>

      <div className={styles.layout}>
        <main className={styles.board}>
          <div className={styles.boardHeader}><div><strong>Live Dispatch Board</strong><span>8:30 AM–4:30 PM operational capacity · lunch 12:00–1:00 PM</span></div><button type="button">Optimize route</button></div>
          <div className={styles.vanGrid}>{previewVans.map((van) => {
            const vanJobs = jobs.filter((job) => job.vanId === van.id);
            const amAnchor = getHalfDayAnchor(jobs, van.id, 'am');
            const pmAnchor = getHalfDayAnchor(jobs, van.id, 'pm');
            return <section key={van.id} className={`${styles.vanLane} ${selectedVan === van.id ? styles.vanLaneSelected : ''}`}>
              <header><div className={styles.vanIdentity}><span>{van.id.replace('VAN-', 'V')}</span><div><strong>{van.name}</strong><small>{van.team}</small></div></div><b>{van.active ? 'ACTIVE' : 'OFFLINE'}</b></header>
              <div className={styles.anchorBar}><div><span>AM anchor</span><strong>{amAnchor?.sector ?? 'Open'}</strong></div><div><span>PM anchor</span><strong>{pmAnchor?.sector ?? 'Open'}</strong></div></div>
              <div className={styles.daySegments}>
                <JobSegment label="Morning" jobs={vanJobs.filter((job) => job.segment === 'am' || job.segment === 'full_day')} />
                <div className={styles.breakRow}><span>12:00</span><div>Lunch / reset</div><span>1:00</span></div>
                <JobSegment label="Afternoon" jobs={vanJobs.filter((job) => job.segment === 'pm' || job.segment === 'full_day')} />
              </div>
            </section>;
          })}</div>
        </main>

        <aside className={styles.sideRail}>
          <section className={styles.sideCard}><div className={styles.sideTitle}><span>AI</span><div><strong>Booking Intelligence</strong><small>Deterministic facts first</small></div></div><div className={styles.insight}><b>Route opportunity</b><p>Van 1 is anchored in Noord this morning. Nearby Noord / Palm Beach work should be preferred before sending the team across the island.</p></div><div className={styles.insight}><b>Capacity rule</b><p>A customer restriction such as “after 10” recalculates all valid options. Previously rejected times are not repeated.</p></div><button type="button" onClick={() => setDrawerOpen(true)}>Find valid appointment</button></section>

          <section className={styles.sideCard}><div className={styles.cardHeading}><div><strong>Job Readiness</strong><span>Example pre-dispatch check</span></div><b className={styles.blockedText}>{readinessPreview.status.toUpperCase()}</b></div><ul className={styles.checkList}><li className={styles.ok}>✓ Crew + skill assigned</li><li className={styles.ok}>✓ Van and route compatible</li><li className={styles.bad}>! Required parts not ready</li><li className={styles.warn}>! Site access not confirmed</li></ul><button type="button">Open readiness queue</button></section>

          <section className={styles.sideCard}><div className={styles.cardHeading}><div><strong>Support Van Rule</strong><span>Large same-site jobs</span></div><b>6 + 4</b></div><div className={styles.supportDiagram}><div><strong>Primary van</strong><span>6 units</span><small>Owns confirmation + reminder</small></div><i>+</i><div><strong>Support van</strong><span>4 units</span><small>No duplicate customer messages</small></div></div><p className={styles.cardFoot}>The linked support assignment inherits customer, site and work context instead of creating a duplicate appointment.</p></section>

          <section className={styles.sideCard}><div className={styles.cardHeading}><div><strong>Unscheduled Queue</strong><span>Needs a scheduling decision</span></div><b>3</b></div><div className={styles.queue}><div><span className={styles.queuePriority}>HIGH</span><strong>Commercial diagnostic</strong><small>Oranjestad · requested today</small></div><div><span>NEW</span><strong>2-unit standard service</strong><small>Noord · customer after 10 AM</small></div><div><span>READY</span><strong>Installation</strong><small>Santa Cruz · deposit confirmed</small></div></div></section>
        </aside>
      </div>

      {drawerOpen ? <AppointmentDrawer jobs={jobs} onClose={() => setDrawerOpen(false)} onReserve={addAppointment} /> : null}
    </section>
  );
}

function JobSegment({ label, jobs }: { label: string; jobs: DispatchJob[] }) {
  const unique = jobs.filter((job, index, list) => list.findIndex((item) => item.id === job.id) === index).sort((a, b) => a.start.localeCompare(b.start));
  return <section className={styles.segment}><div className={styles.segmentLabel}>{label}</div>{unique.length ? unique.map((job) => <article className={`${styles.jobCard} ${job.status === 'temporary_hold' ? styles.jobHold : ''}`} key={job.id}><div className={styles.jobTime}><strong>{labelTime(job.start)}</strong><span>{labelTime(job.end)}</span></div><div className={styles.jobMain}><div><strong>{job.customer}</strong><b className={readinessClass(job.readiness)}>{job.readiness.replace('_', ' ')}</b></div><span>{presetLabel(job.presetId)} · {job.quantity} unit{job.quantity === 1 ? '' : 's'}</span><small>{job.site} · {job.sector}{job.supportForJobId ? ' · Support assignment' : ''}</small></div></article>) : <button type="button" className={styles.openCapacity}>+ Open capacity</button>}</section>;
}

function AppointmentDrawer({ jobs, onClose, onReserve }: { jobs: DispatchJob[]; onClose: () => void; onReserve: (request: BookingRequest, slot: CandidateSlot, technicianInstructions: string) => void }) {
  const [customer, setCustomer] = useState('New Customer');
  const [site, setSite] = useState('Customer Property');
  const [sector, setSector] = useState('Noord');
  const [presetId, setPresetId] = useState<WorkPresetId>('standard_service');
  const [quantity, setQuantity] = useState(1);
  const [restriction, setRestriction] = useState('any');
  const [technicianInstructions, setTechnicianInstructions] = useState('');
  const [selected, setSelected] = useState<CandidateSlot | null>(null);

  const request = useMemo<BookingRequest>(() => ({
    customer, site, sector, presetId, quantity,
    restriction: restriction === 'morning' ? { halfDay: 'am' } : restriction === 'afternoon' ? { halfDay: 'pm' } : restriction === 'after10' ? { notBefore: '10:00' } : restriction === 'after2' ? { notBefore: '14:00' } : undefined,
  }), [customer, site, sector, presetId, quantity, restriction]);
  const slots = useMemo(() => findCandidateSlots(request, jobs), [request, jobs]);
  const description = customerFacingDescription(request);

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={styles.drawer} role="dialog" aria-modal="true">
    <header className={styles.drawerHeader}><div><span>Booking workflow</span><h2>New appointment</h2><p>The ERP proposes valid capacity after considering duration, restrictions, route anchors and van availability.</p></div><button type="button" onClick={onClose}>×</button></header>
    <div className={styles.drawerBody}>
      <section className={styles.formSection}><header><strong>1 · Customer & location</strong><span>Choose canonical CRM records in production.</span></header><div className={styles.formGrid}><label><span>Customer</span><input value={customer} onChange={(event) => setCustomer(event.target.value)} /></label><label><span>Property / site</span><input value={site} onChange={(event) => setSite(event.target.value)} /></label><label><span>DEMAC sector</span><select value={sector} onChange={(event) => setSector(event.target.value)}><option>Noord</option><option>Palm Beach</option><option>Oranjestad</option><option>Santa Cruz</option><option>Paradera</option><option>San Nicolas</option><option>Savaneta</option></select></label></div></section>
      <section className={styles.formSection}><header><strong>2 · Work & duration</strong><span>Durations are configuration-driven defaults.</span></header><div className={styles.formGrid}><label className={styles.wide}><span>Predetermined work</span><select value={presetId} onChange={(event) => { setPresetId(event.target.value as WorkPresetId); setSelected(null); }}>{defaultWorkPresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label><label><span>Number of A/C units</span><input type="number" min={1} max={12} value={quantity} onChange={(event) => { setQuantity(Math.max(1, Number(event.target.value) || 1)); setSelected(null); }} /></label><label><span>Customer restriction</span><select value={restriction} onChange={(event) => { setRestriction(event.target.value); setSelected(null); }}><option value="any">No time restriction</option><option value="morning">Morning only</option><option value="afternoon">Afternoon only</option><option value="after10">After 10:00 AM</option><option value="after2">After 2:00 PM</option></select></label></div><div className={styles.descriptionPreview}><span>CUSTOMER-FACING DESCRIPTION</span><strong>{description}</strong><small>This remains separate from technician-only instructions.</small></div><label className={styles.instructions}><span>Technician instructions</span><textarea rows={3} value={technicianInstructions} onChange={(event) => setTechnicianInstructions(event.target.value)} placeholder="Internal access notes, technical preparation or specific work instructions..." /></label></section>
      <section className={styles.formSection}><header><strong>3 · Valid ERP options</strong><span>Customer restrictions are hard filters; invalid times are not shown.</span></header><div className={styles.slotList}>{slots.length ? slots.map((slot) => <button type="button" key={`${slot.vanId}-${slot.start}-${slot.supportVanId ?? ''}`} className={`${styles.slotCard} ${selected === slot ? styles.slotSelected : ''}`} onClick={() => setSelected(slot)}><div><strong>{slot.segment === 'full_day' ? 'Full-day linked team' : `${labelTime(slot.start)} – ${labelTime(slot.end)}`}</strong><span>{slot.vanId}{slot.supportVanId ? ` + ${slot.supportVanId}` : ''} · {slot.sector}</span></div><b>{slot.score}</b><small>{slot.requiresSupportVan ? `${slot.primaryUnits} + ${slot.supportUnits} units · one customer communication owner` : slot.reasons[0] ?? 'Available capacity'}</small></button>) : <div className={styles.noSlots}><strong>No valid capacity with these constraints</strong><p>Change the day, restriction, quantity or work type. The ERP should never invent a slot merely to satisfy the conversation.</p></div>}</div></section>
    </div>
    <footer className={styles.drawerFooter}><div>{selected ? <><span>Selected</span><strong>{selected.vanId}{selected.supportVanId ? ` + ${selected.supportVanId}` : ''} · {selected.segment === 'full_day' ? 'full day' : labelTime(selected.start)}</strong></> : <span>Select a valid ERP option to continue.</span>}</div><div><button type="button" className={styles.secondary} onClick={onClose}>Cancel</button><button type="button" className={styles.primary} disabled={!selected} onClick={() => selected && onReserve(request, selected, technicianInstructions)}>Temporary hold</button></div></footer>
  </aside></div>;
}
