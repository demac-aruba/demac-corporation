'use client';

import { useMemo, useState } from 'react';
import styles from './customer-commercial.module.css';

type EventType = 'communication' | 'work' | 'finance' | 'sales' | 'note';
type TimelineEvent = { id: string; type: EventType; channel?: string; date: string; time: string; title: string; detail: string; actor: string; status?: string };

type OpportunityStage = 'Qualified' | 'Assessment' | 'Estimating' | 'Proposal Sent' | 'Negotiation';
type Opportunity = { id: string; subject: string; value: string; stage: OpportunityStage; probability: number; owner: string; nextAction: string; due: string; source: string };

const seedEvents: TimelineEvent[] = [
  { id: 'EV-1', type: 'communication', channel: 'WhatsApp', date: 'Today', time: '09:14', title: 'Customer requested appointment availability', detail: 'Conversation retained with scheduling context and property reference.', actor: 'Operations AI + Office', status: 'Waiting for DEMAC' },
  { id: 'EV-2', type: 'finance', channel: 'Bank', date: 'Yesterday', time: '15:42', title: 'Incoming payment detected', detail: 'Afl. 13,000 matched against open customer invoices and routed for allocation review.', actor: 'Bank Intelligence', status: 'Review' },
  { id: 'EV-3', type: 'work', channel: 'Field', date: 'Aug 8', time: '11:20', title: 'Work order completed', detail: 'Technician report, photos, measurements and add-ons submitted to office review.', actor: 'Field Team', status: 'Completed' },
  { id: 'EV-4', type: 'sales', channel: 'Email', date: 'Aug 5', time: '14:05', title: 'Estimate sent', detail: 'Equipment proposal delivered with payment terms and coating option.', actor: 'Sales / Operations', status: 'Proposal Sent' },
  { id: 'EV-5', type: 'communication', channel: 'Call', date: 'Aug 4', time: '10:32', title: 'Inbound phone call', detail: 'Customer asked about maintenance and future equipment replacement.', actor: 'Office Operator', status: 'Resolved' },
];

const seedOpportunities: Opportunity[] = [
  { id: 'OP-204', subject: 'Replace aging living-room system', value: 'Afl. 2,850', stage: 'Proposal Sent', probability: 65, owner: 'Sales', nextAction: 'Follow up on proposal', due: 'Aug 12', source: 'Technician recommendation' },
  { id: 'OP-188', subject: 'Preventive maintenance agreement', value: 'Afl. 4,200 / yr', stage: 'Assessment', probability: 45, owner: 'Operations', nextAction: 'Confirm asset coverage', due: 'Aug 14', source: 'CRM maintenance signal' },
];

const filters: Array<{ key: 'all' | EventType; label: string }> = [
  { key: 'all', label: 'All activity' }, { key: 'communication', label: 'Messages & Calls' }, { key: 'work', label: 'Work' }, { key: 'finance', label: 'Finance' }, { key: 'sales', label: 'Sales' }, { key: 'note', label: 'Notes' },
];

function eventTone(type: EventType) {
  return type === 'communication' ? styles.blue : type === 'work' ? styles.purple : type === 'finance' ? styles.green : type === 'sales' ? styles.amber : styles.gray;
}

export function CustomerTimelinePanel({ customerName }: { customerName: string }) {
  const [events, setEvents] = useState(seedEvents);
  const [filter, setFilter] = useState<'all' | EventType>('all');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const visible = useMemo(() => filter === 'all' ? events : events.filter((event) => event.type === filter), [events, filter]);
  const saveNote = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    setEvents((current) => [{ id: `EV-${Date.now()}`, type: 'note', channel: 'Internal', date: 'Today', time: 'Now', title: 'Internal CRM note', detail: trimmed, actor: 'Current user', status: 'Internal only' }, ...current]);
    setNote('');
    setNoteOpen(false);
  };

  return (
    <section className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <div><span>{customerName}</span><h3>Unified Activity & Communications</h3><p>One customer timeline for communication, field work, sales, finance signals and internal notes.</p></div>
        <button type="button" onClick={() => setNoteOpen(true)}>+ Internal note</button>
      </header>

      <div className={styles.filterBar}>{filters.map((item) => <button type="button" key={item.key} className={filter === item.key ? styles.filterActive : ''} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>

      <div className={styles.timeline}>
        {visible.map((event) => <article key={event.id} className={styles.eventRow}>
          <div className={`${styles.eventIcon} ${eventTone(event.type)}`}>{event.channel?.slice(0,2).toUpperCase() ?? 'EV'}</div>
          <div className={styles.eventTime}><strong>{event.date}</strong><span>{event.time}</span></div>
          <div className={styles.eventMain}><div><strong>{event.title}</strong>{event.status ? <b>{event.status}</b> : null}</div><p>{event.detail}</p><small>{event.channel} · {event.actor}</small></div>
          <button type="button">Open</button>
        </article>)}
      </div>

      {noteOpen ? <div className={styles.noteComposer}><div><strong>Add internal note</strong><span>Internal notes are never sent to the customer.</span></div><textarea autoFocus rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add operational context, follow-up information or a handoff note..." /><footer><button type="button" onClick={() => setNoteOpen(false)}>Cancel</button><button type="button" className={styles.primaryAction} onClick={saveNote} disabled={!note.trim()}>Save note</button></footer></div> : null}
    </section>
  );
}

export function CustomerOpportunityPanel({ customerName }: { customerName: string }) {
  const [opportunities, setOpportunities] = useState(seedOpportunities);
  const [recommendationConverted, setRecommendationConverted] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [value, setValue] = useState('');

  const weighted = opportunities.reduce((sum, opportunity) => {
    const amount = Number(opportunity.value.replace(/[^0-9.]/g, '')) || 0;
    return sum + amount * opportunity.probability / 100;
  }, 0);

  const convertRecommendation = () => {
    if (recommendationConverted) return;
    setOpportunities((current) => [...current, { id: `OP-${Date.now()}`, subject: 'Anti-corrosive coating opportunity', value: 'Afl. 350', stage: 'Qualified', probability: 70, owner: 'Operations', nextAction: 'Confirm customer interest', due: 'Aug 13', source: 'Technician finding' }]);
    setRecommendationConverted(true);
  };

  const createOpportunity = () => {
    if (!subject.trim()) return;
    setOpportunities((current) => [...current, { id: `OP-${Date.now()}`, subject: subject.trim(), value: value.trim() || 'Value pending', stage: 'Qualified', probability: 25, owner: 'Current user', nextAction: 'Qualify opportunity', due: 'Not set', source: 'Manual CRM entry' }]);
    setSubject(''); setValue(''); setEditorOpen(false);
  };

  return (
    <section className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <div><span>{customerName}</span><h3>Opportunities & Recommendations</h3><p>Track commercial follow-up as structured work with an owner, next action and due date.</p></div>
        <button type="button" onClick={() => setEditorOpen(true)}>+ New opportunity</button>
      </header>

      <div className={styles.opportunityMetrics}>
        <article><span>Open pipeline</span><strong>{opportunities.length}</strong><small>Active opportunities</small></article>
        <article><span>Weighted pipeline</span><strong>Afl. {Math.round(weighted).toLocaleString('en-US')}</strong><small>Value × probability</small></article>
        <article><span>Needs follow-up</span><strong>{opportunities.filter((item) => item.nextAction).length}</strong><small>Every opportunity has a next action</small></article>
      </div>

      <section className={styles.recommendationCard}><div className={styles.aiBadge}>AI</div><div><span>FIELD RECOMMENDATION</span><strong>Technician noted corrosion exposure on outdoor equipment</strong><p>Create a sales opportunity for anti-corrosive treatment. The recommendation remains separate from the technician report until a commercial opportunity is intentionally created.</p></div><button type="button" onClick={convertRecommendation} disabled={recommendationConverted}>{recommendationConverted ? 'Converted ✓' : 'Convert to opportunity'}</button></section>

      <div className={styles.opportunityList}>{opportunities.map((opportunity) => <article className={styles.opportunityCard} key={opportunity.id}>
        <header><div><span>{opportunity.id}</span><b>{opportunity.stage}</b></div><strong>{opportunity.subject}</strong><p>{opportunity.source}</p></header>
        <div className={styles.opportunityBody}><div><span>Expected value</span><strong>{opportunity.value}</strong></div><div><span>Probability</span><strong>{opportunity.probability}%</strong><div className={styles.progress}><i style={{ width: `${opportunity.probability}%` }} /></div></div><div><span>Owner</span><strong>{opportunity.owner}</strong></div></div>
        <footer><div><span>Next action</span><strong>{opportunity.nextAction}</strong><small>Due {opportunity.due}</small></div><button type="button">Open opportunity</button></footer>
      </article>)}</div>

      {editorOpen ? <div className={styles.opportunityEditor}><div><strong>New opportunity</strong><span>Capture the commercial intention; details can be refined after qualification.</span></div><label><span>Opportunity subject *</span><input autoFocus value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="e.g. Replace three bedroom units" /></label><label><span>Expected value</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Afl. ... or pending" /></label><footer><button type="button" onClick={() => setEditorOpen(false)}>Cancel</button><button type="button" className={styles.primaryAction} onClick={createOpportunity} disabled={!subject.trim()}>Create opportunity</button></footer></div> : null}
    </section>
  );
}
