'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  aiRiskDecision,
  routeConversation,
  type ConversationMessage,
  type ConversationStatus,
  type Queue,
} from '../../lib/communications';
import {
  assignConversation,
  claimConversation,
  loadCommunicationWorkspace,
  markConversationRead,
  queueWhatsAppText,
  saveInternalCommunicationNote,
  touchCommunicationPresence,
  updateConversationStatus,
  type LiveConversation,
  type LiveOperator,
  type WhatsAppProvider,
} from '../../lib/browser-communications';
import { loadFirebasePrincipal } from '../../lib/firebase/principal';
import type { AuthPrincipal } from '../../lib/security';
import styles from './communication-center.module.css';

type Mode = 'communications' | 'ai' | 'escalations';
type InboxScope = 'mine' | 'unassigned' | 'team';

const queueLabels: Array<{ value: 'all' | Queue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'general', label: 'General' },
  { value: 'scheduling', label: 'Scheduling' },
  { value: 'sales', label: 'Sales' },
  { value: 'finance', label: 'Finance' },
  { value: 'technical', label: 'Technical' },
  { value: 'complaints', label: 'Complaints' },
];

const statusOptions: ConversationStatus[] = [
  'new', 'assigned', 'waiting_customer', 'waiting_demac', 'appointment_pending',
  'estimate_pending', 'payment_pending', 'escalated', 'resolved', 'closed',
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'WA';
}

function relativeTime(value?: string) {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function isManager(principal: AuthPrincipal | null) {
  return principal?.role === 'super_admin' || principal?.role === 'operations';
}

export function CommunicationCenter({ mode = 'communications' }: { mode?: Mode }) {
  const [principal, setPrincipal] = useState<AuthPrincipal | null>(null);
  const [conversations, setConversations] = useState<LiveConversation[]>([]);
  const [operators, setOperators] = useState<LiveOperator[]>([]);
  const [provider, setProvider] = useState<WhatsAppProvider>('wacli');
  const [selectedId, setSelectedId] = useState('');
  const [queue, setQueue] = useState<'all' | Queue>(mode === 'escalations' ? 'complaints' : 'all');
  const [scope, setScope] = useState<InboxScope>('mine');
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignmentTarget, setAssignmentTarget] = useState('');

  const refresh = useCallback(async () => {
    const workspace = await loadCommunicationWorkspace();
    setConversations(workspace.conversations);
    setOperators(workspace.operators);
    setProvider(workspace.provider);
    setSelectedId((current) => current || workspace.conversations[0]?.id || '');
    return workspace;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let activePrincipal: AuthPrincipal | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function bootstrap() {
      try {
        const loadedPrincipal = await loadFirebasePrincipal();
        if (cancelled) return;
        activePrincipal = loadedPrincipal;
        setPrincipal(loadedPrincipal);
        const initialWorkspace = await refresh();
        if (cancelled) return;
        const initialOwned = initialWorkspace.conversations.filter((conversation) => conversation.ownerUserId === loadedPrincipal.userId && !['resolved', 'closed'].includes(conversation.status)).length;
        await touchCommunicationPresence(loadedPrincipal, 'available', initialOwned);
        if (cancelled) return;
        setLoading(false);
        interval = setInterval(() => {
          refresh()
            .then((workspace) => {
              if (!activePrincipal) return;
              const owned = workspace.conversations.filter((conversation) => conversation.ownerUserId === activePrincipal?.userId && !['resolved', 'closed'].includes(conversation.status)).length;
              return touchCommunicationPresence(activePrincipal, 'available', owned);
            })
            .catch((refreshError) => setError(refreshError instanceof Error ? refreshError.message : String(refreshError)));
        }, 5000);
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError));
          setLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (activePrincipal) touchCommunicationPresence(activePrincipal, 'offline', 0).catch(() => undefined);
    };
  }, [refresh]);

  const manager = isManager(principal);
  const visible = useMemo(() => conversations
    .filter((conversation) => queue === 'all' || conversation.queue === queue)
    .filter((conversation) => mode !== 'escalations' || conversation.status === 'escalated')
    .filter((conversation) => {
      if (!principal) return false;
      if (scope === 'mine') return conversation.ownerUserId === principal.userId;
      if (scope === 'unassigned') return !conversation.ownerUserId;
      return true;
    }), [conversations, queue, mode, principal, scope]);

  useEffect(() => {
    if (visible.some((conversation) => conversation.id === selectedId)) return;
    const fallback = visible[0];
    setSelectedId(fallback?.id ?? '');
    setAssignmentTarget(fallback?.ownerUserId || '');
  }, [visible, selectedId]);

  const selected = visible.find((conversation) => conversation.id === selectedId)
    ?? visible[0]
    ?? null;

  const selectedOwnedByMe = Boolean(selected && principal && selected.ownerUserId === principal.userId);
  const selectedUnassigned = Boolean(selected && !selected.ownerUserId);
  const selectedOwnedByColleague = Boolean(selected && selected.ownerUserId && principal && selected.ownerUserId !== principal.userId);
  const canReadBody = Boolean(selected && (manager || selectedOwnedByMe || selectedUnassigned));
  const canReply = Boolean(selected && principal && (selectedOwnedByMe || selectedUnassigned));

  const aiDecision = selected ? aiRiskDecision({
    intent: selected.queue,
    complaint: selected.queue === 'complaints',
    paymentDispute: selected.queue === 'finance' && selected.status === 'escalated',
    refund: false,
    pricingException: false,
    technicalComplexity: selected.queue === 'technical' ? 'complex' : 'normal',
    confidence: selected.queue === 'complaints' ? .55 : .91,
  }) : null;
  const recommendedOperator = selected ? routeConversation(selected, operators) : null;

  const selectConversation = async (conversation: LiveConversation) => {
    setSelectedId(conversation.id);
    setAssignmentTarget(conversation.ownerUserId || '');
    if ((manager || conversation.ownerUserId === principal?.userId) && conversation.unread > 0) {
      markConversationRead(conversation.id).catch(() => undefined);
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, unread: 0 } : item));
    }
  };

  const takeOver = async () => {
    if (!selected || !principal) return;
    setBusy(true);
    setError('');
    try {
      await claimConversation(selected.id, principal);
      await refresh();
      setScope('mine');
    } catch (takeoverError) {
      setError(takeoverError instanceof Error ? takeoverError.message : String(takeoverError));
    } finally {
      setBusy(false);
    }
  };

  const reassign = async () => {
    if (!selected || !manager || !assignmentTarget) return;
    const operator = operators.find((item) => item.userId === assignmentTarget);
    if (!operator) return;
    setBusy(true);
    setError('');
    try {
      await assignConversation(selected.id, operator);
      await refresh();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : String(assignError));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: ConversationStatus) => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await updateConversationStatus(selected.id, status);
      setConversations((current) => current.map((item) => item.id === selected.id ? { ...item, status } : item));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !selected || !principal) return;
    if (!internal && !canReply) {
      setError('Take ownership of this conversation before replying so two operators cannot answer the same customer.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      let workingConversation = selected;
      if (!internal && selectedUnassigned) {
        await claimConversation(selected.id, principal);
        workingConversation = { ...selected, owner: principal.displayName, ownerUserId: principal.userId, status: 'assigned' };
      }

      if (internal) {
        await saveInternalCommunicationNote(selected.id, text, principal);
      } else {
        await queueWhatsAppText(workingConversation, text, principal, provider);
      }

      const optimistic: ConversationMessage = {
        id: `local-${Date.now()}`,
        at: new Date().toISOString(),
        author: internal ? `${principal.displayName} · internal` : principal.displayName,
        role: internal ? 'internal_note' : 'operator',
        text,
        channel: internal ? 'internal' : 'whatsapp',
      };
      setConversations((current) => current.map((conversation) => conversation.id === selected.id
        ? { ...conversation, owner: workingConversation.owner, ownerUserId: workingConversation.ownerUserId, messages: [...conversation.messages, optimistic], lastActivityAt: optimistic.at }
        : conversation));
      setDraft('');
      if (!internal) setScope('mine');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setBusy(false);
    }
  };

  const active = conversations.filter((conversation) => !['resolved', 'closed'].includes(conversation.status)).length;
  const aiActive = conversations.filter((conversation) => conversation.aiDisposition === 'ai_active').length;
  const escalated = conversations.filter((conversation) => conversation.status === 'escalated').length;
  const unread = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);
  const onlineOperators = operators.filter((operator) => operator.presence !== 'offline').length;

  return <section className={styles.page}>
    <header className={styles.head}>
      <div>
        <span>{mode === 'ai' ? 'AI Customer Service Agent' : mode === 'escalations' ? 'Human Exception Queue' : 'Unified Customer Communications'}</span>
        <h1>{mode === 'ai' ? 'AI Customer Agent' : mode === 'escalations' ? 'Escalations' : 'Communication Center'}</h1>
        <p>Live shared inbox with operator ownership, manager visibility, WhatsApp delivery state, internal handoff and CRM-ready context. Current WhatsApp transport: {provider.toUpperCase()}.</p>
      </div>
      <button className={styles.primary} type="button" onClick={() => refresh().catch(() => undefined)} disabled={loading}>Refresh</button>
    </header>

    {error ? <div className={styles.notice}><strong>Communication Center</strong><span>{error}</span></div> : null}

    <div className={styles.metrics}>
      <article className={styles.metric}><span>Active</span><strong>{active}</strong><small>Open conversations</small></article>
      <article className={styles.metric}><span>My queue</span><strong>{principal ? conversations.filter((conversation) => conversation.ownerUserId === principal.userId && !['resolved', 'closed'].includes(conversation.status)).length : 0}</strong><small>{principal?.displayName ?? 'Loading operator'}</small></article>
      <article className={styles.metric}><span>Escalated</span><strong>{escalated}</strong><small>Human exception</small></article>
      <article className={styles.metric}><span>Unread</span><strong>{unread}</strong><small>Needs attention</small></article>
      <article className={styles.metric}><span>Operators online</span><strong>{onlineOperators}</strong><small>Shared inbox</small></article>
      <article className={styles.metric}><span>WhatsApp provider</span><strong>{provider.toUpperCase()}</strong><small>{provider === 'wacli' ? 'Linked-device bridge' : 'Meta Cloud API'}</small></article>
    </div>

    <div className={styles.workspace}>
      <aside className={styles.panel}>
        <header><div><strong>Inbox & Queues</strong><span>{loading ? 'Loading…' : `${visible.length} visible conversations`}</span></div></header>
        <div className={styles.queueFilters}>
          <button type="button" className={scope === 'mine' ? styles.active : ''} onClick={() => setScope('mine')}>Mine</button>
          <button type="button" className={scope === 'unassigned' ? styles.active : ''} onClick={() => setScope('unassigned')}>Unassigned</button>
          <button type="button" className={scope === 'team' ? styles.active : ''} onClick={() => setScope('team')}>{manager ? 'All team' : 'Team pipeline'}</button>
        </div>
        <div className={styles.queueFilters}>{queueLabels.map((item) => <button type="button" key={item.value} className={queue === item.value ? styles.active : ''} onClick={() => setQueue(item.value)}>{item.label}</button>)}</div>
        <div className={styles.conversationList}>
          {!loading && visible.length === 0 ? <div className={styles.empty}>No conversations in this view.</div> : null}
          {visible.map((conversation) => <button key={conversation.id} type="button" className={`${styles.conversationRow} ${selected?.id === conversation.id ? styles.active : ''}`} onClick={() => selectConversation(conversation)}>
            <span className={styles.avatar}>{initials(conversation.customer)}</span>
            <span><strong>{conversation.customer}</strong><small>{conversation.queue} · {conversation.owner ?? 'Unassigned'} · {relativeTime(conversation.lastActivityAt)}</small></span>
            {conversation.unread ? <b>{conversation.unread}</b> : null}
          </button>)}
        </div>
      </aside>

      <main className={`${styles.panel} ${styles.chat}`}>
        {!selected ? <div className={styles.emptyLarge}><strong>{loading ? 'Loading Communication Center…' : 'No WhatsApp conversations yet'}</strong><p>Once the wacli bridge receives its first message, it will appear here automatically.</p></div> : <>
          <div className={styles.chatHeader}>
            <div className={styles.chatHeaderTop}>
              <div><h2>{selected.customer}</h2><p>{selected.phone || selected.chatJid || 'WhatsApp identity pending'} · {selected.property ?? 'Property pending'} · {selected.language}</p></div>
              <button type="button" className={styles.takeover} onClick={takeOver} disabled={busy || selectedOwnedByMe}>{selectedOwnedByMe ? 'Owned by me' : selectedOwnedByColleague ? 'Take over' : 'Take conversation'}</button>
            </div>
            <div className={styles.statusRow}>
              <span className={styles.pill}>{selected.status.replaceAll('_', ' ')}</span>
              <span className={styles.pill}>{selected.queue}</span>
              <span className={styles.pill}>{selected.owner ?? 'Unassigned'}</span>
              <span className={styles.pill}>{selected.aiDisposition.replaceAll('_', ' ')}</span>
              {selected.customerTyping ? <span className={styles.pill}>typing…</span> : null}
              {selected.vip ? <span className={styles.pill}>VIP</span> : null}
            </div>
            <div className={styles.controls}>
              <label>Status<select value={selected.status} onChange={(event) => changeStatus(event.target.value as ConversationStatus)} disabled={busy || (!manager && !selectedOwnedByMe)}>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
              {manager ? <label>Assign<select value={assignmentTarget || selected.ownerUserId || ''} onChange={(event) => setAssignmentTarget(event.target.value)}><option value="">Select operator</option>{operators.map((operator) => <option key={operator.userId} value={operator.userId}>{operator.name} · {operator.presence.replaceAll('_', ' ')}</option>)}</select><button type="button" onClick={reassign} disabled={busy || !assignmentTarget}>Apply</button></label> : null}
            </div>
          </div>

          <div className={styles.messages}>
            {!canReadBody ? <article className={`${styles.message} ${styles.system}`}><span>Team pipeline</span><p>This conversation is being handled by {selected.owner ?? 'another operator'}. You can see ownership and status, but take it over before working in the chat.</p></article> : selected.messages.length ? selected.messages.map((message) => <article key={message.id} className={`${styles.message} ${styles[message.role]}`}><span>{message.author} · {relativeTime(message.at)} · {message.channel}</span><p>{message.text}</p></article>) : <article className={`${styles.message} ${styles.system}`}><span>Conversation ready</span><p>No synchronized messages are stored in the recent window yet.</p></article>}
          </div>

          <div className={styles.quick}><button type="button">Create appointment</button><button type="button">Create lead</button><button type="button">Create estimate</button><button type="button">Payment issue</button><button type="button">Open customer</button><button type="button" onClick={() => changeStatus('escalated')}>Escalate</button></div>
          <div className={styles.composer}>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!canReadBody || busy} placeholder={internal ? 'Write an internal note — never sent to customer' : canReply ? 'Reply to customer…' : 'Take ownership before replying…'} />
            <div className={styles.composerFooter}>
              <div><button type="button" onClick={() => setInternal(!internal)} className={internal ? styles.active : ''} disabled={!canReadBody}>{internal ? 'Internal note ON' : 'Internal note'}</button><button type="button" disabled title="The existing Copilot V30 remains preserved; ERP-authenticated AI drafting will be connected in the next AI activation step.">AI draft</button></div>
              <button type="button" className={styles.primary} onClick={send} disabled={busy || !draft.trim() || (!internal && !canReply)}>{busy ? 'Working…' : internal ? 'Save note' : 'Send reply'}</button>
            </div>
          </div>
        </>}
      </main>

      <aside className={styles.panel}>
        <header><div><strong>{mode === 'ai' ? 'AI Decision & Handoff' : 'Customer Context'}</strong><span>CRM + operational memory</span></div></header>
        {selected ? <div className={styles.context}>
          <section><span>Next action</span><strong>{selected.nextAction ?? 'No next action'}</strong><p>Due: {selected.nextActionDue ?? 'Not set'}.</p></section>
          <section><span>Routing</span><strong>{selected.routeReason ?? (recommendedOperator ? `Recommended: ${recommendedOperator.name}` : 'Queue / manual assignment')}</strong><p>{aiDecision ? `${aiDecision.mode === 'ai' ? 'AI may continue' : 'Human required'} · ${aiDecision.reason}` : 'Waiting for conversation context.'}</p></section>
          <section><span>CRM snapshot</span><ul><li>Customer: {selected.customerId ?? 'New / unresolved lead'}</li><li>Property: {selected.property ?? 'Missing'}</li><li>Equipment: {selected.equipment ?? 'Load from CRM'}</li><li>Queue: {selected.queue}</li><li>Current owner: {selected.owner ?? 'Unassigned'}</li><li>Provider: {selected.provider ?? provider}</li></ul></section>
          <section><span>Collision control</span><strong>{selected.lockedBy ? `Reply lock: ${selected.lockedBy}` : 'Ownership lock follows assignee'}</strong><p>Operators cannot reply to a colleague-owned chat until they take ownership. Managers retain full visibility and reassignment control.</p></section>
        </div> : <div className={styles.empty}>No conversation selected.</div>}
        {mode === 'escalations' ? <div>{conversations.filter((conversation) => conversation.status === 'escalated').map((conversation) => <article className={styles.escalation} key={conversation.id}><span>{conversation.queue}</span><strong>{conversation.customer}</strong><p>{conversation.nextAction ?? 'Manager review required'}</p></article>)}</div> : <div className={styles.operators}>{operators.length ? operators.map((operator) => <article className={styles.operator} key={operator.id}><span>{initials(operator.name)}</span><div><strong>{operator.name}</strong><small>{operator.activeChats} chats{operator.activeVoiceCall ? ' · voice call active' : ''}</small></div><b>{operator.presence.replaceAll('_', ' ')}</b></article>) : <div className={styles.empty}>Operators appear here after they open the Communication Center.</div>}</div>}
      </aside>
    </div>
  </section>;
}