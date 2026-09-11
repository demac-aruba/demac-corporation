'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { addDaysToDateKey, arubaDateKey, ARUBA_TIME_ZONE } from '@/lib/aruba-date';
import {
  acknowledgeTask,
  addTaskComment,
  createTask,
  formatDailyTaskSummary,
  loadTaskTrackerWorkspace,
  requestTaskUpdate,
  saveTaskAutomationSettings,
  updateTaskChecklist,
  updateTaskStatus,
} from '@/lib/task-tracker/repository';
import {
  canExecuteTask,
  effectiveTaskStatus,
  taskAccess,
  taskIsAssignedToPrincipal,
  taskProgress,
} from '@/lib/task-tracker/policy';
import type {
  TaskAutomationSettings,
  TaskDisplayStatus,
  TaskLifecycleStatus,
  TaskPriority,
  TaskRecord,
  TaskTrackerWorkspace as TaskTrackerWorkspaceState,
} from '@/lib/task-tracker/types';
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

const boardStatuses: TaskDisplayStatus[] = ['pending', 'in_progress', 'waiting', 'completed', 'overdue'];
const executableStatuses: TaskLifecycleStatus[] = ['pending', 'in_progress', 'waiting', 'completed'];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'TK';
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusLabel(status: TaskDisplayStatus) {
  return status === 'in_progress' ? 'In Progress' : titleCase(status);
}

function priorityLabel(priority: TaskPriority) {
  return titleCase(priority);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function statusClass(status: TaskDisplayStatus) {
  if (status === 'in_progress') return styles.statusInProgress;
  if (status === 'waiting') return styles.statusWaiting;
  if (status === 'completed') return styles.statusCompleted;
  if (status === 'overdue') return styles.statusOverdue;
  if (status === 'cancelled') return styles.statusCancelled;
  return styles.statusPending;
}

function priorityClass(priority: TaskPriority) {
  if (priority === 'important') return styles.priorityImportant;
  if (priority === 'urgent') return styles.priorityUrgent;
  if (priority === 'critical') return styles.priorityCritical;
  return styles.priorityNormal;
}

function formatDue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No deadline';
  return new Intl.DateTimeFormat('en-AW', {
    timeZone: ARUBA_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-AW', {
    timeZone: ARUBA_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function taskDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ARUBA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function arubaLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a valid deadline date and time.');
  const date = new Date(`${value}:00-04:00`);
  if (Number.isNaN(date.getTime())) throw new Error('Choose a valid deadline date and time.');
  return date.toISOString();
}

function defaultDraft(firstAssignee = ''): TaskDraft {
  return {
    title: '',
    description: '',
    category: 'Report',
    priority: 'important',
    assigneeStaffId: firstAssignee,
    dueLocal: `${addDaysToDateKey(arubaDateKey(), 1)}T10:00`,
    completionRequirement: 'checklist_required',
    checklist: [''],
  };
}

function TaskStatusPill({ task }: { task: TaskRecord }) {
  const status = effectiveTaskStatus(task);
  return <span className={`${styles.pill} ${statusClass(status)}`}>{statusLabel(status)}</span>;
}

function TaskPriorityPill({ priority }: { priority: TaskPriority }) {
  return <span className={`${styles.pill} ${priorityClass(priority)}`}>{priorityLabel(priority)}</span>;
}

export function TaskTrackerWorkspace() {
  const { principal } = useAuth();
  const access = useMemo(() => taskAccess(principal), [principal]);
  const [workspace, setWorkspace] = useState<TaskTrackerWorkspaceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<WorkspaceView>(access.canViewAll ? 'overview' : 'my');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mobileBoardStatus, setMobileBoardStatus] = useState<TaskDisplayStatus>('pending');
  const [draft, setDraft] = useState<TaskDraft>(() => defaultDraft());
  const [comment, setComment] = useState('');
  const [automationDraft, setAutomationDraft] = useState<TaskAutomationSettings | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const next = await loadTaskTrackerWorkspace(principal);
      setWorkspace(next);
      setAutomationDraft(next.automation);
      setDraft((current) => ({
        ...current,
        assigneeStaffId: current.assigneeStaffId || next.assignees[0]?.staffId || '',
      }));
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
  const selectedEvents = useMemo(
    () => (workspace?.events ?? []).filter((event) => event.taskId === selectedTaskId),
    [selectedTaskId, workspace?.events],
  );

  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (view === 'my' && !taskIsAssignedToPrincipal(task, principal)) return false;
      if (statusFilter !== 'all' && effectiveTaskStatus(task) !== statusFilter) return false;
      if (!normalized) return true;
      return `${task.taskNumber} ${task.title} ${task.description} ${task.assigneeNameSnapshot} ${task.category ?? ''}`.toLowerCase().includes(normalized);
    });
  }, [principal, query, statusFilter, tasks, view]);

  const stats = useMemo(() => {
    const today = arubaDateKey();
    const dueToday = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status) && taskDateKey(task.dueAt) === today).length;
    const overdue = tasks.filter((task) => effectiveTaskStatus(task) === 'overdue').length;
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const active = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length;
    return { active, dueToday, overdue, completed };
  }, [tasks]);

  const boardGroups = useMemo(() => Object.fromEntries(boardStatuses.map((status) => [
    status,
    filteredTasks.filter((task) => effectiveTaskStatus(task) === status),
  ])) as Record<TaskDisplayStatus, TaskRecord[]>, [filteredTasks]);

  const mutate = useCallback(async (operation: () => Promise<unknown>, success: string) => {
    if (!workspace?.liveDataAvailable) {
      setError(workspace?.dataAccessMessage || 'Task Tracker writes are not activated in this environment yet.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage(success);
      await load(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }, [load, workspace?.dataAccessMessage, workspace?.liveDataAvailable]);

  const openCreate = () => {
    setError('');
    setMessage('');
    setDraft(defaultDraft(workspace?.assignees[0]?.staffId || ''));
    setCreateOpen(true);
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace) return;
    const assignee = workspace.assignees.find((item) => item.staffId === draft.assigneeStaffId);
    if (!assignee) {
      setError('Choose a registered DEMAC staff member for this task.');
      return;
    }
    await mutate(
      () => createTask({
        principal,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        priority: draft.priority,
        assignee,
        dueAt: arubaLocalToIso(draft.dueLocal),
        checklist: draft.checklist,
        completionRequirement: draft.completionRequirement,
      }),
      'Task created successfully.',
    );
    if (workspace.liveDataAvailable) setCreateOpen(false);
  };

  const changeStatus = async (task: TaskRecord, status: TaskLifecycleStatus) => {
    await mutate(() => updateTaskStatus(task, status, principal), `Task moved to ${titleCase(status)}.`);
  };

  const toggleChecklist = async (task: TaskRecord, itemId: string) => {
    const checklist = task.checklist.map((item) => item.id === itemId ? { ...item, completed: !item.completed } : item);
    await mutate(() => updateTaskChecklist(task, checklist, principal), 'Checklist updated.');
  };

  const submitComment = async () => {
    if (!selectedTask || !comment.trim()) return;
    const text = comment;
    setComment('');
    await mutate(() => addTaskComment(selectedTask, text, principal), 'Comment added.');
  };

  const saveAutomation = async () => {
    if (!automationDraft) return;
    await mutate(() => saveTaskAutomationSettings(automationDraft, principal), 'Task reminder settings saved.');
  };

  const previewAssignee = workspace?.assignees[0] ?? null;
  const previewTasks = previewAssignee ? tasks.filter((task) => task.assigneeStaffId === previewAssignee.staffId) : [];
  const dailyPreview = formatDailyTaskSummary(previewTasks, previewAssignee?.name || 'Operator');

  return (
    <section className={styles.workspace}>
      <header className={styles.pageHead}>
        <div>
          <div className={styles.eyebrow}>Operations · Team Execution</div>
          <h1>Task Tracker</h1>
          <p>Assign, prioritize and follow operational work without interfering with Scheduling &amp; Dispatch. Deadlines, evidence and reminders remain traceable in one place.</p>
        </div>
        <div className={styles.headActions}>
          {access.canManageAutomations ? <button className={`${styles.button} ${styles.buttonQuiet}`} type="button" onClick={() => setView('automation')}>Reminder Rules</button> : null}
          {access.canAssign ? <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={openCreate}>+ New Task</button> : null}
        </div>
      </header>

      {workspace?.dataAccessMessage ? (
        <div className={styles.notice}>
          <div><strong>Safe preview mode</strong>{workspace.dataAccessMessage}</div>
          <span>Schedule remains untouched.</span>
        </div>
      ) : null}
      {error ? <div className={styles.errorNotice}><div><strong>Task Tracker needs attention</strong>{error}</div><button className={styles.button} type="button" onClick={() => setError('')}>Dismiss</button></div> : null}
      {message ? <div className={styles.notice}><div><strong>Saved</strong>{message}</div><button className={styles.button} type="button" onClick={() => setMessage('')}>Dismiss</button></div> : null}

      <div className={styles.tabs} role="tablist" aria-label="Task Tracker views">
        {access.canViewAll ? <button className={`${styles.tab} ${view === 'overview' ? styles.tabActive : ''}`} type="button" onClick={() => setView('overview')}>All Tasks</button> : null}
        <button className={`${styles.tab} ${view === 'my' ? styles.tabActive : ''}`} type="button" onClick={() => setView('my')}>My Tasks</button>
        <button className={`${styles.tab} ${view === 'board' ? styles.tabActive : ''}`} type="button" onClick={() => setView('board')}>Status Board</button>
        {access.canManageAutomations ? <button className={`${styles.tab} ${view === 'automation' ? styles.tabActive : ''}`} type="button" onClick={() => setView('automation')}>WhatsApp Reminders</button> : null}
      </div>

      {view !== 'automation' ? (
        <div className={styles.statsGrid}>
          <StatCard icon="AC" label="Active Tasks" value={stats.active} meta="Pending, in progress or waiting" />
          <StatCard icon="TD" label="Due Today" value={stats.dueToday} meta="Aruba business time" />
          <StatCard icon="!" label="Overdue" value={stats.overdue} meta="Needs attention" />
          <StatCard icon="✓" label="Completed" value={stats.completed} meta="Visible task history" />
        </div>
      ) : null}

      {view === 'overview' || view === 'my' ? (
        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search task, operator, category..." aria-label="Search tasks" />
            </label>
            <div className={styles.toolbarActions}>
              <select className={styles.filterSelect} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label="Filter by status">
                <option value="all">All statuses</option>
                {boardStatuses.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}
              </select>
              {access.canAssign ? <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={openCreate}>+ New Task</button> : null}
            </div>
          </div>

          {loading ? <div className={styles.panelBody}><div className={styles.skeleton} /></div> : filteredTasks.length === 0 ? (
            <EmptyState live={Boolean(workspace?.liveDataAvailable)} mine={view === 'my'} />
          ) : (
            <>
              <div className={styles.desktopTable}>
                <table className={styles.taskTable}>
                  <thead><tr><th>Task</th><th>Assigned To</th><th>Priority</th><th>Status</th><th>Deadline</th><th>Progress</th></tr></thead>
                  <tbody>
                    {filteredTasks.map((task) => (
                      <tr key={task.id} onClick={() => setSelectedTaskId(task.id)}>
                        <td><div className={styles.taskTitle}><strong>{task.title}</strong><span>{task.taskNumber} · {task.category || 'General'}</span></div></td>
                        <td><AssigneeCell task={task} /></td>
                        <td><TaskPriorityPill priority={task.priority} /></td>
                        <td><TaskStatusPill task={task} /></td>
                        <td><Deadline task={task} /></td>
                        <td><Progress task={task} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.mobileTaskList}>
                {filteredTasks.map((task) => <MobileTaskCard task={task} key={task.id} onOpen={() => setSelectedTaskId(task.id)} />)}
              </div>
            </>
          )}
        </section>
      ) : null}

      {view === 'board' ? (
        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search board..." aria-label="Search task board" />
            </label>
            <div className={styles.toolbarActions}>
              {access.canAssign ? <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={openCreate}>+ New Task</button> : null}
            </div>
          </div>
          {loading ? <div className={styles.panelBody}><div className={styles.skeleton} /></div> : (
            <>
              <div className={styles.boardDesktop}>
                {boardStatuses.map((status) => <BoardLane status={status} tasks={boardGroups[status] || []} onOpen={setSelectedTaskId} key={status} />)}
              </div>
              <div className={styles.mobileBoard}>
                <div className={styles.mobileBoardTabs}>
                  {boardStatuses.map((status) => (
                    <button className={`${styles.mobileBoardTab} ${mobileBoardStatus === status ? styles.mobileBoardTabActive : ''}`} type="button" onClick={() => setMobileBoardStatus(status)} key={status}>
                      {statusLabel(status)} · {(boardGroups[status] || []).length}
                    </button>
                  ))}
                </div>
                <div className={styles.mobileBoardCards}>
                  {(boardGroups[mobileBoardStatus] || []).length ? (boardGroups[mobileBoardStatus] || []).map((task) => <MobileTaskCard task={task} key={task.id} onOpen={() => setSelectedTaskId(task.id)} />) : <EmptyState live={Boolean(workspace?.liveDataAvailable)} mine={false} compact />}
                </div>
              </div>
            </>
          )}
        </section>
      ) : null}

      {view === 'automation' && automationDraft ? (
        <AutomationPanel
          settings={automationDraft}
          onChange={setAutomationDraft}
          preview={dailyPreview}
          canSave={access.canManageAutomations && Boolean(workspace?.liveDataAvailable)}
          busy={busy}
          onSave={() => void saveAutomation()}
        />
      ) : null}

      {createOpen ? (
        <CreateTaskDrawer
          draft={draft}
          setDraft={setDraft}
          assignees={workspace?.assignees ?? []}
          busy={busy}
          liveDataAvailable={Boolean(workspace?.liveDataAvailable)}
          onClose={() => setCreateOpen(false)}
          onSubmit={(event) => void submitCreate(event)}
        />
      ) : null}

      {selectedTask ? (
        <TaskDetailDrawer
          task={selectedTask}
          events={selectedEvents}
          principal={principal}
          comment={comment}
          setComment={setComment}
          liveDataAvailable={Boolean(workspace?.liveDataAvailable)}
          busy={busy}
          onClose={() => setSelectedTaskId(null)}
          onAcknowledge={() => void mutate(() => acknowledgeTask(selectedTask, principal), 'Task acknowledged.')}
          onStatus={(status) => void changeStatus(selectedTask, status)}
          onToggleChecklist={(itemId) => void toggleChecklist(selectedTask, itemId)}
          onRequestUpdate={() => void mutate(() => requestTaskUpdate(selectedTask, principal), 'WhatsApp update request queued.')}
          onComment={() => void submitComment()}
        />
      ) : null}
    </section>
  );
}

function StatCard({ icon, label, value, meta }: { icon: string; label: string; value: number; meta: string }) {
  return <article className={styles.statCard}><div className={styles.statTop}><span className={styles.statLabel}>{label}</span><span className={styles.statIcon}>{icon}</span></div><div className={styles.statValue}>{value}</div><div className={styles.statMeta}>{meta}</div></article>;
}

function AssigneeCell({ task }: { task: TaskRecord }) {
  return <div className={styles.assignee}><span className={styles.avatar}>{initials(task.assigneeNameSnapshot)}</span><div><strong>{task.assigneeNameSnapshot}</strong><span>{task.assigneePhoneSnapshot || 'Canonical staff profile'}</span></div></div>;
}

function Deadline({ task }: { task: TaskRecord }) {
  const overdue = effectiveTaskStatus(task) === 'overdue';
  return <div className={`${styles.deadline} ${overdue ? styles.deadlineOverdue : ''}`}><strong>{formatDue(task.dueAt)}</strong><span>{overdue ? 'Past deadline' : 'Aruba time'}</span></div>;
}

function Progress({ task }: { task: TaskRecord }) {
  const progress = taskProgress(task);
  return <div><div className={styles.progress}><span style={{ width: `${progress}%` }} /></div><span style={{ color: 'var(--muted)', fontSize: 8 }}>{progress}%</span></div>;
}

function MobileTaskCard({ task, onOpen }: { task: TaskRecord; onOpen: () => void }) {
  return (
    <article className={styles.mobileTaskCard} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(); }}>
      <div className={styles.mobileTaskTop}>
        <div><strong>{task.title}</strong><small>{task.taskNumber} · {task.category || 'General'}</small></div>
        <TaskStatusPill task={task} />
      </div>
      <div className={styles.mobileTaskMeta}><div><span className={styles.avatar}>{initials(task.assigneeNameSnapshot)}</span><span>{task.assigneeNameSnapshot}</span></div><TaskPriorityPill priority={task.priority} /></div>
      <div className={styles.mobileTaskFooter}><Deadline task={task} /><Progress task={task} /></div>
    </article>
  );
}

function BoardLane({ status, tasks, onOpen }: { status: TaskDisplayStatus; tasks: TaskRecord[]; onOpen: (id: string) => void }) {
  return (
    <section className={styles.boardLane}>
      <header className={styles.laneHead}><strong>{statusLabel(status)}</strong><span>{tasks.length}</span></header>
      <div className={styles.laneCards}>
        {tasks.map((task) => (
          <article className={styles.boardCard} key={task.id} onClick={() => onOpen(task.id)}>
            <strong>{task.title}</strong>
            <small>{task.taskNumber} · {task.assigneeNameSnapshot}</small>
            <div className={styles.boardCardFooter}><TaskPriorityPill priority={task.priority} /><small>{formatDue(task.dueAt)}</small></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EmptyState({ live, mine, compact = false }: { live: boolean; mine: boolean; compact?: boolean }) {
  return <div className={styles.emptyState} style={compact ? { padding: 24 } : undefined}><strong>{live ? 'No tasks match this view' : 'Task data is not activated yet'}</strong><span>{live ? (mine ? 'Your assigned tasks will appear here.' : 'Create a task or adjust the filters.') : 'The UI and canonical employee selection are ready. Persistence stays disabled until Task Tracker Firestore permissions are reviewed and approved.'}</span></div>;
}

function CreateTaskDrawer({
  draft,
  setDraft,
  assignees,
  busy,
  liveDataAvailable,
  onClose,
  onSubmit,
}: {
  draft: TaskDraft;
  setDraft: (draft: TaskDraft | ((current: TaskDraft) => TaskDraft)) => void;
  assignees: TaskTrackerWorkspaceState['assignees'];
  busy: boolean;
  liveDataAvailable: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <>
      <button className={styles.drawerBackdrop} type="button" aria-label="Close create task" onClick={onClose} />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Create new task">
        <header className={styles.drawerHeader}>
          <div><div className={styles.eyebrow}>Task Tracker</div><h2>Create New Task</h2><p>Assign clear work with an Aruba deadline, checklist and completion rule.</p></div>
          <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form id="task-create-form" className={styles.drawerBody} onSubmit={onSubmit}>
          <div className={styles.formGrid}>
            <div className={`${styles.field} ${styles.fieldWide}`}><label>Task title *</label><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Delta Blue Report" required /></div>
            <div className={styles.field}><label>Assign to *</label><select value={draft.assigneeStaffId} onChange={(event) => setDraft((current) => ({ ...current, assigneeStaffId: event.target.value }))} required><option value="">Choose staff member</option>{assignees.map((assignee) => <option value={assignee.staffId} key={assignee.staffId}>{assignee.name}{assignee.phone ? ` · ${assignee.phone}` : ''}</option>)}</select></div>
            <div className={styles.field}><label>Category</label><input value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Report, Follow-up, Admin..." /></div>
            <div className={styles.field}><label>Priority *</label><select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as TaskPriority }))}>{(['normal', 'important', 'urgent', 'critical'] as TaskPriority[]).map((priority) => <option value={priority} key={priority}>{priorityLabel(priority)}</option>)}</select></div>
            <div className={styles.field}><label>Deadline · Aruba time *</label><input type="datetime-local" value={draft.dueLocal} onChange={(event) => setDraft((current) => ({ ...current, dueLocal: event.target.value }))} required /></div>
            <div className={`${styles.field} ${styles.fieldWide}`}><label>Description / requirements</label><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Explain exactly what must be delivered and any quality requirements." /></div>
            <div className={`${styles.field} ${styles.fieldWide}`}><label>Completion requirement</label><select value={draft.completionRequirement} onChange={(event) => setDraft((current) => ({ ...current, completionRequirement: event.target.value as TaskRecord['completionRequirement'] }))}><option value="none">No special requirement</option><option value="checklist_required">All checklist items must be completed</option></select></div>
          </div>

          <section className={styles.formSection}>
            <div className={styles.formSectionHead}><h3>Checklist / Subtasks</h3><button className={styles.button} type="button" onClick={() => setDraft((current) => ({ ...current, checklist: [...current.checklist, ''] }))}>+ Add item</button></div>
            <div className={styles.checklistDraft}>
              {draft.checklist.map((item, index) => (
                <div className={styles.checklistDraftRow} key={`draft-${index}`}>
                  <input value={item} onChange={(event) => setDraft((current) => ({ ...current, checklist: current.checklist.map((value, itemIndex) => itemIndex === index ? event.target.value : value) }))} placeholder={`Checklist item ${index + 1}`} />
                  {draft.checklist.length > 1 ? <button className={styles.removeItem} type="button" onClick={() => setDraft((current) => ({ ...current, checklist: current.checklist.filter((_, itemIndex) => itemIndex !== index) }))} aria-label="Remove checklist item">×</button> : null}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.formSection}>
            <div className={styles.formSectionHead}><h3>Smart reminders</h3><span style={{ color: 'var(--muted)', fontSize: 9 }}>Defaults can be changed in Reminder Rules.</span></div>
            <div className={styles.reminderGrid}>
              <label className={styles.reminderOption}><input type="checkbox" checked readOnly /> Daily 8:00 AM summary</label>
              <label className={styles.reminderOption}><input type="checkbox" checked readOnly /> 24 hours before</label>
              <label className={styles.reminderOption}><input type="checkbox" checked readOnly /> 3 hours before</label>
              <label className={styles.reminderOption}><input type="checkbox" checked readOnly /> 1 hour before</label>
              <label className={styles.reminderOption}><input type="checkbox" checked readOnly /> Deadline alert</label>
              <label className={styles.reminderOption}><input type="checkbox" checked readOnly /> Overdue follow-up</label>
            </div>
          </section>

          {!liveDataAvailable ? <div className={styles.notice} style={{ marginTop: 18 }}><div><strong>Preview only</strong>Creating tasks stays disabled until the new Task Tracker collections receive approved server-side permissions.</div></div> : null}
        </form>
        <footer className={styles.drawerFooter}><button className={styles.button} type="button" onClick={onClose}>Cancel</button><button className={`${styles.button} ${styles.buttonPrimary}`} form="task-create-form" type="submit" disabled={busy || !liveDataAvailable}>{busy ? 'Creating…' : 'Create Task'}</button></footer>
      </aside>
    </>
  );
}

function TaskDetailDrawer({
  task,
  events,
  principal,
  comment,
  setComment,
  liveDataAvailable,
  busy,
  onClose,
  onAcknowledge,
  onStatus,
  onToggleChecklist,
  onRequestUpdate,
  onComment,
}: {
  task: TaskRecord;
  events: TaskTrackerWorkspaceState['events'];
  principal: ReturnType<typeof useAuth>['principal'];
  comment: string;
  setComment: (value: string) => void;
  liveDataAvailable: boolean;
  busy: boolean;
  onClose: () => void;
  onAcknowledge: () => void;
  onStatus: (status: TaskLifecycleStatus) => void;
  onToggleChecklist: (itemId: string) => void;
  onRequestUpdate: () => void;
  onComment: () => void;
}) {
  const executable = canExecuteTask(task, principal);
  const manager = principal.capabilities.has('tasks.manage');
  const progress = taskProgress(task);
  const status = effectiveTaskStatus(task);
  const commentEvents = events.filter((event) => event.type === 'comment_added');

  return (
    <>
      <button className={styles.drawerBackdrop} type="button" aria-label="Close task detail" onClick={onClose} />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`${task.taskNumber} ${task.title}`}>
        <header className={styles.drawerHeader}>
          <div><div className={styles.eyebrow}>{task.taskNumber} · {task.category || 'General'}</div><h2>{task.title}</h2><p>Created by {task.createdByName} · {formatEventTime(task.createdAt)}</p></div>
          <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.detailSummary}>
            <div className={styles.detailMetric}><span>Assigned To</span><strong>{task.assigneeNameSnapshot}</strong></div>
            <div className={styles.detailMetric}><span>Priority</span><strong>{priorityLabel(task.priority)}</strong></div>
            <div className={styles.detailMetric}><span>Status</span><strong>{statusLabel(status)}</strong></div>
          </div>
          <div className={styles.detailDescription}>{task.description || 'No additional task requirements were provided.'}</div>

          <section className={styles.detailSection}>
            <h3>Deadline &amp; Progress</h3>
            <div className={styles.detailSummary}>
              <div className={styles.detailMetric}><span>Deadline · Aruba time</span><strong>{formatDue(task.dueAt)}</strong></div>
              <div className={styles.detailMetric}><span>Progress</span><strong>{progress}%</strong></div>
              <div className={styles.detailMetric}><span>Acknowledged</span><strong>{task.acknowledgedAt ? 'Yes' : 'Not yet'}</strong></div>
            </div>
          </section>

          <section className={styles.detailSection}>
            <h3>Checklist · {task.checklist.filter((item) => item.completed).length}/{task.checklist.length}</h3>
            {task.checklist.length ? <div className={styles.checklist}>{task.checklist.map((item) => <label className={styles.checklistItem} key={item.id}><input type="checkbox" checked={item.completed} disabled={!executable || busy || !liveDataAvailable} onChange={() => onToggleChecklist(item.id)} /><span>{item.label}</span></label>)}</div> : <div className={styles.notice}><div>No checklist items are required for this task.</div></div>}
          </section>

          <section className={styles.detailSection}>
            <h3>Evidence</h3>
            <div className={styles.notice}><div><strong>{task.attachments.length} attached files</strong>Evidence metadata is part of the task contract. File upload activation will use the existing governed Firebase Storage boundary rather than a separate storage path.</div></div>
          </section>

          <section className={styles.detailSection}>
            <h3>Comments &amp; Activity</h3>
            <div className={styles.timeline}>
              {events.slice(0, 20).map((event) => <div className={styles.timelineItem} key={event.id}><span className={styles.timelineDot} /><div><strong>{event.actorName} · {titleCase(event.type)}</strong><p>{event.message || formatEventTime(event.at)}</p>{event.message ? <p>{formatEventTime(event.at)}</p> : null}</div></div>)}
              {!events.length ? <div className={styles.notice}><div>No task activity has been recorded yet.</div></div> : null}
            </div>
            {executable ? <div className={styles.commentComposer}><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add an internal task comment..." onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onComment(); } }} /><button className={styles.button} type="button" onClick={onComment} disabled={busy || !liveDataAvailable || !comment.trim()}>Post</button></div> : null}
            {commentEvents.length > 0 ? <span style={{ display: 'block', marginTop: 8, color: 'var(--muted)', fontSize: 8 }}>{commentEvents.length} comment{commentEvents.length === 1 ? '' : 's'} in activity history.</span> : null}
          </section>
        </div>
        <footer className={styles.drawerFooter}>
          <div className={styles.detailActions} style={{ width: '100%', justifyContent: 'flex-end' }}>
            {executable && !task.acknowledgedAt ? <button className={styles.button} type="button" onClick={onAcknowledge} disabled={busy || !liveDataAvailable}>Acknowledge</button> : null}
            {manager ? <button className={styles.button} type="button" onClick={onRequestUpdate} disabled={busy || !liveDataAvailable || task.status === 'completed' || task.status === 'cancelled'}>Request Update</button> : null}
            {executable && !['completed', 'cancelled'].includes(task.status) ? <select className={styles.filterSelect} value={task.status} onChange={(event) => onStatus(event.target.value as TaskLifecycleStatus)} disabled={busy || !liveDataAvailable}>{executableStatuses.map((item) => <option value={item} key={item}>{titleCase(item)}</option>)}</select> : null}
            {executable && !['completed', 'cancelled'].includes(task.status) ? <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => onStatus('completed')} disabled={busy || !liveDataAvailable}>✓ Mark Complete</button> : null}
          </div>
        </footer>
      </aside>
    </>
  );
}

function AutomationPanel({ settings, onChange, preview, canSave, busy, onSave }: {
  settings: TaskAutomationSettings;
  onChange: (settings: TaskAutomationSettings) => void;
  preview: string;
  canSave: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  const toggle = (key: keyof TaskAutomationSettings) => {
    const current = settings[key];
    if (typeof current !== 'boolean') return;
    onChange({ ...settings, [key]: !current });
  };

  return (
    <section className={styles.automationGrid}>
      <div className={styles.automationStack}>
        <AutomationCard title="Daily WhatsApp Summary" description="Send each operator one compact list of pending tasks every morning." checked={settings.dailySummaryEnabled} onToggle={() => toggle('dailySummaryEnabled')}>
          <div className={styles.field} style={{ marginTop: 12 }}><label>Send at · Aruba time</label><input type="time" value={settings.dailySummaryTime} onChange={(event) => onChange({ ...settings, dailySummaryTime: event.target.value })} /></div>
        </AutomationCard>
        <AutomationCard title="Pre-deadline Reminders" description="Escalate attention as a task approaches its exact deadline." checked={settings.twentyFourHoursBefore || settings.threeHoursBefore || settings.oneHourBefore} onToggle={() => onChange({ ...settings, twentyFourHoursBefore: !settings.twentyFourHoursBefore, threeHoursBefore: !settings.twentyFourHoursBefore, oneHourBefore: !settings.twentyFourHoursBefore })}>
          <div className={styles.reminderGrid} style={{ marginTop: 12 }}>
            <label className={styles.reminderOption}><input type="checkbox" checked={settings.twentyFourHoursBefore} onChange={() => toggle('twentyFourHoursBefore')} /> 24 hours before</label>
            <label className={styles.reminderOption}><input type="checkbox" checked={settings.threeHoursBefore} onChange={() => toggle('threeHoursBefore')} /> 3 hours before</label>
            <label className={styles.reminderOption}><input type="checkbox" checked={settings.oneHourBefore} onChange={() => toggle('oneHourBefore')} /> 1 hour before</label>
            <label className={styles.reminderOption}><input type="checkbox" checked={settings.deadlineAlert} onChange={() => toggle('deadlineAlert')} /> At deadline</label>
          </div>
        </AutomationCard>
        <AutomationCard title="Overdue Reminders & Escalation" description="Continue reminding only while the task is still open, then escalate visibly to management." checked={settings.overdueReminders} onToggle={() => toggle('overdueReminders')}>
          <div className={styles.formGrid} style={{ marginTop: 12 }}>
            <div className={styles.field}><label>Reminder interval</label><select value={settings.overdueIntervalHours} onChange={(event) => onChange({ ...settings, overdueIntervalHours: Number(event.target.value) })}><option value={6}>Every 6 hours</option><option value={12}>Every 12 hours</option><option value={24}>Every 24 hours</option></select></div>
            <div className={styles.field}><label>Escalate after</label><select value={settings.escalateAfterHours} onChange={(event) => onChange({ ...settings, escalateAfterHours: Number(event.target.value) })}><option value={12}>12 hours overdue</option><option value={24}>24 hours overdue</option><option value={48}>48 hours overdue</option></select></div>
          </div>
        </AutomationCard>
        <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" disabled={!canSave || busy} onClick={onSave}>{busy ? 'Saving…' : 'Save Reminder Rules'}</button>
        {!canSave ? <div className={styles.notice}><div><strong>Automation activation remains protected</strong>The UI and deterministic reminder policy are ready, but no production reminder worker or permission change is activated from this branch.</div></div> : null}
      </div>
      <section className={styles.panel}>
        <header className={styles.panelHead}><div><h2>WhatsApp Message Preview</h2><p>One morning digest instead of repetitive message spam.</p></div><span className={`${styles.pill} ${styles.statusCompleted}`}>8:00 AM</span></header>
        <div className={styles.panelBody}><div className={styles.previewMessage}><div className={styles.messageBubble}>{preview}</div></div></div>
      </section>
    </section>
  );
}

function AutomationCard({ title, description, checked, onToggle, children }: { title: string; description: string; checked: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return <article className={styles.automationCard}><div className={styles.automationCardTop}><div><h3>{title}</h3><p>{description}</p></div><input className={styles.toggle} type="checkbox" checked={checked} onChange={onToggle} aria-label={title} /></div>{children}</article>;
}
