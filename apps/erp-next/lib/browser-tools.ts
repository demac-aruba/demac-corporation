import type { BrowserWorkOrderRecord } from './browser-operational';
import type { WorkPresetId } from './scheduling';
import { loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_TOOL_ASSETS_KEY = 'demac.erp-next.assets.tools.v1';
export const BROWSER_TOOL_REQUIREMENTS_KEY = 'demac.erp-next.assets.tool-requirements.v1';

export const toolClasses = [
  'Vacuum Pump',
  'Manifold / Gauge Set',
  'Micron Gauge',
  'Recovery Machine',
  'Drill / Driver',
  'Service Toolkit',
] as const;
export type ToolClass = (typeof toolClasses)[number];
export type ToolCoverageMode = 'per_assigned_van' | 'shared_across_job';

export type BrowserToolAsset = {
  id: string;
  name: string;
  toolClass: ToolClass;
  locationId: 'OFFICE' | 'VAN-1' | 'VAN-2' | 'VAN-3' | 'VAN-4' | 'UNASSIGNED';
  status: 'available' | 'checked_out' | 'maintenance' | 'calibration_due' | 'lost';
  verified: boolean;
  serialOrQr?: string;
  calibrationDueAt?: string;
  updatedAt: string;
};

export type BrowserToolRequirementPolicy = {
  presetId: WorkPresetId;
  requiredClasses: ToolClass[];
  coverageMode: ToolCoverageMode;
  reviewed: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type RequiredToolsReadiness = {
  status: 'ready' | 'at_risk' | 'blocked';
  reason: string;
  source: string;
  requiredClasses: ToolClass[];
  assignedVanIds: string[];
};

export function loadBrowserToolAssets() {
  return loadBrowserValue<BrowserToolAsset[]>(BROWSER_TOOL_ASSETS_KEY, []);
}

export function saveBrowserToolAssets(assets: BrowserToolAsset[]) {
  const now = new Date().toISOString();
  const next = assets.map((asset) => ({ ...asset, updatedAt: now }));
  saveBrowserValue(BROWSER_TOOL_ASSETS_KEY, next);
  return next;
}

export function loadToolRequirementPolicies() {
  return loadBrowserValue<BrowserToolRequirementPolicy[]>(BROWSER_TOOL_REQUIREMENTS_KEY, []).map((policy) => ({ ...policy, coverageMode: policy.coverageMode ?? 'per_assigned_van' }));
}

export function saveToolRequirementPolicies(policies: BrowserToolRequirementPolicy[]) {
  const now = new Date().toISOString();
  const next = policies.map((policy) => ({ ...policy, updatedAt: now, updatedBy: 'Operations / Preview' }));
  saveBrowserValue(BROWSER_TOOL_REQUIREMENTS_KEY, next);
  return next;
}

function toolIsUsable(asset: BrowserToolAsset) {
  if (!asset.verified || asset.status !== 'available') return false;
  if (!asset.calibrationDueAt) return true;
  const due = new Date(asset.calibrationDueAt).getTime();
  return Number.isNaN(due) || due >= Date.now();
}

function deriveSharedJobCoverage(requiredClasses: ToolClass[], assignedVanIds: string[], assets: BrowserToolAsset[]) {
  const risks: string[] = [];
  const blockers: string[] = [];
  const readyEvidence: string[] = [];
  for (const requiredClass of requiredClasses) {
    const matching = assets.filter((asset) => assignedVanIds.includes(asset.locationId) && asset.toolClass === requiredClass);
    const usable = matching.find(toolIsUsable);
    if (usable) {
      readyEvidence.push(`${requiredClass} (${usable.id}) is verified and available on ${usable.locationId} for shared job use.`);
      continue;
    }
    if (!matching.length) {
      blockers.push(`No assigned van has ${requiredClass} registered for shared job use.`);
      continue;
    }
    if (matching.some((asset) => !asset.verified)) {
      risks.push(`${requiredClass} exists on an assigned van, but asset verification is incomplete.`);
      continue;
    }
    blockers.push(`No usable ${requiredClass} is available across assigned vans; ${matching.map((asset) => `${asset.id} ${asset.status.replaceAll('_', ' ')}`).join(', ')}.`);
  }
  return { risks, blockers, readyEvidence };
}

function derivePerVanCoverage(requiredClasses: ToolClass[], assignedVanIds: string[], assets: BrowserToolAsset[]) {
  const risks: string[] = [];
  const blockers: string[] = [];
  const readyEvidence: string[] = [];
  for (const vanId of assignedVanIds) {
    for (const requiredClass of requiredClasses) {
      const matching = assets.filter((asset) => asset.locationId === vanId && asset.toolClass === requiredClass);
      const usable = matching.find(toolIsUsable);
      if (usable) {
        readyEvidence.push(`${vanId}: ${requiredClass} (${usable.id}) available and verified.`);
        continue;
      }
      if (!matching.length) {
        blockers.push(`${vanId} has no ${requiredClass} registered.`);
        continue;
      }
      if (matching.some((asset) => !asset.verified)) {
        risks.push(`${vanId} has ${requiredClass}, but asset verification is incomplete.`);
        continue;
      }
      blockers.push(`${vanId} has no usable ${requiredClass}; ${matching.map((asset) => `${asset.id} ${asset.status.replaceAll('_', ' ')}`).join(', ')}.`);
    }
  }
  return { risks, blockers, readyEvidence };
}

export function deriveRequiredToolsReadiness(order: BrowserWorkOrderRecord, options?: {
  assets?: BrowserToolAsset[];
  policies?: BrowserToolRequirementPolicy[];
}): RequiredToolsReadiness {
  const assets = options?.assets ?? loadBrowserToolAssets();
  const policies = options?.policies ?? loadToolRequirementPolicies();
  const policy = policies.find((item) => item.presetId === order.presetId);
  const assignedVanIds = Array.from(new Set(order.assignments.map((assignment) => assignment.vanId).filter(Boolean)));

  if (!policy || !policy.reviewed) {
    return { status: 'at_risk', reason: `Required-tool policy has not been reviewed for ${order.presetId.replaceAll('_', ' ')}.`, source: 'Tool Requirement Policy', requiredClasses: policy?.requiredClasses ?? [], assignedVanIds };
  }

  if (!policy.requiredClasses.length) {
    return { status: 'ready', reason: 'Tool Requirement Policy explicitly confirms no tracked company tool is required for this Work Order type.', source: `Tool Requirement Policy · ${policy.updatedBy}`, requiredClasses: [], assignedVanIds };
  }

  if (!assignedVanIds.length) {
    return { status: 'blocked', reason: 'No assigned van exists, so required tool custody cannot be resolved.', source: 'Work Order assignments + Tool Asset Registry', requiredClasses: policy.requiredClasses, assignedVanIds };
  }

  const result = policy.coverageMode === 'shared_across_job'
    ? deriveSharedJobCoverage(policy.requiredClasses, assignedVanIds, assets)
    : derivePerVanCoverage(policy.requiredClasses, assignedVanIds, assets);

  const source = `Verified Tool Asset Registry · ${policy.coverageMode === 'shared_across_job' ? 'shared across job' : 'per assigned van'}`;
  if (result.blockers.length) return { status: 'blocked', reason: result.blockers.join(' '), source, requiredClasses: policy.requiredClasses, assignedVanIds };
  if (result.risks.length) return { status: 'at_risk', reason: result.risks.join(' '), source, requiredClasses: policy.requiredClasses, assignedVanIds };
  return { status: 'ready', reason: result.readyEvidence.join(' '), source, requiredClasses: policy.requiredClasses, assignedVanIds };
}
