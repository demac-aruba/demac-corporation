'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ConversationMessage,
  type ConversationStatus,
  type Queue,
} from '../../lib/communications';
import {
  assignConversation,
  claimConversation,
  loadCommunicationCustomerContext,
  loadCommunicationWorkspace,
  markConversationRead,
  queueWhatsAppText,
  returnConversationToAi,
  saveInternalCommunicationNote,
  touchCommunicationPresence,
  updateConversationStatus,
  type CommunicationCustomerContext,
  type LiveConversation,
  type LiveOperator,
  type WhatsAppProvider,
} from '../../lib/browser-communications';
import { loadFirebasePrincipal } from '../../lib/firebase/principal';
import type { AuthPrincipal } from '../../lib/security';
import { CommunicationAvatar, WhatsAppMessageContent, conversationMessagePreview, messageReceiptLabel } from './whatsapp-message-content';
import styles from './communication-center.module.css';

type Mode = 'communications' | 'ai' | 'escalations';
type InboxScope = 'pending' | 'mine' | 'unassigned' | 'team';
type VisualState = 'overdue' | 'needs_reply' | 'assigned' | 'unassigned' | 'escalated' | 'resolved';
type ContextTab = 'overview' | 'properties' | 'equipment' | 'actions';

const queueLabels: Array<{ value: 'all' | Queue; label: string }> = [
  { value: 'all', label: 'All queues' },
  { value: 'general', label: 'General' },
  { value: 'scheduling', label: 'Scheduling' },
  { value: 'sales', label: 'Sales' },
  { value: 'finance', label: 'Finance' },
  { value: 'technical', label: 'Technical' },
  { value: 'commercial_vip', label: 'Commercial / VIP' },
  { value: 'complaints', label: 'Complaints' },
  { value: 'manager', label: 'Manager' },
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

function messageTime(value?: string) {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function lastConversationMessage(conversation: LiveConversation) {
  return conversation.messages[conversation.messages.length - 1];
}

function lastMessage(conversation: LiveConversation) {
  const recent = lastConversationMessage(conversation);
  return recent ? conversationMessagePreview(recent) : conversation.lastMessageText || 'No recent message';
}

function isManager(principal: AuthPrincipal | null) {
  return principal?.role === 'super_admin' || principal?.role === 'operations';
}

function needsDemacReply(conversation: LiveConversation) {
  if (['resolved', 'closed'].includes(conversation.status)) return false;
  if (conversation.aiDisposition === 'ai_active') return false;
  if (conversation.status === 'escalated') return true;
  const last = lastConversationMessage(conversation);
  if (!last) return conversation.status === 'new' || conversation.status === 'waiting_demac';
  return last.role === 'customer' || conversation.status === 'waiting_demac';
}

function waitingMinutes(conversation: LiveConversation) {
  const last = lastConversationMessage(conversation);
  const timestamp = Date.parse(last?.at || conversation.lastActivityAt || '');
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
}

function visualState(conversation: LiveConversation): { state: VisualState; label: string } {
  if (conversation.status === 'escalated') return { state: 'escalated', label: 'Escalated' };
  if (['resolved', 'closed'].includes(conversation.status)) return { state: 'resolved', label: 'Resolved' };
  if (conversation.aiDisposition === 'ai_active') return { state: 'assigned', label: 'AI active' };
  if (needsDemacReply(conversation)) {
    const minutes = waitingMinutes(conversation);
    if (minutes >= 30) return { state: 'overdue', label: `${minutes}m waiting` };
    return { state: 'needs_reply', label: minutes > 0 ? `Needs reply · ${minutes}m` : 'Needs reply' };
  }
  if (conversation.ownerUserId || conversation.owner) return { state: 'assigned', label: 'In progress' };
  return { state: 'unassigned', label: 'Unassigned' };
}

function statusLabel(status: ConversationStatus) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function messageAuthorLabel(message: ConversationMessage, customer: string) {
  if (message.role === 'customer') return customer;
  if (message.author === 'DEMAC WhatsApp') return 'Linked WhatsApp device';
  return message.author || (message.role === 'ai' ? 'DEMAC AI' : 'DEMAC operator');
}

function customerActionUrl(path: string, customer: CommunicationCustomerContext | null, selected: LiveConversation | null, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ source: 'communication-center', ...extra });
  if (customer?.id) query.set('customerId', customer.id);
  if (customer?.properties[0]?.id) query.set('propertyId', customer.properties[0].id);
  if (selected?.id) query.set('conversationId', selected.id);
  if (selected?.phone) query.set('phone', selected.phone);
  return `${path}?${query.toString()}`;
}

function Metric({ label, value, tone, hint }: { label: string; value: number; tone?: 'danger' | 'warning' | 'success'; hint: string }) {
  return <article className={styles.metricCard} data-tone={tone ?? 'neutral'}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

export function CommunicationCenter({ mode = 'communications', standalone = false }: { mode?: Mode; standalone?: boolean }) {
  const [principal, setPrincipal] = useState<AuthPrincipal | null>(null);
  const [conversations, setConversations] = useState<LiveConversation[]>([]);
  const [operators, setOperators] = useState<LiveOperator[]>([]);
  const [provider, setProvider] = useState<WhatsAppProvider>('wacli');
  const [selectedId, setSelectedId] = useState('');
  const [queue, setQueue] = useState<'all' | Queue>(mode === 'escalations' ? 'complaints' : 'all');
  const [scope, setScope] = useState<InboxScope>(mode === 'escalations' ? 'team' : 'pending');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignmentTarget, setAssignmentTarget] = useState('');
  const [showDetails, setShowDetails] = useState(standalone || mode !== 'communications');
  const [customerContext, setCustomerContext] = useState<CommunicationCustomerContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>('overview');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
  const normalizedSearch = search.trim().toLowerCase();
  const activeCount = conversations.filter((conversation) => !['resolved', 'closed'].includes(conversation.status)).length;
  const pendingCount = conversations.filter(needsDemacReply).length;
  const myCount = principal ? conversations.filter((conversation) => conversation.ownerUserId === principal.userId && !['resolved', 'closed'].includes(conversation.status)).length : 0;
  const unassignedCount = conversations.filter((conversation) => conversation.aiDisposition !== 'ai_active' && !conversation.ownerUserId && !['resolved', 'closed'].includes(conversation.status)).length;
  const escalatedCount = conversations.filter((conversation) => conversation.status === 'escalated').length;
  const onlineCount = operators.filter((operator) => operator.presence !== 'offline').length;

  const visible = useMemo(() => conversations
    .filter((conversation) => queue === 'all' || conversation.queue === queue)
    .filter((conversation) => mode !== 'escalations' || conversation.status === 'escalated')
    .filter((conversation) => {
      if (!principal) return false;
      if (scope === 'pending') return needsDemacReply(conversation);
      if (scope === 'mine') return conversation.ownerUserId === principal.userId;
      if (scope === 'unassigned') return conversation.aiDisposition !== 'ai_active' && !conversation.ownerUserId;
      return true;
    })
    .filter((conversation) => {
      if (!normalizedSearch) return true;
      const haystack = [conversation.customer, conversation.phone, conversation.property, conversation.queue, conversation.status, conversation.owner, lastMessage(conversation)].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    }), [conversations, queue, mode, principal, scope, normalizedSearch]);

  useEffect(() => {
    if (visible.some((conversation) => conversation.id === selectedId)) return;
    const fallback = visible[0];
    setSelectedId(fallback?.id ?? '');
    setAssignmentTarget(fallback?.ownerUserId || '');
  }, [visible, selectedId]);

  const selected = visible.find((conversation) => conversation.id === selectedId) ?? visible[0] ?? null;
  const selectedAiActive = Boolean(selected && selected.aiDisposition === 'ai_active');
  const selectedOwnedByMe = Boolean(selected && principal && selected.ownerUserId === principal.userId);
  const selectedUnassigned = Boolean(selected && !selected.ownerUserId && !selectedAiActive);
  const selectedOwnedByColleague = Boolean(selected && selected.ownerUserId && principal && selected.ownerUserId !== principal.userId);
  const canReadBody = Boolean(selected && (manager || selectedAiActive || selectedOwnedByMe || selectedUnassigned));
  const canReply = Boolean(selected && principal && selectedOwnedByMe && !selectedAiActive);
  const canManageWorkflow = Boolean(selected && !selectedAiActive && (manager || selectedOwnedByMe));
  const canReturnToAi = Boolean(selected && !selectedAiActive && principal && (manager || selectedOwnedByMe));

  useEffect(() => {
    let cancelled = false;
    setCustomerContext(null);
    setContextTab('overview');
    if (!selected) return () => { cancelled = true; };
    setContextLoading(true);
    loadCommunicationCustomerContext(selected)
      .then((context) => { if (!cancelled) setCustomerContext(context); })
      .catch(() => { if (!cancelled) setCustomerContext(null); })
      .finally(() => { if (!cancelled) setContextLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [selected?.id, selected?.messages.length]);

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

  const returnToAi = async () => {
    if (!selected || !principal || !canReturnToAi) return;
    setBusy(true);
    setError('');
    try {
      await returnConversationToAi(selected.id, principal);
      await refresh();
      setScope('team');
    } catch (returnError) {
      setError(returnError instanceof Error ? returnError.message : String(returnError));
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
    if (!selected || !canManageWorkflow) return;
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
      setError('Take ownership of this conversation before replying so the Customer Agent and an operator cannot answer the same customer.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (internal) await saveInternalCommunicationNote(selected.id, text, principal);
      else await queueWhatsAppText(selected, text, principal, provider);

      const optimistic: ConversationMessage = {
        id: `local-${Date.now()}`,
        at: new Date().toISOString(),
        author: internal ? `${principal.displayName} · internal` : principal.displayName,
        role: internal ? 'internal_note' : 'operator',
        text,
        channel: internal ? 'internal' : 'whatsapp',
      };
      setConversations((current) => current.map((conversation) => conversation.id === selected.id
        ? { ...conversation, messages: [...conversation.messages, optimistic], lastActivityAt: optimistic.at, lastMessageText: text }
        : conversation));
      setDraft('');
      if (!internal) setScope('mine');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setBusy(false);
    }
  };

  const openAction = (path: string, extra: Record<string, string> = {}) => {
    const url = customerActionUrl(path, customerContext, selected, extra);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const heading = mode === 'ai' ? 'AI Customer Agent' : mode === 'escalations' ? 'Escalations' : 'Communication Center';
  const subtitle = mode === 'communications' ? 'WhatsApp team inbox for customer conversations, ownership and follow-up.' : mode === 'ai' ? 'AI-assisted customer conversations with human ownership controls.' : 'Conversations that require human exception handling.';
  const detailsVisible = standalone || showDetails;

  return <section className={`${styles.page} ${standalone ? styles.standalone : ''}`}>
    <div className={styles.topLine}>
      <div className={styles.titleBlock}>
        <div className={styles.titleRow}>{standalone ? <span className={styles.brandIcon}>WA</span> : null}<div><h1>{standalone ? 'DEMAC Communication Center' : heading}</h1><p>{subtitle}</p></div><span className={`${styles.liveBadge} ${provider === 'wacli' ? styles.testBadge : ''}`}>{provider === 'wacli' ? 'TEST · WACLI' : 'LIVE · META'}</span></div>
      </div>
      <div className={styles.headerActions}>
        <span className={styles.syncState}><i /> Auto-sync</span>
        {standalone && principal ? <span className={styles.operatorIdentity}><b>{initials(principal.displayName)}</b><span>{principal.displayName}</span></span> : null}
        {standalone ? <a className={styles.erpLink} href="/dashboard" target="_blank" rel="noopener noreferrer">ERP ↗</a> : null}
        <button className={styles.refreshButton} type="button" onClick={() => refresh().catch(() => undefined)} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
    </div>

    {standalone ? <div className={styles.standaloneMetrics}>
      <Metric label="Active conversations" value={activeCount} hint="Open customer threads" />
      <Metric label="Needs reply" value={pendingCount} tone={pendingCount ? 'warning' : undefined} hint="Waiting on a DEMAC operator" />
      <Metric label="Unassigned" value={unassignedCount} tone={unassignedCount ? 'warning' : undefined} hint="Human queue without owner" />
      <Metric label="Operators online" value={onlineCount} tone="success" hint="Active presence" />
      <Metric label="Escalated" value={escalatedCount} tone={escalatedCount ? 'danger' : undefined} hint="Exception queue" />
    </div> : null}

    {provider === 'wacli' && mode === 'communications' ? <div className={styles.testNotice}><strong>TEST CONNECTION</strong><span>Personal linked WhatsApp device. Production customer traffic remains on the official channel until cutover.</span></div> : null}
    {error ? <div className={styles.notice}><strong>Communication Center</strong><span>{error}</span></div> : null}

    <div className={`${styles.workspace} ${detailsVisible ? styles.withDetails : ''}`}>
      <aside className={`${styles.panel} ${styles.inboxPanel}`}>
        <div className={styles.inboxHeader}><div><strong>WhatsApp Inbox</strong><span>{loading ? 'Loading conversations…' : `${visible.length} conversations shown`}</span></div><span className={styles.inboxCount}>{conversations.length}</span></div>
        <div className={styles.inboxTools}>
          <label className={styles.inboxSearch}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />{search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear conversation search">×</button> : null}</label>
          <select className={styles.queueSelect} value={queue} onChange={(event) => setQueue(event.target.value as 'all' | Queue)} aria-label="Filter by queue">{queueLabels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </div>
        <div className={styles.scopeTabs}>
          <button type="button" className={scope === 'pending' ? styles.active : ''} onClick={() => setScope('pending')}><span>Needs reply</span><b>{pendingCount}</b></button>
          <button type="button" className={scope === 'mine' ? styles.active : ''} onClick={() => setScope('mine')}><span>Mine</span><b>{myCount}</b></button>
          <button type="button" className={scope === 'unassigned' ? styles.active : ''} onClick={() => setScope('unassigned')}><span>Unassigned</span><b>{unassignedCount}</b></button>
          <button type="button" className={scope === 'team' ? styles.active : ''} onClick={() => setScope('team')}><span>{manager ? 'All' : 'Team'}</span><b>{conversations.length}</b></button>
        </div>
        <div className={styles.conversationList}>
          {!loading && visible.length === 0 ? <div className={styles.empty}><strong>No conversations found</strong><span>Try another inbox view, queue or search.</span></div> : null}
          {visible.map((conversation) => {
            const state = visualState(conversation);
            const owner = conversation.aiDisposition === 'ai_active' ? 'DEMAC Customer Agent' : conversation.owner ?? 'No operator';
            return <button key={conversation.id} type="button" data-state={state.state} className={`${styles.conversationRow} ${selected?.id === conversation.id ? styles.selectedRow : ''}`} onClick={() => selectConversation(conversation)}>
              <CommunicationAvatar className={styles.avatar} name={conversation.customer} url={conversation.avatarUrl} />
              <span className={styles.rowBody}>
                <span className={styles.rowTop}><strong>{conversation.customer}</strong><time>{relativeTime(conversation.lastActivityAt)}</time></span>
                <span className={styles.rowPreview}>{lastMessage(conversation)}</span>
                <span className={styles.rowMeta}><em className={styles.statusChip} data-state={state.state}>{state.label}</em><em>{owner}</em><em>{conversation.queue}</em></span>
              </span>
              {conversation.unread ? <b className={styles.unreadBadge}>{conversation.unread}</b> : null}
            </button>;
          })}
        </div>
      </aside>

      <main className={`${styles.panel} ${styles.chat}`}>
        {!selected ? <div className={styles.emptyLarge}><span className={styles.emptyIcon}>WA</span><strong>{loading ? 'Loading Communication Center…' : 'No conversation selected'}</strong><p>Choose a conversation from the inbox to start working.</p></div> : <>
          <div className={styles.chatHeader}>
            <div className={styles.chatIdentity}><CommunicationAvatar className={styles.chatAvatar} name={selected.customer} url={selected.avatarUrl} /><div><h2>{selected.customer}</h2><p>{selected.phone || selected.chatJid || 'WhatsApp identity pending'}{selected.property ? ` · ${selected.property}` : ''}</p></div></div>
            <div className={styles.chatHeaderActions}>
              <span className={styles.ownerLabel}>{selectedAiActive ? 'DEMAC Customer Agent active' : selected.owner ? `Assigned to ${selected.owner}` : 'Human queue · unassigned'}</span>
              {selectedOwnedByMe && !selectedAiActive
                ? <button type="button" className={styles.takeover} onClick={returnToAi} disabled={busy || !canReturnToAi}>Return to AI</button>
                : <button type="button" className={styles.takeover} onClick={takeOver} disabled={busy || selectedOwnedByMe}>{selectedAiActive ? 'Take over from AI' : selectedOwnedByColleague ? 'Take over' : 'Take conversation'}</button>}
              {!standalone ? <button type="button" className={styles.detailsButton} onClick={() => setShowDetails((current) => !current)}>{showDetails ? 'Hide details' : 'Customer details'}</button> : null}
            </div>
          </div>

          <div className={styles.workflowBar}>
            <div className={styles.statusPills}><span className={styles.pill}>{statusLabel(selected.status)}</span><span className={styles.pill}>{selected.queue}</span><span className={styles.pill}>{selectedAiActive ? 'AI ownership' : 'Human ownership'}</span>{selected.customerTyping ? <span className={`${styles.pill} ${styles.typingPill}`}>typing…</span> : null}{selected.vip ? <span className={`${styles.pill} ${styles.vipPill}`}>VIP</span> : null}</div>
            <div className={styles.controls}>
              <select value={selected.status} onChange={(event) => changeStatus(event.target.value as ConversationStatus)} disabled={busy || !canManageWorkflow} aria-label="Conversation status">{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
              {manager ? <><select value={assignmentTarget || selected.ownerUserId || ''} onChange={(event) => setAssignmentTarget(event.target.value)} aria-label="Assign conversation"><option value="">Select operator</option>{operators.map((operator) => <option key={operator.userId} value={operator.userId}>{operator.name} · {operator.presence.replaceAll('_', ' ')}</option>)}</select><button type="button" onClick={reassign} disabled={busy || !assignmentTarget}>Assign</button></> : null}
              <button type="button" className={styles.escalateButton} onClick={() => changeStatus('escalated')} disabled={busy || !canManageWorkflow}>Escalate</button><button type="button" className={styles.resolveButton} onClick={() => changeStatus('resolved')} disabled={busy || !canManageWorkflow}>Resolve</button>
            </div>
          </div>

          <div className={styles.messages}>
            {!canReadBody ? <article className={`${styles.message} ${styles.system}`}><span className={styles.messageAuthor}>Team ownership</span><p>This conversation is being handled by {selected.owner ?? 'another operator'}. Take ownership before working in the chat.</p></article> : selected.messages.length ? selected.messages.map((message) => <article key={message.id} className={`${styles.message} ${styles[message.role]}`}>
              <div className={styles.messageHeader}><span className={styles.messageAuthor}>{messageAuthorLabel(message, selected.customer)}</span></div>
              <WhatsAppMessageContent message={message} />
              <div className={styles.messageFooter}><time>{messageTime(message.at)}</time>{message.role === 'operator' ? <span>{messageReceiptLabel(message)}</span> : null}</div>
            </article>) : <article className={`${styles.message} ${styles.system}`}><span className={styles.messageAuthor}>Conversation ready</span><p>No synchronized messages are stored in the recent window yet.</p></article>}
            <div ref={messagesEndRef} />
          </div>

          <div className={`${styles.composer} ${internal ? styles.internalComposer : ''}`}>
            <div className={styles.composerMode}><button type="button" onClick={() => setInternal(false)} className={!internal ? styles.active : ''} disabled={!canReadBody}>Reply</button><button type="button" onClick={() => setInternal(true)} className={internal ? styles.active : ''} disabled={!canReadBody}>Internal note</button><span>{internal ? 'Visible only to DEMAC staff' : selectedAiActive ? 'Customer Agent currently owns this conversation' : principal ? `Sending as ${principal.displayName}` : 'WhatsApp message'}</span></div>
            <div className={styles.composerBox}>
              <div className={styles.mediaTools}><button type="button" className={styles.mediaButton} disabled title="File sending will be activated after full-screen UX acceptance." aria-label="Attach file">＋</button><button type="button" className={styles.mediaButton} disabled title="Voice notes will be activated after full-screen UX acceptance." aria-label="Record voice note">●</button></div>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && draft.trim() && (internal || canReply)) void send(); } }} disabled={!canReadBody || busy} placeholder={internal ? 'Write an internal note…' : canReply ? 'Type a message…' : selectedAiActive ? 'Take over from AI before replying…' : 'Take ownership before replying…'} />
              <button type="button" className={styles.sendButton} onClick={send} disabled={busy || !draft.trim() || (!internal && !canReply)}>{busy ? 'Sending…' : internal ? 'Save note' : 'Send'}</button>
            </div>
            <div className={styles.composerHint}><span>Enter to send · Shift+Enter for new line</span><span>{internal ? 'Internal collaboration' : 'WhatsApp'}</span></div>
          </div>
        </>}
      </main>

      {detailsVisible ? <aside className={`${styles.panel} ${styles.contextPanel}`}>
        <div className={styles.contextHeader}><div><strong>Customer 360</strong><span>CRM & operational context</span></div>{selected ? <span className={styles.contextChannel}>WhatsApp</span> : null}</div>
        {selected ? <div className={styles.context}>
          <section className={styles.customerCard}><CommunicationAvatar className={styles.largeAvatar} name={customerContext?.displayName || selected.customer} url={selected.avatarUrl} /><div><strong>{customerContext?.displayName || selected.customer}</strong><p>{customerContext?.phone || selected.phone || selected.chatJid || 'Phone not resolved'}</p>{customerContext?.email ? <p>{customerContext.email}</p> : null}<small>{contextLoading ? 'Matching CRM…' : customerContext ? 'Matched CRM customer' : 'WhatsApp contact · not linked to CRM'}</small></div></section>

          <nav className={styles.contextTabs} aria-label="Customer context sections">
            {(['overview', 'properties', 'equipment', 'actions'] as ContextTab[]).map((tab) => <button key={tab} type="button" className={contextTab === tab ? styles.contextTabActive : ''} onClick={() => setContextTab(tab)}>{tab === 'overview' ? 'Info' : tab === 'properties' ? 'Properties' : tab === 'equipment' ? 'A/C' : 'Actions'}</button>)}
          </nav>

          {contextTab === 'overview' ? <div className={styles.contextBody}>
            <section className={styles.contextSection}><span>Conversation</span><dl><div><dt>Owner</dt><dd>{selectedAiActive ? 'DEMAC Customer Agent' : selected.owner ?? 'Unassigned'}</dd></div><div><dt>Ownership</dt><dd>{selectedAiActive ? 'AI' : 'Human'}</dd></div><div><dt>Status</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>Queue</dt><dd>{selected.queue}</dd></div><div><dt>Language</dt><dd>{customerContext?.preferredLanguage || selected.language}</dd></div></dl></section>
            <section className={styles.contextSection}><span>Customer profile</span>{customerContext ? <dl><div><dt>Customer ID</dt><dd>{customerContext.id}</dd></div><div><dt>Type</dt><dd>{customerContext.type || '—'}</dd></div><div><dt>CRM status</dt><dd>{customerContext.status || '—'}</dd></div><div><dt>Properties</dt><dd>{customerContext.properties.length}</dd></div><div><dt>Registered A/C</dt><dd>{customerContext.equipment.length}</dd></div></dl> : <p>This WhatsApp identity has not been matched to a live CRM customer yet. The conversation can still be handled normally.</p>}{customerContext?.tags.length ? <div className={styles.tagList}>{customerContext.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}</section>
            {selected.nextAction ? <section className={styles.contextSection}><span>Next action</span><strong>{selected.nextAction}</strong><p>{selected.nextActionDue ? `Due ${selected.nextActionDue}` : 'No due date.'}</p></section> : null}
            {mode !== 'communications' ? <section className={styles.contextSection}><span>Ownership</span><strong>{selectedAiActive ? 'DEMAC Customer Agent' : selected.owner ? `Human · ${selected.owner}` : 'Human queue · unassigned'}</strong><p>{selected.routeReason || 'Ownership is controlled by the Customer Agent runtime and Communication Center.'}</p></section> : null}
          </div> : null}

          {contextTab === 'properties' ? <div className={styles.contextBody}>{contextLoading ? <div className={styles.contextEmpty}>Loading customer properties…</div> : customerContext?.properties.length ? <div className={styles.recordList}>{customerContext.properties.map((property) => <article key={property.id}><div><strong>{property.name}</strong><span>{property.address}</span>{property.sector ? <small>{property.sector}</small> : null}</div><b>{property.equipment.length} A/C</b></article>)}</div> : <div className={styles.contextEmpty}>No live CRM properties are linked to this WhatsApp contact.</div>}</div> : null}

          {contextTab === 'equipment' ? <div className={styles.contextBody}>{contextLoading ? <div className={styles.contextEmpty}>Loading registered equipment…</div> : customerContext?.equipment.length ? <div className={styles.recordList}>{customerContext.equipment.map((equipment) => <article key={equipment.id}><div><strong>{equipment.locationLabel}</strong><span>{equipment.systemType}</span><small>{equipment.condition || (equipment.active ? 'Active' : 'Inactive')}</small></div><b>{equipment.active ? 'Active' : 'Off'}</b></article>)}</div> : <div className={styles.contextEmpty}>No registered A/C equipment found for this customer.</div>}</div> : null}

          {contextTab === 'actions' ? <div className={styles.contextBody}>
            <section className={styles.contextSection}><span>Quick customer actions</span><div className={styles.quickActionGrid}>
              <button type="button" disabled={!customerContext} onClick={() => openAction('/scheduling', { action: 'create-appointment' })}><b>＋</b><span>Create appointment</span><small>Open Scheduling with customer context</small></button>
              <button type="button" disabled={!customerContext} onClick={() => openAction('/work-orders', { action: 'create', type: 'warranty' })}><b>W</b><span>Warranty ticket</span><small>Start a warranty work order</small></button>
              <button type="button" disabled={!customerContext} onClick={() => openAction('/crm', { tab: 'Equipment', action: 'add-equipment' })}><b>A/C</b><span>Add equipment</span><small>Register another air conditioner</small></button>
              <button type="button" disabled={!customerContext} onClick={() => openAction('/crm', { action: 'edit-customer' })}><b>✎</b><span>Edit customer</span><small>Update CRM master information</small></button>
              <button type="button" onClick={() => openAction('/crm', { action: 'open-customer' })}><b>CRM</b><span>Open full CRM</span><small>View complete Customer 360</small></button>
            </div>{!customerContext ? <p>Link this WhatsApp identity to a CRM customer before using customer-specific actions.</p> : null}</section>
          </div> : null}

          {!standalone ? <details className={styles.details}><summary>Operator presence</summary><div className={styles.operators}>{operators.length ? operators.map((operator) => <article className={styles.operator} key={operator.id}><span>{initials(operator.name)}</span><div><strong>{operator.name}</strong><small>{operator.activeChats} chat{operator.activeChats === 1 ? '' : 's'}{operator.activeVoiceCall ? ' · on voice call' : ''}</small></div><b>{operator.presence.replaceAll('_', ' ')}</b></article>) : <div className={styles.empty}><span>No other operators online.</span></div>}</div></details> : null}
        </div> : <div className={styles.empty}><strong>No customer selected</strong><span>Customer context appears when you open a conversation.</span></div>}
      </aside> : null}
    </div>
  </section>;
}
