'use strict';

// Isomorphic, dependency-free recovery boundary. Never writes storage or Firebase.
const STORAGE_KEYS = Object.freeze([
  'demac.erp-next.projects.preview.v1',
  'demac.erp-next.project-phase-templates.preview.v1',
]);
const FORMAT = 'demac-projects-local-backup';
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function assertTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw fail('invalid_timestamp', 'A valid ISO UTC capture time is required.');
  }
}
function canonicalBody(value) {
  if (!exactKeys(value, ['format', 'version', 'capturedAt', 'origin', 'entries'])
      || value.format !== FORMAT || value.version !== 1) {
    throw fail('invalid_backup', 'Unsupported Projects backup format.');
  }
  assertTimestamp(value.capturedAt);
  if (typeof value.origin !== 'string' || value.origin.length > 300) {
    throw fail('invalid_origin', 'The backup origin is invalid.');
  }
  let parsed;
  try { parsed = new URL(value.origin); } catch { throw fail('invalid_origin', 'The backup origin is invalid.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== value.origin) {
    throw fail('invalid_origin', 'Use an HTTP(S) origin without path, credentials or query.');
  }
  if (!Array.isArray(value.entries) || value.entries.length !== STORAGE_KEYS.length) {
    throw fail('invalid_entries', 'The backup must contain exactly the two Projects storage keys.');
  }
  const entries = STORAGE_KEYS.map((key, index) => {
    const entry = value.entries[index];
    if (!exactKeys(entry, ['key', 'raw']) || entry.key !== key
        || (entry.raw !== null && typeof entry.raw !== 'string')) {
      throw fail('invalid_entries', 'Only raw Projects records and phase templates are accepted.');
    }
    return { key, raw: entry.raw };
  });
  return { format: FORMAT, version: 1, capturedAt: value.capturedAt, origin: value.origin, entries };
}
function boundedJson(value) {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_BACKUP_BYTES) {
    throw fail('backup_too_large', 'Projects backup exceeds the 16 MiB recovery limit. Nothing was changed.');
  }
  return encoded;
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw fail('crypto_unavailable', 'Secure checksum support is unavailable in this browser.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function captureLocalBackup(storage, { capturedAt, origin }) {
  if (!storage || typeof storage.getItem !== 'function') throw fail('storage_unavailable', 'Projects storage cannot be read.');
  // Capture raw bytes before any sanitizer runs. Invalid JSON and unknown fields survive.
  const entries = STORAGE_KEYS.map((key) => ({ key, raw: storage.getItem(key) }));
  for (const entry of entries) {
    if (storage.getItem(entry.key) !== entry.raw) {
      throw fail('storage_changed', 'Projects changed during capture. Retry without editing the project.');
    }
  }
  const body = canonicalBody({ format: FORMAT, version: 1, capturedAt, origin, entries });
  const backup = { body, integrity: { algorithm: 'SHA-256', digest: await sha256(boundedJson(body)) } };
  boundedJson(backup);
  return backup;
}
async function verifyLocalBackup(serialized) {
  if (typeof serialized !== 'string') throw fail('invalid_backup', 'A Projects backup file is required.');
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES) throw fail('backup_too_large', 'Backup file exceeds 16 MiB.');
  let backup;
  try { backup = JSON.parse(serialized); } catch { throw fail('invalid_backup', 'The backup file is not valid JSON.'); }
  if (!exactKeys(backup, ['body', 'integrity'])
      || !exactKeys(backup.integrity, ['algorithm', 'digest'])
      || backup.integrity.algorithm !== 'SHA-256'
      || !/^[a-f0-9]{64}$/.test(backup.integrity.digest)) {
    throw fail('invalid_backup', 'The backup envelope or checksum is invalid.');
  }
  const body = canonicalBody(backup.body);
  if (await sha256(boundedJson(body)) !== backup.integrity.digest) {
    throw fail('checksum_mismatch', 'The backup checksum does not match. Do not migrate this file.');
  }
  // Integrity is not provenance/authenticity and is not permission to import.
  return { body, integrity: { ...backup.integrity } };
}
function inspectLocalBackup(backup) {
  const body = canonicalBody(backup.body);
  const issues = [];
  let state = null;
  let templates = null;
  const parsedKeys = new Set();
  for (const entry of body.entries) {
    if (entry.raw === null) { issues.push({ code: 'missing_storage_key', key: entry.key }); continue; }
    try {
      const parsed = JSON.parse(entry.raw);
      parsedKeys.add(entry.key);
      if (entry.key === STORAGE_KEYS[0]) state = parsed;
      else templates = parsed;
    } catch { issues.push({ code: 'malformed_source_json', key: entry.key }); }
  }
  const projects = state?.version === 1 && Array.isArray(state.projects) ? state.projects : null;
  if (parsedKeys.has(STORAGE_KEYS[0]) && projects === null) issues.push({ code: 'unsupported_project_state', key: STORAGE_KEYS[0] });
  if (parsedKeys.has(STORAGE_KEYS[1]) && !Array.isArray(templates)) issues.push({ code: 'unsupported_templates', key: STORAGE_KEYS[1] });
  const ids = new Set();
  const numbers = new Set();
  for (const project of projects ?? []) {
    if (!project || typeof project.id !== 'string' || !project.id.trim()
        || typeof project.projectNumber !== 'string' || !project.projectNumber.trim()
        || !Array.isArray(project.phases) || !Array.isArray(project.assignments)) {
      issues.push({ code: 'invalid_project_record', key: STORAGE_KEYS[0] }); continue;
    }
    if (ids.has(project.id)) issues.push({ code: 'duplicate_project_id', projectId: project.id });
    const number = project.projectNumber.trim().toUpperCase();
    if (numbers.has(number)) issues.push({ code: 'duplicate_project_number', projectId: project.id });
    ids.add(project.id); numbers.add(number);
  }
  return {
    capturedAt: body.capturedAt,
    origin: body.origin,
    projectCount: projects?.length ?? null,
    templateCount: Array.isArray(templates) ? templates.length : null,
    projects,
    issues,
    migrationAllowed: false,
  };
}

module.exports = { STORAGE_KEYS, MAX_BACKUP_BYTES, captureLocalBackup, verifyLocalBackup, inspectLocalBackup };
