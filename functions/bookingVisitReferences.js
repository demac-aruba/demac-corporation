'use strict';

const crypto = require('node:crypto');
const { BOOKING_ERROR_CODES, BookingAuthorityError } = require('./bookingAuthorityCore');
const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;
const MAX_REFERENCE_FILES = 20;
const UPLOAD_COLLECTION = 'bookingReferenceUploads';
const OFFICE_ROLES = new Set(['admin', 'office', 'operator', 'office_operator', 'supervisor', 'owner', 'super_admin', 'superadmin']);
const MIME_EXTENSIONS = {
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'],
  'video/mp4': ['mp4', 'm4v'], 'video/quicktime': ['mov'], 'video/webm': ['webm'],
  'audio/mpeg': ['mp3'], 'audio/mp4': ['m4a', 'mp4'], 'audio/aac': ['aac'],
  'audio/ogg': ['ogg', 'opus'], 'audio/opus': ['opus', 'ogg'], 'audio/wav': ['wav'], 'audio/x-wav': ['wav'], 'audio/webm': ['webm'],
};
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
function fail(reason, message) { throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, message, { reason }); }
function referenceId(value) {
  const id = clean(value, 100);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) fail('reference-id', 'Invalid reference file identity.');
  return id;
}
function officeProfile(profile) {
  return profile?.active === true && OFFICE_ROLES.has(clean(profile.role).toLowerCase().replace(/[\s-]+/g, '_'));
}
function validateReferenceFile({ fileName, contentType, size }) {
  const name = clean(fileName, 180).replace(/[\r\n/\\\x00-\x1f]/g, '_');
  const ext = name.split('.').pop().toLowerCase();
  let mime = clean(contentType, 120).split(';')[0].toLowerCase();
  if (!mime || mime === 'application/octet-stream') mime = Object.keys(MIME_EXTENSIONS).find(key => MIME_EXTENSIONS[key].includes(ext)) || '';
  if (!MIME_EXTENSIONS[mime]?.includes(ext)) fail('reference-type', 'Use JPG, PNG, WebP, MP4, MOV, WebM or a supported audio file (MP3, M4A, OGG, OPUS, AAC, WAV).');
  if (!Number.isInteger(size) || size <= 0 || size > MAX_REFERENCE_BYTES) fail('reference-size', 'Each reference file must be between 1 byte and 25 MB.');
  return { fileName: name, mimeType: mime, size, kind: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'voice' };
}
function normalizeReferenceLocation(value) {
  const input = clean(typeof value === 'string' ? value : value?.url, 1500);
  if (!input) return null;
  const coordinates = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(input);
  let url = input;
  if (coordinates) {
    const lat = Number(coordinates[1]), lng = Number(coordinates[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) fail('reference-location', 'GPS coordinates are outside the valid range.');
    url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  let parsed;
  try { parsed = new URL(url); } catch { fail('reference-location', 'Paste a Maps link or latitude, longitude.'); }
  const allowed = ['maps.google.com', 'maps.app.goo.gl', 'maps.apple.com'].includes(parsed.hostname)
    || (['www.google.com', 'google.com', 'goo.gl'].includes(parsed.hostname) && parsed.pathname.startsWith('/maps'));
  if (parsed.protocol !== 'https:' || !allowed || parsed.username || parsed.password) fail('reference-location', 'Use a secure Google Maps / Apple Maps link or latitude, longitude.');
  return { url: parsed.href, label: clean(value?.label, 160) || 'Ubicación del trabajo' };
}
function referenceInput(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('reference-input', 'Invalid visit references.');
  const files = Array.isArray(raw.files) ? raw.files : [];
  if (files.length > MAX_REFERENCE_FILES) fail('reference-limit', 'A booking supports up to 20 reference files.');
  const normalized = files.map(file => ({ id: referenceId(file.id), description: clean(file.description, 700) }));
  if (new Set(normalized.map(file => file.id)).size !== normalized.length) fail('reference-duplicate', 'A reference file cannot appear twice.');
  return { notes: clean(raw.notes, 3000), location: normalizeReferenceLocation(raw.location), files: normalized };
}
function referenceFingerprint(raw) {
  return crypto.createHash('sha256').update(JSON.stringify(referenceInput(raw))).digest('hex');
}

// Read every upload claim before any booking writes. The appointment is the only
// domain record; upload manifests are private staging/retention metadata.
async function prepareVisitReferencesCommit({ db, transaction, input, actor, appointmentId, current = null, now = new Date() }) {
  const normalized = referenceInput(input);
  if (!normalized) return null;
  const uid = clean(actor?.id || actor?.uid, 160);
  if (!uid || actor?.source !== 'office-scheduling') fail('reference-office-only', 'Only an authenticated office scheduler may edit visit references.');
  const profile = await transaction.get(db.collection('users').doc(uid));
  if (!profile.exists || !officeProfile(profile.data())) fail('reference-forbidden', 'An active, provisioned office account is required.');
  const records = [];
  for (const file of normalized.files) {
    const ref = db.collection(UPLOAD_COLLECTION).doc(file.id);
    const snapshot = await transaction.get(ref);
    const upload = snapshot.exists ? snapshot.data() : null;
    if (!upload || !['ready', 'linked'].includes(upload.status)) fail('reference-not-ready', 'A reference upload is missing or incomplete. Upload it again.');
    if (upload.appointmentId ? upload.appointmentId !== appointmentId : upload.uploadedBy !== uid) fail('reference-owner', 'A reference belongs to another booking or uploader.');
    if (!upload.appointmentId && Date.parse(upload.expiresAt) <= now.getTime()) fail('reference-expired', 'This draft upload expired. Upload it again.');
    if (upload.storagePath !== `booking-references/${upload.uploadedBy}/${file.id}`) fail('reference-path', 'Invalid reference storage identity.');
    records.push({ ref, upload, file });
  }
  const value = { ...normalized, version: Number(current?.version || 0) + 1, updatedAt: now.toISOString(), updatedBy: uid,
    files: records.map(({ upload, file }) => ({ ...file, storagePath: upload.storagePath, fileName: upload.fileName,
      mimeType: upload.mimeType, size: upload.size, kind: upload.kind, uploadedBy: upload.uploadedBy })) };
  return { value, write() { records.forEach(({ ref }) => transaction.set(ref, { status: 'linked', appointmentId, linkedAt: now.toISOString(), expiresAt: '9999-12-31T23:59:59.999Z' }, { merge: true })); } };
}

function createVisitReferenceService({ db, clock = () => new Date() }) {
  async function save({ appointmentId, references, expectedVersion, requestId, actor }) {
    const id = clean(appointmentId, 180);
    if (!id || id.includes('/')) fail('reference-appointment', 'A booking is required.');
    const key = referenceId(requestId);
    const fingerprint = referenceFingerprint(references);
    const now = clock();
    return db.runTransaction(async transaction => {
      const ref = db.collection('appointments').doc(id);
      const auditRef = ref.collection('referenceChanges').doc(key);
      const [snapshot, replay] = await Promise.all([transaction.get(ref), transaction.get(auditRef)]);
      if (!snapshot.exists) fail('reference-appointment', 'The booking no longer exists.');
      const appointment = snapshot.data();
      if (replay.exists) {
        if (replay.data().fingerprint !== fingerprint || replay.data().actorId !== actor.id) fail('reference-replay', 'This request was used for different references.');
        return { success: true, references: appointment.visitReferences, replayed: true };
      }
      if (['cancelled', 'canceled'].includes(appointment.status)) fail('reference-cancelled', 'References cannot be changed on a cancelled booking.');
      const current = appointment.visitReferences;
      if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(current?.version || 0)) fail('reference-conflict', 'Another operator updated these references. Reload before saving.');
      const prepared = await prepareVisitReferencesCommit({ db, transaction, input: references, actor, appointmentId: id, current, now });
      if (!prepared) fail('reference-required', 'References are required.');
      transaction.set(ref, { visitReferences: prepared.value }, { merge: true });
      prepared.write();
      transaction.set(auditRef, { fingerprint, actorId: actor.id, at: now.toISOString(), version: prepared.value.version,
        fileIds: prepared.value.files.map(file => file.id), operation: 'visit_references_updated' });
      return { success: true, references: prepared.value };
    });
  }
  return { save };
}

function referenceMessageParts({ text, appointment, order, client, sequence }) {
  const references = appointment?.visitReferences;
  const messages = [{ text }];
  for (const [index, file] of (references?.files || []).entries()) {
    const title = `*Trabajo ${sequence} · ${clean(client?.name || order.clientName, 100) || 'Cliente'} · ${order.time}*`;
    const caption = `${title}\nReferencia ${index + 1}: ${clean(file.fileName, 120)}${file.description ? `\n${file.description}` : ''}`;
    const media = { kind: file.kind, storagePath: file.storagePath, fileName: file.fileName, mimeType: file.mimeType };
    // WhatsApp voice messages do not carry captions. Send the explanation first.
    if (file.kind === 'voice') messages.push({ text: caption }, { text: '', media });
    else messages.push({ text: caption, media });
  }
  return messages;
}

module.exports = { MAX_REFERENCE_BYTES, MAX_REFERENCE_FILES, UPLOAD_COLLECTION, officeProfile, referenceId,
  validateReferenceFile, normalizeReferenceLocation, referenceInput, referenceFingerprint,
  prepareVisitReferencesCommit, createVisitReferenceService, referenceMessageParts };
