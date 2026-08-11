import type { BrowserCrmAssetIdentity } from './browser-crm';
import { loadBrowserCustomerMaster } from './browser-crm';
import type { BrowserWorkOrderRecord } from './browser-operational';

export type FieldEquipmentProgress = {
  assetId: string;
  name: string;
  type: string;
  capacity?: string;
  serial?: string;
  status: 'pending' | 'in_progress' | 'complete';
  beforePhoto: boolean;
  afterPhoto: boolean;
  gaugePhoto: boolean;
  refrigerantState: 'not_checked' | 'normal' | 'low' | 'recovered' | 'recharged';
  measurement?: string;
  note?: string;
};

export type FieldAddonState = {
  switches: number;
  brackets: number;
  armaflex: number;
  refrigerantLb: number;
};

export type BrowserFieldExecutionRecord = {
  workOrderId: string;
  appointmentId: string;
  customerId?: string;
  siteId?: string;
  technicianStatus: 'not_started' | 'in_progress' | 'submitted';
  startedAt?: string;
  submittedAt?: string;
  updatedAt: string;
  equipment: FieldEquipmentProgress[];
  addons: FieldAddonState;
  voiceSeconds: number;
  voiceTranscriptionStatus: 'none' | 'queued' | 'transcribed';
  technicianSummary: string;
};

export type BrowserOfficeReviewRecord = {
  id: string;
  workOrderId: string;
  appointmentId: string;
  customer: string;
  site: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'returned';
  language: 'English' | 'Spanish' | 'Papiamento';
  technicianSummary: string;
  professionalSummary: string;
  reviewerNote?: string;
  reviewedAt?: string;
};

function genericAssets(order: BrowserWorkOrderRecord): BrowserCrmAssetIdentity[] {
  return Array.from({ length: Math.max(1, order.totalQuantity) }, (_, index) => ({
    id: `${order.id}-UNIT-${index + 1}`,
    site: order.site,
    type: 'HVAC Equipment',
    name: `Service Unit ${index + 1}`,
    status: 'Unregistered',
  }));
}

export function equipmentForWorkOrder(order: BrowserWorkOrderRecord): FieldEquipmentProgress[] {
  const master = order.customerId ? loadBrowserCustomerMaster(order.customerId) : { assets: [] };
  const siteAssets = (master.assets ?? []).filter((asset) => !order.site || asset.site === order.site);
  const source = siteAssets.length ? siteAssets.slice(0, Math.max(order.totalQuantity, siteAssets.length)) : genericAssets(order);
  return source.map((asset) => ({
    assetId: asset.id,
    name: asset.name,
    type: asset.type,
    capacity: asset.capacity,
    serial: asset.serial,
    status: 'pending',
    beforePhoto: false,
    afterPhoto: false,
    gaugePhoto: false,
    refrigerantState: 'not_checked',
  }));
}

export function createFieldExecution(order: BrowserWorkOrderRecord): BrowserFieldExecutionRecord {
  return {
    workOrderId: order.id,
    appointmentId: order.appointmentId,
    customerId: order.customerId,
    siteId: order.siteId,
    technicianStatus: 'not_started',
    updatedAt: new Date().toISOString(),
    equipment: equipmentForWorkOrder(order),
    addons: { switches: 0, brackets: 0, armaflex: 0, refrigerantLb: 0 },
    voiceSeconds: 0,
    voiceTranscriptionStatus: 'none',
    technicianSummary: '',
  };
}

export function canSubmitFieldExecution(record: BrowserFieldExecutionRecord) {
  const incomplete = record.equipment.filter((item) => item.status !== 'complete');
  const missingEvidence = record.equipment.filter((item) => item.status === 'complete' && (!item.beforePhoto || !item.afterPhoto));
  const voiceTooLong = record.voiceSeconds > 120;
  return {
    allowed: incomplete.length === 0 && missingEvidence.length === 0 && !voiceTooLong,
    blockers: [
      ...(incomplete.length ? [`${incomplete.length} equipment record(s) are not complete.`] : []),
      ...(missingEvidence.length ? [`${missingEvidence.length} completed equipment record(s) are missing before/after evidence.`] : []),
      ...(voiceTooLong ? ['Voice note exceeds the 2-minute limit.'] : []),
    ],
  };
}

export function createOfficeReview(order: BrowserWorkOrderRecord, execution: BrowserFieldExecutionRecord): BrowserOfficeReviewRecord {
  const workCompleted = execution.equipment.length;
  const addonParts: string[] = [];
  if (execution.addons.switches) addonParts.push(`${execution.addons.switches} switch(es)`);
  if (execution.addons.brackets) addonParts.push(`${execution.addons.brackets} bracket(s)`);
  if (execution.addons.armaflex) addonParts.push(`${execution.addons.armaflex} armaflex item(s)`);
  if (execution.addons.refrigerantLb) addonParts.push(`${execution.addons.refrigerantLb} lb refrigerant`);
  const technicianSummary = execution.technicianSummary.trim() || `${workCompleted} HVAC equipment record(s) completed according to the assigned work order.`;
  const professionalSummary = `${order.customerFacingDescription} was completed for ${order.customer} at ${order.site}. ${workCompleted} equipment record(s) were documented with required field evidence.${addonParts.length ? ` Additional materials/add-ons recorded: ${addonParts.join(', ')}.` : ''} The office must review this report before any customer delivery.`;
  return {
    id: `REV-${order.id}`,
    workOrderId: order.id,
    appointmentId: order.appointmentId,
    customer: order.customer,
    site: order.site,
    submittedAt: execution.submittedAt ?? new Date().toISOString(),
    status: 'pending',
    language: 'English',
    technicianSummary,
    professionalSummary,
  };
}
