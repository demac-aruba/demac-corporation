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
  const result = sanitizeProjectsState(loadBrowserValue<unknown>(BROWSER_PROJECTS_PREVIEW_KEY, null));
  if (result.changed) saveBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, result.state);
  return result;
}

export function saveProjectsWithoutSamples(state: BrowserProjectsPreviewState): boolean {
  return saveBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, sanitizeProjectsState(state).state);
}

export async function commitProjectsWithoutSamples(
  fallback: BrowserProjectsPreviewState,
  mutation: (latest: BrowserProjectsPreviewState) => BrowserProjectsPreviewState,
  options: CleanProjectsMutationOptions = {},
): Promise<BrowserProjectsPreviewState> {
  const operation = () => {
    options.authorize?.();
    const source = options.read ? options.read() : loadBrowserValue<unknown>(BROWSER_PROJECTS_PREVIEW_KEY, fallback);
    const latest = sanitizeProjectsState(source).state;
    const next = sanitizeProjectsState(mutation(latest)).state;
    const saved = options.write ? options.write(next) : saveBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, next);
    if (!saved) throw new Error('Project changes could not be saved in this browser. Nothing was committed.');
    return next;
  };

  if (options.runExclusive) return options.runExclusive(operation);
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(CLEAN_PROJECTS_WRITE_LOCK, operation);
  }
  return operation();
}
