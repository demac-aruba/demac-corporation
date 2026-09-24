const { hashKey, BookingAuthorityError } = require('./bookingAuthorityCore');

const COLLECTION = 'projectRecords';
const GENERAL_PHASE = 'GENERAL-PROJECT-WORK';
const MANAGERS = new Set(['owner', 'admin', 'superadmin', 'super_admin', 'operation', 'operations', 'manager', 'supervisor', 'project_manager', 'projects']);
const READERS = new Set([...MANAGERS, 'finance', 'accounting']);
const MAX_ASSIGNMENTS = 150;
function fail(message, code = 'invalid_request') { throw new BookingAuthorityError(code, message); }
function identifier(value) {
  if (typeof value !== 'string' || !/^[\w.-]{1,180}$/.test(value)) fail('A valid record identifier is required.');
  return value;
}
function roleAllows(role, write) {
  return (write ? MANAGERS : READERS).has(String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_'));
}
async function authorize(db, uid, write = false, transaction) {
  identifier(uid);
  const ref = db.collection('users').doc(uid);
  const snapshot = await (transaction ? transaction.get(ref) : ref.get());
  const profile = snapshot.exists && snapshot.data();
  if (!profile || profile.active === false || !roleAllows(profile.role, write)) fail('Projects permission is required.', 'permission_denied');
  return { id: uid, name: String(profile.name || profile.displayName || '').slice(0, 180), source: 'project-authority' };
}
function phaseExists(project, phaseId) {
  return phaseId === GENERAL_PHASE || project.phases.some(phase => phase.id === phaseId);
}
function normalizePlanningInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('A Project record is required.');
  const project = JSON.parse(JSON.stringify(input));
  for (const key of ['customerName', 'location', 'contactPerson', 'type', 'description', 'technicianInstructions', 'managerId', 'managerName', 'startsOn', 'estimatedCompletionOn', 'unitType']) {
    if (project[key] === undefined) project[key] = '';
    if (typeof project[key] !== 'string' || project[key].length > 5000) fail(`Invalid ${key}.`);
  }
  for (const key of ['totalUnits', 'completedUnits', 'estimatedWorkDays', 'scheduledFutureHours', 'actualLaborHours', 'materialActual']) project[key] ??= 0;
  project.priority ??= 'Normal'; project.slotsPerWorkDay ??= 6; project.slotDurationMinutes ??= 60; project.materialBudget ??= null;
  for (const key of ['assignedVans', 'materials', 'expenses', 'costEntries']) { project[key] ??= []; if (!Array.isArray(project[key])) fail(`Invalid ${key}.`); }
  if (project.assignedVans.length > 100 || project.assignedVans.some(id => typeof id !== 'string' || id.length > 180)) fail('Invalid assigned Vans.');
  return project;
}
function hasOperationalActivity(project) {
  return Number(project.completedUnits || 0) > 0
    || Number(project.actualLaborHours || 0) > 0
    || Number(project.scheduledFutureHours || 0) > 0
    || Number(project.materialActual || 0) > 0
    || (project.assignments || []).length > 0
    || (project.assignedVans || []).length > 0
    || (project.materials || []).length > 0
    || (project.expenses || []).length > 0
    || (project.costEntries || []).length > 0
    || (project.phases || []).some(phase => Number(phase.actualLaborHours || 0) > 0
      || Number(phase.actualMaterialCost || 0) > 0
      || Number(phase.unitsCompleted || 0) > 0
      || Number(phase.progress || 0) > 0
      || (phase.fieldReports || []).length > 0
      || (phase.status && phase.status !== 'Planned')
      || (phase.workflowStatus && !['Draft', 'Ready to Schedule'].includes(phase.workflowStatus)));
}
function assertBounded(project) {
  if (Buffer.byteLength(JSON.stringify(project)) > 600_000) fail('Project is too large to save.');
  if (!Array.isArray(project.phases) || project.phases.length > 100 || !Array.isArray(project.assignments) || project.assignments.length > MAX_ASSIGNMENTS) fail('Project exceeds the phase or booking-link limit.');
  identifier(project.id); identifier(project.customerId);
  if (typeof project.siteId !== 'string') fail('Invalid Project property identifier.');
  if (project.siteId) identifier(project.siteId);
  else if (project.status !== 'Draft' || hasOperationalActivity(project)) {
    fail('A Project without a Service Property must remain an unexecuted Draft.');
  }
  if (!String(project.name || '').trim() || !String(project.projectNumber || '').trim()) fail('Project name and number are required.');
  const phaseIds = new Set();
  for (const phase of project.phases) {
    if (!phase || typeof phase !== 'object' || Array.isArray(phase) || typeof phase.name !== 'string' || phase.name.length > 500) fail('Invalid Project phase.');
    identifier(phase.id);
    if (phaseIds.has(phase.id) || !String(phase.name || '').trim()) fail('Phase identifiers must be unique and names are required.');
    phaseIds.add(phase.id);
    if (!Number.isFinite(phase.estimatedLaborHours) || phase.estimatedLaborHours < 0) fail('Invalid phase budget.');
  }
  if (!Number.isFinite(project.estimatedSlots) || project.estimatedSlots < 0 || !Number.isInteger(project.estimatedSlots)) fail('Invalid Project slot budget.');
  for (const key of ['estimatedLaborHours', 'estimatedWorkDays', 'totalUnits', 'completedUnits', 'actualLaborHours', 'materialActual', 'scheduledFutureHours']) {
    if (project[key] !== undefined && (!Number.isFinite(project[key]) || project[key] < 0)) fail(`Invalid ${key}.`);
  }
  if (project.phases.reduce((sum, phase) => sum + phase.estimatedLaborHours, 0) > project.estimatedLaborHours) fail('Phase allocation exceeds the approved Project budget.');
  if (project.slotDurationMinutes !== undefined && project.slotDurationMinutes !== 60) fail('Projects use one-hour Van slots.');
  if (project.estimatedLaborHours !== project.estimatedSlots) fail('Project labor capacity must match the approved one-hour slot budget.');
  for (const key of ['name', 'projectNumber', 'customerName', 'location', 'type', 'contactPerson', 'managerName']) {
    if (project[key] !== undefined && (typeof project[key] !== 'string' || project[key].length > 500)) fail(`Invalid ${key}.`);
  }
  if (!['Draft', 'Planned', 'Active', 'On Hold', 'Near Completion', 'Completed', 'Cancelled'].includes(project.status)) fail('Invalid Project status.');
  for (const phase of project.phases) {
    if (phase.dependencies !== undefined && !Array.isArray(phase.dependencies)) fail('Phase dependencies must be a list.');
    if ((phase.dependencies || []).some(id => id === phase.id || !phaseIds.has(id))) fail('Invalid phase dependency.');
    if ((phase.checklist || []).length > 100 || (phase.fieldReports || []).length > 100) fail('Phase detail limit reached.');
  }
  const visited = new Set(); const pending = new Set();
  function visit(id) {
    if (pending.has(id)) fail('Phase dependencies cannot contain a cycle.');
    if (visited.has(id)) return;
    pending.add(id);
    for (const dependency of project.phases.find(phase => phase.id === id).dependencies || []) visit(dependency);
    pending.delete(id); visited.add(id);
  }
  project.phases.forEach(phase => visit(phase.id));
}
function assertNoActuals(project, previous) {
  for (const key of ['actualLaborHours', 'materialActual', 'completedUnits']) {
    if (Number(project[key] || 0) !== Number(previous?.[key] || 0)) fail('Actual execution and costs cannot be imported or edited through planning.');
  }
  for (const key of ['materials', 'expenses', 'costEntries']) {
    if (JSON.stringify(project[key] || []) !== JSON.stringify(previous?.[key] || [])) fail('Financial actuals require their own authority.');
  }
  for (const phase of project.phases) {
    const old = previous?.phases.find(item => item.id === phase.id);
    for (const key of ['actualLaborHours', 'actualMaterialCost', 'unitsCompleted', 'progress']) {
      if (Number(phase[key] || 0) !== Number(old?.[key] || 0)) fail('Recorded phase progress must remain unchanged.');
    }
    if (JSON.stringify(phase.fieldReports || []) !== JSON.stringify(old?.fieldReports || [])) fail('Field reports cannot be imported through planning.');
    for (const item of phase.checklist || []) if (Boolean(item.done) !== Boolean(old?.checklist?.find(previousItem => previousItem.id === item.id)?.done)) fail('Checklist completion requires verified execution.');
    if (phase.workflowStatus === 'Completed' && old?.workflowStatus !== 'Completed') fail('Phase completion requires verified execution.');
  }
  for (const phase of previous?.phases || []) if (!project.phases.some(item => item.id === phase.id)
    && (phase.actualLaborHours || phase.unitsCompleted || phase.progress || phase.fieldReports?.length)) fail('A phase with recorded activity cannot be removed.');
}
async function validateLinks(db, transaction, project, previous) {
  const claims = [];
  const seen = new Set();
  for (const link of project.assignments) {
    identifier(link.appointmentId); identifier(link.workOrderId);
    if (seen.has(link.workOrderId) || !phaseExists(project, link.phaseId) || link.projectId !== project.id) fail('Invalid or duplicate Project booking link.');
    seen.add(link.workOrderId);
    const claimRef = db.collection('projectBookingClaims').doc(link.appointmentId);
    const [appointmentSnap, orderSnap, claimSnap] = await Promise.all([
      transaction.get(db.collection('appointments').doc(link.appointmentId)),
      transaction.get(db.collection('workOrders').doc(link.workOrderId)), transaction.get(claimRef),
    ]);
    const appointment = appointmentSnap.exists && appointmentSnap.data();
    const order = orderSnap.exists && orderSnap.data();
    if (!appointment || !order || appointment.customerId !== project.customerId || appointment.propertyId !== project.siteId
      || order.clientId !== project.customerId || order.propertyId !== project.siteId || order.appointmentId !== link.appointmentId
      || !(appointment.workOrderIds || []).includes(link.workOrderId)) fail('A Project link does not match canonical customer, property and booking records.');
    if (claimSnap.exists && claimSnap.data().projectId !== project.id) fail('This appointment already belongs to another Project.');
    if (appointment.projectId && appointment.projectId !== project.id) fail('Canonical appointment belongs to another Project.');
    const old = previous?.assignments.find(item => item.workOrderId === link.workOrderId);
    if (old && (old.appointmentId !== link.appointmentId || old.phaseId !== link.phaseId)) fail('Existing booking links cannot be moved to another phase or appointment.');
    if (Number(link.actualHours || 0) !== Number(old?.actualHours || 0) || Number(link.unitsCompleted || 0) !== Number(old?.unitsCompleted || 0)
      || (link.postedAt || '') !== (old?.postedAt || '')) fail('Planning cannot create actual work.');
    {
      // Derive capacity and crew from the canonical Work Order, never the import.
      Object.assign(link, { id: `PASG-${link.workOrderId}`, vanId: order.vanId, technicianIds: order.technicianIds || [],
        scheduledDate: order.date, scheduledStart: order.time, scheduledEnd: order.appointmentCapacityEndTime || order.appointmentEndTime || '',
        scheduledSlots: Number(order.scheduledSlots || 0), scheduledHours: Number(order.scheduledSlots || 0), actualHours: old?.actualHours || 0,
        unitsCompleted: old?.unitsCompleted || 0, unitsPlanned: old?.unitsPlanned || Number(link.unitsPlanned || 0), status: old?.status || 'Scheduled', bookingStatus: appointment.status === 'temporary_hold' ? 'temporary_hold' : 'confirmed' });
    }
    claims.push({ ref: claimRef, value: { projectId: project.id, appointmentId: link.appointmentId } });
  }
  for (const link of previous?.assignments || []) if (!seen.has(link.workOrderId)) fail('Booking history cannot be removed from a Project.');
  return claims;
}
function createProjectRecords({ db, clock = () => new Date() }) {
  async function list(uid) {
    await authorize(db, uid);
    const snapshot = await db.collection(COLLECTION).orderBy('id').limit(201).get();
    if (snapshot.size > 200) fail('Project portfolio limit reached; pagination is required.');
    return { success: true, projects: snapshot.docs.map(doc => doc.data()) };
  }
  async function save({ project: input, expectedVersion, requestId, dryRun = false }, uid) {
    await authorize(db, uid, true);
    identifier(requestId);
    const project = normalizePlanningInput(input);
    assertBounded(project);
    const fingerprint = hashKey(JSON.stringify({ project, expectedVersion }), 64);
    const ref = db.collection(COLLECTION).doc(project.id);
    const numberRef = db.collection('projectNumberClaims').doc(hashKey(String(project.projectNumber).trim().toUpperCase(), 64));
    const auditRef = db.collection('projectPlanningAudit').doc(hashKey(`${uid}:${requestId}`, 64));
    return db.runTransaction(async transaction => {
      const actor = await authorize(db, uid, true, transaction);
      const propertyRef = project.siteId ? db.collection('properties').doc(project.siteId) : null;
      const [snapshot, numberSnap, auditSnap, customerSnap, propertySnap] = await Promise.all([
        transaction.get(ref), transaction.get(numberRef), transaction.get(auditRef),
        transaction.get(db.collection('clients').doc(project.customerId)), propertyRef ? transaction.get(propertyRef) : Promise.resolve(null),
      ]);
      if (auditSnap.exists) {
        if (auditSnap.data().fingerprint !== fingerprint) fail('Request identifier was already used with different data.', 'conflict');
        return { success: true, replayed: true, project: snapshot.data() };
      }
      const previous = snapshot.exists ? snapshot.data() : null;
      if (Number(expectedVersion) !== Number(previous?.serverVersion || 0)) fail('Project changed in another session. Reload before saving.', 'conflict');
      const attachingDraftProperty = previous?.siteId === '' && previous.status === 'Draft'
        && project.siteId && project.status === 'Draft'
        && !hasOperationalActivity(previous) && !hasOperationalActivity(project);
      if (previous && (previous.customerId !== project.customerId || previous.projectNumber !== project.projectNumber
        || (previous.siteId !== project.siteId && !attachingDraftProperty))) {
        fail('Published Project identity cannot be changed through planning.');
      }
      if (previous && (hasOperationalActivity(previous) || hasOperationalActivity(project))
        && (previous.type !== project.type || previous.location !== project.location || previous.status !== project.status)) {
        fail('Project type, location and status cannot change through planning after operational activity.');
      }
      if (previous && (previous.status === 'Completed') !== (project.status === 'Completed')) {
        fail('Completed Project status requires a dedicated completion workflow.');
      }
      if (previous && project.estimatedSlots < previous.estimatedSlots) {
        fail('Reducing a shared Project slot budget requires canonical Scheduling verification.');
      }
      if (!customerSnap.exists || customerSnap.data().active === false) fail('Select an active canonical CRM customer.');
      if (project.siteId && (!propertySnap.exists || propertySnap.data().clientId !== project.customerId || propertySnap.data().active === false)) {
        fail('Select an active Service Property belonging to this customer.');
      }
      if (numberSnap.exists && numberSnap.data().projectId !== project.id) fail('Project number already exists.', 'conflict');
      assertNoActuals(project, previous);
      const claims = await validateLinks(db, transaction, project, previous);
      const now = clock().toISOString();
      const next = { ...project, serverVersion: Number(previous?.serverVersion || 0) + 1, updatedAtIso: now,
        updatedBy: actor.id, createdAtIso: previous?.createdAtIso || now, createdBy: previous?.createdBy || actor.id };
      if (!dryRun) {
        transaction.set(ref, next);
        transaction.set(numberRef, { projectId: project.id });
        claims.forEach(claim => transaction.set(claim.ref, claim.value));
        transaction.set(auditRef, { projectId: project.id, fingerprint, actor, recordedAtIso: now, version: next.serverVersion, operation: previous ? 'update' : 'publish' });
      }
      return { success: true, dryRun, project: next };
    });
  }
  return { list, save };
}
module.exports = { COLLECTION, GENERAL_PHASE, MAX_ASSIGNMENTS, fail, identifier, authorize, phaseExists, createProjectRecords };
