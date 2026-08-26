import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';
import {
  parseFieldAttachVisitAssetResponse,
  parseFieldPrepareVisitResponse,
  parseFieldScheduleResponse,
  parseFieldTransitionVisitResponse,
  type FieldActiveVisitTransition,
} from './field-authority-contract';
import {
  parseFieldCreateAdditionalInterventionResponse,
  parseFieldCreatePlannedInterventionResponse,
  parseFieldTransitionInterventionResponse,
  type FieldInterventionExecutionTarget,
  type FieldTechnicianScopeChangeOrigin,
} from './field-intervention-contract';
import {
  parseFieldRecordAdditionalWorkDecisionResponse,
  type FieldAdditionalWorkDecision,
} from './field-approval-contract';
import {
  parseFieldAddReportMeasurementResponse,
  parseFieldAddReportPhotoEvidenceResponse,
  type FieldMeasurementMoment,
} from './field-report-contract';
import { parseFieldAddReportFindingResponse } from './field-finding-contract';
import { parseFieldSetReportChecklistItemResponse } from './field-checklist-contract';
import {
  parseFieldFreeTextJobResponse,
  parseFieldSetReportFreeTextResponse,
} from './field-free-text-contract';
import { parseFieldRegisterVisitAssetResponse } from './field-equipment-registration-contract';

export { fieldActionAllowed } from './field-authorization';
export type {
  FieldActiveVisitTransition,
  FieldAllowedAction,
  FieldAssignmentSource,
  FieldAttachVisitAssetResponse,
  FieldJobDetail,
  FieldKnownEquipment,
  FieldPlannedWork,
  FieldPreparedVisit,
  FieldPrepareSource,
  FieldPrepareVisitResponse,
  FieldResponsibility,
  FieldScheduleJob,
  FieldTransitionVisitResponse,
  FieldVisitAsset,
  FieldVisitAssetSource,
  FieldVisitAssetStatus,
  FieldVisitState,
  FieldVisitStatus,
} from './field-authority-contract';
export type {
  FieldAvailableService,
  FieldCreateAdditionalInterventionResponse,
  FieldCreatePlannedInterventionResponse,
  FieldInterventionExecutionOption,
  FieldInterventionExecutionTarget,
  FieldPlannedInterventionOption,
  FieldPlannedWorkProgress,
  FieldPriceSnapshot,
  FieldScopeChange,
  FieldScopeChangeOrigin,
  FieldTechnicianScopeChangeOrigin,
  FieldTransitionInterventionResponse,
  FieldWorkIntervention,
  FieldWorkInterventionOrigin,
  FieldWorkInterventionRequester,
  FieldWorkInterventionStatus,
} from './field-intervention-contract';
export type {
  FieldAdditionalWorkDecision,
  FieldApproval,
  FieldApprovalMethod,
  FieldApprovalReference,
  FieldApprovalReferenceType,
  FieldApprovalStatus,
  FieldRecordAdditionalWorkDecisionResponse,
} from './field-approval-contract';
export type {
  FieldAddReportMeasurementResponse,
  FieldAddReportPhotoEvidenceResponse,
  FieldInterventionReport,
  FieldMeasurementMoment,
  FieldReportJobDetail,
  FieldReportMeasurement,
  FieldReportMeasurementOption,
  FieldReportPhotoEvidence,
  FieldReportPhotoOption,
  FieldReportSection,
  FieldReportSectionOption,
  FieldReportSectionStatus,
  FieldReportSectionType,
  FieldReportTemplateSnapshot,
} from './field-report-contract';
export type {
  FieldAddReportFindingResponse,
  FieldFindingInterventionReport,
  FieldFindingJobDetail,
  FieldReportFinding,
  FieldReportFindingOption,
} from './field-finding-contract';
export type {
  FieldChecklistInterventionReport,
  FieldChecklistJobDetail,
  FieldChecklistReportSection,
  FieldChecklistReportTemplateSnapshot,
  FieldReportChecklistItem,
  FieldReportChecklistOption,
  FieldReportChecklistResponse,
  FieldSetReportChecklistItemResponse,
} from './field-checklist-contract';
export type {
  FieldFreeTextInterventionReport,
  FieldFreeTextJobDetail,
  FieldFreeTextJobDetail as FieldExecutionJobDetail,
  FieldReportFreeTextOption,
  FieldReportFreeTextResponse,
  FieldSetReportFreeTextResponse,
} from './field-free-text-contract';
export type {
  FieldEquipmentRegistrationEvidence,
  FieldEquipmentRegistrationEvidenceKind,
  FieldRegisteredEquipment,
  FieldRegisterVisitAssetResponse,
} from './field-equipment-registration-contract';

type FieldApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

export type RegisterOnSiteFieldEquipmentInput = {
  visitId: string;
  requestId: string;
  locationLabel: string;
  systemType: string;
  brand: string;
  btu: number;
  refrigerant: string;
  voltage: string;
  qrCode?: string;
  evidencePaths: {
    equipment_reference: string;
    indoor_nameplate: string;
    outdoor_nameplate: string;
  };
};

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/fieldOperationsAuthority`;
}

function asApiErrorPayload(value: unknown): FieldApiError {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as FieldApiError
    : {};
}

function abortError() {
  const error = new Error('Field Operations request timed out.');
  error.name = 'AbortError';
  return error;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function callFieldAuthority(action: string, data: Record<string, unknown>, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const session = await abortable(requireFirebaseWebSession(), controller.signal);
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data }),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiError = asApiErrorPayload(payload);
      const code = apiError.error?.code ? ` (${apiError.error.code})` : '';
      throw new Error(`${apiError.error?.message ?? 'Field Operations could not complete the request.'}${code}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Field Operations took too long to respond. Refresh and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getFieldSchedule(startDate: string, endDate = startDate) {
  return parseFieldScheduleResponse(await callFieldAuthority('get_schedule', { startDate, endDate }));
}

export async function getFieldJob(workOrderId: string) {
  return parseFieldFreeTextJobResponse(await callFieldAuthority('get_job', { workOrderId }));
}

export async function prepareFieldVisit(workOrderId: string, requestId: string) {
  return parseFieldPrepareVisitResponse(await callFieldAuthority('prepare_visit', { workOrderId, requestId }));
}

export async function transitionFieldVisit(visitId: string, to: FieldActiveVisitTransition, expectedVersion: number, requestId: string) {
  return parseFieldTransitionVisitResponse(await callFieldAuthority('transition_visit', { visitId, to, expectedVersion, requestId }));
}

export async function attachExistingFieldAsset(visitId: string, assetId: string, requestId: string) {
  return parseFieldAttachVisitAssetResponse(await callFieldAuthority('attach_visit_asset', { visitId, assetId, requestId }));
}

export async function registerOnSiteFieldEquipment(input: RegisterOnSiteFieldEquipmentInput) {
  return parseFieldRegisterVisitAssetResponse(await callFieldAuthority('register_visit_asset', {
    visitId: input.visitId, requestId: input.requestId, locationLabel: input.locationLabel, systemType: input.systemType,
    brand: input.brand, btu: input.btu, refrigerant: input.refrigerant, voltage: input.voltage, qrCode: input.qrCode ?? '', evidencePaths: input.evidencePaths,
  }, 20_000));
}

export async function createPlannedFieldIntervention(visitId: string, visitAssetId: string, plannedWorkLineId: string, serviceCatalogItemId: string, requestId: string) {
  return parseFieldCreatePlannedInterventionResponse(await callFieldAuthority('create_planned_intervention', { visitId, visitAssetId, plannedWorkLineId, serviceCatalogItemId, requestId }));
}

export async function createAdditionalFieldIntervention(visitId: string, visitAssetId: string, serviceCatalogItemId: string, origin: FieldTechnicianScopeChangeOrigin, reason: string, requestId: string) {
  return parseFieldCreateAdditionalInterventionResponse(await callFieldAuthority('create_additional_intervention', { visitId, visitAssetId, serviceCatalogItemId, origin, reason, requestId }));
}

export async function recordAdditionalFieldInterventionDecision(visitId: string, interventionId: string, decision: FieldAdditionalWorkDecision, receiverName: string, note: string, requestId: string) {
  return parseFieldRecordAdditionalWorkDecisionResponse(await callFieldAuthority('record_additional_intervention_decision', { visitId, interventionId, decision, receiverName, note, requestId }));
}

export async function transitionFieldIntervention(visitId: string, interventionId: string, to: FieldInterventionExecutionTarget, expectedVersion: number, note: string, requestId: string) {
  return parseFieldTransitionInterventionResponse(await callFieldAuthority('transition_intervention', { visitId, interventionId, to, expectedVersion, note, requestId }));
}

export async function addFieldReportPhotoEvidence(visitId: string, interventionId: string, sectionId: string, storagePath: string, caption: string, requestId: string) {
  return parseFieldAddReportPhotoEvidenceResponse(await callFieldAuthority('add_report_photo_evidence', { visitId, interventionId, sectionId, storagePath, caption, requestId }, 20_000));
}

export async function addFieldReportMeasurement(visitId: string, interventionId: string, sectionId: string, metric: string, value: number | string, unit: string, moment: FieldMeasurementMoment, requestId: string) {
  return parseFieldAddReportMeasurementResponse(await callFieldAuthority('add_report_measurement', { visitId, interventionId, sectionId, metric, value, unit, moment, requestId }));
}

export async function addFieldReportFinding(visitId: string, interventionId: string, sectionId: string, summary: string, details: string, recommendation: string, requestId: string) {
  return parseFieldAddReportFindingResponse(await callFieldAuthority('add_report_finding', { visitId, interventionId, sectionId, summary, details, recommendation, requestId }));
}

export async function setFieldReportChecklistItem(visitId: string, interventionId: string, sectionId: string, itemId: string, checked: boolean, expectedVersion: number, requestId: string) {
  return parseFieldSetReportChecklistItemResponse(await callFieldAuthority('set_report_checklist_item', { visitId, interventionId, sectionId, itemId, checked, expectedVersion, requestId }));
}

export async function setFieldReportFreeText(visitId: string, interventionId: string, sectionId: string, value: string, expectedVersion: number, requestId: string) {
  return parseFieldSetReportFreeTextResponse(await callFieldAuthority('set_report_free_text', { visitId, interventionId, sectionId, value, expectedVersion, requestId }));
}
