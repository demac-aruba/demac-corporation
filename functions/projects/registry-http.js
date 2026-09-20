'use strict';

// Transport only. The existing registry service remains the only planning writer.
// No Firebase initialization, deployment export, operational writer or activation here.
const MAX_BODY_BYTES = 128 * 1024;
const PUBLIC_ERRORS = Object.freeze({
  projects_not_active: 'Central Projects is not activated.',
  projects_writes_paused: 'New Project changes are paused. Existing records and exact-request recovery remain available.',
  unauthenticated: 'Your session cannot be verified. Sign in again before continuing.',
  forbidden: 'Your account does not have permission for this operation.',
  import_owner_required: 'Owner authorization is required for legacy recovery.',
  legacy_import_not_active: 'Import is not activated. The preview did not change any data.',
  version_conflict: 'Another operator changed this project. Refresh and review your edits before saving again.',
  request_conflict: 'This request identity belongs to a different operation. Do not resubmit altered data.',
  legacy_preview_changed: 'The source changed after preview. Review a new preview before importing.',
  legacy_import_conflict: 'Project identity, history or customer/property data requires reconciliation.',
  project_identity_conflict: 'This project identity already exists. Reconcile it instead of recreating it.',
  project_not_found: 'The selected project is not available.',
  crm_identity_conflict: 'Select an existing active customer and its own service property.',
  phase_has_history: 'A phase with operational history cannot be removed.',
  phase_budget_allocation: 'Review the phase planning estimates against the project estimate. Booking overruns remain advisory.',
  appointment_identity_conflict: 'The appointment does not match the project customer and property.',
  association_conflict: 'This appointment already belongs to another project or phase.',
  work_order_identity_conflict: 'A related Work Order has conflicting customer or property information.',
  work_order_missing: 'A related Work Order is missing. Reconcile the appointment before linking it.',
  backup_confirmation_required: 'Verify the saved original backup before importing.',
  import_warnings_unacknowledged: 'Review every warning in the current import preview.',
  import_archive_conflict: 'Archived source integrity could not be verified. No restoration was performed.',
  import_source_not_found: 'This project has no archived browser source.',
});
function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}
function createProjectRegistryHttp({ service, allowedOrigins = [] }) {
  if (!service || typeof service.execute !== 'function') throw new Error('A trusted Project registry service is required.');
  const origins = new Set(allowedOrigins.map((origin) => {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) throw new Error('CORS origins must be explicit HTTP(S) origins.');
    return origin;
  }));
  return async function handle(request) {
    const headers = { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    const origin = header(request.headers, 'origin');
    const response = (status, body) => ({ status, headers, body });
    const error = (status, code, message, outcome = 'rejected') => response(status, { success: false, error: { code, message, outcome } });
    if (origin && !origins.has(origin)) return error(403, 'origin_denied', 'This website is not allowed to call Central Projects.');
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') {
      if (header(request.headers, 'access-control-request-method') !== 'POST') return error(405, 'method_not_allowed', 'Only POST requests are accepted.');
      const requested = header(request.headers, 'access-control-request-headers').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
      if (requested.some((value) => !['authorization', 'content-type'].includes(value))) return error(400, 'invalid_preflight', 'Unsupported request headers.');
      headers['Access-Control-Allow-Methods'] = 'POST';
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      headers['Access-Control-Max-Age'] = '300';
      return response(204, null);
    }
    if (request.method !== 'POST') return error(405, 'method_not_allowed', 'Only POST requests are accepted.');
    if (!/^application\/json(?:\s*;|$)/i.test(header(request.headers, 'content-type'))) return error(415, 'unsupported_media_type', 'Use application/json.');
    const token = /^Bearer ([^\s]{1,16000})$/.exec(header(request.headers, 'authorization'))?.[1];
    if (!token) return error(401, 'unauthenticated', PUBLIC_ERRORS.unauthenticated);
    try {
      if (request.rawBody && request.rawBody.length > MAX_BODY_BYTES) return error(413, 'payload_too_large', 'The request exceeds the Projects limit.');
      const serialized = JSON.stringify(request.body);
      if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) return error(413, 'payload_too_large', 'The request exceeds the Projects limit.');
      const data = await service.execute({ idToken: token, command: request.body });
      return response(200, { success: true, data });
    } catch (cause) {
      // Known validation errors never echo caller data. Unknown failures may follow a commit.
      const known = typeof cause?.code === 'string' && /^[a-z][a-z_]{1,80}$/.test(cause.code)
        && [400, 401, 403, 404, 409, 413, 503].includes(cause.status);
      if (known) return error(cause.status, cause.code, PUBLIC_ERRORS[cause.code] || 'The request could not be accepted. Review its fields and refresh the project.');
      return error(503, 'service_unavailable', 'The result could not be verified. Retry the same request; do not create a replacement booking or project.', 'unknown');
    }
  };
}
module.exports = { MAX_BODY_BYTES, createProjectRegistryHttp };
