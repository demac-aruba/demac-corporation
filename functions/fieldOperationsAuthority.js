const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
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

const FIELD_ACTIONS = new Set(['get_schedule', 'get_job', 'prepare_visit']);

function cleanText(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function publicJobProjection(job) {
  if (!job || typeof job !== 'object') return job;
  // WorkOrder.technicianIds is a Legacy compatibility field that may mix Firebase uid and
  // staff-profile ids. Assignment has already been resolved server-side, so never expose that
  // storage detail as part of the public Field contract where a client could treat it as truth.
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

function createFieldOperationsApi({ db, verifyIdToken, reportError = () => {}, prepareWorkVisit } = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('A Firestore-compatible db is required.');
  if (typeof verifyIdToken !== 'function') throw new Error('verifyIdToken is required.');
  if (typeof reportError !== 'function') throw new Error('reportError must be a function when provided.');
  if (prepareWorkVisit !== undefined && typeof prepareWorkVisit !== 'function') throw new Error('prepareWorkVisit must be a function when provided.');

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
      return { success: true, version: FIELD_OPERATIONS_API_VERSION, jobs: jobs.map(publicJobProjection) };
    }
    if (action === 'get_job') {
      const workOrderId = cleanText(data.workOrderId, 180);
      if (!workOrderId) throw fieldError('work_order_required', 'A Work Order id is required.');
      const job = await loadAssignedJob(db, identity, workOrderId);
      return { success: true, version: FIELD_OPERATIONS_API_VERSION, job: publicJobProjection(job) };
    }
    if (action === 'prepare_visit') {
      if (typeof prepareWorkVisit !== 'function') {
        throw fieldError('mutation_not_configured', 'Field visit preparation is not configured in this runtime.', 503);
      }
      return prepareWorkVisit({
        identity,
        workOrderId: cleanText(data.workOrderId, 180),
        requestId: cleanText(data.requestId, 240),
      });
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
          // Error reporting must never replace the original API failure.
        }
      }
      return result;
    }
  }

  return { authenticate, execute, handle, version: FIELD_OPERATIONS_API_VERSION };
}

let defaultApi;
function getDefaultApi() {
  if (!defaultApi) {
    const db = getFirestore();
    const resolveAssignment = createMutationAssignmentResolver({ db });
    const appendAuditInTransaction = createFieldAuditAppender({ db });
    const prepareWorkVisit = createPrepareWorkVisitCommand({ db, resolveAssignment, appendAuditInTransaction });
    defaultApi = createFieldOperationsApi({
      db,
      verifyIdToken: (token) => getAuth().verifyIdToken(token, true),
      prepareWorkVisit,
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
module.exports.publicJobProjection = publicJobProjection;
