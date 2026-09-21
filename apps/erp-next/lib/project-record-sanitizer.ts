import {
  BROWSER_PROJECTS_PREVIEW_KEY,
  BROWSER_PROJECTS_PREVIEW_WRITE_LOCK,
  isStoredBrowserProject,
  readOriginalBrowserProjects,
  PROJECT_STORAGE_RECOVERY_MESSAGE,
  type BrowserProject,
  type BrowserProjectsPreviewState,
} from './browser-projects';
import { saveBrowserValue } from './browser-store';

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
  recoveryRequired: boolean;
  sourceError?: string;
};

export type CleanProjectsMutationOptions = {
  authorize?: () => void;
  read?: () => unknown;
  write?: (state: BrowserProjectsPreviewState) => boolean;
  runExclusive?: (operation: () => BrowserProjectsPreviewState) => Promise<BrowserProjectsPreviewState>;
};

export function sanitizeProjectsState(candidate: unknown): SanitizedProjectsState {
  if (!candidate || typeof candidate !== 'object') {
    return { state: EMPTY_PROJECTS_STATE, removedIds: [], changed: false, recoveryRequired: candidate != null };
  }
  const input = candidate as Partial<BrowserProjectsPreviewState>;
  if (input.version !== 1 || !Array.isArray(input.projects)) {
    return { state: EMPTY_PROJECTS_STATE, removedIds: [], changed: true, recoveryRequired: true };
  }

  const removedIds: string[] = [];
  const seen = new Set<string>();
  const projects = input.projects.filter((value): value is BrowserProject => {
    if (!isStoredBrowserProject(value)) return false;
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
  // Preserve unknown top-level fields instead of silently dropping recovery evidence.
  const state: BrowserProjectsPreviewState = { ...input, version: 1, selectedProjectId, projects };
  const changed = removedIds.length > 0
    || projects.length !== input.projects.length
    || selectedProjectId !== (input.selectedProjectId ?? '');
  return { state, removedIds, changed, recoveryRequired: projects.length !== input.projects.length };
}

export function loadProjectsWithoutSamples(): SanitizedProjectsState {
  // Filtering is a display projection only. A historical sample ID is not proof
  // that its current payload contains no user changes or approved manual costs.
  try { return sanitizeProjectsState(readOriginalBrowserProjects(null)); }
  catch { return { state: EMPTY_PROJECTS_STATE, removedIds: [], changed: false, recoveryRequired: true, sourceError: 'Browser Projects could not be read. This is not an empty project list.' }; }
}

export function saveProjectsWithoutSamples(state: BrowserProjectsPreviewState): boolean {
  try {
    const original = sanitizeProjectsState(readOriginalBrowserProjects(null));
    const next = sanitizeProjectsState(state);
    if (original.recoveryRequired || next.recoveryRequired) return false;
    // Selection persistence may not replace a concurrently changed browser list.
    return saveBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, { ...original.state, selectedProjectId: state.selectedProjectId });
  } catch { return false; }
}

export async function commitProjectsWithoutSamples(
  fallback: BrowserProjectsPreviewState,
  mutation: (latest: BrowserProjectsPreviewState) => BrowserProjectsPreviewState,
  options: CleanProjectsMutationOptions = {},
): Promise<BrowserProjectsPreviewState> {
  const operation = () => {
    options.authorize?.();
    let source: unknown;
    try { source = options.read ? options.read() : readOriginalBrowserProjects(fallback); }
    catch { throw new Error(PROJECT_STORAGE_RECOVERY_MESSAGE); }
    const original = sanitizeProjectsState(source);
    if (original.recoveryRequired) throw new Error(PROJECT_STORAGE_RECOVERY_MESSAGE);
    const proposed = sanitizeProjectsState(mutation(original.state));
    if (proposed.recoveryRequired) throw new Error(PROJECT_STORAGE_RECOVERY_MESSAGE);
    const next = proposed.state;
    const saved = options.write ? options.write(next) : saveBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, next);
    if (!saved) throw new Error('Project changes could not be verified in this browser. Review the stored original before retrying.');
    return next;
  };

  if (options.runExclusive) return options.runExclusive(operation);
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(BROWSER_PROJECTS_PREVIEW_WRITE_LOCK, operation);
  }
  return operation();
}
