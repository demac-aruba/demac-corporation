'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthPrincipal } from '../../lib/security';
import type { ConversationStatus, Queue } from '../../lib/communications';
import {
  assignConversation,
  claimConversation,
  markConversationRead,
  queueWhatsAppText,
  saveInternalCommunicationNote,
  touchCommunicationPresence,
  updateConversationStatus,
  type LiveOperator,
  type WhatsAppProvider,
} from '../../lib/browser-communications';
import {
  loadRichCommunicationWorkspace,
  queueWhatsAppMedia,
  type RichConversationMessage,
  type RichLiveConversation,
} from '../../lib/communication-workspace-v2';
import { fetchPrivateCommunicationMedia, type CommunicationMediaKind } from '../../lib/firebase/communication-storage';
import { loadFirebasePrincipal } from '../../lib/firebase/principal';
import styles from './whatsapp-operator-workspace.module.css';

const queues: Array<'all' | Queue> = ['all', 'general', 'scheduling', 'sales', 'finance', 'technical', 'commercial_vip', 'complaints', 'manager'];
type Scope = 'pending' | 'mine' | 'unassigned' | 'team';
type ContextTab = 'info' | 'properties' | 'equipment' | 'actions';

function initials(name: string) { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'WA'; }
function digits(value?: string | null) { return String(value || '').replace(/\D/g, ''); }
function isManager(principal: AuthPrincipal | null) { return principal?.role === 'super_admin' || principal?.role === 'operations'; }
function formatPhone(value?: string | null) { const phone = digits(value); return phone ? `+${phone}` : ''; }
function messageTime(value?: string) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.valueOf()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; }
function relativeTime(value?: string) { const ms = value ? Date.parse(value) : NaN; if (!Number.isFinite(ms)) return '—'; const sec = Math.max(0, Math.round((Date.now() - ms) / 1000)); if (sec < 60) return `${sec}s`; const min = Math.round(sec / 60); if (min < 60) return `${min}m`; const hour = Math.round(min / 60); return hour < 24 ? `${hour}h` : `${Math.round(hour / 24)}d`; }
function lastMessage(conversation: RichLiveConversation) { return conversation.messages[conversation.messages.length - 1]; }
function needsReply(conversation: RichLiveConversation) { if (['resolved', 'closed'].includes(conversation.status)) return false; if (conversation.status === 'escalated') return true; const last = lastMessage(conversation); return !last ? ['new', 'waiting_demac'].includes(conversation.status) : last.role === 'customer' || conversation.status === 'waiting_demac'; }
function waitingMinutes(conversation: RichLiveConversation) { const value = lastMessage(conversation)?.at || conversation.lastActivityAt; const ms = Date.parse(value || ''); return Number.isFinite(ms) ? Math.max(0, Math.floor((Date.now() - ms) / 60000)) : 0; }
function visualState(conversation: RichLiveConversation) { if (conversation.status === 'escalated') return 'escalated'; if (['resolved', 'closed'].includes(conversation.status)) return 'resolved'; if (needsReply(conversation)) return waitingMinutes(conversation) >= 30 ? 'overdue' : 'needs-reply'; if (conversation.ownerUserId || conversation.owner) return 'assigned'; return 'unassigned'; }
function mediaKind(file: File): CommunicationMediaKind { const type = file.type.toLowerCase(); if (type.startsWith('image/')) return 'image'; if (type.startsWith('video/')) return 'video'; if (type.startsWith('audio/')) return 'audio'; return 'document'; }
function statusLabel(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function PrivateAsset({ path, alt, className }: { path?: string | null; alt: string; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    let localUrl = '';
    if (!path) { setUrl(''); return; }
    fetchPrivateCommunicationMedia(path).then((blob) => {
      if (cancelled) return;
      localUrl = URL.createObjectURL(blob);
      setUrl(localUrl);
    }).catch(() => setUrl(''));
    return () => { cancelled = true; if (localUrl) URL.revokeObjectURL(localUrl); };
  }, [path]);
  return url ? <img className={className} src={url} alt={alt} /> : null;
}

function Avatar({ conversation, size = 'normal' }: { conversation: RichLiveConversation; size?: 'normal' | 'large' }) {
  const [loaded, setLoaded] = useState(false);
  return <span className={`${styles.avatar} ${size === 'large' ? styles.avatarLarge : ''}`}>
    {conversation.avatarStoragePath ? <PrivateAsset path={conversation.avatarStoragePath} alt={conversation.customer} className={styles.avatarImage} /> : null}
    <b className={loaded ? styles.hiddenFallback : ''}>{initials(conversation.customer)}</b>
    {conversation.avatarStoragePath ? <span className={styles.avatarProbe}><PrivateAsset path={conversation.avatarStoragePath} alt="" className={styles.avatarProbeImage} /></span> : null}
  </span>;
}

function MediaMessage({ message }: { message: RichConversationMessage }) {
  const media = message.media;
  const [url, setUrl] = useState('');
  useEffect(() => {
    let localUrl = '';
    let cancelled = false;
    if (!media?.storagePath) { setUrl(''); return; }
    fetchPrivateCommunicationMedia(media.storagePath).then((blob) => {
      if (cancelled) return;
      localUrl = URL.createObjectURL(blob);
      setUrl(localUrl);
    }).catch(() => setUrl(''));
    return () => { cancelled = true; if (localUrl) URL.revokeObjectURL(localUrl); };
  }, [media?.storagePath]);
  if (!media) return null;
  if (!media.storagePath) return <div className={styles.mediaPending}>Media is syncing from WhatsApp…</div>;
  if (!url) return <div className={styles.mediaPending}>Loading media…</div>;
  if (media.kind === 'image') return <a href={url} target="_blank" rel="noreferrer" className={styles.imageLink}><img src={url} alt={media.caption || media.fileName || 'WhatsApp image'} /></a>;
  if (media.kind === 'sticker') return <img className={styles.sticker} src={url} alt={media.caption || 'WhatsApp sticker'} />;
  if (media.kind === 'video') return <video className={styles.video} src={url} controls preload="metadata" />;
  if (media.kind === 'audio' || media.kind === 'voice') return <audio className={styles.audio} src={url} controls preload="metadata" />;
  return <a className={styles.documentCard} href={url} target="_blank" rel="noreferrer"><span>PDF</span><div><strong>{media.fileName || 'WhatsApp document'}</strong><small>{media.mimeType || 'Document'}</small></div></a>;
}

function MessageBubble({ message, customer }: { message: RichConversationMessage; customer: string }) {
  const stickerOnly = message.media?.kind === 'sticker' && !message.text;
  const author = message.role === 'customer' ? customer : message.author === 'DEMAC WhatsApp' ? 'Linked WhatsApp device' : message.author || 'DEMAC operator';
  return <article className={`${styles.message} ${styles[`role_${message.role}`]} ${stickerOnly ? styles.stickerOnly : ''}`}>
    {!stickerOnly ? <span className={styles.messageAuthor}>{author}</span> : null}
    <MediaMessage message={message} />
    {message.text ? <p>{message.text}</p> : null}
    {message.media?.caption && message.media.caption !== message.text ? <p>{message.media.caption}</p> : null}
    {!stickerOnly ? <footer><time>{messageTime(message.at)}</time>{message.role === 'operator' ? <span>{message.status === 'read' ? '✓✓' : '✓'}</span> : null}</footer> : <time className={styles.stickerTime}>{messageTime(message.at)}</time>}
  </article>;
}

export function WhatsAppOperatorWorkspace() {
  const [principal, setPrincipal] = useState<AuthPrincipal | null>(null);
  const [conversations, setConversations] = useState<RichLiveConversation[]>([]);
  const [operators, setOperators] = useState<LiveOperator[]>([]);
  const [provider, setProvider] = useState<WhatsAppProvider>('wacli');
  const [selectedId, setSelectedId] = useState('');
  const [scope, setScope] = useState<Scope>('pending');
  const [queue, setQueue] = useState<'all' | Queue>('all');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>('info');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const workspace = await loadRichCommunicationWorkspace();
    setConversations(workspace.conversations);
    setOperators(workspace.operators);
    setProvider(workspace.provider);
    setSelectedId((current) => current || workspace.conversations[0]?.id || '');
    return workspace;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let activePrincipal: AuthPrincipal | null = null;
    loadFirebasePrincipal().then(async (loaded) => {
      if (cancelled) return;
      activePrincipal = loaded;
      setPrincipal(loaded);
      const workspace = await refresh();
      const owned = workspace.conversations.filter((item) => item.ownerUserId === loaded.userId && !['resolved', 'closed'].includes(item.status)).length;
      await touchCommunicationPresence(loaded, 'available', owned).catch(() => undefined);
      timer = setInterval(() => refresh().catch(() => undefined), 5000);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { cancelled = true; if (timer) clearInterval(timer); if (activePrincipal) touchCommunicationPresence(activePrincipal, 'offline', 0).catch(() => undefined); };
  }, [refresh]);

  const manager = isManager(principal);
  const filtered = useMemo(() => conversations.filter((conversation) => queue === 'all' || conversation.queue === queue).filter((conversation) => {
    if (!principal) return false;
    if (scope === 'pending') return needsReply(conversation);
    if (scope === 'mine') return conversation.ownerUserId === principal.userId;
    if (scope === 'unassigned') return !conversation.ownerUserId;
    return true;
  }).filter((conversation) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [conversation.customer, conversation.phone, conversation.owner, conversation.queue, conversation.lastMessageText, conversation.property].filter(Boolean).join(' ').toLowerCase().includes(q);
  }), [conversations, queue, scope, search, principal]);

  useEffect(() => { if (!filtered.some((item) => item.id === selectedId)) setSelectedId(filtered[0]?.id || ''); }, [filtered, selectedId]);
  const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || null;
  const ownedByMe = Boolean(selected && principal && selected.ownerUserId === principal.userId);
  const unassigned = Boolean(selected && !selected.ownerUserId);
  const canReply = Boolean(selected && principal && (ownedByMe || unassigned));

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ block: 'end' }); textareaRef.current?.focus({ preventScroll: true }); }, [selected?.id, selected?.messages.length]);
  useEffect(() => { if (!recording) return; const started = Date.now(); const timer = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - started) / 1000)), 500); return () => clearInterval(timer); }, [recording]);

  const sendText = async () => {
    const text = draft.trim();
    if (!text || !selected || !principal || busy) return;
    if (!internal && !canReply) { setError('Take ownership before replying so two operators cannot answer the same customer.'); return; }
    setBusy(true); setError('');
    try {
      let current = selected;
      if (!internal && unassigned) { await claimConversation(selected.id, principal); current = { ...selected, owner: principal.displayName, ownerUserId: principal.userId, status: 'assigned' }; }
      if (internal) await saveInternalCommunicationNote(current.id, text, principal);
      else await queueWhatsAppText(current, text, principal, provider);
      setDraft('');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true })); }
  };

  const sendFile = async (file: File, forcedKind?: CommunicationMediaKind) => {
    if (!selected || !principal || busy) return;
    if (!canReply) { setError('Take ownership before sending media.'); return; }
    setBusy(true); setError(''); setAttachmentOpen(false);
    try { await queueWhatsAppMedia(selected, file, forcedKind || mediaKind(file), principal, provider); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); if (fileInputRef.current) fileInputRef.current.value = ''; requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true })); }
  };

  const startVoice = async () => {
    if (recording) { mediaRecorderRef.current?.stop(); return; }
    if (!selected || !principal || !canReply) { setError('Take ownership before recording a voice note.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false); setRecordingSeconds(0);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const extension = blob.type.includes('ogg') ? 'ogg' : 'webm';
        await sendFile(new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type }), 'voice');
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecording(true); setRecordingSeconds(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Microphone permission was not granted.'); }
  };

  const selectConversation = (conversation: RichLiveConversation) => {
    setSelectedId(conversation.id); setContextTab('info');
    if ((manager || conversation.ownerUserId === principal?.userId) && conversation.unread > 0) markConversationRead(conversation.id).catch(() => undefined);
  };

  const active = conversations.filter((item) => !['resolved', 'closed'].includes(item.status)).length;
  const pending = conversations.filter(needsReply).length;
  const unassignedCount = conversations.filter((item) => !item.ownerUserId && !['resolved', 'closed'].includes(item.status)).length;
  const online = operators.filter((item) => item.presence !== 'offline').length;
  const escalated = conversations.filter((item) => item.status === 'escalated').length;
  const phone = selected?.phoneResolutionStatus === 'resolved' ? formatPhone(selected.phone) : '';

  return <section className={styles.workspacePage}>
    <div className={styles.metrics}>
      {[['Active conversations', active, 'Open customer threads'], ['Needs reply', pending, 'Waiting on DEMAC'], ['Unassigned', unassignedCount, 'No operator yet'], ['Operators online', online, 'Active presence'], ['Escalated', escalated, 'Exception queue']].map(([label, value, hint]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}
    </div>
    {provider === 'wacli' ? <div className={styles.testBar}><b>TEST CONNECTION</b><span>Personal linked WhatsApp device. Production customer traffic remains on the official channel until cutover.</span></div> : null}
    {error ? <div className={styles.errorBar}>{error}<button type="button" onClick={() => setError('')}>×</button></div> : null}

    <div className={styles.columns}>
      <aside className={styles.inbox}>
        <header><div><strong>WhatsApp Inbox</strong><small>{filtered.length} conversations shown</small></div><b>{conversations.length}</b></header>
        <div className={styles.searchRow}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /><select value={queue} onChange={(event) => setQueue(event.target.value as 'all' | Queue)}>{queues.map((item) => <option key={item} value={item}>{item === 'all' ? 'All queues' : statusLabel(item)}</option>)}</select></div>
        <nav className={styles.scopeTabs}>{([['pending', 'Needs reply', pending], ['mine', 'Mine', principal ? conversations.filter((item) => item.ownerUserId === principal.userId).length : 0], ['unassigned', 'Unassigned', unassignedCount], ['team', 'All', conversations.length]] as const).map(([value, label, count]) => <button key={value} type="button" className={scope === value ? styles.activeScope : ''} onClick={() => setScope(value)}>{label}<b>{count}</b></button>)}</nav>
        <div className={styles.conversationList}>{filtered.map((conversation) => <button type="button" key={conversation.id} className={`${styles.conversationRow} ${selected?.id === conversation.id ? styles.selectedConversation : ''}`} data-state={visualState(conversation)} onClick={() => selectConversation(conversation)}>
          <Avatar conversation={conversation} /><div className={styles.conversationCopy}><div><strong>{conversation.customer}</strong><time>{relativeTime(conversation.lastActivityAt)}</time></div><p>{lastMessage(conversation)?.media ? `[${lastMessage(conversation)?.media?.kind}] ${lastMessage(conversation)?.text || ''}` : lastMessage(conversation)?.text || conversation.lastMessageText || 'No recent message'}</p><footer><span>{visualState(conversation) === 'overdue' ? `${waitingMinutes(conversation)}m Waiting` : visualState(conversation) === 'needs-reply' ? 'Needs Reply' : visualState(conversation) === 'assigned' ? 'In Progress' : statusLabel(visualState(conversation))}</span><em>{conversation.owner || 'No operator'}</em><i>{conversation.queue}</i>{conversation.unread ? <b>{conversation.unread}</b> : null}</footer></div>
        </button>)}</div>
      </aside>

      <main className={styles.chat}>
        {!selected ? <div className={styles.emptyChat}><strong>No conversation selected</strong><span>Choose a WhatsApp conversation from the inbox.</span></div> : <>
          <header className={styles.chatHeader}><div className={styles.contactIdentity}><Avatar conversation={selected} /><div><strong>{selected.customer}</strong><span>{phone || (selected.phoneResolutionStatus === 'resolving' ? 'Phone resolving…' : 'Phone unavailable')}</span></div></div><div className={styles.owner}><span>{selected.owner ? `Assigned to ${selected.owner}` : 'Unassigned'}</span>{!ownedByMe ? <button type="button" onClick={() => principal && claimConversation(selected.id, principal).then(refresh)}>{selected.ownerUserId ? 'Take over' : 'Take conversation'}</button> : <b>Owned by me</b>}</div></header>
          <div className={styles.workflow}><span>{statusLabel(selected.status)}</span><span>{statusLabel(selected.queue)}</span><div><select value={selected.status} onChange={(event) => updateConversationStatus(selected.id, event.target.value as ConversationStatus).then(refresh)}>{['new','assigned','waiting_customer','waiting_demac','appointment_pending','estimate_pending','payment_pending','escalated','resolved','closed'].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>{manager ? <select value={selected.ownerUserId || ''} onChange={(event) => { const operator = operators.find((item) => item.userId === event.target.value); if (operator) assignConversation(selected.id, operator).then(refresh); }}><option value="">Select operator</option>{operators.map((operator) => <option key={operator.userId} value={operator.userId}>{operator.name}</option>)}</select> : null}</div></div>
          <div className={styles.messages}>{selected.messages.map((message) => <MessageBubble key={message.id} message={message} customer={selected.customer} />)}<div ref={messagesEndRef} /></div>
          <div className={styles.composer}>
            <div className={styles.replyTabs}><button type="button" className={!internal ? styles.activeReply : ''} onClick={() => setInternal(false)}>Reply</button><button type="button" className={internal ? styles.activeReply : ''} onClick={() => setInternal(true)}>Internal note</button><span>{internal ? 'Visible only to DEMAC staff' : principal ? `Sending as ${principal.displayName}` : ''}</span></div>
            {recording ? <div className={styles.recordingBar}><span className={styles.recordDot} /> Recording voice note <b>{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</b><button type="button" onClick={() => mediaRecorderRef.current?.stop()}>Stop & send</button></div> : null}
            <div className={styles.composerBox}>
              <div className={styles.plusWrap}><button className={styles.iconButton} type="button" aria-label="Attach" onClick={() => setAttachmentOpen((value) => !value)}>＋</button>{attachmentOpen ? <div className={styles.attachMenu}><button type="button" onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = '.pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf'; fileInputRef.current.click(); } }}>▣ <span>Document</span></button><button type="button" onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = 'image/*,video/*'; fileInputRef.current.click(); } }}>▧ <span>Photos & videos</span></button></div> : null}</div>
              <input ref={fileInputRef} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void sendFile(file); }} />
              <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendText(); } }} placeholder={internal ? 'Write an internal note…' : canReply ? 'Type a message' : 'Take ownership before replying'} disabled={!selected || (!internal && !canReply)} />
              <button className={`${styles.iconButton} ${recording ? styles.micRecording : ''}`} type="button" aria-label={recording ? 'Stop voice recording' : 'Record voice note'} onClick={() => void startVoice()} disabled={!selected || (!internal && !canReply)}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M9 22h6"/></svg></button>
            </div>
            <small className={styles.keyHint}>Enter to send · Shift+Enter for new line</small>
          </div>
        </>}
      </main>

      <aside className={styles.customer360}>
        <header><div><strong>Customer 360</strong><small>CRM & operational context</small></div><span>WhatsApp</span></header>
        {selected ? <><section className={styles.profile}><Avatar conversation={selected} size="large"/><div><strong>{selected.customer}</strong><p>{phone || (selected.phoneResolutionStatus === 'resolving' ? 'Phone resolving…' : 'Phone unavailable')}</p>{selected.customerEmail ? <p>{selected.customerEmail}</p> : null}<small>{selected.customerId ? 'Existing DEMAC Customer' : 'New / unregistered WhatsApp contact'}</small></div></section>
        <nav className={styles.contextTabs}>{(['info','properties','equipment','actions'] as ContextTab[]).map((tab) => <button key={tab} type="button" className={contextTab === tab ? styles.activeContext : ''} onClick={() => setContextTab(tab)}>{tab === 'equipment' ? 'A/C' : tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav>
        <div className={styles.contextBody}>{contextTab === 'info' ? <><section><h3>Conversation</h3><dl><div><dt>Owner</dt><dd>{selected.owner || 'Unassigned'}</dd></div><div><dt>Status</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>Queue</dt><dd>{selected.queue}</dd></div><div><dt>Phone</dt><dd>{phone || (selected.phoneResolutionStatus === 'resolving' ? 'Resolving…' : 'Unavailable')}</dd></div><div><dt>Language</dt><dd>{selected.language}</dd></div></dl></section><section><h3>Customer profile</h3><dl><div><dt>CRM</dt><dd>{selected.customerId ? 'Matched' : 'Not linked'}</dd></div><div><dt>Properties</dt><dd>{selected.customerPropertiesCount ?? selected.customerProperties?.length ?? 0}</dd></div><div><dt>Registered A/C</dt><dd>{selected.customerEquipmentCount ?? selected.customerEquipment?.length ?? 0}</dd></div></dl></section></> : null}
        {contextTab === 'properties' ? <section><h3>Properties</h3>{selected.customerProperties?.length ? selected.customerProperties.map((property) => <article className={styles.record} key={property.id}><div><strong>{property.name}</strong><span>{property.address || 'Address not entered'}</span></div><b>{property.equipmentCount} A/C</b></article>) : <p>No linked CRM properties.</p>}</section> : null}
        {contextTab === 'equipment' ? <section><h3>Registered A/C</h3>{selected.customerEquipment?.length ? selected.customerEquipment.map((unit) => <article className={styles.record} key={unit.id}><div><strong>{unit.locationLabel}</strong><span>{unit.systemType}</span></div><b>{unit.active ? 'Active' : 'Off'}</b></article>) : <p>No registered equipment.</p>}</section> : null}
        {contextTab === 'actions' ? <section><h3>Quick actions</h3><div className={styles.quickActions}><a href={`/scheduling?source=communication-center&customerId=${selected.customerId || ''}&phone=${encodeURIComponent(phone)}`} target="_blank">Create appointment</a><a href={`/work-orders?source=communication-center&type=warranty&customerId=${selected.customerId || ''}`} target="_blank">Warranty ticket</a><a href={`/crm?source=communication-center&action=add-equipment&customerId=${selected.customerId || ''}`} target="_blank">Add A/C</a><a href={`/crm?source=communication-center&action=edit-customer&customerId=${selected.customerId || ''}`} target="_blank">Edit customer</a></div></section> : null}</div></> : <div className={styles.empty360}>Select a conversation to see customer context.</div>}
      </aside>
    </div>
  </section>;
}
