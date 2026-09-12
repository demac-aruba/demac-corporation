'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { addDaysToDateKey, arubaDateKey, ARUBA_TIME_ZONE } from '@/lib/aruba-date';
import {
  acknowledgeTask,
  addTaskComment,
  addTaskEvidence,
  createTask,
  downloadTaskEvidence,
  formatDailyTaskSummary,
  loadTaskTrackerWorkspace,
  requestTaskUpdate,
  saveTaskAutomationSettings,
  updateTaskStatus,
} from '@/lib/task-tracker/repository';
import { addCheckpointProgress, configureCheckpoint, decideCheckpointApproval } from '@/lib/task-tracker/checkpoint-api';
import {
  checkpointFollowUpDue,
  checkpointIsStale,
  checkpointStatus,
  latestCheckpointUpdate,
  type RichTaskCheckpoint,
  type RichTaskRecord,
  type RichTaskWorkspace,
  type TaskCheckpointStatus,
} from '@/lib/task-tracker/checkpoint-types';
import { canExecuteTask, effectiveTaskStatus, taskAccess, taskIsAssignedToPrincipal, taskProgress } from '@/lib/task-tracker/policy';
import type { TaskAttachment, TaskAutomationSettings, TaskDisplayStatus, TaskLifecycleStatus, TaskPriority, TaskRecord } from '@/lib/task-tracker/types';
import styles from './task-tracker.module.css';

type WorkspaceView = 'overview' | 'my' | 'board' | 'automation';
type StatusFilter = 'all' | TaskDisplayStatus;
type TaskDraft = {
  title: string;
  description: string;
  category: string;
  priority: TaskPriority;
  assigneeStaffId: string;
  dueLocal: string;
  completionRequirement: TaskRecord['completionRequirement'];
  checklist: string[];
};
type CheckpointDraft = {
  text: string;
  status: TaskCheckpointStatus;
  nextAction: string;
  nextFollowUpLocal: string;
  waitingOn: string;
  blockedReason: string;
};

const boardStatuses: TaskDisplayStatus[] = ['pending', 'in_progress', 'waiting', 'completed', 'overdue'];
const executableStatuses: TaskLifecycleStatus[] = ['pending', 'in_progress', 'waiting', 'completed'];
const checkpointStatuses: TaskCheckpointStatus[] = ['pending', 'in_progress', 'waiting', 'blocked'];
const evidenceAccept = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx';

function initials(name: string) { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'TK'; }
function titleCase(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase()); }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function statusLabel(status: TaskDisplayStatus | TaskCheckpointStatus) { return status === 'in_progress' ? 'In Progress' : titleCase(status); }
function formatDue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No deadline';
  return new Intl.DateTimeFormat('en-AW', { timeZone: ARUBA_TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AW', { timeZone: ARUBA_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return 'File';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function arubaLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a valid Aruba date and time.');
  return new Date(`${value}:00-04:00`).toISOString();
}
function isoToLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ARUBA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function defaultTaskDraft(firstAssignee = ''): TaskDraft {
  return { title: '', description: '', category: 'Follow-up', priority: 'important', assigneeStaffId: firstAssignee, dueLocal: `${addDaysToDateKey(arubaDateKey(), 1)}T10:00`, completionRequirement: 'checklist_required', checklist: [''] };
}
function defaultCheckpointDraft(item: RichTaskCheckpoint): CheckpointDraft {
  return {
    text: '',
    status: checkpointStatus(item) === 'completed' ? 'in_progress' : checkpointStatus(item),
    nextAction: String(item.nextAction || ''),
    nextFollowUpLocal: isoToLocal(item.nextFollowUpAt),
    waitingOn: String(item.waitingOn || ''),
    blockedReason: String(item.blockedReason || ''),
  };
}
function chipStyle(status: string) {
  const base = { display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '3px 8px', borderRadius: 999, fontSize: 9, fontWeight: 700, border: '1px solid var(--border)' } as const;
  if (status === 'blocked' || status === 'overdue') return { ...base, background: 'var(--danger-soft, #fff1f2)', color: 'var(--danger, #b42318)' };
  if (status === 'waiting') return { ...base, background: 'var(--warning-soft, #fff7e6)', color: 'var(--warning, #8a5a00)' };
  if (status === 'completed' || status === 'approved') return { ...base, background: 'var(--success-soft, #ecfdf3)', color: 'var(--success, #027a48)' };
  return { ...base, background: 'var(--surface-2)', color: 'var(--text)' };
}

export function TaskTrackerWorkspaceV2() {
  const { principal } = useAuth();
  const access = useMemo(() => taskAccess(principal), [principal]);
  const [workspace, setWorkspace] = useState<RichTaskWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<WorkspaceView>(access.canViewAll ? 'overview' : 'my');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(() => defaultTaskDraft());
  const [checkpointDrafts, setCheckpointDrafts] = useState<Record<string, CheckpointDraft>>({});
  const [comment, setComment] = useState('');
  const [automationDraft, setAutomationDraft] = useState<TaskAutomationSettings | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const next = await loadTaskTrackerWorkspace(principal) as unknown as RichTaskWorkspace;
      setWorkspace(next);
      setAutomationDraft(next.automation);
      setDraft((current) => ({ ...current, assigneeStaffId: current.assigneeStaffId || next.assignees[0]?.staffId || '' }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [principal]);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    if (!access.canViewAll && view === 'overview') setView('my');
    if (!access.canManageAutomations && view === 'automation') setView('my');
  }, [access.canManageAutomations, access.canViewAll, view]);

  const tasks = workspace?.tasks ?? [];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedEvents = (workspace?.events ?? []).filter((event) => event.taskId === selectedTaskId);
  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (view === 'my' && !taskIsAssignedToPrincipal(task, principal)) return false;
      if (statusFilter !== 'all' && effectiveTaskStatus(task) !== statusFilter) return false;
      if (!normalized) return true;
      const checkpointText = task.checklist.map((item) => `${item.label} ${(item.updates || []).map((update) => update.text).join(' ')}`).join(' ');
      return `${task.taskNumber} ${task.title} ${task.description} ${task.assigneeNameSnapshot} ${checkpointText}`.toLowerCase().includes(normalized);
    });
  }, [principal, query, statusFilter, tasks, view]);

  const attention = useMemo(() => {
    const now = new Date();
    const checkpoints = tasks.flatMap((task) => task.checklist.map((item) => ({ task, item })));
    return {
      active: tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length,
      overdue: tasks.filter((task) => effectiveTaskStatus(task) === 'overdue').length,
      blocked: checkpoints.filter(({ item }) => checkpointStatus(item) === 'blocked').length,
      followUp: checkpoints.filter(({ item }) => checkpointFollowUpDue(item, now)).length,
      approval: checkpoints.filter(({ item }) => item.requiresApproval === true && item.approvalStatus !== 'approved' && checkpointStatus(item) !== 'completed').length,
      stale: checkpoints.filter(({ task, item }) => checkpointIsStale(item, task.createdAt, now)).length,
    };
  }, [tasks]);

  const mutate = useCallback(async (operation: () => Promise<unknown>, success: string) => {
    if (!workspace?.liveDataAvailable) return setError(workspace?.dataAccessMessage || 'Task Tracker is not live.');
    setBusy(true); setError(''); setMessage('');
    try {
      await operation();
      setMessage(success);
      await load(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally { setBusy(false); }
  }, [load, workspace?.dataAccessMessage, workspace?.liveDataAvailable]);

  const openTask = (task: RichTaskRecord) => {
    setSelectedTaskId(task.id);
    const next: Record<string, CheckpointDraft> = {};
    task.checklist.forEach((item) => { next[item.id] = defaultCheckpointDraft(item); });
    setCheckpointDrafts(next);
    setComment('');
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace) return;
    const assignee = workspace.assignees.find((item) => item.staffId === draft.assigneeStaffId);
    if (!assignee) return setError('Choose a registered DEMAC staff member.');
    await mutate(() => createTask({ principal, title: draft.title, description: draft.description, category: draft.category, priority: draft.priority, assignee, dueAt: arubaLocalToIso(draft.dueLocal), checklist: draft.checklist, completionRequirement: draft.completionRequirement }), 'Task created successfully. WhatsApp assignment is queued automatically.');
    if (workspace.liveDataAvailable) setCreateOpen(false);
  };

  const saveCheckpoint = async (task: RichTaskRecord, item: RichTaskCheckpoint, forceStatus?: TaskCheckpointStatus) => {
    const current = checkpointDrafts[item.id] || defaultCheckpointDraft(item);
    const status = forceStatus || current.status;
    await mutate(() => addCheckpointProgress({
      task,
      itemId: item.id,
      text: current.text,
      status,
      nextAction: current.nextAction,
      nextFollowUpAt: current.nextFollowUpLocal ? arubaLocalToIso(current.nextFollowUpLocal) : undefined,
      waitingOn: current.waitingOn,
      blockedReason: current.blockedReason,
    }), status === 'completed' ? 'Checkpoint completed with final result recorded.' : 'Progress update saved.');
    setCheckpointDrafts((currentDrafts) => ({ ...currentDrafts, [item.id]: { ...defaultCheckpointDraft(item), text: '' } }));
  };

  const addEvidence = async (task: RichTaskRecord, file: File) => mutate(() => addTaskEvidence(task, file, principal), `Evidence attached: ${file.name}`);
  const downloadEvidence = async (task: RichTaskRecord, attachment: TaskAttachment) => {
    setBusy(true); setError('');
    try { await downloadTaskEvidence(task, attachment.id, attachment.fileName, principal); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const dailyPreview = formatDailyTaskSummary(tasks, workspace?.assignees[0]?.name || 'Operator');

  return <section className={styles.workspace}>
    <header className={styles.pageHead}>
      <div><div className={styles.eyebrow}>Operations · Follow-up V2</div><h1>Task Tracker</h1><p>Track what happened, what is still pending, who is holding the next action and when the next follow-up is due.</p></div>
      <div className={styles.headActions}>{access.canManageAutomations ? <button className={`${styles.button} ${styles.buttonQuiet}`} type="button" onClick={() => setView('automation')}>Reminder Rules</button> : null}{access.canAssign ? <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => { setDraft(defaultTaskDraft(workspace?.assignees[0]?.staffId || '')); setCreateOpen(true); }}>+ New Task</button> : null}</div>
    </header>

    {error ? <div className={styles.errorNotice}><div><strong>Task Tracker needs attention</strong>{error}</div><button className={styles.button} type="button" onClick={() => setError('')}>Dismiss</button></div> : null}
    {message ? <div className={styles.notice}><div><strong>Saved</strong>{message}</div><button className={styles.button} type="button" onClick={() => setMessage('')}>Dismiss</button></div> : null}

    <div className={styles.tabs} role="tablist">
      {access.canViewAll ? <button className={`${styles.tab} ${view === 'overview' ? styles.tabActive : ''}`} type="button" onClick={() => setView('overview')}>All Tasks</button> : null}
      <button className={`${styles.tab} ${view === 'my' ? styles.tabActive : ''}`} type="button" onClick={() => setView('my')}>My Tasks</button>
      <button className={`${styles.tab} ${view === 'board' ? styles.tabActive : ''}`} type="button" onClick={() => setView('board')}>Status Board</button>
      {access.canManageAutomations ? <button className={`${styles.tab} ${view === 'automation' ? styles.tabActive : ''}`} type="button" onClick={() => setView('automation')}>WhatsApp Reminders</button> : null}
    </div>

    {view !== 'automation' ? <div className={styles.statsGrid}>
      <Stat label="Active Tasks" value={attention.active} meta="Open work" />
      <Stat label="Overdue" value={attention.overdue} meta="Past deadline" />
      <Stat label="Blocked" value={attention.blocked} meta="Checkpoint blockers" />
      <Stat label="Follow-up Due" value={attention.followUp} meta="Needs contact now" />
      <Stat label="Needs Approval" value={attention.approval} meta="Manager decision" />
      <Stat label="No Update 2d+" value={attention.stale} meta="Stale checkpoints" />
    </div> : null}

    {(view === 'overview' || view === 'my') ? <TaskList loading={loading} tasks={visibleTasks} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onOpen={openTask} /> : null}
    {view === 'board' ? <Board tasks={visibleTasks} query={query} setQuery={setQuery} onOpen={openTask} /> : null}
    {view === 'automation' && automationDraft ? <ReminderPanel settings={automationDraft} preview={dailyPreview} busy={busy} onChange={setAutomationDraft} onSave={() => void mutate(() => saveTaskAutomationSettings(automationDraft, principal), 'Reminder rules saved.')} /> : null}

    {createOpen ? <CreateDrawer draft={draft} setDraft={setDraft} assignees={workspace?.assignees ?? []} busy={busy} onClose={() => setCreateOpen(false)} onSubmit={(event) => void submitCreate(event)} /> : null}
    {selectedTask ? <TaskDrawer task={selectedTask} events={selectedEvents} principal={principal} drafts={checkpointDrafts} setDrafts={setCheckpointDrafts} comment={comment} setComment={setComment} busy={busy} onClose={() => setSelectedTaskId(null)} onCheckpoint={(item, status) => void saveCheckpoint(selectedTask, item, status)} onConfigure={(item, requiresApproval, dependsOnItemId) => void mutate(() => configureCheckpoint({ task: selectedTask, itemId: item.id, requiresApproval, dependsOnItemId }), 'Checkpoint rules saved.')} onApprove={(item, decision) => void mutate(() => decideCheckpointApproval({ task: selectedTask, itemId: item.id, decision }), `Checkpoint ${decision}.`)} onAcknowledge={() => void mutate(() => acknowledgeTask(selectedTask, principal), 'Task acknowledged.')} onTaskStatus={(status) => void mutate(() => updateTaskStatus(selectedTask, status, principal), `Task moved to ${titleCase(status)}.`)} onRequestUpdate={() => void mutate(() => requestTaskUpdate(selectedTask, principal), 'WhatsApp update request queued.')} onComment={() => { if (!comment.trim()) return; const text = comment; setComment(''); void mutate(() => addTaskComment(selectedTask, text, principal), 'Comment added.'); }} onEvidence={(file) => void addEvidence(selectedTask, file)} onDownload={(attachment) => void downloadEvidence(selectedTask, attachment)} /> : null}
  </section>;
}

function Stat({ label, value, meta }: { label: string; value: number; meta: string }) { return <article className={styles.statCard}><div className={styles.statTop}><span className={styles.statLabel}>{label}</span></div><div className={styles.statValue}>{value}</div><div className={styles.statMeta}>{meta}</div></article>; }

function TaskList({ loading, tasks, query, setQuery, statusFilter, setStatusFilter, onOpen }: { loading: boolean; tasks: RichTaskRecord[]; query: string; setQuery: (v: string) => void; statusFilter: StatusFilter; setStatusFilter: (v: StatusFilter) => void; onOpen: (task: RichTaskRecord) => void }) {
  return <section className={styles.panel}><div className={styles.toolbar}><label className={styles.search}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search task, checkpoint, update..." /></label><select className={styles.filterSelect} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All statuses</option>{boardStatuses.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></div>{loading ? <div className={styles.panelBody}><div className={styles.skeleton} /></div> : <div className={styles.mobileTaskList} style={{ display: 'grid', padding: 12 }}>{tasks.map((task) => <TaskCard task={task} onOpen={() => onOpen(task)} key={task.id} />)}{!tasks.length ? <div className={styles.emptyState}><strong>No tasks match this view</strong><span>Adjust the filters or create a new task.</span></div> : null}</div>}</section>;
}

function TaskCard({ task, onOpen }: { task: RichTaskRecord; onOpen: () => void }) {
  const pending = task.checklist.filter((item) => checkpointStatus(item) !== 'completed');
  const latest = pending.map((item) => latestCheckpointUpdate(item)).filter(Boolean).sort((a, b) => String(b?.at).localeCompare(String(a?.at)))[0];
  return <article className={styles.mobileTaskCard} onClick={onOpen} role="button" tabIndex={0} style={{ cursor: 'pointer' }}><div className={styles.mobileTaskTop}><div><strong>{task.title}</strong><small>{task.taskNumber} · {task.assigneeNameSnapshot}</small></div><span style={chipStyle(effectiveTaskStatus(task))}>{statusLabel(effectiveTaskStatus(task))}</span></div><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 10 }}><span><strong>{pending.length}</strong> pending checkpoint{pending.length === 1 ? '' : 's'}</span><span>Due {formatDue(task.dueAt)}</span><span>{taskProgress(task)}% complete</span></div>{latest?.text ? <div style={{ marginTop: 10, color: 'var(--muted)', fontSize: 10 }}>Latest update: {latest.text}</div> : null}</article>;
}

function Board({ tasks, query, setQuery, onOpen }: { tasks: RichTaskRecord[]; query: string; setQuery: (v: string) => void; onOpen: (task: RichTaskRecord) => void }) {
  return <section className={styles.panel}><div className={styles.toolbar}><label className={styles.search}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search board..." /></label></div><div className={styles.boardDesktop}>{boardStatuses.map((status) => <section className={styles.boardLane} key={status}><header className={styles.laneHead}><strong>{statusLabel(status)}</strong><span>{tasks.filter((task) => effectiveTaskStatus(task) === status).length}</span></header><div className={styles.laneCards}>{tasks.filter((task) => effectiveTaskStatus(task) === status).map((task) => <article className={styles.boardCard} key={task.id} onClick={() => onOpen(task)}><strong>{task.title}</strong><small>{task.taskNumber} · {task.assigneeNameSnapshot}</small><div className={styles.boardCardFooter}><small>{task.checklist.filter((item) => checkpointStatus(item) !== 'completed').length} pending</small><small>{formatDue(task.dueAt)}</small></div></article>)}</div></section>)}</div></section>;
}

function CreateDrawer({ draft, setDraft, assignees, busy, onClose, onSubmit }: { draft: TaskDraft; setDraft: (value: TaskDraft | ((current: TaskDraft) => TaskDraft)) => void; assignees: RichTaskWorkspace['assignees']; busy: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  return <><button className={styles.drawerBackdrop} type="button" aria-label="Close" onClick={onClose} /><aside className={styles.drawer} role="dialog" aria-modal="true"><header className={styles.drawerHeader}><div><div className={styles.eyebrow}>Task Tracker</div><h2>Create New Task</h2><p>Every checklist item can later receive multiple progress updates without being completed.</p></div><button className={styles.closeButton} type="button" onClick={onClose}>×</button></header><form id="task-create-v2" className={styles.drawerBody} onSubmit={onSubmit}><div className={styles.formGrid}><div className={`${styles.field} ${styles.fieldWide}`}><label>Task title *</label><input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div><div className={styles.field}><label>Assign to *</label><select required value={draft.assigneeStaffId} onChange={(event) => setDraft((current) => ({ ...current, assigneeStaffId: event.target.value }))}><option value="">Choose staff member</option>{assignees.map((assignee) => <option value={assignee.staffId} key={assignee.staffId}>{assignee.name}</option>)}</select></div><div className={styles.field}><label>Category</label><input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} /></div><div className={styles.field}><label>Priority</label><select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as TaskPriority }))}>{(['normal', 'important', 'urgent', 'critical'] as TaskPriority[]).map((item) => <option value={item} key={item}>{titleCase(item)}</option>)}</select></div><div className={styles.field}><label>Deadline · Aruba time</label><input type="datetime-local" required value={draft.dueLocal} onChange={(event) => setDraft((current) => ({ ...current, dueLocal: event.target.value }))} /></div><div className={`${styles.field} ${styles.fieldWide}`}><label>Description / requirements</label><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Explain exactly what must be delivered and any quality requirements." /></div><div className={`${styles.field} ${styles.fieldWide}`}><label>Completion requirement</label><select value={draft.completionRequirement} onChange={(event) => setDraft((current) => ({ ...current, completionRequirement: event.target.value as TaskRecord['completionRequirement'] }))}><option value="none">No special requirement</option><option value="checklist_required">All checkpoints must be completed</option><option value="attachment_required">At least one evidence file</option></select></div></div><section className={styles.formSection}><div className={styles.formSectionHead}><h3>Checklist / Checkpoints</h3><button className={styles.button} type="button" onClick={() => setDraft((current) => ({ ...current, checklist: [...current.checklist, ''] }))}>+ Add item</button></div><div className={styles.checklistDraft}>{draft.checklist.map((item, index) => <div className={styles.checklistDraftRow} key={index}><input value={item} onChange={(event) => setDraft((current) => ({ ...current, checklist: current.checklist.map((value, i) => i === index ? event.target.value : value) }))} placeholder={`Checkpoint ${index + 1}`} />{draft.checklist.length > 1 ? <button className={styles.removeItem} type="button" onClick={() => setDraft((current) => ({ ...current, checklist: current.checklist.filter((_, i) => i !== index) }))}>×</button> : null}</div>)}</div></section></form><footer className={styles.drawerFooter}><button className={styles.button} type="button" onClick={onClose}>Cancel</button><button className={`${styles.button} ${styles.buttonPrimary}`} form="task-create-v2" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create Task'}</button></footer></aside></>;
}

function TaskDrawer({ task, events, principal, drafts, setDrafts, comment, setComment, busy, onClose, onCheckpoint, onConfigure, onApprove, onAcknowledge, onTaskStatus, onRequestUpdate, onComment, onEvidence, onDownload }: { task: RichTaskRecord; events: RichTaskWorkspace['events']; principal: ReturnType<typeof useAuth>['principal']; drafts: Record<string, CheckpointDraft>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, CheckpointDraft>>>; comment: string; setComment: (v: string) => void; busy: boolean; onClose: () => void; onCheckpoint: (item: RichTaskCheckpoint, status?: TaskCheckpointStatus) => void; onConfigure: (item: RichTaskCheckpoint, requiresApproval: boolean, dependsOnItemId?: string) => void; onApprove: (item: RichTaskCheckpoint, decision: 'approved' | 'rejected') => void; onAcknowledge: () => void; onTaskStatus: (status: TaskLifecycleStatus) => void; onRequestUpdate: () => void; onComment: () => void; onEvidence: (file: File) => void; onDownload: (attachment: TaskAttachment) => void }) {
  const executable = canExecuteTask(task, principal);
  const manager = principal.capabilities.has('tasks.manage');
  const terminal = ['completed', 'cancelled'].includes(task.status);
  const chooseEvidence = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onEvidence(file); };
  return <><button className={styles.drawerBackdrop} type="button" onClick={onClose} aria-label="Close" /><aside className={styles.drawer} role="dialog" aria-modal="true"><header className={styles.drawerHeader}><div><div className={styles.eyebrow}>{task.taskNumber} · {task.category || 'General'}</div><h2>{task.title}</h2><p>Assigned to {task.assigneeNameSnapshot} · Due {formatDue(task.dueAt)}</p></div><button className={styles.closeButton} type="button" onClick={onClose}>×</button></header><div className={styles.drawerBody}><div className={styles.detailDescription}>{task.description || 'No additional requirements.'}</div><section className={styles.detailSection}><h3>Checkpoints · {task.checklist.filter((item) => checkpointStatus(item) === 'completed').length}/{task.checklist.length}</h3><div style={{ display: 'grid', gap: 12 }}>{task.checklist.map((item) => <CheckpointCard key={item.id} task={task} item={item} draft={drafts[item.id] || defaultCheckpointDraft(item)} setDraft={(patch) => setDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] || defaultCheckpointDraft(item)), ...patch } }))} executable={executable && !terminal} manager={manager} busy={busy} onSave={(status) => onCheckpoint(item, status)} onConfigure={(requiresApproval, dependency) => onConfigure(item, requiresApproval, dependency)} onApprove={(decision) => onApprove(item, decision)} />)}</div></section><section className={styles.detailSection}><div className={styles.formSectionHead}><div><h3 style={{ margin: 0 }}>Evidence · {task.attachments.length}</h3><span style={{ color: 'var(--muted)', fontSize: 9 }}>Private task storage</span></div>{executable && !terminal ? <label className={`${styles.button} ${styles.buttonPrimary}`}>+ Attach Evidence<input type="file" accept={evidenceAccept} disabled={busy} onChange={chooseEvidence} style={{ display: 'none' }} /></label> : null}</div>{task.attachments.map((attachment) => <div className={styles.checklistItem} key={attachment.id} style={{ justifyContent: 'space-between', marginTop: 8 }}><div><strong>{attachment.fileName}</strong><span style={{ display: 'block', fontSize: 8, color: 'var(--muted)' }}>{formatBytes(attachment.size)} · {attachment.uploadedByName}</span></div><button className={styles.button} type="button" disabled={busy} onClick={() => onDownload(attachment)}>Download</button></div>)}</section><section className={styles.detailSection}><h3>Comments &amp; Activity</h3><div className={styles.timeline}>{events.slice(0, 40).map((event) => <div className={styles.timelineItem} key={event.id}><span className={styles.timelineDot} /><div><strong>{event.actorName} · {titleCase(event.type)}</strong><p>{event.message || formatEventTime(event.at)}</p>{event.message ? <p>{formatEventTime(event.at)}</p> : null}</div></div>)}</div>{executable ? <div className={styles.commentComposer}><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a task-level comment..." /><button className={styles.button} type="button" disabled={busy || !comment.trim()} onClick={onComment}>Post</button></div> : null}</section></div><footer className={styles.drawerFooter}><div className={styles.detailActions}>{executable && !task.acknowledgedAt ? <button className={styles.button} type="button" onClick={onAcknowledge}>Acknowledge</button> : null}{manager && !terminal ? <button className={styles.button} type="button" onClick={onRequestUpdate}>Request Update</button> : null}{executable && !terminal ? <select className={styles.filterSelect} value={task.status} onChange={(event) => onTaskStatus(event.target.value as TaskLifecycleStatus)}>{executableStatuses.map((status) => <option value={status} key={status}>{titleCase(status)}</option>)}</select> : null}{executable && !terminal ? <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => onTaskStatus('completed')}>✓ Mark Task Complete</button> : null}</div></footer></aside></>;
}

function CheckpointCard({ task, item, draft, setDraft, executable, manager, busy, onSave, onConfigure, onApprove }: { task: RichTaskRecord; item: RichTaskCheckpoint; draft: CheckpointDraft; setDraft: (patch: Partial<CheckpointDraft>) => void; executable: boolean; manager: boolean; busy: boolean; onSave: (status?: TaskCheckpointStatus) => void; onConfigure: (requiresApproval: boolean, dependency?: string) => void; onApprove: (decision: 'approved' | 'rejected') => void }) {
  const status = checkpointStatus(item);
  const updates = [...(item.updates || [])].reverse();
  const dependency = item.dependsOnItemId ? task.checklist.find((candidate) => candidate.id === item.dependsOnItemId) : null;
  const dependencyOpen = dependency ? checkpointStatus(dependency) !== 'completed' : false;
  const approvalOpen = item.requiresApproval === true && item.approvalStatus !== 'approved';
  return <article style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--surface)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}><div><strong style={{ fontSize: 12 }}>{status === 'completed' ? '✓ ' : '☐ '}{item.label}</strong><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}><span style={chipStyle(status)}>{statusLabel(status)}</span>{item.requiresApproval ? <span style={chipStyle(item.approvalStatus || 'pending')}>Approval: {titleCase(item.approvalStatus || 'pending')}</span> : null}{dependency ? <span style={chipStyle(dependencyOpen ? 'waiting' : 'completed')}>After: {dependency.label}</span> : null}</div></div>{item.lastUpdateAt ? <small style={{ color: 'var(--muted)' }}>{formatEventTime(item.lastUpdateAt)}</small> : null}</div>{item.nextAction || item.nextFollowUpAt || item.waitingOn || item.blockedReason ? <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'var(--surface-2)', fontSize: 10, display: 'grid', gap: 4 }}>{item.nextAction ? <span><strong>Next:</strong> {item.nextAction}</span> : null}{item.nextFollowUpAt ? <span><strong>Follow-up:</strong> {formatDue(item.nextFollowUpAt)}</span> : null}{item.waitingOn ? <span><strong>Waiting on:</strong> {item.waitingOn}</span> : null}{item.blockedReason ? <span><strong>Blocked:</strong> {item.blockedReason}</span> : null}</div> : null}{updates.length ? <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>{updates.slice(0, 8).map((update) => <div key={update.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 9 }}><div style={{ fontSize: 10 }}>{update.text}</div><small style={{ color: 'var(--muted)' }}>{update.actorName} · {formatEventTime(update.at)} · {statusLabel(update.status)}</small></div>)}</div> : <div style={{ marginTop: 10, color: 'var(--muted)', fontSize: 10 }}>No progress updates yet.</div>}{manager && status !== 'completed' ? <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><label style={{ fontSize: 10 }}><input type="checkbox" checked={item.requiresApproval === true} onChange={(event) => onConfigure(event.target.checked, item.dependsOnItemId || undefined)} disabled={busy} /> Require manager approval</label><select className={styles.filterSelect} value={item.dependsOnItemId || ''} onChange={(event) => onConfigure(item.requiresApproval === true, event.target.value || undefined)} disabled={busy}><option value="">No prerequisite</option>{task.checklist.filter((candidate) => candidate.id !== item.id).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</select>{item.requiresApproval && item.approvalStatus !== 'approved' ? <><button className={styles.button} type="button" onClick={() => onApprove('approved')} disabled={busy}>Approve</button><button className={styles.button} type="button" onClick={() => onApprove('rejected')} disabled={busy}>Reject</button></> : null}</div> : null}{executable && status !== 'completed' ? <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'grid', gap: 8 }}><textarea value={draft.text} onChange={(event) => setDraft({ text: event.target.value })} placeholder="Progress update / result. Example: I called today; they have not paid yet and promised to pay tomorrow." style={{ width: '100%', minHeight: 72 }} /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}><label className={styles.field}><span>Checkpoint status</span><select value={draft.status} onChange={(event) => setDraft({ status: event.target.value as TaskCheckpointStatus })}>{checkpointStatuses.map((value) => <option value={value} key={value}>{statusLabel(value)}</option>)}</select></label><label className={styles.field}><span>Next follow-up · Aruba</span><input type="datetime-local" value={draft.nextFollowUpLocal} onChange={(event) => setDraft({ nextFollowUpLocal: event.target.value })} /></label><label className={styles.field}><span>Waiting on</span><input value={draft.waitingOn} onChange={(event) => setDraft({ waitingOn: event.target.value })} placeholder="Customer, supplier, manager..." /></label><label className={styles.field}><span>Next action</span><input value={draft.nextAction} onChange={(event) => setDraft({ nextAction: event.target.value })} placeholder="Call again tomorrow..." /></label></div>{draft.status === 'blocked' ? <label className={styles.field}><span>Blocker reason *</span><input value={draft.blockedReason} onChange={(event) => setDraft({ blockedReason: event.target.value })} placeholder="Explain what prevents progress." /></label> : null}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><button className={styles.button} type="button" onClick={() => onSave()} disabled={busy || !draft.text.trim()}>Save Update</button><button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => onSave('completed')} disabled={busy || !draft.text.trim() || dependencyOpen || approvalOpen}>✓ Complete Checkpoint</button></div>{dependencyOpen ? <small style={{ color: 'var(--muted)' }}>Complete the prerequisite checkpoint first.</small> : null}{approvalOpen ? <small style={{ color: 'var(--muted)' }}>Manager approval is required before completion.</small> : null}</div> : null}</article>;
}

function ReminderPanel({ settings, preview, busy, onChange, onSave }: { settings: TaskAutomationSettings; preview: string; busy: boolean; onChange: (settings: TaskAutomationSettings) => void; onSave: () => void }) {
  const toggle = (key: keyof TaskAutomationSettings) => onChange({ ...settings, [key]: !settings[key] } as TaskAutomationSettings);
  return <section className={styles.panel}><div className={styles.panelBody}><div className={styles.formSectionHead}><div><h2 style={{ margin: 0 }}>WhatsApp Reminder Rules</h2><p style={{ color: 'var(--muted)' }}>Reminders now include pending checkpoints, latest update, next action, follow-up date, waiting/blocker context and approval needs.</p></div><button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={onSave} disabled={busy}>Save Rules</button></div><div className={styles.reminderGrid}>{(['dailySummaryEnabled', 'twentyFourHoursBefore', 'threeHoursBefore', 'oneHourBefore', 'deadlineAlert', 'overdueReminders'] as const).map((key) => <label className={styles.reminderOption} key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={() => toggle(key)} /> {titleCase(key)}</label>)}</div><div className={styles.field} style={{ marginTop: 12, maxWidth: 220 }}><label>Daily summary time · Aruba</label><input type="time" value={settings.dailySummaryTime} onChange={(event) => onChange({ ...settings, dailySummaryTime: event.target.value })} /></div><section className={styles.detailSection}><h3>Message preview</h3><pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', fontSize: 10, background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>{preview}</pre></section></div></section>;
}
