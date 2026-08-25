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
  type FieldTechnicianScopeChangeOrigin,
} from './field-intervention-contract';
import {
  parseFieldApprovalJobResponse,
  parseFieldRecordAdditionalWorkDecisionResponse,
  type FieldAdditionalWorkDecision,
} from './field-approval-contract';

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
  FieldPlannedInterventionOption,
  FieldPlannedWorkProgress,
  FieldPriceSnapshot,
  FieldScopeChange,
  FieldScopeChangeOrigin,
  FieldTechnicianScopeChangeOrigin,
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
  FieldExecutionJobDetail,
  FieldRecordAdditionalWorkDecisionResponse,
} from './field-approval-contract';

type FieldApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

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
  return parseFieldApprovalJobResponse(await callFieldAuthority('get_job', { workOrderId }));
}

export async function prepareFieldVisit(workOrderId: string, requestId: string) {
  return parseFieldPrepareVisitResponse(await callFieldAuthority('prepare_visit', { workOrderId, requestId }));
}

export async function transitionFieldVisit(
  visitId: string,
  to: FieldActiveVisitTransition,
  expectedVersion: number,
  requestId: string,
) {
  return parseFieldTransitionVisitResponse(await callFieldAuthority('transition_visit', {
    visitId,
    to,
    expectedVersion,
    requestId,
  }));
}

export async function attachExistingFieldAsset(visitId: string, assetId: string, requestId: string) {
  return parseFieldAttachVisitAssetResponse(await callFieldAuthority('attach_visit_asset', {
    visitId,
    assetId,
    requestId,
  }));
}

export async function createPlannedFieldIntervention(
  visitId: string,
  visitAssetId: string,
  plannedWorkLineId: string,
  serviceCatalogItemId: string,
  requestId: string,
) {
  return parseFieldCreatePlannedInterventionResponse(await callFieldAuthority('create_planned_intervention', {
    visitId,
    visitAssetId,
    plannedWorkLineId,
    serviceCatalogItemId,
    requestId,
  }));
}

export async function createAdditionalFieldIntervention(
  visitId: string,
  visitAssetId: string,
  serviceCatalogItemId: string,
  origin: FieldTechnicianScopeChangeOrigin,
  reason: string,
  requestId: string,
) {
  return parseFieldCreateAdditionalInterventionResponse(await callFieldAuthority('create_additional_intervention', {
    visitId,
    visitAssetId,
    serviceCatalogItemId,
    origin,
    reason,
    requestId,
  }));
}

export async function recordAdditionalFieldInterventionDecision(
  visitId: string,
  interventionId: string,
  decision: FieldAdditionalWorkDecision,
  receiverName: string,
  note: string,
  requestId: string,
) {
  return parseFieldRecordAdditionalWorkDecisionResponse(await callFieldAuthority('record_additional_intervention_decision', {
    visitId,
    interventionId,
    decision,
    receiverName,
    note,
    requestId,
  }));
}
