import { employees } from './management-operations';
import type { BrowserWorkOrderRecord } from './browser-operational';
import type { WorkPresetId } from './scheduling';
import { loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_WORKFORCE_KEY = 'demac.erp-next.workforce.registry.v1';

export const workforceSkills = ['Service', 'Deep Cleaning', 'Diagnostics', 'Installation', 'Commercial'] as const;
export type WorkforceSkill = (typeof workforceSkills)[number];

export type BrowserWorkforceEmployee = {
  id: string;
  name: string;
  role: string;
  vanId: string;
  active: boolean;
  skills: WorkforceSkill[];
  skillsVerified: boolean;
  source: 'preview_seed' | 'operator';
  updatedAt: string;
};

export type CrewSkillReadiness = {
  status: 'ready' | 'at_risk' | 'blocked';
  reason: string;
  source: string;
  requiredSkill?: WorkforceSkill;
  assignedVanIds: string[];
};

const requiredSkillByPreset: Partial<Record<WorkPresetId, WorkforceSkill>> = {
  standard_service: 'Service',
  deep_cleaning: 'Deep Cleaning',
  diagnostic: 'Diagnostics',
  repair: 'Diagnostics',
  installation_standard: 'Installation',
  installation_extended: 'Installation',
  installation_rooftop: 'Installation',
  installation_second_floor: 'Installation',
  installation_third_floor: 'Installation',
  anti_corrosive: 'Service',
};

function employeeId(name: string) {
  return `EMP-${name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function vanIdFromTeam(team: string) {
  const match = team.match(/Van\s*(\d+)/i);
  return match ? `VAN-${match[1]}` : 'UNASSIGNED';
}

function normalizeSkills(skills: string[]): WorkforceSkill[] {
  return workforceSkills.filter((skill) => skills.some((value) => value.toLowerCase() === skill.toLowerCase()));
}

export function previewWorkforceSeed(): BrowserWorkforceEmployee[] {
  return employees.map((employee) => ({
    id: employeeId(employee.name),
    name: employee.name,
    role: employee.role,
    vanId: vanIdFromTeam(employee.team),
    active: employee.status === 'Working' || employee.status === 'Support',
    skills: normalizeSkills(employee.skills),
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

export function requiredSkillForPreset(presetId: WorkPresetId) {
  return requiredSkillByPreset[presetId];
}

export function deriveCrewSkillReadiness(order: BrowserWorkOrderRecord, roster = loadBrowserWorkforce()): CrewSkillReadiness {
  const assignedVanIds = Array.from(new Set(order.assignments.map((assignment) => assignment.vanId).filter(Boolean)));
  const requiredSkill = requiredSkillForPreset(order.presetId);

  if (!assignedVanIds.length) {
    return { status: 'blocked', reason: 'No assigned van exists, so no field crew can be resolved.', source: 'Work Order assignments + Workforce Registry', requiredSkill, assignedVanIds };
  }

  if (!requiredSkill) {
    return { status: 'at_risk', reason: `No required workforce skill is configured yet for ${order.presetId.replaceAll('_', ' ')}.`, source: 'Workforce skill policy', assignedVanIds };
  }

  const blockers: string[] = [];
  const risks: string[] = [];
  const readyEvidence: string[] = [];

  for (const vanId of assignedVanIds) {
    const crew = roster.filter((employee) => employee.active && employee.vanId === vanId);
    if (!crew.length) {
      blockers.push(`${vanId} has no active crew registered.`);
      continue;
    }

    const qualifiedVerified = crew.filter((employee) => employee.skillsVerified && employee.skills.includes(requiredSkill));
    if (qualifiedVerified.length) {
      readyEvidence.push(`${vanId}: ${qualifiedVerified.map((employee) => employee.name).join(', ')} verified for ${requiredSkill}.`);
      continue;
    }

    const unverified = crew.filter((employee) => !employee.skillsVerified);
    if (unverified.length) {
      risks.push(`${vanId} has crew assigned, but ${requiredSkill} coverage is not fully verified (${unverified.map((employee) => employee.name).join(', ')}).`);
      continue;
    }

    blockers.push(`${vanId} has a verified crew roster but nobody is verified for ${requiredSkill}.`);
  }

  if (blockers.length) return { status: 'blocked', reason: blockers.join(' '), source: 'Verified Workforce Registry', requiredSkill, assignedVanIds };
  if (risks.length) return { status: 'at_risk', reason: risks.join(' '), source: 'Unverified Workforce Registry', requiredSkill, assignedVanIds };
  return { status: 'ready', reason: readyEvidence.join(' '), source: 'Verified Workforce Registry', requiredSkill, assignedVanIds };
}
