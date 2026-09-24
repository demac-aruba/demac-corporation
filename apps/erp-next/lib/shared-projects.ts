import type { BrowserProject, BrowserProjectsPreviewState } from './browser-projects';
import { loadProjectsWithoutSamples, commitProjectsWithoutSamples } from './project-record-sanitizer';
import { firebaseClientConfig } from './firebase/client-config';
import { firebaseTransportUrl } from './firebase/isolated-preview';
import { requireFirebaseWebSession } from './firebase/session';

export const PROJECTS_CHANGED_EVENT = 'demac-shared-projects-changed';
export async function projectApi<T>(action: string, data: Record<string, unknown>, uid: string): Promise<T> {
  const session = await requireFirebaseWebSession();
  if (session.uid !== uid) throw new Error('Your session changed. Reload Projects.');
  const response = await fetch(firebaseTransportUrl(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/projectAuthority`), {
    method: 'POST', headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data }), signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) throw new Error(payload.error?.message || 'Projects could not verify this request.');
  if ((await requireFirebaseWebSession()).uid !== uid) throw new Error('Your session changed. Reload Projects.');
  return payload as T;
}
const pendingLists = new Map<string, Promise<BrowserProject[]>>();
export async function loadSharedProjects(uid: string, includeBrowserRecords = true): Promise<BrowserProjectsPreviewState> {
  let pending = pendingLists.get(uid);
  if (!pending) {
    pending = projectApi<{ projects: BrowserProject[] }>('list', {}, uid).then(result => result.projects);
    pendingLists.set(uid, pending);
    void pending.finally(() => { if (pendingLists.get(uid) === pending) pendingLists.delete(uid); }).catch(() => {});
  }
  const shared = await pending;
  const local = includeBrowserRecords ? loadProjectsWithoutSamples().state : { version: 1 as const, selectedProjectId: '', projects: [] };
  const ids = new Set(shared.map(project => project.id));
  return { ...local, projects: [...shared, ...local.projects.filter(project => !ids.has(project.id) && !project.serverVersion)] };
}
async function saveRequestId(project: BrowserProject, expectedVersion: number) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ project, expectedVersion })));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}
export async function saveSharedProject(project: BrowserProject, uid: string, dryRun = false) {
  const expectedVersion = project.serverVersion || 0;
  const requestId = await saveRequestId(project, expectedVersion);
  const result = await projectApi<{ project: BrowserProject }>('save', { project, expectedVersion, requestId, dryRun }, uid);
  if (!dryRun) window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  return result.project;
}

export type HistoricalProjectCapacitySource = {
  appointmentId: string;
  workOrderId: string;
  date: string;
  vanId: string;
  vanName: string;
  technicianIds: string[];
  technicianNames: string[];
  start: string;
  currentSlots: number;
  eligible: boolean;
  reason?: string;
};

export type HistoricalProjectCapacitySources = {
  success: true;
  project: BrowserProject;
  budgetSlots: number;
  usedSlots: number;
  sources: HistoricalProjectCapacitySource[];
};

export function loadHistoricalProjectCapacitySources(projectId: string, uid: string) {
  return projectApi<HistoricalProjectCapacitySources>('history_capacity_sources', { projectId }, uid);
}

export type AdjustHistoricalProjectCapacityInput = {
  projectId: string;
  appointmentId: string;
  expectedVersion: number;
  slots: number;
  reason: string;
  requestId: string;
  overBudgetAcknowledged: boolean;
  noBillingAcknowledged: boolean;
};

export type AdjustHistoricalProjectCapacityResult = {
  success: true;
  replayed: boolean;
  project: BrowserProject;
  appointmentId: string;
  workOrderId: string;
  previousSlots: number | null;
  currentSlots: number | null;
  replayedEntry?: { previousSlots: number; currentSlots: number };
  budgetSlots: number;
  usedBefore: number;
  usedAfter: number;
  overBudget: number;
};

export async function adjustHistoricalProjectCapacity(input: AdjustHistoricalProjectCapacityInput, uid: string) {
  const result = await projectApi<AdjustHistoricalProjectCapacityResult>('history_adjust_capacity', input, uid);
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  return result;
}

export async function commitSharedProjects(
  fallback: BrowserProjectsPreviewState,
  mutation: (latest: BrowserProjectsPreviewState) => BrowserProjectsPreviewState,
  options: { uid: string; authorize?: () => void },
) {
  options.authorize?.();
  const latest = await loadSharedProjects(options.uid);
  options.authorize?.();
  const next = mutation(latest);
  const changed = next.projects.filter(project => JSON.stringify(project) !== JSON.stringify(latest.projects.find(item => item.id === project.id)));
  if (!changed.length && next.projects.length === latest.projects.length) return latest;
  if (changed.length !== 1 || next.projects.length < latest.projects.length) throw new Error('Save one Project change at a time.');
  const project = changed[0];
  const previous = latest.projects.find(item => item.id === project.id);
  if (previous && !previous.serverVersion) {
    await commitProjectsWithoutSamples(loadProjectsWithoutSamples().state, local => ({ ...local,
      projects: local.projects.map(item => item.id === project.id ? project : item) }), { authorize: options.authorize });
  } else {
    const displayed = fallback.projects.find(item => item.id === project.id);
    if (previous && displayed?.serverVersion !== previous.serverVersion) throw new Error('Project changed in another session. Reload before saving.');
    options.authorize?.();
    const saved = await saveSharedProject(project, options.uid);
    next.projects = next.projects.map(item => item.id === saved.id ? saved : item);
  }
  return next;
}
