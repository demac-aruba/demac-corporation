'use strict';
const crypto = require('node:crypto');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { normalizeFieldIdentity, loadAssignedJob } = require('./fieldOperationsAuthorityCore');
const { arubaDateParts } = require('./bookingSchedulingPrimitives');
const { createTechnicianDailyScheduleService, activeWorkOrder, collapseContiguousSupportOrders } = require('./technicianDailyScheduleService');
const { MAX_REFERENCE_BYTES, UPLOAD_COLLECTION, officeProfile, referenceId, validateReferenceFile, createVisitReferenceService } = require('./bookingVisitReferences');
const error = (status, message) => Object.assign(new Error(message), { status });
const safeId = value => { const id = String(value || '').trim(); if (!id || id.length > 180 || id.includes('/')) throw error(400, 'Invalid booking identity.'); return id; };

function createReferenceHttpHandler({ db, bucket, verifyIdToken, clock = () => new Date(), authorizeJob = loadAssignedJob }) {
  const service = createVisitReferenceService({ db, clock });
  return async (request, response) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Cache-Control', 'private, no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS') return response.status(204).send('');
    try {
      if (!['GET', 'POST'].includes(request.method)) throw error(405, 'Use GET or POST.');
      const token = /^Bearer\s+(\S+)$/i.exec(request.get('authorization') || '')?.[1];
      if (!token) throw error(401, 'Sign in to DEMAC ERP.');
      let decoded;
      try { decoded = await verifyIdToken(token); } catch { throw error(401, 'Your session expired. Sign in again.'); }
      const profileSnapshot = await db.collection('users').doc(decoded.uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!profile || profile.active !== true) throw error(403, 'An active ERP account is required.');
      const office = officeProfile(profile);
      const actor = { id: decoded.uid, source: 'office-scheduling', name: profile.name || '' };
      if (request.method === 'POST') {
        if (!office) throw error(403, 'Only office schedulers may change booking references.');
        if (request.query.action === 'upload') {
          const id = referenceId(request.query.uploadId);
          const bytes = Buffer.isBuffer(request.rawBody) ? request.rawBody : Buffer.alloc(0);
          if (Number(request.get('content-length')) > MAX_REFERENCE_BYTES) throw error(413, 'Reference files must be 25 MB or smaller.');
          const file = validateReferenceFile({ fileName: request.query.fileName, contentType: request.get('content-type'), size: bytes.length });
          const digest = crypto.createHash('sha256').update(bytes).digest('hex');
          const ref = db.collection(UPLOAD_COLLECTION).doc(id);
          const existing = await ref.get();
          if (existing.exists) {
            const previous = existing.data();
            if (previous.uploadedBy !== actor.id || previous.digest !== digest || previous.fileName !== file.fileName || previous.mimeType !== file.mimeType) throw error(409, 'Upload identity is already used for another file.');
            if (['ready', 'linked'].includes(previous.status)) return response.status(200).json({ success: true, file: { ...file, id } });
            throw error(409, 'This upload is still processing or expired. Select the file again.');
          }
          const storagePath = `booking-references/${actor.id}/${id}`;
          await ref.create({ ...file, id, digest, storagePath, uploadedBy: actor.id, status: 'uploading',
            expiresAt: new Date(clock().getTime() + 24 * 60 * 60 * 1000).toISOString() });
          try {
            await bucket.file(storagePath).save(bytes, { resumable: false, metadata: { contentType: file.mimeType, cacheControl: 'private, no-store' } });
            await ref.set({ status: 'ready' }, { merge: true });
          } catch (cause) {
            await bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => {});
            await ref.delete().catch(() => {});
            throw cause;
          }
          return response.status(200).json({ success: true, file: { ...file, id } });
        }
        const input = request.body || {};
        return response.status(200).json(await service.save({ ...input, actor }));
      }
      let appointmentId = request.query.appointmentId;
      const workOrderId = request.query.workOrderId;
      if (!office) {
        const id = safeId(workOrderId);
        const identity = normalizeFieldIdentity({ uid: decoded.uid, profile, decoded });
        const order = await db.collection('workOrders').doc(id).get();
        if (!order.exists || order.data().date !== arubaDateParts(clock()).date) throw error(403, 'References are available only for your assigned work today.');
        await authorizeJob(db, identity, id);
        appointmentId = order.data().appointmentId;
      } else if (workOrderId) {
        const order = await db.collection('workOrders').doc(safeId(workOrderId)).get();
        if (!order.exists) throw error(404, 'Work Order not found.');
        appointmentId = order.data().appointmentId;
      }
      const fileId = request.query.fileId ? referenceId(request.query.fileId) : '';
      let file;
      let references;
      if (!appointmentId && office && fileId) {
        const upload = await db.collection(UPLOAD_COLLECTION).doc(fileId).get();
        if (!upload.exists || upload.data().uploadedBy !== actor.id || upload.data().status !== 'ready' || upload.data().appointmentId) throw error(403, 'Draft file is not available to this account.');
        file = upload.data();
      } else {
        const snapshot = await db.collection('appointments').doc(safeId(appointmentId)).get();
        if (!snapshot.exists) throw error(404, 'Booking not found.');
        references = snapshot.data().visitReferences || { notes: '', location: null, files: [], version: 0 };
        if (!fileId) return response.status(200).json({ success: true, references });
        file = references.files.find(item => item.id === fileId);
      }
      if (!file) throw error(404, 'Reference file not found.');
      const [bytes] = await bucket.file(file.storagePath).download();
      response.set('Content-Type', file.mimeType);
      response.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
      response.set('Content-Security-Policy', "sandbox; default-src 'none'");
      return response.status(200).send(bytes);
    } catch (cause) {
      const status = cause.status || (cause.details?.reason ? 400 : 500);
      if (status >= 500) logger.error('Booking reference request failed.', { code: cause.code || 'unknown' });
      return response.status(status).json({ success: false, error: { code: cause.details?.reason || cause.code || 'reference-request',
        message: status >= 500 ? 'References could not be saved. Retry the same request or reload to verify.' : cause.message } });
    }
  };
}
let handler;
exports.bookingVisitReferences = onRequest({ region: 'us-central1', memory: '512MiB', timeoutSeconds: 120, concurrency: 4 }, (request, response) => {
  if (!handler) handler = createReferenceHttpHandler({ db: getFirestore(), bucket: getStorage().bucket(), verifyIdToken: token => getAuth().verifyIdToken(token, true) });
  return handler(request, response);
});

async function cleanupReferenceUploads({ db, bucket, now = new Date() }) {
  const expired = await db.collection(UPLOAD_COLLECTION).where('expiresAt', '<=', now.toISOString()).limit(100).get();
  let deleted = 0;
  for (const item of expired.docs) {
    const remove = await db.runTransaction(async tx => {
      const current = await tx.get(item.ref);
      if (!current.exists || current.data().appointmentId || current.data().status === 'linked') return null;
      tx.set(item.ref, { status: 'deleting' }, { merge: true });
      return current.data().storagePath;
    });
    if (remove) { await bucket.file(remove).delete({ ignoreNotFound: true }); await item.ref.delete(); deleted++; }
  }
  return deleted;
}
exports.cleanupBookingReferenceUploads = onSchedule({ schedule: 'every 60 minutes', region: 'us-central1', timeoutSeconds: 120 }, () => cleanupReferenceUploads({ db: getFirestore(), bucket: getStorage().bucket() }));

async function notifyReferenceUpdate({ db, before, after, appointmentId, now = new Date() }) {
  if (!before || Number(before.visitReferences?.version || 0) === Number(after?.visitReferences?.version || 0)) return;
  const dayNow = arubaDateParts(now);
  if (after.date !== dayNow.date || dayNow.time < '08:00' || after.backdated === true || after.bookingMode === 'backdated' || after.status !== 'confirmed') return;
  const schedules = createTechnicianDailyScheduleService({ db });
  const day = await schedules.loadDay(after.date);
  if (day.appointmentsById.get(appointmentId)?.visitReferences?.version !== after.visitReferences.version) return;
  for (const van of day.vans) {
    const orders = collapseContiguousSupportOrders(day.workOrders.filter(order => order.vanId === van.id).sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id)));
    for (const [index, order] of orders.entries()) {
      if (order.appointmentId !== appointmentId || !activeWorkOrder(order)) continue;
      const result = await schedules.queueWorkOrder({ dateKey: after.date, van, order, day, sequence: index + 1,
        deliveryKey: `references-${after.visitReferences.version}`, reason: 'visit-references-updated' });
      if (!result.queued) logger.warn('Booking reference update could not be queued.', { appointmentId, vanId: van.id, reason: result.reason });
    }
  }
}
exports.notifyBookingReferenceUpdate = onDocumentUpdated({ document: 'appointments/{appointmentId}', region: 'us-central1', timeoutSeconds: 120, retry: true }, event => notifyReferenceUpdate({ db: getFirestore(), before: event.data?.before.data(), after: event.data?.after.data(), appointmentId: event.params.appointmentId }));
module.exports.createReferenceHttpHandler = createReferenceHttpHandler;
module.exports.cleanupReferenceUploads = cleanupReferenceUploads;
module.exports.notifyReferenceUpdate = notifyReferenceUpdate;
