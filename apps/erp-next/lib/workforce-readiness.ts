import type { BrowserWorkOrderRecord } from './browser-operational';
import type { WorkPresetId } from './scheduling';

export const workforceSkills = ['Service', 'Deep Cleaning', 'Diagnostics', 'Installation', 'Commercial'] as const;
export type WorkforceSkill = (typeof workforceSkills)[number];

export type WorkforceEmployee = {
  id: string;
  name: string;
  role: string;
  vanId: string;
  active: boolean;
  skills: WorkforceSkill[];
  skillsVerified: boolean;
  source: 'canonical_firestore' | 'preview_seed' | 'operator';
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

export function normalizeWorkforceSkills(skills: string[] = []): WorkforceSkill[] {
  return workforceSkills.filter((skill) => skills.some((value) => value.toLowerCase() === skill.toLowerCase()));
}

export function requiredSkillForPreset(presetId: WorkPresetId) {
  return requiredSkillByPreset[presetId];
}

export function deriveCrewSkillReadiness(order: BrowserWorkOrderRecord, roster: WorkforceEmployee[]): CrewSkillReadiness {
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
      blockers.push(`${vanId} has no active crew registered for this work date.`);
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

  if (blockers.length) return { status: 'blocked', reason: blockers.join(' '), source: 'Canonical Workforce Registry', requiredSkill, assignedVanIds };
  if (risks.length) return { status: 'at_risk', reason: risks.join(' '), source: 'Canonical Workforce Registry', requiredSkill, assignedVanIds };
  return { status: 'ready', reason: readyEvidence.join(' '), source: 'Canonical Workforce Registry', requiredSkill, assignedVanIds };
}
