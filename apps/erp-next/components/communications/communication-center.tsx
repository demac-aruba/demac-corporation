'use client';

import { useMemo, useState } from 'react';
import { aiRiskDecision, previewConversations, previewHandoff, previewOperators, routeConversation, type Conversation, type Queue } from '../../lib/communications';
import styles from './communication-center.module.css';

type Mode = 'communications' | 'ai' | 'escalations';
const queueLabels: Array<{ value: 'all' | Queue; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'general', label: 'General' }, { value: 'scheduling', label: 'Scheduling' }, { value: 'sales', label: 'Sales' }, { value: 'finance', label: 'Finance' }, { value: 'technical', label: 'Technical' }, { value: 'complaints', label: 'Complaints' },
];

function initials(name: string) { return name.split(/\s+/).map((part)=>part[0]).slice(0,2).join('').toUpperCase(); }

export function CommunicationCenter({ mode = 'communications' }: { mode?: Mode }) {
  const [conversations, setConversations] = useState(previewConversations);
  const [selectedId, setSelectedId] = useState(previewConversations[0].id);
  const [queue, setQueue] = useState<'all' | Queue>(mode === 'escalations' ? 'complaints' : 'all');
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);

  const visible = useMemo(() => conversations.filter((conversation) => queue === 'all' || conversation.queue === queue).filter((conversation) => mode !== 'escalations' || conversation.status === 'escalated'), [conversations, queue, mode]);
  const selected = conversations.find((conversation)=>conversation.id===selectedId) ?? visible[0] ?? conversations[0];
  const aiDecision = aiRiskDecision({ intent: selected.queue, complaint: selected.queue === 'complaints', paymentDispute: false, refund: false, pricingException: false, technicalComplexity: selected.queue === 'technical' ? 'complex' : 'normal', confidence: selected.queue === 'complaints' ? .55 : .91 });
  const recommendedOperator = routeConversation(selected, previewOperators);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const message = { id: `M-${Date.now()}`, at: 'Now', author: internal ? 'Internal note' : selected.owner ?? 'DEMAC', role: internal ? 'internal_note' as const : 'operator' as const, text, channel: internal ? 'internal' as const : 'whatsapp' as const };
    setConversations((current)=>current.map((conversation)=>conversation.id===selected.id ? { ...conversation, messages:[...conversation.messages,message], lastActivityAt:'Now' } : conversation));
    setDraft('');
  };

  const takeOver = () => setConversations((current)=>current.map((conversation)=>conversation.id===selected.id ? { ...conversation, owner:'Operations', aiDisposition:'human_active', lockedBy:'Operations', status: conversation.status === 'new' ? 'assigned' : conversation.status } : conversation));

  const active = conversations.filter((c)=>!['resolved','closed'].includes(c.status)).length;
  const aiActive = conversations.filter((c)=>c.aiDisposition==='ai_active').length;
  const escalated = conversations.filter((c)=>c.status==='escalated').length;
  const unread = conversations.reduce((sum,c)=>sum+c.unread,0);

  return <section className={styles.page}>
    <header className={styles.head}><div><span>{mode === 'ai' ? 'AI Customer Service Agent' : mode === 'escalations' ? 'Human Exception Queue' : 'Unified Customer Communications'}</span><h1>{mode === 'ai' ? 'AI Customer Agent' : mode === 'escalations' ? 'Escalations' : 'Communication Center'}</h1><p>{mode === 'ai' ? 'AI handles the normal path using governed ERP tools; complaints, disputes, refunds, complex technical issues and low-confidence cases escalate with full context.' : 'One DEMAC conversation across WhatsApp, voice, phone and internal handoff. Ownership, locks, next actions and CRM context prevent duplicate work and lost customer history.'}</p></div><button className={styles.primary} type="button">+ New conversation</button></header>

    <div className={styles.metrics}><article className={styles.metric}><span>Active</span><strong>{active}</strong><small>Open conversations</small></article><article className={styles.metric}><span>AI active</span><strong>{aiActive}</strong><small>Routine path</small></article><article className={styles.metric}><span>Escalated</span><strong>{escalated}</strong><small>Human exception</small></article><article className={styles.metric}><span>Unread</span><strong>{unread}</strong><small>Needs attention</small></article><article className={styles.metric}><span>Operators online</span><strong>{previewOperators.filter((o)=>o.presence!=='offline').length}</strong><small>Shared inbox</small></article><article className={styles.metric}><span>Avg response</span><strong>1m 42s</strong><small>Preview KPI</small></article></div>

    <div className={styles.workspace}>
      <aside className={styles.panel}><header><div><strong>Inbox & Queues</strong><span>{visible.length} visible conversations</span></div></header><div className={styles.queueFilters}>{queueLabels.map((item)=><button type="button" key={item.value} className={queue===item.value?styles.active:''} onClick={()=>setQueue(item.value)}>{item.label}</button>)}</div><div className={styles.conversationList}>{visible.map((conversation)=><button key={conversation.id} type="button" className={`${styles.conversationRow} ${selected.id===conversation.id?styles.active:''}`} onClick={()=>setSelectedId(conversation.id)}><span className={styles.avatar}>{initials(conversation.customer)}</span><span><strong>{conversation.customer}</strong><small>{conversation.queue} · {conversation.status.replaceAll('_',' ')} · {conversation.lastActivityAt}</small></span>{conversation.unread?<b>{conversation.unread}</b>:null}</button>)}</div></aside>

      <main className={`${styles.panel} ${styles.chat}`}>
        <div className={styles.chatHeader}><div className={styles.chatHeaderTop}><div><h2>{selected.customer}</h2><p>{selected.phone} · {selected.property ?? 'Property pending'} · {selected.language}</p></div><button type="button" className={styles.takeover} onClick={takeOver}>Take over</button></div><div className={styles.statusRow}><span className={styles.pill}>{selected.status.replaceAll('_',' ')}</span><span className={styles.pill}>{selected.queue}</span><span className={styles.pill}>{selected.owner ?? 'Unassigned'}</span><span className={styles.pill}>{selected.aiDisposition.replaceAll('_',' ')}</span>{selected.vip?<span className={styles.pill}>VIP</span>:null}</div></div>
        <div className={styles.messages}>{selected.messages.map((message)=><article key={message.id} className={`${styles.message} ${styles[message.role]}`}><span>{message.author} · {message.at} · {message.channel}</span><p>{message.text}</p></article>)}</div>
        <div className={styles.quick}><button type="button">Create appointment</button><button type="button">Create lead</button><button type="button">Create estimate</button><button type="button">Payment issue</button><button type="button">Open customer</button><button type="button">Escalate</button></div>
        <div className={styles.composer}><textarea value={draft} onChange={(event)=>setDraft(event.target.value)} placeholder={internal?'Write an internal note — never sent to customer':'Reply to customer...'} /><div className={styles.composerFooter}><div><button type="button" onClick={()=>setInternal(!internal)} className={internal?styles.active:''}>{internal?'Internal note ON':'Internal note'}</button><button type="button">AI draft</button></div><button type="button" className={styles.primary} onClick={send}>{internal?'Save note':'Send reply'}</button></div></div>
      </main>

      <aside className={styles.panel}><header><div><strong>{mode==='ai'?'AI Decision & Handoff':'Customer Context'}</strong><span>CRM + operational memory</span></div></header><div className={styles.context}><section><span>Next action</span><strong>{selected.nextAction ?? 'No next action'}</strong><p>Due: {selected.nextActionDue ?? 'Not set'}. Every active conversation should own a next action and due date.</p></section><section><span>AI routing</span><strong>{aiDecision.mode === 'ai' ? 'AI may continue' : 'Human required'}</strong><p>{aiDecision.reason}. Recommended owner: {recommendedOperator?.name ?? 'Manager / manual assignment'}.</p></section><section><span>CRM snapshot</span><ul><li>Customer: {selected.customerId ?? 'New lead'}</li><li>Property: {selected.property ?? 'Missing'}</li><li>Equipment: {selected.equipment ?? 'Load from CRM'}</li><li>Queue: {selected.queue}</li><li>Current owner: {selected.owner ?? 'Unassigned'}</li></ul></section>{selected.id===previewHandoff.conversationId?<section><span>AI handoff summary</span><strong>{previewHandoff.reason}</strong><p>{previewHandoff.request}</p><ul>{previewHandoff.actionsAlreadyTaken.map((action)=><li key={action}>{action}</li>)}</ul><p><b>Next:</b> {previewHandoff.recommendedNextAction}</p></section>:null}<section><span>Collision control</span><strong>{selected.lockedBy ? `Reply lock: ${selected.lockedBy}` : 'No active reply collision'}</strong><p>If another operator sends while an AI/operator draft is open, the stale draft must be invalidated before send.</p></section></div>{mode==='escalations'?<div>{conversations.filter((c)=>c.status==='escalated').map((c)=><article className={styles.escalation} key={c.id}><span>{c.queue}</span><strong>{c.customer}</strong><p>{c.nextAction}</p></article>)}</div>:<div className={styles.operators}>{previewOperators.map((operator)=><article className={styles.operator} key={operator.id}><span>{initials(operator.name)}</span><div><strong>{operator.name}</strong><small>{operator.activeChats} chats{operator.activeVoiceCall?' · voice call active':''}</small></div><b>{operator.presence.replaceAll('_',' ')}</b></article>)}</div>}</aside>
    </div>
  </section>;
}
