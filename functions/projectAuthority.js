const { onRequest } = require('firebase-functions/v2/https');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createProjectRecords, authorize, identifier, fail } = require('./projectRecords');
const { createProjectHistoricalCapacityAuthority } = require('./bookingProjectHistoricalCapacity');
const { createHistoricalProjectProvider, normalizeCorrection, readEvidence, lockId } = require('./projectHistoricalBooking');
const { REGULAR_SLOTS, EXTRA_MORNING_SLOT } = require('./bookingSchedulingPrimitives');

function createProjectApi({ db, verifyIdToken, clock = () => new Date() }) {
  const records = createProjectRecords({ db, clock });
  const historicalCapacity = createProjectHistoricalCapacityAuthority({ db, clock });
  async function handle(request) {
    if (request.method === 'OPTIONS') return { status: 204, body: null };
    if (request.method !== 'POST') return { status: 405, body: { success: false, error: { message: 'POST is required.' } } };
    try {
      const token = /^Bearer (\S+)$/i.exec(request.headers?.authorization || '')?.[1];
      if (!token) fail('Sign in to Projects.', 'unauthenticated');
      let decoded;
      try { decoded = await verifyIdToken(token); } catch { fail('Your session expired.', 'unauthenticated'); }
      const uid = identifier(decoded.uid);
      const { action, data = {} } = request.body || {};
      const actor = await authorize(db, uid, action !== 'list');
      let result;
      if (action === 'list') result = await records.list(uid);
      else if (action === 'save') result = await records.save(data, uid);
      else if (action === 'history_capacity_sources') result = await historicalCapacity.sources(uid, data.projectId);
      else if (action === 'history_adjust_capacity') result = await historicalCapacity.adjust(uid, data);
      else if (action === 'history_sources') {
        const snapshot = await db.collection('projectRecords').doc(identifier(data.projectId)).get();
        if (!snapshot.exists) fail('Publish the Project before correcting historical bookings.');
        const project = snapshot.data();
        const ids = [...new Set(project.assignments.map(link => link.appointmentId))];
        const snapshots = ids.length ? await db.getAll(...ids.map(id => db.collection('appointments').doc(id))) : [];
        const claims = ids.length ? await db.getAll(...ids.map(id => db.collection('projectHistoricalCorrections').doc(id))) : [];
        const sources = snapshots.flatMap((item, index) => {
          const source = item.exists && item.data();
          if (!source || source.status !== 'cancelled' || claims[index].exists || source.assignments?.length !== 1) return [];
          const assignment = source.assignments[0];
          const link = project.assignments.find(row => row.appointmentId === item.id);
          return [{ appointmentId: item.id, phaseId: link.phaseId, date: source.date, vanId: assignment.vanId, vanName: assignment.vanName || assignment.vanId,
            technicianIds: assignment.technicianIds || [], slots: assignment.slots,
            starts: [...REGULAR_SLOTS, EXTRA_MORNING_SLOT].sort().filter(slot => (source.capacityLockIds || []).includes(lockId(source.date, assignment.vanId, slot))) }];
        }).sort((a, b) => a.date.localeCompare(b.date) || a.appointmentId.localeCompare(b.appointmentId));
        const staffIds = [...new Set(sources.flatMap(source => source.technicianIds))];
        const staff = staffIds.length ? await db.getAll(...staffIds.map(id => db.collection('staffProfiles').doc(identifier(id)))) : [];
        result = { success: true, corrections: claims.filter(item => item.exists).map(item => item.data()).sort((a, b) => a.date.localeCompare(b.date) || a.recordedAtIso.localeCompare(b.recordedAtIso)), sources: sources.map(source => ({ ...source, technicianNames: source.technicianIds.map(id => {
          const person = staff.find(item => item.id === id); const record = person?.exists ? person.data() : {};
          return record.name || record.fullName || id;
        }) })) };
      }
      else if (action === 'history_preview') {
        // Recovery only: readEvidence requires an already-cancelled source and no
        // replacement claim. Confirmed bookings use history_adjust_capacity.
        if (data.backdatingAcknowledged !== true) fail('Acknowledge the historical recovery before continuing.');
        identifier(data.requestId);
        const input = normalizeCorrection(data);
        const evidence = await readEvidence(db, input, uid, clock());
        const provider = createHistoricalProjectProvider({ db, input, uid });
        const authority = createBookingAuthority({ db, availabilityProvider: provider, clock });
        result = await authority.checkAvailability({
          request: { customerId: evidence.project.customerId, propertyId: evidence.project.siteId,
            dwellingId: evidence.source.dwellingId, requesterId: evidence.source.requesterId, accessContactId: evidence.source.accessContactId,
            constraints: { requestedDate: evidence.option.date, requestedTime: input.start }, notes: input.reason,
            workLines: [{ presetId: 'other', quantity: 1, manualDurationMinutes: input.slots * 60,
              customerFacingDescription: `Project · ${evidence.project.name}` }] }, actor,
          context: { channel: 'office', requestKey: `project-history:${uid}:${data.requestId}`, bookingMode: 'backdated', backdatingAcknowledged: true },
        });
      } else if (action === 'history_confirm') {
        if (data.backdatingAcknowledged !== true || data.noBillingAcknowledged !== true) {
          fail('Acknowledge historical recovery and verify there is no invoice or payment, including outside DEMAC ERP.');
        }
        identifier(data.requestId); identifier(data.offerId);
        const offerSnap = await db.collection('bookingOffers').doc(data.offerId).get();
        const history = offerSnap.exists && offerSnap.data().metadata?.projectHistory;
        if (!history || history.actorId !== uid || history.noBillingAcknowledged !== true) {
          fail('This historical recovery offer is not available to your session.', 'permission_denied');
        }
        if (history.overBudgetAcknowledged && data.overBudgetAcknowledged !== true) {
          fail('Acknowledge the approved Project slot budget overrun before confirming recovery.');
        }
        const provider = createHistoricalProjectProvider({ db, input: history, uid });
        const authority = createBookingAuthority({ db, availabilityProvider: provider, clock });
        result = await authority.createAppointment({ offerId: data.offerId, offerVersion: data.offerVersion, optionId: data.optionId,
          idempotencyKey: `project-history:${uid}:${data.requestId}`, actor,
          context: { channel: 'office', bookingMode: 'backdated', backdatingAcknowledged: true } });
      } else fail('Unsupported Projects action.');
      return { status: 200, body: result };
    } catch (error) {
      const domainError = error.name === 'BookingAuthorityError';
      const status = error.code === 'unauthenticated' ? 401 : error.code === 'permission_denied' ? 403 : error.code === 'conflict' ? 409 : domainError ? 400 : 500;
      return { status, body: { success: false, error: { code: domainError ? error.code : 'project_unavailable',
        message: domainError ? error.message : 'Projects could not verify the result. Retry the same request or reload to recover it.' } } };
    }
  }
  return { handle };
}
let api;
exports.projectAuthority = onRequest({ region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 }, async (request, response) => {
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  api ||= createProjectApi({ db: getFirestore(), verifyIdToken: token => getAuth().verifyIdToken(token, true) });
  const result = await api.handle(request);
  if (result.status === 204) response.status(204).send('');
  else response.status(result.status).json(result.body);
});
module.exports.createProjectApi = createProjectApi;
