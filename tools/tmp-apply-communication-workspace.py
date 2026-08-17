from pathlib import Path
import re

path = Path('apps/erp-next/components/communications/communication-center.tsx')
text = path.read_text()


def replace(old, new, expected=1):
    global text
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'Expected {expected} occurrence(s), found {count}: {old[:120]!r}')
    text = text.replace(old, new)


replace(
    "import styles from './communication-center.module.css';\nimport mediaStyles from './communication-media.module.css';\n",
    "import styles from './communication-center.module.css';\nimport mediaStyles from './communication-media.module.css';\nimport workspaceStyles from './communication-center-workspace.module.css';\n",
)

replace(
    "type StagedAttachment = { file: File; kind: WhatsAppMediaKind };\n",
    "type StagedAttachment = { file: File; kind: WhatsAppMediaKind };\ntype PendingOptimisticMessage = { message: LiveConversationMessage; objectUrl?: string };\n",
)

helpers = r'''function pendingMatchesServer(local: LiveConversationMessage, server: LiveConversationMessage) {
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

'''
replace('function statusLabel(status: ConversationStatus) {', helpers + 'function statusLabel(status: ConversationStatus) {')

replace(
    "  const [contextTab, setContextTab] = useState<ContextTab>('overview');\n  const messagesEndRef = useRef<HTMLDivElement | null>(null);\n  const fileInputRef = useRef<HTMLInputElement | null>(null);\n",
    "  const [contextTab, setContextTab] = useState<ContextTab>('overview');\n  const [propertyPreviewId, setPropertyPreviewId] = useState('');\n  const messagesEndRef = useRef<HTMLDivElement | null>(null);\n  const fileInputRef = useRef<HTMLInputElement | null>(null);\n  const pendingMessagesRef = useRef<Map<string, PendingOptimisticMessage[]>>(new Map());\n  const localObjectUrlsRef = useRef<Map<string, string>>(new Map());\n",
)

old_refresh = '''  const refresh = useCallback(async () => {
    const workspace = await loadCommunicationWorkspace();
    setConversations(workspace.conversations);
    setOperators(workspace.operators);
    setProvider(workspace.provider);
    setSelectedId((current) => current || workspace.conversations[0]?.id || '');
    return workspace;
  }, []);'''
new_refresh = '''  const refresh = useCallback(async () => {
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
  }, []);'''
replace(old_refresh, new_refresh)

replace(
    "  const onlineCount = operators.filter((operator) => operator.presence !== 'offline').length;\n\n  const visible = useMemo(() => conversations\n",
    "  const onlineCount = operators.filter((operator) => operator.presence !== 'offline').length;\n  const operatorWorkspace = standalone && mode === 'communications';\n  const myPipeline = useMemo(() => principal ? conversations\n    .filter((conversation) => conversation.ownerUserId === principal.userId && !['resolved', 'closed'].includes(conversation.status))\n    .sort((left, right) => Date.parse(right.lastActivityAt || '1970-01-01') - Date.parse(left.lastActivityAt || '1970-01-01')) : [], [conversations, principal]);\n\n  const visible = useMemo(() => conversations\n",
)

replace(
    "      if (!principal) return false;\n      if (scope === 'pending') return needsDemacReply(conversation);\n      if (scope === 'mine') return conversation.ownerUserId === principal.userId;\n      if (scope === 'unassigned') return conversation.aiDisposition !== 'ai_active' && !conversation.ownerUserId;\n      return true;\n",
    "      if (!principal) return false;\n      if (operatorWorkspace) return true;\n      if (scope === 'pending') return needsDemacReply(conversation);\n      if (scope === 'mine') return conversation.ownerUserId === principal.userId;\n      if (scope === 'unassigned') return conversation.aiDisposition !== 'ai_active' && !conversation.ownerUserId;\n      return true;\n",
)

replace(
    "    }), [conversations, queue, mode, principal, scope, normalizedSearch]);\n\n  useEffect(() => {\n    if (visible.some((conversation) => conversation.id === selectedId)) return;\n    const fallback = visible[0];\n    setSelectedId(fallback?.id ?? '');\n    setAssignmentTarget(fallback?.ownerUserId || '');\n  }, [visible, selectedId]);\n\n  const selected = visible.find((conversation) => conversation.id === selectedId) ?? visible[0] ?? null;\n",
    "    }), [conversations, queue, mode, principal, scope, normalizedSearch, operatorWorkspace]);\n\n  const selectionPool = useMemo(() => operatorWorkspace ? conversations : visible, [operatorWorkspace, conversations, visible]);\n  useEffect(() => {\n    if (selectionPool.some((conversation) => conversation.id === selectedId)) return;\n    const fallback = visible[0] ?? selectionPool[0];\n    setSelectedId(fallback?.id ?? '');\n    setAssignmentTarget(fallback?.ownerUserId || '');\n  }, [visible, selectionPool, selectedId]);\n\n  const selected = selectionPool.find((conversation) => conversation.id === selectedId) ?? visible[0] ?? selectionPool[0] ?? null;\n",
)

replace(
    "  const canReply = Boolean(selected && principal && selectedOwnedByMe && !selectedAiActive);\n  const canManageWorkflow = Boolean(selected && !selectedAiActive && (manager || selectedOwnedByMe));\n",
    "  const canReply = Boolean(selected && principal && selectedOwnedByMe && !selectedAiActive);\n  const canComposeCustomer = Boolean(selected && principal && !selectedOwnedByColleague && (selectedOwnedByMe || selectedAiActive || selectedUnassigned));\n  const canManageWorkflow = Boolean(selected && !selectedAiActive && (manager || selectedOwnedByMe));\n",
)

replace(
    "    setContextTab('overview');\n    setAttachment(null);\n",
    "    setContextTab('overview');\n    setPropertyPreviewId('');\n    setAttachment(null);\n",
)

replace(
    "    if (!canReply) {\n      setError('Take ownership of this conversation before attaching a file.');\n      return;\n    }\n",
    "    if (!canComposeCustomer) {\n      setError(selectedOwnedByColleague ? 'This conversation is assigned to another operator. Reassign it before attaching a file.' : 'Replying will assign this conversation to you before the file is sent.');\n      return;\n    }\n",
)
replace("  }, [canReply, internal]);", "  }, [canComposeCustomer, internal, selectedOwnedByColleague]);")

replace(
    "  useEffect(() => () => cancelVoiceNote(), [selected?.id, cancelVoiceNote]);\n",
    "  useEffect(() => () => cancelVoiceNote(), [selected?.id, cancelVoiceNote]);\n  useEffect(() => () => {\n    for (const objectUrl of localObjectUrlsRef.current.values()) URL.revokeObjectURL(objectUrl);\n    localObjectUrlsRef.current.clear();\n  }, []);\n",
)

send_pattern = re.compile(r"  const send = async \(\) => \{.*?\n  \};\n\n  const openAction", re.S)
send_match = send_pattern.search(text)
if not send_match:
    raise SystemExit('Could not locate send() block')
new_send = r'''  const send = async () => {
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

  const openAction'''
text = text[:send_match.start()] + new_send + text[send_match.end():]

replace(
    "  if (customer?.properties[0]?.id) query.set('propertyId', customer.properties[0].id);\n",
    "  if (customer?.properties[0]?.id && !query.has('propertyId')) query.set('propertyId', customer.properties[0].id);\n",
)

replace(
    "  const canSubmit = internal\n    ? Boolean(canReadBody && !busy && draft.trim())\n    : Boolean(canReply && !busy && !voiceRecording && (draft.trim() || attachment));\n  const attachmentKind = attachment?.kind || null;\n",
    "  const canSubmit = internal\n    ? Boolean(canReadBody && !busy && draft.trim())\n    : Boolean(canComposeCustomer && !busy && !voiceRecording && (draft.trim() || attachment));\n  const attachmentKind = attachment?.kind || null;\n  const propertyPreview = customerContext?.properties.find((property) => property.id === propertyPreviewId) ?? null;\n",
)

replace(
    "    <div className={`${styles.workspace} ${detailsVisible ? styles.withDetails : ''}`}>\n",
    "    <div className={`${styles.workspace} ${detailsVisible ? styles.withDetails : ''} ${operatorWorkspace ? workspaceStyles.operatorWorkspace : ''}`}>\n",
)

scope_tabs = '''        <div className={styles.scopeTabs}>
          <button type="button" className={scope === 'pending' ? styles.active : ''} onClick={() => setScope('pending')}><span>Needs reply</span><b>{pendingCount}</b></button>
          <button type="button" className={scope === 'mine' ? styles.active : ''} onClick={() => setScope('mine')}><span>Mine</span><b>{myCount}</b></button>
          <button type="button" className={scope === 'unassigned' ? styles.active : ''} onClick={() => setScope('unassigned')}><span>Unassigned</span><b>{unassignedCount}</b></button>
          <button type="button" className={scope === 'team' ? styles.active : ''} onClick={() => setScope('team')}><span>{manager ? 'All' : 'Team'}</span><b>{conversations.length}</b></button>
        </div>'''
replace(scope_tabs, '''        {operatorWorkspace ? <div className={workspaceStyles.inboxGeneralLabel}>All incoming conversations</div> : <div className={styles.scopeTabs}>
          <button type="button" className={scope === 'pending' ? styles.active : ''} onClick={() => setScope('pending')}><span>Needs reply</span><b>{pendingCount}</b></button>
          <button type="button" className={scope === 'mine' ? styles.active : ''} onClick={() => setScope('mine')}><span>Mine</span><b>{myCount}</b></button>
          <button type="button" className={scope === 'unassigned' ? styles.active : ''} onClick={() => setScope('unassigned')}><span>Unassigned</span><b>{unassignedCount}</b></button>
          <button type="button" className={scope === 'team' ? styles.active : ''} onClick={() => setScope('team')}><span>{manager ? 'All' : 'Team'}</span><b>{conversations.length}</b></button>
        </div>}''')

replace(
    "          const state = visualState(conversation);\n          const owner = conversation.aiDisposition === 'ai_active' ? 'DEMAC Customer Agent' : conversation.owner ?? 'No operator';\n",
    "          const state = operatorWorkspace ? inboxWorkflowState(conversation) : visualState(conversation);\n          const owner = conversation.aiDisposition === 'ai_active' ? 'DEMAC Customer Agent' : conversation.owner ?? 'No operator';\n",
)
replace(
    "              <span className={styles.rowMeta}><em className={styles.statusChip} data-state={state.state}>{state.label}</em><em>{owner}</em><em>{conversation.queue}</em></span>\n",
    "              {operatorWorkspace ? <span className={`${styles.rowMeta} ${workspaceStyles.compactInboxMeta}`}><em className={styles.statusChip} data-state={state.state}>{state.label}</em></span> : <span className={styles.rowMeta}><em className={styles.statusChip} data-state={state.state}>{state.label}</em><em>{owner}</em><em>{conversation.queue}</em></span>}\n",
)

replace(
    "    </aside>\n\n    <main className={`${styles.panel} ${styles.chat}`}>\n",
    '''    </aside>

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
''',
)

old_header_actions = '''          <div className={styles.chatHeaderActions}>
            <span className={styles.ownerLabel}>{selectedAiActive ? 'DEMAC Customer Agent active' : selected.owner ? `Assigned to ${selected.owner}` : 'Human queue · unassigned'}</span>
            {selectedOwnedByMe && !selectedAiActive
              ? <button type="button" className={styles.takeover} onClick={returnToAi} disabled={busy || !canReturnToAi}>Return to AI</button>
              : <button type="button" className={styles.takeover} onClick={takeOver} disabled={busy || selectedOwnedByMe}>{selectedAiActive ? 'Take over from AI' : selectedOwnedByColleague ? 'Take over' : 'Take conversation'}</button>}
            {!standalone ? <button type="button" className={styles.detailsButton} onClick={() => setShowDetails((current) => !current)}>{showDetails ? 'Hide details' : 'Customer details'}</button> : null}
          </div>'''
new_header_actions = '''          <div className={styles.chatHeaderActions}>
            <span className={styles.ownerLabel}>{selectedAiActive ? 'Maya · AI' : selected.owner ? `Assigned to ${selected.owner}` : 'Unassigned'}</span>
            {operatorWorkspace ? <details className={workspaceStyles.actionMenu}>
              <summary aria-label="Conversation actions">•••</summary>
              <div className={workspaceStyles.actionMenuPanel}>
                <label>Status<select value={selected.status} onChange={(event) => changeStatus(event.target.value as ConversationStatus)} disabled={busy || !canManageWorkflow}>{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
                {manager ? <label>Assign operator<select value={assignmentTarget || selected.ownerUserId || ''} onChange={(event) => setAssignmentTarget(event.target.value)}><option value="">Select operator</option>{operators.map((operator) => <option key={operator.userId} value={operator.userId}>{operator.name} · {operator.presence.replaceAll('_', ' ')}</option>)}</select></label> : null}
                <div className={workspaceStyles.actionMenuButtons}>
                  {manager ? <button type="button" className={workspaceStyles.brand} onClick={reassign} disabled={busy || !assignmentTarget}>Assign</button> : null}
                  {selectedOwnedByColleague ? <button type="button" className={workspaceStyles.brand} onClick={takeOver} disabled={busy}>Take over</button> : null}
                  {selectedOwnedByMe && !selectedAiActive ? <button type="button" className={workspaceStyles.brand} onClick={returnToAi} disabled={busy || !canReturnToAi}>Return to Maya</button> : null}
                  <button type="button" className={workspaceStyles.danger} onClick={() => changeStatus('escalated')} disabled={busy || !canManageWorkflow}>Escalate</button>
                  <button type="button" className={workspaceStyles.success} onClick={() => changeStatus('resolved')} disabled={busy || !canManageWorkflow}>Complete</button>
                </div>
              </div>
            </details> : <>
              {selectedOwnedByMe && !selectedAiActive
                ? <button type="button" className={styles.takeover} onClick={returnToAi} disabled={busy || !canReturnToAi}>Return to AI</button>
                : <button type="button" className={styles.takeover} onClick={takeOver} disabled={busy || selectedOwnedByMe}>{selectedAiActive ? 'Take over from AI' : selectedOwnedByColleague ? 'Take over' : 'Take conversation'}</button>}
              {!standalone ? <button type="button" className={styles.detailsButton} onClick={() => setShowDetails((current) => !current)}>{showDetails ? 'Hide details' : 'Customer details'}</button> : null}
            </>}
          </div>'''
replace(old_header_actions, new_header_actions)

workflow = '''        <div className={styles.workflowBar}>
          <div className={styles.statusPills}><span className={styles.pill}>{statusLabel(selected.status)}</span><span className={styles.pill}>{selected.queue}</span><span className={styles.pill}>{selectedAiActive ? 'AI ownership' : 'Human ownership'}</span>{selected.customerTyping ? <span className={`${styles.pill} ${styles.typingPill}`}>typing…</span> : null}{selected.vip ? <span className={`${styles.pill} ${styles.vipPill}`}>VIP</span> : null}</div>
          <div className={styles.controls}>
            <select value={selected.status} onChange={(event) => changeStatus(event.target.value as ConversationStatus)} disabled={busy || !canManageWorkflow} aria-label="Conversation status">{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
            {manager ? <><select value={assignmentTarget || selected.ownerUserId || ''} onChange={(event) => setAssignmentTarget(event.target.value)} aria-label="Assign conversation"><option value="">Select operator</option>{operators.map((operator) => <option key={operator.userId} value={operator.userId}>{operator.name} · {operator.presence.replaceAll('_', ' ')}</option>)}</select><button type="button" onClick={reassign} disabled={busy || !assignmentTarget}>Assign</button></> : null}
            <button type="button" className={styles.escalateButton} onClick={() => changeStatus('escalated')} disabled={busy || !canManageWorkflow}>Escalate</button><button type="button" className={styles.resolveButton} onClick={() => changeStatus('resolved')} disabled={busy || !canManageWorkflow}>Resolve</button>
          </div>
        </div>'''
replace(workflow, '''        {operatorWorkspace ? <div className={workspaceStyles.assignmentHint} data-state={selectedOwnedByColleague ? 'blocked' : 'ready'}><b>{selectedOwnedByColleague ? '!' : '✓'}</b><span>{selectedOwnedByColleague ? `Assigned to ${selected.owner}. Reassign or take over before replying.` : selectedOwnedByMe ? 'This conversation is assigned to you. Replying will keep it assigned.' : selectedAiActive ? 'Replying assigns this conversation to you and pauses Maya for this chat.' : 'Replying assigns this conversation to you automatically.'}</span></div> : <div className={styles.workflowBar}>
          <div className={styles.statusPills}><span className={styles.pill}>{statusLabel(selected.status)}</span><span className={styles.pill}>{selected.queue}</span><span className={styles.pill}>{selectedAiActive ? 'AI ownership' : 'Human ownership'}</span>{selected.customerTyping ? <span className={`${styles.pill} ${styles.typingPill}`}>typing…</span> : null}{selected.vip ? <span className={`${styles.pill} ${styles.vipPill}`}>VIP</span> : null}</div>
          <div className={styles.controls}>
            <select value={selected.status} onChange={(event) => changeStatus(event.target.value as ConversationStatus)} disabled={busy || !canManageWorkflow} aria-label="Conversation status">{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
            {manager ? <><select value={assignmentTarget || selected.ownerUserId || ''} onChange={(event) => setAssignmentTarget(event.target.value)} aria-label="Assign conversation"><option value="">Select operator</option>{operators.map((operator) => <option key={operator.userId} value={operator.userId}>{operator.name} · {operator.presence.replaceAll('_', ' ')}</option>)}</select><button type="button" onClick={reassign} disabled={busy || !assignmentTarget}>Assign</button></> : null}
            <button type="button" className={styles.escalateButton} onClick={() => changeStatus('escalated')} disabled={busy || !canManageWorkflow}>Escalate</button><button type="button" className={styles.resolveButton} onClick={() => changeStatus('resolved')} disabled={busy || !canManageWorkflow}>Resolve</button>
          </div>
        </div>}''')

replace("        <div className={styles.messages}>\n", "        <div className={`${styles.messages} ${operatorWorkspace ? workspaceStyles.expandedMessages : ''}`}>\n")

text = text.replace("if (!internal && canReply && !busy && !voiceRecording)", "if (!internal && canComposeCustomer && !busy && !voiceRecording)")
replace("disabled={busy || internal || !canReply || voiceRecording}", "disabled={busy || internal || !canComposeCustomer || voiceRecording}")
replace("title={canReply ? 'Attach photo, audio, video or document' : 'Take ownership before attaching a file'}", "title={canComposeCustomer ? 'Attach photo, audio, video or document' : selectedOwnedByColleague ? 'Assigned to another operator' : 'Replying will assign this conversation to you'}")
replace("disabled={busy || internal || !canReply || !voiceSupported}", "disabled={busy || internal || !canComposeCustomer || !voiceSupported}")
replace("title={!voiceSupported ? 'Voice-note recording is not supported by this browser' : voiceRecording ? 'Stop voice-note recording' : canReply ? 'Record voice note' : 'Take ownership before recording a voice note'}", "title={!voiceSupported ? 'Voice-note recording is not supported by this browser' : voiceRecording ? 'Stop voice-note recording' : canComposeCustomer ? 'Record voice note' : selectedOwnedByColleague ? 'Assigned to another operator' : 'Replying will assign this conversation to you'}")
replace("disabled={!canReadBody || busy} placeholder={internal ? 'Write an internal note…' : voiceRecording ? `Recording voice note ${formatRecordingTime(voiceSeconds)}… click stop when finished` : canReply ? attachment ? 'Add a caption or press Send…' : 'Type a message or drop a file here…' : selectedAiActive ? 'Take over from AI before replying…' : 'Take ownership before replying…'}", "disabled={!canReadBody || busy} placeholder={internal ? 'Write an internal note…' : voiceRecording ? `Recording voice note ${formatRecordingTime(voiceSeconds)}… click stop when finished` : canComposeCustomer ? attachment ? 'Add a caption or press Send…' : selectedOwnedByMe ? 'Type a message or drop a file here…' : 'Type a reply to assign this conversation to you…' : selectedOwnedByColleague ? 'Assigned to another operator…' : 'Reply unavailable…'}")

replace("    {detailsVisible ? <aside className={`${styles.panel} ${styles.contextPanel}`}>\n", "    {detailsVisible ? <aside className={`${styles.panel} ${styles.contextPanel} ${operatorWorkspace ? workspaceStyles.customer360 : ''}`}>\n")
replace("<CommunicationAvatar className={styles.largeAvatar} name={customerContext?.displayName || selected.customer} url={selected.avatarUrl} />", "<CommunicationAvatar className={styles.largeAvatar} name={customerContext?.displayName || selected.customer} url={customerContext?.avatarUrl || selected.avatarUrl} />")
replace(
    "          {(['overview', 'properties', 'equipment', 'actions'] as ContextTab[]).map((tab) => <button key={tab} type=\"button\" className={contextTab === tab ? styles.contextTabActive : ''} onClick={() => setContextTab(tab)}>{tab === 'overview' ? 'Info' : tab === 'properties' ? 'Properties' : tab === 'equipment' ? 'A/C' : 'Actions'}</button>)}\n",
    "          {(operatorWorkspace ? (['overview', 'properties', 'actions'] as ContextTab[]) : (['overview', 'properties', 'equipment', 'actions'] as ContextTab[])).map((tab) => <button key={tab} type=\"button\" className={contextTab === tab ? styles.contextTabActive : ''} onClick={() => setContextTab(tab)}>{tab === 'overview' ? 'Info' : tab === 'properties' ? 'Properties' : tab === 'equipment' ? 'A/C' : 'Actions'}</button>)}\n",
)

properties_pattern = re.compile(r"        \{contextTab === 'properties' \? <div className=\{styles\.contextBody\}>.*?</div> : null\}\n\n        \{contextTab === 'equipment'", re.S)
match = properties_pattern.search(text)
if not match:
    raise SystemExit('Could not locate properties context block')
properties_replacement = r'''        {contextTab === 'properties' ? <div className={styles.contextBody}>{contextLoading ? <div className={styles.contextEmpty}>Loading customer properties…</div> : customerContext?.properties.length ? operatorWorkspace ? <div className={workspaceStyles.propertyList}>{customerContext.properties.map((property, index) => <article key={property.id} className={workspaceStyles.propertyCard}>
          <div className={workspaceStyles.propertyTitle}><span className={workspaceStyles.propertyIcon}>⌂</span><div><strong>{property.name}</strong><span>{property.address || 'Address not set'}</span></div>{index === 0 ? <small className={workspaceStyles.propertyPrimary}>Primary</small> : null}</div>
          <dl className={workspaceStyles.propertyFacts}><div><dt>Customer</dt><dd>{customerContext.displayName}</dd></div><div><dt>Contact</dt><dd>{customerContext.phone || 'Not set'}</dd></div><div><dt>A/C count</dt><dd>{property.equipment.length}</dd></div></dl>
          <button type="button" className={workspaceStyles.propertyOpen} onClick={() => setPropertyPreviewId(property.id)}>Open profile ↗</button>
        </article>)}</div> : <div className={styles.recordList}>{customerContext.properties.map((property) => <article key={property.id}><div><strong>{property.name}</strong><span>{property.address}</span>{property.sector ? <small>{property.sector}</small> : null}</div><b>{property.equipment.length} A/C</b></article>)}</div> : <div className={styles.contextEmpty}>No live CRM properties are linked to this WhatsApp contact.</div>}</div> : null}

        {contextTab === 'equipment' '''
text = text[:match.start()] + properties_replacement + text[match.end():]

drawer_anchor = "    </aside> : null}\n  </div>\n</section>;\n}"
drawer = r'''    </aside> : null}
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
}'''
replace(drawer_anchor, drawer)

path.write_text(text)
print('Communication Center transform applied successfully')
