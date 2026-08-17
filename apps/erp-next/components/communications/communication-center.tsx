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
  queueWhatsAppMedia,
  queueWhatsAppText,
  returnConversationToAi,
  saveInternalCommunicationNote,
  touchCommunicationPresence,
  updateConversationStatus,
  validateWhatsAppAttachment,
  whatsAppAttachmentKind,
  type CommunicationCustomerContext,
  type LiveConversation,
  type LiveConversationMessage,
  type LiveOperator,
  type WhatsAppMediaKind,
  type WhatsAppProvider,
} from '../../lib/browser-communications';
import { closeCommunicationConversation } from '../../lib/communication-conversation-actions';
import { loadFirebasePrincipal } from '../../lib/firebase/principal';
import type { AuthPrincipal } from '../../lib/security';
import { CommunicationAvatar, WhatsAppMessageContent, conversationMessagePreview, messageReceiptLabel } from './whatsapp-message-content';
import { useVoiceNoteRecorder } from './use-voice-note-recorder';
import styles from './communication-center.module.css';
import mediaStyles from './communication-media.module.css';
import workspaceStyles from './communication-center-workspace.module.css';

type Mode = 'communications' | 'ai' | 'escalations';
type InboxScope = 'pending' | 'mine' | 'unassigned' | 'team';
type VisualState = 'overdue' | 'needs_reply' | 'assigned' | 'unassigned' | 'escalated' | 'resolved';
type ContextTab = 'overview' | 'properties' | 'equipment' | 'actions';
type StagedAttachment = { file: File; kind: WhatsAppMediaKind };
type PendingOptimisticMessage = { message: LiveConversationMessage; objectUrl?: string };

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

function pendingMatchesServer(local: LiveConversationMessage, server: LiveConversationMessage) {
  if (server.role !== 'operator') return false;
  const localText = String(local.text || local.mediaCaption || '').trim();
  const serverText = String(server.text || server.mediaCaption || '').trim();
  if (localText !== serverText) return false;
  if (String(local.mediaType || '') !== String(server.mediaType || '')) return false;
  if (local.mediaFileName && server.mediaFileName && local.mediaFileName !== server.mediaFileName) return false;
  const localAt = Date.parse(local.at || '');
  const serverAt = Date.parse(server.at || '');
  return Number.isFinite(localAt) && Number.isFinite(serverAt) && Math.abs(localAt - serverAt) <= 120_000;
}

function inboxWorkflowState(conversation: LiveConversation): { state: VisualState; label: string } {
  if (conversation.status === 'escalated') return { state: 'escalated', label: 'Escalated' };
  if (['resolved', 'closed'].includes(conversation.status)) return { state: 'resolved', label: 'Completed' };
  if (conversation.aiDisposition === 'ai_active') return { state: 'assigned', label: 'Maya · AI' };
  if (needsDemacReply(conversation)) return visualState(conversation);
  if (conversation.owner) return { state: 'assigned', label: `Assigned to ${conversation.owner.split(/\s+/)[0]}` };
  return { state: 'unassigned', label: 'Unassigned' };
}

function pipelineWorkflowState(conversation: LiveConversation): { label: string; tone: 'normal' | 'warning' | 'danger' | 'info' } {
  if (conversation.status === 'escalated') return { label: 'Escalated', tone: 'danger' };
  if (conversation.status === 'waiting_customer') return { label: 'Waiting customer', tone: 'normal' };
  if (conversation.status === 'appointment_pending') return { label: 'Booking in progress', tone: 'info' };
  if (conversation.status === 'estimate_pending') return { label: 'Estimate pending', tone: 'info' };
  if (conversation.status === 'payment_pending') return { label: 'Payment pending', tone: 'info' };
  if (needsDemacReply(conversation)) return { label: 'Needs reply', tone: 'warning' };
  return { label: 'In progress', tone: 'normal' };
}

function statusLabel(status: ConversationStatus) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function messageAuthorLabel(message: ConversationMessage, customer: string) {
  if (message.role === 'customer') return customer;
  if (message.author === 'DEMAC WhatsApp') return 'Linked WhatsApp device';
  return message.author || (message.role === 'ai' ? 'DEMAC AI' : 'DEMAC operator');
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function formatRecordingTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function attachmentPreviewLabel(type?: string | null) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'image') return '[Photo]';
  if (normalized === 'video') return '[Video]';
  if (normalized === 'voice') return '[Voice note]';
  if (normalized === 'audio') return '[Audio]';
  return '[Document]';
}

function attachmentIcon(type?: string | null) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'video') return 'VID';
  if (normalized === 'voice') return 'MIC';
  if (normalized === 'audio') return 'AUD';
  if (normalized === 'image') return 'IMG';
  return 'DOC';
}

function customerActionUrl(path: string, customer: CommunicationCustomerContext | null, selected: LiveConversation | null, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ source: 'communication-center', ...extra });
  if (customer?.id) query.set('customerId', customer.id);
  if (customer?.properties[0]?.id && !query.has('propertyId')) query.set('propertyId', customer.properties[0].id);
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
  const [attachment, setAttachment] = useState<StagedAttachment | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignmentTarget, setAssignmentTarget] = useState('');
  const [showDetails, setShowDetails] = useState(standalone || mode !== 'communications');
  const [customerContext, setCustomerContext] = useState<CommunicationCustomerContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>('overview');
  const [propertyPreviewId, setPropertyPreviewId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingMessagesRef = useRef<Map<string, PendingOptimisticMessage[]>>(new Map());
  const localObjectUrlsRef = useRef<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    const workspace = await loadCommunicationWorkspace();
    const conversationsWithPending = workspace.conversations.map((conversation) => {
      const pending = pendingMessagesRef.current.get(conversation.id) ?? [];
      if (!pending.length) return conversation;
      const matchedServerIndexes = new Set<number>();
      const remaining = pending.filter((entry) => {
        const matchIndex = conversation.messages.findIndex((serverMessage, index) => !matchedServerIndexes.has(index) && pendingMatchesServer(entry.message, serverMessage));
        if (matchIndex < 0) return true;
        matchedServerIndexes.add(matchIndex);
        const objectUrl = localObjectUrlsRef.current.get(entry.message.id);
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          localObjectUrlsRef.current.delete(entry.message.id);
        }
        return false;
      });
      if (remaining.length) pendingMessagesRef.current.set(conversation.id, remaining);
      else pendingMessagesRef.current.delete(conversation.id);
      const messages = [...conversation.messages, ...remaining.map((entry) => entry.message)]
        .sort((left, right) => Date.parse(left.at || '') - Date.parse(right.at || ''));
      const latest = messages[messages.length - 1];
      return latest ? { ...conversation, messages, lastActivityAt: latest.at, lastMessageText: conversationMessagePreview(latest) } : conversation;
    });
    setConversations(conversationsWithPending);
    setOperators(workspace.operators);
    setProvider(workspace.provider);
    setSelectedId((current) => current || workspace.conversations[0]?.id || '');
    return { ...workspace, conversations: conversationsWithPending };
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
  const operatorWorkspace = standalone && mode === 'communications';
  const myPipeline = useMemo(() => principal ? conversations
    .filter((conversation) => conversation.ownerUserId === principal.userId && !['resolved', 'closed'].includes(conversation.status))
    .sort((left, right) => Date.parse(right.lastActivityAt || '1970-01-01') - Date.parse(left.lastActivityAt || '1970-01-01')) : [], [conversations, principal]);

  const visible = useMemo(() => conversations
    .filter((conversation) => queue === 'all' || conversation.queue === queue)
    .filter((conversation) => mode !== 'escalations' || conversation.status === 'escalated')
    .filter((conversation) => {
      if (!principal) return false;
      if (operatorWorkspace) return true;
      if (scope === 'pending') return needsDemacReply(conversation);
      if (scope === 'mine') return conversation.ownerUserId === principal.userId;
      if (scope === 'unassigned') return conversation.aiDisposition !== 'ai_active' && !conversation.ownerUserId;
      return true;
    })
    .filter((conversation) => {
      if (!normalizedSearch) return true;
      const haystack = [conversation.customer, conversation.phone, conversation.property, conversation.queue, conversation.status, conversation.owner, lastMessage(conversation)].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    }), [conversations, queue, mode, principal, scope, normalizedSearch, operatorWorkspace]);

  const selectionPool = useMemo(() => operatorWorkspace ? conversations : visible, [operatorWorkspace, conversations, visible]);
  useEffect(() => {
    if (selectionPool.some((conversation) => conversation.id === selectedId)) return;
    const fallback = visible[0] ?? selectionPool[0];
    setSelectedId(fallback?.id ?? '');
    setAssignmentTarget(fallback?.ownerUserId || '');
  }, [visible, selectionPool, selectedId]);

  const selected = selectionPool.find((conversation) => conversation.id === selectedId) ?? visible[0] ?? selectionPool[0] ?? null;
  const selectedAiActive = Boolean(selected && selected.aiDisposition === 'ai_active');
  const selectedOwnedByMe = Boolean(selected && principal && selected.ownerUserId === principal.userId);
  const selectedUnassigned = Boolean(selected && !selected.ownerUserId && !selectedAiActive);
  const selectedOwnedByColleague = Boolean(selected && selected.ownerUserId && principal && selected.ownerUserId !== principal.userId);
  const canReadBody = Boolean(selected && (manager || selectedAiActive || selectedOwnedByMe || selectedUnassigned));
  const canReply = Boolean(selected && principal && selectedOwnedByMe && !selectedAiActive);
  const canComposeCustomer = Boolean(selected && principal && !selectedOwnedByColleague && (selectedOwnedByMe || selectedAiActive || selectedUnassigned));
  const canManageWorkflow = Boolean(selected && !selectedAiActive && (manager || selectedOwnedByMe));
  const canReturnToAi = Boolean(selected && !selectedAiActive && principal && (manager || selectedOwnedByMe));

  useEffect(() => {
    let cancelled = false;
    setCustomerContext(null);
    setContextTab('overview');
    setPropertyPreviewId('');
    setAttachment(null);
    setDragActive(false);
    if (!selected) return () => { cancelled = true; };
    setContextLoading(true);
    loadCommunicationCustomerContext(selected)
      .then((context) => { if (!cancelled) setCustomerContext(context); })
      .catch(() => { if (!cancelled) setCustomerContext(null); })
      .finally(() => { if (!cancelled) setContextLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  useEffect(() => {
    if (!attachment || attachment.kind !== 'image') {
      setAttachmentPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(attachment.file);
    setAttachmentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

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

  const closeChat = async () => {
    if (!selected || !canManageWorkflow) return;
    setBusy(true);
    setError('');
    try {
      await closeCommunicationConversation(selected.id);
      await refresh();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : String(closeError));
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

  const stageAttachment = useCallback((file: File | null, kindOverride?: WhatsAppMediaKind) => {
    if (!file) return;
    if (internal) {
      setError('Attachments are for customer WhatsApp replies. Switch back to Reply before attaching a file.');
      return;
    }
    if (!canComposeCustomer) {
      setError(selectedOwnedByColleague ? 'This conversation is assigned to another operator. Reassign it before attaching a file.' : 'Replying will assign this conversation to you before the file is sent.');
      return;
    }
    try {
      validateWhatsAppAttachment(file);
      setAttachment({ file, kind: kindOverride || whatsAppAttachmentKind(file) });
      setError('');
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : String(attachmentError));
    }
  }, [canComposeCustomer, internal, selectedOwnedByColleague]);

  const {
    recording: voiceRecording,
    seconds: voiceSeconds,
    supported: voiceSupported,
    start: startVoiceNote,
    stop: stopVoiceNote,
    cancel: cancelVoiceNote,
  } = useVoiceNoteRecorder({
    onRecorded: useCallback((file: File) => stageAttachment(file, 'voice'), [stageAttachment]),
    onError: useCallback((message: string) => setError(message), []),
    maxSeconds: 120,
  });

  useEffect(() => () => cancelVoiceNote(), [selected?.id, cancelVoiceNote]);
  useEffect(() => () => {
    for (const objectUrl of localObjectUrlsRef.current.values()) URL.revokeObjectURL(objectUrl);
    localObjectUrlsRef.current.clear();
  }, []);

  const send = async () => {
    const text = draft.trim();
    if (!selected || !principal) return;
    if (internal && !text) return;
    if (!internal && !text && !attachment) return;
    if (!internal && !canComposeCustomer) {
      setError(selectedOwnedByColleague ? 'This conversation is assigned to another operator. Reassign or take over before replying.' : 'This conversation cannot be replied to right now.');
      return;
    }
    if (voiceRecording) {
      setError('Stop the voice-note recording before sending.');
      return;
    }

    const conversationSnapshot = selected;
    const attachmentSnapshot = attachment;
    let optimisticId = '';

    if (!internal) {
      optimisticId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const objectUrl = attachmentSnapshot ? URL.createObjectURL(attachmentSnapshot.file) : '';
      const optimistic: LiveConversationMessage = {
        id: optimisticId,
        at: new Date().toISOString(),
        author: principal.displayName,
        role: 'operator',
        text,
        channel: 'whatsapp',
        status: 'queued',
        provider,
        mediaType: attachmentSnapshot?.kind || null,
        mediaCaption: attachmentSnapshot && text ? text : null,
        mediaFileName: attachmentSnapshot?.file.name || null,
        mediaMimeType: attachmentSnapshot?.file.type || null,
        mediaSize: attachmentSnapshot?.file.size || null,
        mediaUrl: objectUrl || null,
      };
      const currentPending = pendingMessagesRef.current.get(conversationSnapshot.id) ?? [];
      pendingMessagesRef.current.set(conversationSnapshot.id, [...currentPending, { message: optimistic, objectUrl: objectUrl || undefined }]);
      if (objectUrl) localObjectUrlsRef.current.set(optimisticId, objectUrl);
      const preview = text || attachmentPreviewLabel(attachmentSnapshot?.kind);
      setConversations((current) => current.map((conversation) => conversation.id === conversationSnapshot.id
        ? {
            ...conversation,
            owner: principal.displayName,
            ownerUserId: principal.userId,
            aiDisposition: 'human_active',
            status: 'assigned',
            unread: 0,
            messages: [...conversation.messages, optimistic],
            lastActivityAt: optimistic.at,
            lastMessageText: preview,
          }
        : conversation));
      setDraft('');
      setAttachment(null);
    }

    setBusy(true);
    setError('');
    try {
      if (internal) {
        await saveInternalCommunicationNote(conversationSnapshot.id, text, principal);
        setDraft('');
      } else {
        if (!selectedOwnedByMe) await claimConversation(conversationSnapshot.id, principal);
        if (attachmentSnapshot) await queueWhatsAppMedia(conversationSnapshot, attachmentSnapshot.file, text, principal, provider, attachmentSnapshot.kind);
        else await queueWhatsAppText(conversationSnapshot, text, principal, provider);
        if (!operatorWorkspace) setScope('mine');
        await refresh();
      }
    } catch (sendError) {
      if (optimisticId) {
        const pending = pendingMessagesRef.current.get(conversationSnapshot.id) ?? [];
        pendingMessagesRef.current.set(conversationSnapshot.id, pending.map((entry) => entry.message.id === optimisticId ? { ...entry, message: { ...entry.message, status: 'failed' } } : entry));
        setConversations((current) => current.map((conversation) => conversation.id === conversationSnapshot.id
          ? { ...conversation, messages: conversation.messages.map((message) => message.id === optimisticId ? { ...message, status: 'failed' } : message) }
          : conversation));
        refresh().catch(() => undefined);
      }
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
  const canSubmit = internal
    ? Boolean(canReadBody && !busy && draft.trim())
    : Boolean(canComposeCustomer && !busy && !voiceRecording && (draft.trim() || attachment));
  const attachmentKind = attachment?.kind || null;
  const propertyPreview = customerContext?.properties.find((property) => property.id === propertyPreviewId) ?? null;

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

    <div className={`${styles.workspace} ${detailsVisible ? styles.withDetails : ''} ${operatorWorkspace ? workspaceStyles.operatorWorkspace : ''}`}>
      <aside className={`${styles.panel} ${styles.inboxPanel}`}>
        <div className={styles.inboxHeader}><div><strong>WhatsApp Inbox</strong><span>{loading ? 'Loading conversations…' : `${visible.length} conversations shown`}</span></div><span className={styles.inboxCount}>{conversations.length}</span></div>
        <div className={styles.inboxTools}>
          <label className={styles.inboxSearch}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />{search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear conversation search">×</button> : null}</label>
          <select className={styles.queueSelect} value={queue} onChange={(event) => setQueue(event.target.value as 'all' | Queue)} aria-label="Filter by queue">{queueLabels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </div>
        {operatorWorkspace ? <div className={workspaceStyles.inboxGeneralLabel}>All incoming conversations</div> : <div className={styles.scopeTabs}>
          <button type="button" className={scope === 'pending' ? styles.active : ''} onClick={() => setScope('pending')}><span>Needs reply</span><b>{pendingCount}</b></button>
          <button type="button" className={scope === 'mine' ? styles.active : ''} onClick={() => setScope('mine')}><span>Mine</span><b>{myCount}</b></button>
          <button type="button" className={scope === 'unassigned' ? styles.active : ''} onClick={() => setScope('unassigned')}><span>Unassigned</span><b>{unassignedCount}</b></button>
          <button type="button" className={scope === 'team' ? styles.active : ''} onClick={() => setScope('team')}><span>{manager ? 'All' : 'Team'}</span><b>{conversations.length}</b></button>
        </div>}
        <div className={styles.conversationList}>
          {!loading && visible.length === 0 ? <div className={styles.empty}><strong>No conversations found</strong><span>Try another inbox view, queue or search.</span></div> : null}
          {visible.map((conversation) => {
            const state = operatorWorkspace ? inboxWorkflowState(conversation) : visualState(conversation);
            const owner = conversation.aiDisposition === 'ai_active' ? 'DEMAC Customer Agent' : conversation.owner ?? 'No operator';
            return <button key={conversation.id} type="button" data-state={state.state} className={`${styles.conversationRow} ${selected?.id === conversation.id ? styles.selectedRow : ''}`} onClick={() => selectConversation(conversation)}>
              <CommunicationAvatar className={styles.avatar} name={conversation.customer} url={conversation.avatarUrl} />
              <span className={styles.rowBody}>
                <span className={styles.rowTop}><strong>{conversation.customer}</strong><time>{relativeTime(conversation.lastActivityAt)}</time></span>
                <span className={styles.rowPreview}>{lastMessage(conversation)}</span>
              {operatorWorkspace ? <span className={`${styles.rowMeta} ${workspaceStyles.compactInboxMeta}`}><em className={styles.statusChip} data-state={state.state}>{state.label}</em></span> : <span className={styles.rowMeta}><em className={styles.statusChip} data-state={state.state}>{state.label}</em><em>{owner}</em><em>{conversation.queue}</em></span>}
              </span>
              {conversation.unread ? <b className={styles.unreadBadge}>{conversation.unread}</b> : null}
            </button>;
          })}
        </div>
    </aside>

    {operatorWorkspace ? <aside className={workspaceStyles.pipelinePanel}>
      <div className={workspaceStyles.pipelineHeader}><div><strong>My Pipeline <b>{myPipeline.length}</b></strong><span>Assigned to me</span></div><button className={workspaceStyles.pipelineRefresh} type="button" onClick={() => refresh().catch(() => undefined)} aria-label="Refresh my pipeline">↻</button></div>
      <div className={workspaceStyles.pipelineList}>
        {myPipeline.length ? myPipeline.map((conversation) => {
          const pipelineState = pipelineWorkflowState(conversation);
          return <button key={conversation.id} type="button" className={`${workspaceStyles.pipelineRow} ${selected?.id === conversation.id ? workspaceStyles.pipelineRowActive : ''}`} onClick={() => selectConversation(conversation)}>
            <CommunicationAvatar className={workspaceStyles.pipelineAvatar} name={conversation.customer} url={conversation.avatarUrl} />
            <span className={workspaceStyles.pipelineBody}><span className={workspaceStyles.pipelineTop}><strong>{conversation.customer}</strong><time>{relativeTime(conversation.lastActivityAt)}</time></span><em className={workspaceStyles.pipelineStatus} data-tone={pipelineState.tone}>{pipelineState.label}</em></span>
          </button>;
        }) : <div className={workspaceStyles.pipelineEmpty}>Your active conversations will appear here automatically when you reply.</div>}
      </div>
      <div className={workspaceStyles.pipelineFooter}><span>Active workload</span><b>{myPipeline.length}</b></div>
    </aside> : null}

    <main className={`${styles.panel} ${styles.chat} ${operatorWorkspace ? workspaceStyles.chatWide : ''}`}>
        {!selected ? <div className={styles.emptyLarge}><span className={styles.emptyIcon}>WA</span><strong>{loading ? 'Loading Communication Center…' : 'No conversation selected'}</strong><p>Choose a conversation from the inbox to start working.</p></div> : <>
          <div className={styles.chatHeader}>
            <div className={styles.chatIdentity}><CommunicationAvatar className={styles.chatAvatar} name={selected.customer} url={selected.avatarUrl} /><div><h2>{selected.customer}</h2><p>{selected.phone || selected.chatJid || 'WhatsApp identity pending'}{selected.property ? ` · ${selected.property}` : ''}</p></div></div>
          <div className={styles.chatHeaderActions}>
            <span className={styles.ownerLabel}>{selectedAiActive ? 'Maya · AI' : selected.owner ? `Assigned to ${selected.owner}` : 'Unassigned'}</span>
            {operatorWorkspace ? <>
              {selectedOwnedByMe && !selectedAiActive ? <button type="button" className={styles.takeover} onClick={returnToAi} disabled={busy || !canReturnToAi} title="Release this conversation to Maya so she can answer the latest customer message.">Let Maya answer this</button> : null}
              {canManageWorkflow ? <button type="button" className={`${styles.takeover} ${styles.resolveButton}`} onClick={closeChat} disabled={busy} title="Close this chat. Maya will reactivate only when the customer writes again.">Close chat</button> : null}
              {selectedOwnedByColleague ? <button type="button" className={styles.takeover} onClick={takeOver} disabled={busy}>Take over</button> : null}
            </> : <>
              {selectedOwnedByMe && !selectedAiActive
                ? <button type="button" className={styles.takeover} onClick={returnToAi} disabled={busy || !canReturnToAi}>Return to AI</button>
                : <button type="button" className={styles.takeover} onClick={takeOver} disabled={busy || selectedOwnedByMe}>{selectedAiActive ? 'Take over from AI' : selectedOwnedByColleague ? 'Take over' : 'Take conversation'}</button>}
              {!standalone ? <button type="button" className={styles.detailsButton} onClick={() => setShowDetails((current) => !current)}>{showDetails ? 'Hide details' : 'Customer details'}</button> : null}
            </>}
          </div>
          </div>

        {operatorWorkspace ? <div className={workspaceStyles.assignmentHint} data-state={selectedOwnedByColleague ? 'blocked' : 'ready'}><b>{selectedOwnedByColleague ? '!' : '✓'}</b><span>{selectedOwnedByColleague ? `Assigned to ${selected.owner}. Reassign or take over before replying.` : selectedOwnedByMe ? 'This conversation is assigned to you. Replying will keep it assigned.' : selectedAiActive ? 'Replying assigns this conversation to you and pauses Maya for this chat.' : 'Replying assigns this conversation to you automatically.'}</span></div> : <div className={styles.workflowBar}>
          <div className={styles.statusPills}><span className={styles.pill}>{statusLabel(selected.status)}</span><span className={styles.pill}>{selected.queue}</span><span className={styles.pill}>{selectedAiActive ? 'AI ownership' : 'Human ownership'}</span>{selected.customerTyping ? <span className={`${styles.pill} ${styles.typingPill}`}>typing…</span> : null}{selected.vip ? <span className={`${styles.pill} ${styles.vipPill}`}>VIP</span> : null}</div>
          <div className={styles.controls}>
            <select value={selected.status} onChange={(event) => changeStatus(event.target.value as ConversationStatus)} disabled={busy || !canManageWorkflow} aria-label="Conversation status">{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
            {manager ? <><select value={assignmentTarget || selected.ownerUserId || ''} onChange={(event) => setAssignmentTarget(event.target.value)} aria-label="Assign conversation"><option value="">Select operator</option>{operators.map((operator) => <option key={operator.userId} value={operator.userId}>{operator.name} · {operator.presence.replaceAll('_', ' ')}</option>)}</select><button type="button" onClick={reassign} disabled={busy || !assignmentTarget}>Assign</button></> : null}
            <button type="button" className={styles.escalateButton} onClick={() => changeStatus('escalated')} disabled={busy || !canManageWorkflow}>Escalate</button><button type="button" className={styles.resolveButton} onClick={() => changeStatus('resolved')} disabled={busy || !canManageWorkflow}>Resolve</button>
          </div>
        </div>}

        <div className={`${styles.messages} ${operatorWorkspace ? workspaceStyles.expandedMessages : ''}`}>
            {!canReadBody ? <article className={`${styles.message} ${styles.system}`}><span className={styles.messageAuthor}>Team ownership</span><p>This conversation is being handled by {selected.owner ?? 'another operator'}. Take ownership before working in the chat.</p></article> : selected.messages.length ? selected.messages.map((message) => <article key={message.id} className={`${styles.message} ${styles[message.role]}`}>
              <div className={styles.messageHeader}><span className={styles.messageAuthor}>{messageAuthorLabel(message, selected.customer)}</span></div>
              <WhatsAppMessageContent message={message} />
              <div className={styles.messageFooter}><time>{messageTime(message.at)}</time>{message.role === 'operator' ? <span>{messageReceiptLabel(message)}</span> : null}</div>
            </article>) : <article className={`${styles.message} ${styles.system}`}><span className={styles.messageAuthor}>Conversation ready</span><p>No synchronized messages are stored in the recent window yet.</p></article>}
            <div ref={messagesEndRef} />
          </div>

          <div className={`${styles.composer} ${internal ? styles.internalComposer : ''}`}>
            <div className={styles.composerMode}><button type="button" onClick={() => setInternal(false)} className={!internal ? styles.active : ''} disabled={!canReadBody}>Reply</button><button type="button" onClick={() => { cancelVoiceNote(); setInternal(true); setAttachment(null); }} className={internal ? styles.active : ''} disabled={!canReadBody}>Internal note</button><span>{internal ? 'Visible only to DEMAC staff' : selectedAiActive ? 'Customer Agent currently owns this conversation' : principal ? `Sending as ${principal.displayName}` : 'WhatsApp message'}</span></div>
            {attachment ? <div className={mediaStyles.pendingAttachment}>
              <span className={mediaStyles.pendingThumb}>{attachmentKind === 'image' && attachmentPreviewUrl ? <img src={attachmentPreviewUrl} alt="Selected attachment preview" /> : attachmentIcon(attachmentKind)}</span>
              <span className={mediaStyles.pendingBody}><strong>{attachment.file.name}</strong><small>{attachmentKind} · {formatAttachmentSize(attachment.file.size)}</small></span>
              <button type="button" className={mediaStyles.removeAttachment} onClick={() => setAttachment(null)} disabled={busy} aria-label="Remove attachment">×</button>
            </div> : null}
            <div
              className={`${styles.composerBox} ${mediaStyles.mediaComposerBox} ${dragActive ? mediaStyles.dropActive : ''}`}
              onDragEnter={(event) => { event.preventDefault(); if (!internal && canComposeCustomer && !busy && !voiceRecording) setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); if (!internal && canComposeCustomer && !busy && !voiceRecording) { event.dataTransfer.dropEffect = 'copy'; setDragActive(true); } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                if (voiceRecording) return;
                const file = event.dataTransfer.files?.[0] || null;
                stageAttachment(file);
              }}
            >
              <div className={mediaStyles.mediaTools}>
                <input ref={fileInputRef} type="file" hidden accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip" onChange={(event) => { stageAttachment(event.target.files?.[0] || null); event.currentTarget.value = ''; }} />
                <button type="button" className={mediaStyles.mediaButton} onClick={() => fileInputRef.current?.click()} disabled={busy || internal || !canComposeCustomer || voiceRecording} title={canComposeCustomer ? 'Attach photo, audio, video or document' : selectedOwnedByColleague ? 'Assigned to another operator' : 'Replying will assign this conversation to you'} aria-label="Attach file">＋</button>
                <button
                  type="button"
                  className={`${mediaStyles.mediaButton} ${voiceRecording ? mediaStyles.recordingButton : ''}`}
                  onClick={() => {
                    if (voiceRecording) stopVoiceNote();
                    else {
                      setAttachment(null);
                      setError('');
                      void startVoiceNote();
                    }
                  }}
                  disabled={busy || internal || !canComposeCustomer || !voiceSupported}
                  title={!voiceSupported ? 'Voice-note recording is not supported by this browser' : voiceRecording ? 'Stop voice-note recording' : canComposeCustomer ? 'Record voice note' : selectedOwnedByColleague ? 'Assigned to another operator' : 'Replying will assign this conversation to you'}
                  aria-label={voiceRecording ? 'Stop voice-note recording' : 'Record voice note'}
                >{voiceRecording ? '■' : '●'}</button>
              </div>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSubmit) void send(); } }} disabled={!canReadBody || busy} placeholder={internal ? 'Write an internal note…' : voiceRecording ? `Recording voice note ${formatRecordingTime(voiceSeconds)}… click stop when finished` : canComposeCustomer ? attachment ? 'Add a caption or press Send…' : selectedOwnedByMe ? 'Type a message or drop a file here…' : 'Type a reply to assign this conversation to you…' : selectedOwnedByColleague ? 'Assigned to another operator…' : 'Reply unavailable…'} />
              <button type="button" className={styles.sendButton} onClick={send} disabled={!canSubmit}>{busy ? attachment && !internal ? 'Uploading…' : 'Sending…' : internal ? 'Save note' : 'Send'}</button>
            </div>
            <div className={styles.composerHint}><span>{voiceRecording ? <span className={mediaStyles.recordingHint}>Recording {formatRecordingTime(voiceSeconds)} · click ■ to stop</span> : attachment ? <span className={mediaStyles.attachmentHint}>Attachment ready · Enter to send</span> : 'Enter to send · Shift+Enter for new line'}</span><span>{internal ? 'Internal collaboration' : 'WhatsApp'}</span></div>
          </div>
        </>}
      </main>

    {detailsVisible ? <aside className={`${styles.panel} ${styles.contextPanel} ${operatorWorkspace ? workspaceStyles.customer360 : ''}`}>
        <div className={styles.contextHeader}><div><strong>Customer 360</strong><span>CRM & operational context</span></div>{selected ? <span className={styles.contextChannel}>WhatsApp</span> : null}</div>
        {selected ? <div className={styles.context}>
          <section className={styles.customerCard}><CommunicationAvatar className={styles.largeAvatar} name={customerContext?.displayName || selected.customer} url={customerContext?.avatarUrl || selected.avatarUrl} /><div><strong>{customerContext?.displayName || selected.customer}</strong><p>{customerContext?.phone || selected.phone || selected.chatJid || 'Phone not resolved'}</p>{customerContext?.email ? <p>{customerContext.email}</p> : null}<small>{contextLoading ? 'Matching CRM…' : customerContext ? 'Matched CRM customer' : 'WhatsApp contact · not linked to CRM'}</small></div></section>

          <nav className={styles.contextTabs} aria-label="Customer context sections">
          {(operatorWorkspace ? (['overview', 'properties', 'actions'] as ContextTab[]) : (['overview', 'properties', 'equipment', 'actions'] as ContextTab[])).map((tab) => <button key={tab} type="button" className={contextTab === tab ? styles.contextTabActive : ''} onClick={() => setContextTab(tab)}>{tab === 'overview' ? 'Info' : tab === 'properties' ? 'Properties' : tab === 'equipment' ? 'A/C' : 'Actions'}</button>)}
          </nav>

          {contextTab === 'overview' ? <div className={styles.contextBody}>
            <section className={styles.contextSection}><span>Conversation</span><dl><div><dt>Owner</dt><dd>{selectedAiActive ? 'DEMAC Customer Agent' : selected.owner ?? 'Unassigned'}</dd></div><div><dt>Ownership</dt><dd>{selectedAiActive ? 'AI' : 'Human'}</dd></div><div><dt>Status</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>Queue</dt><dd>{selected.queue}</dd></div><div><dt>Language</dt><dd>{customerContext?.preferredLanguage || selected.language}</dd></div></dl></section>
            <section className={styles.contextSection}><span>Customer profile</span>{customerContext ? <dl><div><dt>Customer ID</dt><dd>{customerContext.id}</dd></div><div><dt>Type</dt><dd>{customerContext.type || '—'}</dd></div><div><dt>CRM status</dt><dd>{customerContext.status || '—'}</dd></div><div><dt>Properties</dt><dd>{customerContext.properties.length}</dd></div><div><dt>Registered A/C</dt><dd>{customerContext.equipment.length}</dd></div></dl> : <p>This WhatsApp identity has not been matched to a live CRM customer yet. The conversation can still be handled normally.</p>}{customerContext?.tags.length ? <div className={styles.tagList}>{customerContext.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}</section>
            {selected.nextAction ? <section className={styles.contextSection}><span>Next action</span><strong>{selected.nextAction}</strong><p>{selected.nextActionDue ? `Due ${selected.nextActionDue}` : 'No due date.'}</p></section> : null}
            {mode !== 'communications' ? <section className={styles.contextSection}><span>Ownership</span><strong>{selectedAiActive ? 'DEMAC Customer Agent' : selected.owner ? `Human · ${selected.owner}` : 'Human queue · unassigned'}</strong><p>{selected.routeReason || 'Ownership is controlled by the Customer Agent runtime and Communication Center.'}</p></section> : null}
          </div> : null}

        {contextTab === 'properties' ? <div className={styles.contextBody}>{contextLoading ? <div className={styles.contextEmpty}>Loading customer properties…</div> : customerContext?.properties.length ? operatorWorkspace ? <div className={workspaceStyles.propertyList}>{customerContext.properties.map((property, index) => <article key={property.id} className={workspaceStyles.propertyCard}>
          <div className={workspaceStyles.propertyTitle}><span className={workspaceStyles.propertyIcon}>⌂</span><div><strong>{property.name}</strong><span>{property.address || 'Address not set'}</span></div>{index === 0 ? <small className={workspaceStyles.propertyPrimary}>Primary</small> : null}</div>
          <dl className={workspaceStyles.propertyFacts}><div><dt>Customer</dt><dd>{customerContext.displayName}</dd></div><div><dt>Contact</dt><dd>{customerContext.phone || 'Not set'}</dd></div><div><dt>A/C count</dt><dd>{property.equipment.length}</dd></div></dl>
          <button type="button" className={workspaceStyles.propertyOpen} onClick={() => setPropertyPreviewId(property.id)}>Open profile ↗</button>
        </article>)}</div> : <div className={styles.recordList}>{customerContext.properties.map((property) => <article key={property.id}><div><strong>{property.name}</strong><span>{property.address}</span>{property.sector ? <small>{property.sector}</small> : null}</div><b>{property.equipment.length} A/C</b></article>)}</div> : <div className={styles.contextEmpty}>No live CRM properties are linked to this WhatsApp contact.</div>}</div> : null}

        {contextTab === 'equipment'  ? <div className={styles.contextBody}>{contextLoading ? <div className={styles.contextEmpty}>Loading registered equipment…</div> : customerContext?.equipment.length ? <div className={styles.recordList}>{customerContext.equipment.map((equipment) => <article key={equipment.id}><div><strong>{equipment.locationLabel}</strong><span>{equipment.systemType}</span><small>{equipment.condition || (equipment.active ? 'Active' : 'Inactive')}</small></div><b>{equipment.active ? 'Active' : 'Off'}</b></article>)}</div> : <div className={styles.contextEmpty}>No registered A/C equipment found for this customer.</div>}</div> : null}

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

  {operatorWorkspace && propertyPreview ? <div className={workspaceStyles.propertyBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPropertyPreviewId(''); }}>
    <aside className={workspaceStyles.propertyDrawer} role="dialog" aria-modal="true" aria-label={`${propertyPreview.name} property profile`}>
      <div className={workspaceStyles.propertyDrawerHeader}><div><span>Property 360</span><h3>{propertyPreview.name}</h3><p>{propertyPreview.address || 'Address not set'}</p></div><button type="button" onClick={() => setPropertyPreviewId('')} aria-label="Close property profile">×</button></div>
      <div className={workspaceStyles.propertyDrawerBody}>
        <section className={workspaceStyles.drawerSection}><span>Property contact</span><dl><div><dt>Customer / owner</dt><dd>{customerContext?.displayName || selected?.customer || '—'}</dd></div><div><dt>Primary contact</dt><dd>{customerContext?.phone || selected?.phone || 'Not set'}</dd></div><div><dt>Email</dt><dd>{customerContext?.email || 'Not set'}</dd></div><div><dt>Address</dt><dd>{propertyPreview.address || 'Not set'}</dd></div></dl></section>
        <section className={workspaceStyles.drawerSection}><span>Registered A/C · {propertyPreview.equipment.length}</span>{propertyPreview.equipment.length ? <div className={workspaceStyles.equipmentList}>{propertyPreview.equipment.map((unit) => <article key={unit.id} className={workspaceStyles.equipmentItem}><div><strong>{unit.locationLabel}</strong><small>{unit.systemType}{unit.condition ? ` · ${unit.condition}` : ''}</small></div><b>{unit.active ? 'Active' : 'Inactive'}</b></article>)}</div> : <p>No registered A/C equipment for this property.</p>}</section>
      </div>
      <div className={workspaceStyles.drawerFooter}><button type="button" onClick={() => setPropertyPreviewId('')}>Close</button><button type="button" className={workspaceStyles.primary} onClick={() => openAction('/crm', { tab: 'Properties', action: 'open-property', propertyId: propertyPreview.id })}>Open full property ↗</button></div>
    </aside>
  </div> : null}
</section>;
}
