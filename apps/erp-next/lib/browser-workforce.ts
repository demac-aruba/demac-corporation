import { employees } from './management-operations';
import { loadBrowserValue, saveBrowserValue } from './browser-store';
import {
  deriveCrewSkillReadiness as deriveCrewSkillReadinessFromRoster,
  normalizeWorkforceSkills,
  requiredSkillForPreset,
  workforceSkills,
  type CrewSkillReadiness,
  type WorkforceEmployee,
  type WorkforceSkill,
} from './workforce-readiness';
import type { BrowserWorkOrderRecord } from './browser-operational';

export const BROWSER_WORKFORCE_KEY = 'demac.erp-next.workforce.registry.v1';

export { workforceSkills, requiredSkillForPreset };
export type { CrewSkillReadiness, WorkforceSkill };
export type BrowserWorkforceEmployee = WorkforceEmployee;

function employeeId(name: string) {
  return `EMP-${name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function vanIdFromTeam(team: string) {
  const match = team.match(/Van\s*(\d+)/i);
  return match ? `VAN-${match[1]}` : 'UNASSIGNED';
}

export function previewWorkforceSeed(): BrowserWorkforceEmployee[] {
  return employees.map((employee) => ({
    id: employeeId(employee.name),
    name: employee.name,
    role: employee.role,
    vanId: vanIdFromTeam(employee.team),
    active: employee.status === 'Working' || employee.status === 'Support',
    skills: normalizeWorkforceSkills(employee.skills),
    skillsVerified: false,
    source: 'preview_seed' as const,
    updatedAt: new Date(0).toISOString(),
  }));
}

export function loadBrowserWorkforce() {
  return loadBrowserValue<BrowserWorkforceEmployee[]>(BROWSER_WORKFORCE_KEY, previewWorkforceSeed());
}

export function saveBrowserWorkforce(roster: BrowserWorkforceEmployee[]) {
  const now = new Date().toISOString();
  const normalized = roster.map((employee) => ({ ...employee, updatedAt: now, source: 'operator' as const }));
  saveBrowserValue(BROWSER_WORKFORCE_KEY, normalized);
  return normalized;
}

/**
 * Preview compatibility wrapper only. Operational readiness should pass an explicit
 * canonical roster from Firestore instead of relying on this browser fallback.
 */
export function deriveCrewSkillReadiness(order: BrowserWorkOrderRecord, roster = loadBrowserWorkforce()): CrewSkillReadiness {
  return deriveCrewSkillReadinessFromRoster(order, roster);
}
