// DTOs for the existing registry service. Operational quantities are read-only evidence.
export type ProjectPhasePlan = {
  id: string; name: string; scopeOfWork: string; completionCriteria: string;
  plannedVanMinutes: number; dependencies: string[];
  progressMethod: 'units' | 'checklist' | 'hours' | 'approval'; unitsPlanned: number;
  checklist: Array<{ id: string; label: string; required?: boolean }>;
  details?: Record<string, unknown>;
};
export type CentralProject = {
  id: string; projectNumber: string; schemaVersion: 1; version: number;
  name: string; type: string; customerId: string; propertyId: string;
  description: string; technicianInstructions: string; startsOn: string; estimatedCompletionOn: string;
  planningStatus: string; phases: ProjectPhasePlan[]; details?: Record<string, unknown>;
  budget: { unit: 'van_minutes'; originalMinutes: number; currentMinutes: number; revision: number };
  migration?: { status: string; importId: string; sourceDigest: string; capturedBaselineOnly: boolean; sourceDeclaredStatus: string };
  updatedAt: string;
};
export type ProjectActivity = {
  projectId: string; projectVersion: number; source: string; nextCursor: string | null;
  coverage: { pageIsValid: boolean; allProjectLinksIncluded: boolean; linkedAppointmentsOnPage: number };
  rows: Array<{
    workOrderId: string; appointmentId: string; phaseId: string | null; vanId: string | null;
    date: string | null; start: string | null; status: string; cancelled: boolean; temporaryHold: boolean;
    plannedVanMinutes: number | null; scheduledSlots: number | null;
    visits: Array<{ id: string; status: string; startedAt: string | null; completedAt: string | null; source: string }>;
    review: { status: string; source: string; revisionId: string; reviewedAt: string | null } | null;
    source: string;
  }>;
  issues: Array<{ code: string; workOrderId?: string; appointmentId?: string }>;
  pageTotals: { plannedVanMinutes: number | null; scheduledSlots: number | null; visits: number; approvedWorkOrders: number };
  projectForecast: { unit: 'van_minutes'; budgetMinutes: number; plannedMinutes: number; remainingMinutes: number; overBudgetMinutes: number; blocksBooking: false } | null;
  actualLabor: { personMinutes: number | null; vanMinutes: number | null; status: string };
  physicalProgress: { percent: number | null; status: string };
};
export type ProjectList = { source: 'project_registry_v1'; writeMode?: 'enabled' | 'paused'; projects: CentralProject[]; nextCursor: string | null };
export type MutationResult = { success: true; projectId: string; version: number; changed: boolean; replayed: boolean };
export type ImportPreview = {
  mode: 'dry_run'; writesPerformed: 0; projectId: string; projectNumber: string;
  plan: { name: string; customerId: string; propertyId: string; budgetedVanMinutes: number; phases: ProjectPhasePlan[] };
  warnings: string[]; conflicts: string[]; canImport: boolean; previewHash: string;
  retainedCounts: Record<string, number>; sourceDeclaredStatus: string;
};
export type RegistryCommand = { action: string; data: Record<string, unknown>; requestId?: string };
