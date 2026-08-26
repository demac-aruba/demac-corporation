const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const logger = require('firebase-functions/logger');
const { onRequest } = require('firebase-functions/v2/https');
const { createFieldAuditAppender } = require('./fieldOperationsAudit');
const { createMutationAssignmentResolver } = require('./fieldOperationsMutationAssignment');
const {
  FIELD_OPERATIONS_API_VERSION,
  fieldError,
  loadAssignedJob,
  loadAssignedSchedule,
  normalizeFieldIdentity,
} = require('./fieldOperationsAuthorityCore');
const { createPrepareWorkVisitCommand } = require('./fieldOperationsAuthorityWorkVisit');
const { projectActivatedVisit } = require('./fieldOperationsVisitActions');
const { createAttachExistingVisitAssetCommand, attachVisitAssetsToJob } = require('./fieldOperationsVisitAssets');
const { createRegisterEquipmentSystemCommand } = require('./fieldOperationsEquipmentRegistration');
const {
  attachWorkInterventionsToJob,
  createPlannedWorkInterventionCommand,
} = require('./fieldOperationsVisitInterventions');
const { attachInterventionExecutionOptionsToJob } = require('./fieldOperationsInterventionTransitions');
const { createTransitionWorkInterventionCommand } = require('./fieldOperationsInterventionMutation');
const { createAddReportPhotoEvidenceCommand } = require('./fieldOperationsReportEvidence');
const { createAddFieldMeasurementCommand } = require('./fieldOperationsMeasurements');
const { attachInterventionReportsToJob } = require('./fieldOperationsReportRead');
const {
  attachScopeChangesToJob,
  createAdditionalWorkInterventionCommand,
} = require('./fieldOperationsScopeChanges');
const {
  attachFieldApprovalsToJob,
  createRecordAdditionalWorkDecisionCommand,
} = require('./fieldOperationsApprovals');
const { attachCurrentWorkVisitState, attachCurrentWorkVisitStates } = require('./fieldOperationsVisitRead');
const { createTransitionWorkVisitCommand } = require('./fieldOperationsVisitMutation');

const FIELD_ACTIONS = new Set([
  'get_schedule',
  'get_job',
  'prepare_visit',
  'transition_visit',
  'attach_visit_asset',
  'register_visit_asset',
  'create_planned_intervention',
  'create_additional_intervention',
  'record_additional_intervention_decision',
  'transition_intervention',
  'add_report_photo_evidence',
  'add_report_measurement',
]);

function cleanText(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function equipmentRegistrationEvidencePaths(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    equipment_reference: cleanText(source.equipment_reference, 1000),
    indoor_nameplate: cleanText(source.indoor_nameplate, 1000),
    outdoor_nameplate: cleanText(source.outdoor_nameplate, 1000),
  };
}

function publicJobProjection(job) {
  if (!job || typeof job !== 'object') return job;
  const { technicianIds: _legacyTechnicianIds, ...publicJob } = job;
  return publicJob;
}

function bearerToken(request) {
  const header = cleanText(request?.headers?.authorization || request?.get?.('authorization'), 5000);
  const match = header.match(/^Bearer\s+(.+)$/i);
  return cleanText(match?.[1], 4000);
}

function apiError(error) {
  const status = Number(error?.status) || (error?.code === 'permission_denied' ? 403 : error?.code === 'unauthenticated' ? 401 : 500);
  const internal = status >= 500;
  return {
    status,
    body: {
      success: false,
      version: FIELD_OPERATIONS_API_VERSION,
      error: {
        code: internal ? 'internal_error' : cleanText(error?.code || 'internal_error', 120),
        message: internal ? 'Unexpected Field Operations error.' : cleanText(error?.message || 'Field Operations request failed.', 500),
        details: internal ? {} : error?.details && typeof error.details === 'object' ? error.details : {},
      },
    },
  };
}

function createFieldOperationsApi({
  db,
  verifyIdToken,
  reportError = () => {},
  prepareWorkVisit,
  transitionWorkVisit,
  attachExistingVisitAsset,
  registerEquipmentSystem,
  createPlannedWorkIntervention,
  createAdditionalWorkIntervention,
  recordAdditionalWorkDecision,
  transitionWorkIntervention,
  addReportPhotoEvidence,
  addFieldMeasurement,
} = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('A Firestore-compatible db is required.');
  if (typeof verifyIdToken !== 'function') throw new Error('verifyIdToken is required.');
  if (typeof reportError !== 'function') throw new Error('reportError must be a function when provided.');
  if (prepareWorkVisit !== undefined && typeof prepareWorkVisit !== 'function') throw new Error('prepareWorkVisit must be a function when provided.');
  if (transitionWorkVisit !== undefined && typeof transitionWorkVisit !== 'function') throw new Error('transitionWorkVisit must be a function when provided.');
  if (attachExistingVisitAsset !== undefined && typeof attachExistingVisitAsset !== 'function') throw new Error('attachExistingVisitAsset must be a function when provided.');
  if (registerEquipmentSystem !== undefined && typeof registerEquipmentSystem !== 'function') throw new Error('registerEquipmentSystem must be a function when provided.');
  if (createPlannedWorkIntervention !== undefined && typeof createPlannedWorkIntervention !== 'function') throw new Error('createPlannedWorkIntervention must be a function when provided.');
  if (createAdditionalWorkIntervention !== undefined && typeof createAdditionalWorkIntervention !== 'function') throw new Error('createAdditionalWorkIntervention must be a function when provided.');
  if (recordAdditionalWorkDecision !== undefined && typeof recordAdditionalWorkDecision !== 'function') throw new Error('recordAdditionalWorkDecision must be a function when provided.');
  if (transitionWorkIntervention !== undefined && typeof transitionWorkIntervention !== 'function') throw new Error('transitionWorkIntervention must be a function when provided.');
  if (addReportPhotoEvidence !== undefined && typeof addReportPhotoEvidence !== 'function') throw new Error('addReportPhotoEvidence must be a function when provided.');
  if (addFieldMeasurement !== undefined && typeof addFieldMeasurement !== 'function') throw new Error('addFieldMeasurement must be a function when provided.');

  async function authenticate(request) {
    const token = bearerToken(request);
    if (!token) throw fieldError('unauthenticated', 'Firebase authentication is required.', 401);
    let decoded;
    try {
      decoded = await verifyIdToken(token);
    } catch (cause) {
      const error = fieldError('unauthenticated', 'The Firebase session is invalid or expired.', 401);
      error.cause = cause;
      throw error;
    }
    const uid = cleanText(decoded?.uid || decoded?.sub, 180);
    if (!uid) throw fieldError('unauthenticated', 'The authenticated user has no uid.', 401);
    const profileSnapshot = await db.collection('users').doc(uid).get();
    if (!profileSnapshot.exists) throw fieldError('permission_denied', 'This Firebase account has no DEMAC ERP profile.', 403);
    return normalizeFieldIdentity({ uid, profile: profileSnapshot.data() || {}, decoded });
  }

  async function execute({ action, data = {}, identity }) {
    if (action === 'get_schedule') {
      const jobs = await loadAssignedSchedule(db, identity, data.startDate, data.endDate || data.startDate);
      const enriched = await attachCurrentWorkVisitStates(db, jobs);
      return { success: true, version: FIELD_OPERATIONS_API_VERSION, jobs: enriched.map(publicJobProjection) };
    }
    if (action === 'get_job') {
      const workOrderId = cleanText(data.workOrderId, 180);
      if (!workOrderId) throw fieldError('work_order_required', 'A Work Order id is required.');
      const job = await loadAssignedJob(db, identity, workOrderId);
      const withVisit = await attachCurrentWorkVisitState(db, job);
      const withAssets = await attachVisitAssetsToJob(db, withVisit);
      const withInterventions = await attachWorkInterventionsToJob(db, withAssets);
      const withExecutionOptions = attachInterventionExecutionOptionsToJob(withInterventions);
      const withScopeChanges = await attachScopeChangesToJob(db, withExecutionOptions);
      const withApprovals = await attachFieldApprovalsToJob(db, withScopeChanges);
      const withReports = await attachInterventionReportsToJob(db, withApprovals);
      return {
        success: true,
        version: FIELD_OPERATIONS_API_VERSION,
        job: publicJobProjection(withReports),
      };
    }
    if (action === 'prepare_visit') {
      if (typeof prepareWorkVisit !== 'function') {
        throw fieldError('mutation_not_configured', 'Field visit preparation is not configured in this runtime.', 503);
      }
      const prepared = await prepareWorkVisit({
        identity,
        workOrderId: cleanText(data.workOrderId, 180),
        requestId: cleanText(data.requestId, 240),
      });
      return {
        ...prepared,
        visit: projectActivatedVisit(prepared.visit, prepared.allowedActions),
        version: FIELD_OPERATIONS_API_VERSION,
      };
    }
    if (action === 'transition_visit') {
      if (typeof transitionWorkVisit !== 'function') {
        throw fieldError('mutation_not_configured', 'Field visit transitions are not configured in this runtime.', 503);
      }
      const transitioned = await transitionWorkVisit({
        identity,
        visitId: cleanText(data.visitId, 180),
        to: cleanText(data.to, 80),
        expectedVersion: data.expectedVersion,
        requestId: cleanText(data.requestId, 240),
      });
      return { ...transitioned, version: FIELD_OPERATIONS_API_VERSION };
    }
    if (action === 'attach_visit_asset') {
      if (typeof attachExistingVisitAsset !== 'function') {
        throw fieldError('mutation_not_configured', 'Field visit equipment attachment is not configured in this runtime.', 503);
      }
      const attached = await attachExistingVisitAsset({
        identity,
        visitId: cleanText(data.visitId, 180),
        assetId: cleanText(data.assetId, 180),
        requestId: cleanText(data.requestId, 240),
        source: 'existing_asset',
      });
      return { ...attached, version: FIELD_OPERATIONS_API_VERSION };
    }
    if (action === 'register_visit_asset') {
      if (typeof registerEquipmentSystem !== 'function' || typeof attachExistingVisitAsset !== 'function') {
        throw fieldError('mutation_not_configured', 'On-site A/C registration is not configured in this runtime.', 503);
      }
      const visitId = cleanText(data.visitId, 180);
      const requestId = cleanText(data.requestId, 240);
      const registered = await registerEquipmentSystem({
        identity,
        visitId,
        requestId,
        locationLabel: cleanText(data.locationLabel, 240),
        systemType: cleanText(data.systemType, 120),
        brand: cleanText(data.brand, 120),
        btu: data.btu,
        refrigerant: cleanText(data.refrigerant, 80),
        voltage: cleanText(data.voltage, 80),
        qrCode: cleanText(data.qrCode, 512),
        evidencePaths: equipmentRegistrationEvidencePaths(data.evidencePaths),
      });
      const attached = await attachExistingVisitAsset({
        identity,
        visitId,
        assetId: registered.equipment.id,
        requestId,
        source: 'registered_on_site',
      });
      return {
        success: true,
        version: FIELD_OPERATIONS_API_VERSION,
        replayed: Boolean(registered.replayed && attached.replayed),
        registrationReplayed: Boolean(registered.replayed),
        attachReplayed: Boolean(attached.replayed),
        equipment: registered.equipment,
        evidence: Array.isArray(registered.evidence) ? registered.evidence : [],
        visitAsset: attached.visitAsset,
        allowedActions: attached.allowedActions,
        auditEventIds: [
          ...(Array.isArray(registered.auditEventIds) ? registered.auditEventIds : []),
          attached.auditEventId,
        ].filter(Boolean),
      };
    }
    if (action === 'create_planned_intervention') {
      if (typeof createPlannedWorkIntervention !== 'function') {
        throw fieldError('mutation_not_configured', 'Planned Field work intervention creation is not configured in this runtime.', 503);
      }
      const created = await createPlannedWorkIntervention({
        identity,
        visitId: cleanText(data.visitId, 180),
        visitAssetId: cleanText(data.visitAssetId, 180),
        plannedWorkLineId: cleanText(data.plannedWorkLineId, 180),
        serviceCatalogItemId: cleanText(data.serviceCatalogItemId, 180),
        requestId: cleanText(data.requestId, 240),
      });
      return { ...created, version: FIELD_OPERATIONS_API_VERSION };
    }
    if (action === 'create_additional_intervention') {
      if (typeof createAdditionalWorkIntervention !== 'function') {
        throw fieldError('mutation_not_configured', 'Additional Field work intervention creation is not configured in this runtime.', 503);
      }
      const created = await createAdditionalWorkIntervention({
        identity,
        visitId: cleanText(data.visitId, 180),
        visitAssetId: cleanText(data.visitAssetId, 180),
        serviceCatalogItemId: cleanText(data.serviceCatalogItemId, 180),
        origin: cleanText(data.origin, 80),
        reason: cleanText(data.reason, 1500),
        requestId: cleanText(data.requestId, 240),
      });
      return { ...created, version: FIELD_OPERATIONS_API_VERSION };
    }
    if (action === 'record_additional_intervention_decision') {
      if (typeof recordAdditionalWorkDecision !== 'function') {
        throw fieldError('mutation_not_configured', 'Additional Field work customer decision recording is not configured in this runtime.', 503);
      }
      const decided = await recordAdditionalWorkDecision({
        identity,
        visitId: cleanText(data.visitId, 180),
        interventionId: cleanText(data.interventionId, 180),
        decision: cleanText(data.decision, 40),
        receiverName: cleanText(data.receiverName, 180),
        note: cleanText(data.note, 1000),
        requestId: cleanText(data.requestId, 240),
      });
      return { ...decided, version: FIELD_OPERATIONS_API_VERSION };
    }
    if (action === 'transition_intervention') {
      if (typeof transitionWorkIntervention !== 'function') {
        throw fieldError('mutation_not_configured', 'Work Intervention execution transitions are not configured in this runtime.', 503);
      }
      const transitioned = await transitionWorkIntervention({
        identity,
        visitId: cleanText(data.visitId, 180),
        interventionId: cleanText(data.interventionId, 180),
        to: cleanText(data.to, 80),
        expectedVersion: data.expectedVersion,
        note: cleanText(data.note, 1500),
        requestId: cleanText(data.requestId, 240),
      });
      return { ...transitioned, version: FIELD_OPERATIONS_API_VERSION };
    }
    if (action === 'add_report_photo_evidence') {
      if (typeof addReportPhotoEvidence !== 'function') {
        throw fieldError('mutation_not_configured', 'Work Intervention report photo evidence is not configured in this runtime.', 503);
      }
      const added = await addReportPhotoEvidence({
        identity,
        visitId: cleanText(data.visitId, 180),
        interventionId: cleanText(data.interventionId, 180),
        sectionId: cleanText(data.sectionId, 120),
        storagePath: cleanText(data.storagePath, 1000),
        caption: cleanText(data.caption, 500),
        requestId: cleanText(data.requestId, 240),
      });
      return { ...added, version: FIELD_OPERATIONS_API_VERSION };
    }
    if (action === 'add_report_measurement') {
      if (typeof addFieldMeasurement !== 'function') {
        throw fieldError('mutation_not_configured', 'Work Intervention report measurement is not configured in this runtime.', 503);
      }
      const added = await addFieldMeasurement({
        identity,
        visitId: cleanText(data.visitId, 180),
        interventionId: cleanText(data.interventionId, 180),
        sectionId: cleanText(data.sectionId, 120),
        metric: cleanText(data.metric, 160),
        value: data.value,
        unit: cleanText(data.unit, 80),
        moment: cleanText(data.moment, 40),
        requestId: cleanText(data.requestId, 240),
      });
      return { ...added, version: FIELD_OPERATIONS_API_VERSION };
    }
    throw fieldError('unsupported_action', `Unsupported Field Operations action: ${action || 'missing'}.`, 400);
  }

  async function handle(request) {
    if (request.method === 'OPTIONS') return { status: 204, body: null };
    if (request.method !== 'POST') return { status: 405, body: { success: false, version: FIELD_OPERATIONS_API_VERSION, error: { code: 'method_not_allowed', message: 'POST is required.', details: {} } } };
    const action = cleanText(request.body?.action, 120);
    try {
      if (!FIELD_ACTIONS.has(action)) throw fieldError('unsupported_action', `Unsupported Field Operations action: ${action || 'missing'}.`, 400);
      const identity = await authenticate(request);
      const body = await execute({ action, data: request.body?.data || {}, identity });
      return { status: 200, body };
    } catch (error) {
      const result = apiError(error);
      if (result.status >= 500) {
        try {
          reportError({ action, status: result.status, code: result.body.error.code, error });
        } catch (_reportingError) {
        }
      }
      return result;
    }
  }

  return { authenticate, execute, handle, version: FIELD_OPERATIONS_API_VERSION };
}

async function verifyStoredFieldImage(storagePath) {
  const [metadata] = await getStorage().bucket().file(storagePath).getMetadata();
  return {
    contentType: cleanText(metadata?.contentType, 120),
    sizeBytes: Number(metadata?.size),
  };
}

let defaultApi;
function getDefaultApi() {
  if (!defaultApi) {
    const db = getFirestore();
    const resolveAssignment = createMutationAssignmentResolver({ db });
    const appendAuditInTransaction = createFieldAuditAppender({ db });
    const prepareWorkVisit = createPrepareWorkVisitCommand({ db, resolveAssignment, appendAuditInTransaction });
    const transitionWorkVisit = createTransitionWorkVisitCommand({ db, resolveAssignment, appendAuditInTransaction });
    const attachExistingVisitAsset = createAttachExistingVisitAssetCommand({ db, resolveAssignment, appendAuditInTransaction });
    const registerEquipmentSystem = createRegisterEquipmentSystemCommand({
      db,
      resolveAssignment,
      appendAuditInTransaction,
      verifyStoredImage: verifyStoredFieldImage,
    });
    const createPlannedWorkIntervention = createPlannedWorkInterventionCommand({ db, resolveAssignment, appendAuditInTransaction });
    const createAdditionalWorkIntervention = createAdditionalWorkInterventionCommand({ db, resolveAssignment, appendAuditInTransaction });
    const recordAdditionalWorkDecision = createRecordAdditionalWorkDecisionCommand({ db, resolveAssignment, appendAuditInTransaction });
    const transitionWorkIntervention = createTransitionWorkInterventionCommand({ db, resolveAssignment, appendAuditInTransaction });
    const addReportPhotoEvidence = createAddReportPhotoEvidenceCommand({
      db,
      resolveAssignment,
      appendAuditInTransaction,
      verifyStoredImage: verifyStoredFieldImage,
    });
    const addFieldMeasurement = createAddFieldMeasurementCommand({ db, resolveAssignment, appendAuditInTransaction });
    defaultApi = createFieldOperationsApi({
      db,
      verifyIdToken: (token) => getAuth().verifyIdToken(token, true),
      prepareWorkVisit,
      transitionWorkVisit,
      attachExistingVisitAsset,
      registerEquipmentSystem,
      createPlannedWorkIntervention,
      createAdditionalWorkIntervention,
      recordAdditionalWorkDecision,
      transitionWorkIntervention,
      addReportPhotoEvidence,
      addFieldMeasurement,
      reportError: ({ action, status, code, error }) => logger.error('Field Operations request failed', {
        action: cleanText(action, 120) || 'unknown',
        status,
        code: cleanText(code, 120) || 'internal_error',
        errorName: cleanText(error?.name, 120) || 'Error',
        errorMessage: cleanText(error?.message, 500),
      }),
    });
  }
  return defaultApi;
}

exports.fieldOperationsAuthority = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request, response) => {
    const origin = request.get('origin') || '*';
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    const result = await getDefaultApi().handle(request);
    if (result.status === 204) {
      response.status(204).send('');
      return;
    }
    response.status(result.status).json(result.body);
  },
);

module.exports.FIELD_ACTIONS = FIELD_ACTIONS;
module.exports.apiError = apiError;
module.exports.bearerToken = bearerToken;
module.exports.createFieldOperationsApi = createFieldOperationsApi;
module.exports.equipmentRegistrationEvidencePaths = equipmentRegistrationEvidencePaths;
module.exports.publicJobProjection = publicJobProjection;
module.exports.verifyStoredFieldImage = verifyStoredFieldImage;