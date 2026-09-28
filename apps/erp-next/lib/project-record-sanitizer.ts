import {
  BROWSER_PROJECTS_PREVIEW_KEY,
  type BrowserProject,
  type BrowserProjectsPreviewState,
} from './browser-projects';
import { loadBrowserValue, saveBrowserValue } from './browser-store';

export const KNOWN_PROJECT_SAMPLE_IDS = new Set([
  'DEMO-PRJ-VRF-001',
  'DEMO-PRJ-SVC-002',
  'DEMO-PRJ-INSTALL-003',
  'DEMO-PRJ-SVC-004',
  'DEMO-PRJ-MAINT-005',
  'DEMO-PRJ-PHASE-PLANNER-001',
]);

export const EMPTY_PROJECTS_STATE: BrowserProjectsPreviewState = {
  version: 1,
  selectedProjectId: '',
  projects: [],
};

export type SanitizedProjectsState = {
  state: BrowserProjectsPreviewState;
  removedIds: string[];
  changed: boolean;
};

export type CleanProjectsMutationOptions = {
  authorize?: () => void;
  read?: () => unknown;
  write?: (state: BrowserProjectsPreviewState) => boolean;
  runExclusive?: (operation: () => BrowserProjectsPreviewState) => Promise<BrowserProjectsPreviewState>;
};

const CLEAN_PROJECTS_WRITE_LOCK = 'demac-projects-clean-write';
const UNSAFE_PROJECTS_MESSAGE = 'Project browser data needs recovery before editing. Nothing was saved.';

function isProject(value: unknown): value is BrowserProject {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<BrowserProject>;
  return typeof project.id === 'string'
    && project.id.trim().length > 0
    && typeof project.projectNumber === 'string'
    && typeof project.name === 'string'
    && Array.isArray(project.phases)
    && Array.isArray(project.assignments);
}

export function sanitizeProjectsState(candidate: unknown): SanitizedProjectsState {
  if (!candidate || typeof candidate !== 'object') {
    return { state: EMPTY_PROJECTS_STATE, removedIds: [], changed: false };
  }
  const input = candidate as Partial<BrowserProjectsPreviewState>;
  if (input.version !== 1 || !Array.isArray(input.projects)) {
    return { state: EMPTY_PROJECTS_STATE, removedIds: [], changed: true };
  }

  const removedIds: string[] = [];
  const seen = new Set<string>();
  const projects = input.projects.filter((value): value is BrowserProject => {
    if (!isProject(value)) return false;
    if (KNOWN_PROJECT_SAMPLE_IDS.has(value.id)) {
      removedIds.push(value.id);
      return false;
    }
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
  const selectedProjectId = projects.some((project) => project.id === input.selectedProjectId)
    ? String(input.selectedProjectId)
    : projects[0]?.id ?? '';
  const state: BrowserProjectsPreviewState = { version: 1, selectedProjectId, projects };
  const changed = removedIds.length > 0
    || projects.length !== input.projects.length
    || selectedProjectId !== (input.selectedProjectId ?? '');
  return { state, removedIds, changed };
}

export function loadProjectsWithoutSamples(): SanitizedProjectsState {
  // A read must not overwrite browser-only Projects. Older or malformed records
  // may need an explicit recovery/import decision, even when hidden from this view.
  return sanitizeProjectsState(loadBrowserValue<unknown>(BROWSER_PROJECTS_PREVIEW_KEY, null));
}

export function saveProjectsWithoutSamples(state: BrowserProjectsPreviewState): boolean {
  try {
    const source = readProjectsForMutation(EMPTY_PROJECTS_STATE);
    const previous = sanitizeProjectsForMutation(source);
    const next = sanitizeProjectsForMutation(state);
    assertProjectsRetained(previous, next);
    return saveBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, preserveHiddenProjects(source, next));
  } catch {
    return false;
  }
}

function readProjectsForMutation(fallback: BrowserProjectsPreviewState): unknown {
  if (typeof window === 'undefined') return fallback;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(BROWSER_PROJECTS_PREVIEW_KEY);
  } catch {
    throw new Error(UNSAFE_PROJECTS_MESSAGE);
  }
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(UNSAFE_PROJECTS_MESSAGE);
  }
}

function sanitizeProjectsForMutation(candidate: unknown): BrowserProjectsPreviewState {
  const result = sanitizeProjectsState(candidate);
  if (!candidate || typeof candidate !== 'object') throw new Error(UNSAFE_PROJECTS_MESSAGE);
  const input = candidate as Partial<BrowserProjectsPreviewState>;
  if (input.version !== 1 || !Array.isArray(input.projects)
    || result.state.projects.length + result.removedIds.length !== input.projects.length) {
    throw new Error(UNSAFE_PROJECTS_MESSAGE);
  }
  return result.state;
}

function assertProjectsRetained(previous: BrowserProjectsPreviewState, next: BrowserProjectsPreviewState): void {
  const nextIds = new Set(next.projects.map(project => project.id));
  if (previous.projects.some(project => !nextIds.has(project.id))) throw new Error(UNSAFE_PROJECTS_MESSAGE);
}

function preserveHiddenProjects(source: unknown, next: BrowserProjectsPreviewState): BrowserProjectsPreviewState {
  const original = source as BrowserProjectsPreviewState;
  const updates = new Map(next.projects.map(project => [project.id, project]));
  const projects = original.projects.map(project => {
    const updated = updates.get(project.id);
    if (updated) {
      updates.delete(project.id);
      return updated;
    }
    // Known sample IDs may now contain user work. Hiding them in the UI is not
    // authorization to remove their original records from browser storage.
    if (KNOWN_PROJECT_SAMPLE_IDS.has(project.id)) return project;
    throw new Error(UNSAFE_PROJECTS_MESSAGE);
  });
  projects.push(...updates.values());
  return { ...next, projects };
}

export async function commitProjectsWithoutSamples(
  fallback: BrowserProjectsPreviewState,
  mutation: (latest: BrowserProjectsPreviewState) => BrowserProjectsPreviewState,
  options: CleanProjectsMutationOptions = {},
): Promise<BrowserProjectsPreviewState> {
  const operation = () => {
    options.authorize?.();
    const source = options.read ? options.read() : readProjectsForMutation(fallback);
    const latest = sanitizeProjectsForMutation(source);
    const next = sanitizeProjectsForMutation(mutation(latest));
    assertProjectsRetained(latest, next);
    const persisted = preserveHiddenProjects(source, next);
    const saved = options.write ? options.write(persisted) : saveBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, persisted);
    if (!saved) throw new Error('Project changes could not be saved in this browser. Nothing was committed.');
    return next;
  };

  if (options.runExclusive) return options.runExclusive(operation);
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(CLEAN_PROJECTS_WRITE_LOCK, operation);
  }
  return operation();
}
