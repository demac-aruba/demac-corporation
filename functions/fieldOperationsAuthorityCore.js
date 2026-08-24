const { canonicalizeVanCatalog, resolveCanonicalVanId } = require('./bookingVanIdentity');
const { resolveCrewMembership } = require('./bookingSchedulingPrimitives');

const FIELD_OPERATIONS_API_VERSION = 1;
const FIELD_ROLES = new Set(['technician', 'operations', 'office_operator', 'super_admin']);
const OPERATIONS_ROLES = new Set(['operations', 'office_operator', 'super_admin']);
const PRICE_OVERRIDE_ROLES = new Set(['operations', 'super_admin']);
const FIELD_ACTIVE_WORK_ORDER_STATUSES = new Set(['Confirmada', 'Asignada', 'En camino', 'En el sitio', 'En proceso', 'Pendiente']);
const FIELD_SCHEDULE_VISIBLE_WORK_ORDER_STATUSES = new Set([...FIELD_ACTIVE_WORK_ORDER_STATUSES, 'Completada']);
const FIELD_ALLOWED_ACTIONS = Object.freeze([
  'read',
  'execute',
  'report.edit',
  'evidence.add',
  'measurement.add',
  'finding.add',
  'asset.add',
  'intervention.add',
  'sale.propose',
  'intervention.complete',
  'visit.complete',
  'office.review',
  'price.override',
]);
const RESPONSIBILITY_ACTIONS = Object.freeze({
  lead: Object.freeze([
    'read', 'execute', 'report.edit', 'evidence.add', 'measurement.add', 'finding.add',
    'asset.add', 'intervention.add', 'sale.propose', 'intervention.complete', 'visit.complete',
  ]),
  technician: Object.freeze([
    'read', 'execute', 'report.edit', 'evidence.add', 'measurement.add', 'finding.add',
    'asset.add', 'intervention.add', 'sale.propose', 'intervention.complete',
  ]),
  helper: Object.freeze(['read', 'report.edit', 'evidence.add', 'measurement.add', 'finding.add']),
  office: Object.freeze(['read', 'office.review']),
});

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function unique(values) {
  return [...new Set(values.map((value) => text(value, 180)).filter(Boolean))];
}

function fieldError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function normalizeFieldRole(value) {
  const raw = text(value, 80).toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'owner' || raw === 'admin' || raw === 'superadmin' || raw === 'super_admin') return 'super_admin';
  if (raw === 'operation' || raw === 'operations' || raw === 'manager' || raw === 'supervisor') return 'operations';
  if (raw === 'office' || raw === 'operator' || raw === 'office_operator') return 'office_operator';
  if (raw === 'technician' || raw === 'tech') return 'technician';
  return raw;
}

function normalizeFieldIdentity({ uid, profile = {}, decoded = {} }) {
  // `users/{uid}.role` is the governed ERP role authority. Token claims may describe the
  // authenticated Firebase session but must never fill a missing/invalid DEMAC profile role.
  const role = normalizeFieldRole(profile.role);
  if (!FIELD_ROLES.has(role)) throw fieldError('permission_denied', 'This user is not authorized for Field Operations.', 403);
  if (!profile || profile.active !== true) throw fieldError('permission_denied', 'This DEMAC ERP user is inactive or not provisioned.', 403);
  const staffId = text(profile.staffId, 180);
  if (role === 'technician' && !staffId) throw fieldError('technician_staff_required', 'This technician account is not linked to a DEMAC staff profile.', 403);
  return {
    uid: text(uid || decoded.uid || decoded.sub, 180),
    name: text(profile.name || decoded.name || decoded.email, 180),
    email: text(profile.email || decoded.email, 320),
    role,
    staffId,
    vanId: text(profile.vanId, 180),
    operations: OPERATIONS_ROLES.has(role),
  };
}

function validDateKey(value) {
  const dateKey = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw fieldError('invalid_date', 'A YYYY-MM-DD date is required.');
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) throw fieldError('invalid_date', 'The requested date is invalid.');
  return dateKey;
}

function dateRange(startDate, endDate, maximumDays = 7) {
  const start = validDateKey(startDate);
  const end = validDateKey(endDate || start);
  if (end < start) throw fieldError('invalid_date_range', 'Schedule end date cannot be before the start date.');
  const keys = [];
  let cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last && keys.length < maximumDays) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (cursor <= last) throw fieldError('date_range_too_large', `Field schedule requests are limited to ${maximumDays} days.`);
  return keys;
}

function activeWorkOrder(order) {
  return Boolean(order) && FIELD_ACTIVE_WORK_ORDER_STATUSES.has(text(order.status, 80));
}

function scheduleVisibleWorkOrder(order) {
  return Boolean(order) && FIELD_SCHEDULE_VISIBLE_WORK_ORDER_STATUSES.has(text(order.status, 80));
}

function snapshotItems(snapshot) {
  return (snapshot?.docs || []).map((document) => ({ id: document.id, ...document.data() }));
}

async function getDocument(db, collection, id) {
  const normalizedId = text(id, 180);
  if (!normalizedId) return null;
  const snapshot = await db.collection(collection).doc(normalizedId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function queryItems(query) {
  return snapshotItems(await query.get());
}

function canonicalVanReference(value, context) {
  return resolveCanonicalVanId(value, context?.vanAliases || new Map()) || text(value, 180);
}

async function loadCrewContext(db, dateKey) {
  const [assignmentSnapshot, vansSnapshot] = await Promise.all([
    db.collection('dailyVanAssignments').where('date', '==', dateKey).get(),
    db.collection('vans').get(),
  ]);
  const rawVans = snapshotItems(vansSnapshot);
  const catalog = canonicalizeVanCatalog(rawVans);
  const dailyAssignments = snapshotItems(assignmentSnapshot).map((assignment) => ({
    ...assignment,
    vanId: resolveCanonicalVanId(assignment.vanId, catalog.aliases) || text(assignment.vanId, 180),
  }));
  const memberships = catalog.vans.map((van) => resolveCrewMembership(van, dateKey, dailyAssignments));
  return {
    dailyAssignments,
    vans: catalog.vans,
    memberships,
    vanAliases: catalog.aliases,
  };
}

function membershipIncludesStaff(membership, staffId) {
  return Boolean(membership) && (
    text(membership.driverStaffId, 180) === staffId
    || text(membership.helperStaffId, 180) === staffId
  );
}

function profileVanFallbackAllowed(identity, context) {
  const staffId = text(identity?.staffId, 180);
  const profileVanId = canonicalVanReference(identity?.vanId, context);
  if (!staffId || !profileVanId) return false;

  // A dated assignment is the authoritative override for that date even if its Van reference is
  // historical/malformed and therefore cannot enter the canonical Van membership projection.
  const hasDatedStaffAssignment = context.dailyAssignments.some((assignment) => (
    text(assignment.driverStaffId, 180) === staffId
    || text(assignment.helperStaffId, 180) === staffId
  ));
  if (hasDatedStaffAssignment) return false;

  // Likewise, if the profile Van itself has a dated override to other staff, the old profile
  // value cannot grant read access to that Van's work for the day.
  const profileVanHasDatedOverride = context.dailyAssignments.some((assignment) => (
    canonicalVanReference(assignment.vanId, context) === profileVanId
  ));
  return !profileVanHasDatedOverride;
}

function fieldAssignmentForIdentity(identity, order, dateKey, context) {
  if (identity.operations) {
    return { assigned: true, responsibility: 'office', source: 'office', readOnly: true };
  }

  const staffId = identity.staffId;
  const orderVanId = canonicalVanReference(order?.vanId, context);
  const membership = context.memberships.find((item) => canonicalVanReference(item.vanId, context) === orderVanId);
  if (membership && text(membership.driverStaffId, 180) === staffId) {
    return { assigned: true, responsibility: 'lead', source: membership.source, readOnly: false };
  }
  if (membership && text(membership.helperStaffId, 180) === staffId) {
    return { assigned: true, responsibility: 'helper', source: membership.source, readOnly: false };
  }

  const technicianIds = Array.isArray(order?.technicianIds) ? order.technicianIds.map((id) => text(id, 180)) : [];
  if (technicianIds.includes(staffId) || technicianIds.includes(identity.uid)) {
    return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false };
  }

  const profileVanId = canonicalVanReference(identity.vanId, context);
  if (profileVanFallbackAllowed(identity, context) && profileVanId && orderVanId && profileVanId === orderVanId) {
    return { assigned: true, responsibility: 'technician', source: 'profile_van_fallback', readOnly: true };
  }

  return { assigned: false, responsibility: null, source: 'unassigned', readOnly: true };
}

function allowedActionsForAssignment(identity, assignment) {
  if (!assignment?.assigned) return [];
  if (identity.operations) {
    const actions = [...RESPONSIBILITY_ACTIONS.office];
    if (PRICE_OVERRIDE_ROLES.has(identity.role)) actions.push('price.override');
    return actions;
  }
  if (assignment.readOnly) return ['read'];
  return [...(RESPONSIBILITY_ACTIONS[assignment.responsibility] || ['read'])];
}

function allowedActionsForWorkOrder(identity, assignment, order) {
  const actions = allowedActionsForAssignment(identity, assignment);
  if (activeWorkOrder(order)) return actions;
  return actions.includes('read') ? ['read'] : [];
}

function crewResponsibility({ identity, dateKey, workOrder, ...context }) {
  return fieldAssignmentForIdentity(identity, workOrder, dateKey, context).responsibility || 'technician';
}

function assignedVanIds(identity, _dateKey, context) {
  if (identity.operations) return [];
  const membershipVanIds = context.memberships
    .filter((membership) => membershipIncludesStaff(membership, identity.staffId))
    .map((membership) => canonicalVanReference(membership.vanId, context));
  const profileVanId = profileVanFallbackAllowed(identity, context)
    ? canonicalVanReference(identity.vanId, context)
    : '';
  return unique([...membershipVanIds, profileVanId]);
}

function vanQueryIds(identity, dateKey, context) {
  const canonicalIds = new Set(assignedVanIds(identity, dateKey, context));
  const queryIds = new Set(canonicalIds);
  for (const [rawVanId, canonicalVanId] of context.vanAliases.entries()) {
    if (canonicalIds.has(canonicalVanId)) queryIds.add(rawVanId);
  }
  if (identity.vanId && profileVanFallbackAllowed(identity, context)) queryIds.add(identity.vanId);
  return unique([...queryIds]);
}

async function loadAssignedOrdersForDate(db, identity, dateKey, context) {
  if (identity.operations) {
    return queryItems(db.collection('workOrders').where('date', '==', dateKey));
  }

  const queries = [];
  for (const technicianId of unique([identity.staffId, identity.uid])) {
    queries.push(db.collection('workOrders').where('date', '==', dateKey).where('technicianIds', 'array-contains', technicianId).get());
  }
  for (const vanId of vanQueryIds(identity, dateKey, context)) {
    queries.push(db.collection('workOrders').where('date', '==', dateKey).where('vanId', '==', vanId).get());
  }
  const snapshots = await Promise.all(queries);
  const byId = new Map();
  for (const snapshot of snapshots) {
    for (const order of snapshotItems(snapshot)) byId.set(order.id, order);
  }
  return [...byId.values()];
}

function orderAssignedToIdentity(identity, order, dateKey, context) {
  return fieldAssignmentForIdentity(identity, order, dateKey, context).assigned;
}

function plannedWorkItems(order, appointment) {
  const orderItems = Array.isArray(order?.appointmentWorkItems) ? order.appointmentWorkItems : [];
  if (orderItems.length) return orderItems.map((item, index) => ({
    id: text(item.id || item.presetId || `planned-${index + 1}`, 180),
    serviceId: text(item.serviceId, 180),
    presetId: text(item.presetId, 180),
    label: text(item.label || item.presetId || 'Trabajo programado', 240),
    quantity: Math.max(1, Number(item.quantity) || 1),
    durationMinutes: Math.max(0, Number(item.durationMinutes) || 0),
  }));
  const lines = Array.isArray(appointment?.workLines) ? appointment.workLines : [];
  return lines.map((line, index) => ({
    id: text(line.id || line.presetId || `planned-${index + 1}`, 180),
    serviceId: text(line.serviceId, 180),
    presetId: text(line.presetId, 180),
    label: text(line.label || line.presetLabel || line.presetId || 'Trabajo programado', 240),
    quantity: Math.max(1, Number(line.quantity) || 1),
    durationMinutes: Math.max(0, Number(line.durationMinutes) || Number(line.manualDurationMinutes) || 0),
  }));
}

function projectScheduleJob({ order, client, property, appointment, identity, assignment }) {
  return {
    id: order.id,
    workOrderId: order.id,
    appointmentId: text(order.appointmentId, 180),
    date: text(order.date, 10),
    time: text(order.time, 20),
    endTime: text(order.appointmentEndTime, 20),
    status: text(order.status, 80),
    customerId: text(order.clientId, 180),
    customerName: text(client?.name || client?.company || order.clientName || 'Cliente', 240),
    propertyId: text(order.propertyId, 180),
    propertyName: text(property?.name, 240),
    address: text(order.address || property?.address || property?.addressRaw, 500),
    latitude: Number.isFinite(Number(property?.latitude)) ? Number(property.latitude) : null,
    longitude: Number.isFinite(Number(property?.longitude)) ? Number(property.longitude) : null,
    arrivalPhone: text(client?.phone, 80),
    arrivalWhatsapp: text(client?.whatsapp || client?.phone, 80),
    accessInstructions: text(property?.accessInstructions || property?.propertyAccessInstructions || property?.entryInstructions || property?.accessNotes, 1500),
    customerFacingDescription: text(order.customerFacingDescription || order.problem, 1500),
    technicianInstructions: text(order.technicianInstructions, 1500),
    plannedWork: plannedWorkItems(order, appointment),
    estimatedQuantity: Math.max(0, Number(order.airConditionerCount) || 0),
    vanId: canonicalVanReference(order.vanId, assignment.context),
    technicianIds: unique(Array.isArray(order.technicianIds) ? order.technicianIds : []),
    responsibility: assignment.responsibility,
    assignmentSource: assignment.source,
    allowedActions: allowedActionsForWorkOrder(identity, assignment, order),
    assignmentRole: text(order.appointmentAssignmentRole, 40),
  };
}

async function loadRelatedMaps(db, orders) {
  const ids = (key) => unique(orders.map((order) => order[key]));
  async function mapCollection(collection, values) {
    const records = await Promise.all(values.map((id) => getDocument(db, collection, id)));
    return new Map(records.filter(Boolean).map((record) => [record.id, record]));
  }
  const [clients, properties, appointments] = await Promise.all([
    mapCollection('clients', ids('clientId')),
    mapCollection('properties', ids('propertyId')),
    mapCollection('appointments', ids('appointmentId')),
  ]);
  return { clients, properties, appointments };
}

function orderTimeKey(order) {
  return `${text(order.date, 10)}T${text(order.time || '99:99', 20).padStart(5, '0')}|${order.id}`;
}

function assignmentWithContext(identity, order, dateKey, context) {
  return { ...fieldAssignmentForIdentity(identity, order, dateKey, context), context };
}

async function loadAssignedSchedule(db, identity, startDate, endDate) {
  const dates = dateRange(startDate, endDate, 7);
  const rows = [];
  for (const dateKey of dates) {
    const context = await loadCrewContext(db, dateKey);
    const orders = (await loadAssignedOrdersForDate(db, identity, dateKey, context)).filter(scheduleVisibleWorkOrder);
    const maps = await loadRelatedMaps(db, orders);
    for (const order of orders) {
      const assignment = assignmentWithContext(identity, order, dateKey, context);
      if (!assignment.assigned) continue;
      rows.push(projectScheduleJob({
        order,
        client: maps.clients.get(text(order.clientId, 180)),
        property: maps.properties.get(text(order.propertyId, 180)),
        appointment: maps.appointments.get(text(order.appointmentId, 180)),
        identity,
        assignment,
      }));
    }
  }
  return rows.sort((a, b) => orderTimeKey(a).localeCompare(orderTimeKey(b)));
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value, 240);
    if (normalized) return normalized;
  }
  return '';
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function equipmentTechnicalProjection(item) {
  const components = Array.isArray(item?.components) ? item.components : [];
  const indoor = components.find((component) => text(component?.componentType, 80).toLowerCase() === 'indoor') || components[0] || {};
  const outdoor = components.find((component) => text(component?.componentType, 80).toLowerCase() === 'outdoor') || {};
  return {
    brand: firstText(indoor.brand, item.brand, outdoor.brand),
    model: firstText(indoor.model, indoor.modelNumber, item.model, item.modelNumber, outdoor.model, outdoor.modelNumber),
    serial: firstText(indoor.serial, indoor.serialNumber, item.serial, item.serialNumber, outdoor.serial, outdoor.serialNumber),
    btu: firstValue(indoor.btu, indoor.capacityBtu, item.btu, item.capacityBtu, outdoor.btu, outdoor.capacityBtu) ?? null,
    refrigerant: firstText(indoor.refrigerant, item.refrigerant, outdoor.refrigerant),
    voltage: firstText(indoor.voltage, item.voltage, outdoor.voltage),
  };
}

async function loadAssignedJob(db, identity, workOrderId) {
  const order = await getDocument(db, 'workOrders', workOrderId);
  if (!order || !scheduleVisibleWorkOrder(order)) throw fieldError('work_order_not_found', 'The requested Work Order is not available.', 404);
  const dateKey = validDateKey(order.date);
  const context = await loadCrewContext(db, dateKey);
  const assignment = assignmentWithContext(identity, order, dateKey, context);
  if (!assignment.assigned) throw fieldError('permission_denied', 'You are not assigned to this Work Order.', 403);
  const maps = await loadRelatedMaps(db, [order]);
  const equipmentQuery = db.collection('equipmentSystems').where('clientId', '==', text(order.clientId, 180));
  const equipmentSnapshot = text(order.propertyId, 180)
    ? await equipmentQuery.where('propertyId', '==', text(order.propertyId, 180)).get()
    : await equipmentQuery.get();
  const equipment = snapshotItems(equipmentSnapshot)
    .filter((item) => item.active !== false)
    .map((item) => {
      const technical = equipmentTechnicalProjection(item);
      return {
        id: item.id,
        qrCode: text(item.qrCode, 180),
        locationLabel: text(item.locationLabel, 240),
        systemType: text(item.systemType, 120),
        ...technical,
        condition: text(item.condition, 120),
        active: item.active !== false,
      };
    });
  return {
    ...projectScheduleJob({
      order,
      client: maps.clients.get(text(order.clientId, 180)),
      property: maps.properties.get(text(order.propertyId, 180)),
      appointment: maps.appointments.get(text(order.appointmentId, 180)),
      identity,
      assignment,
    }),
    knownEquipment: equipment,
  };
}

module.exports = {
  FIELD_ALLOWED_ACTIONS,
  FIELD_OPERATIONS_API_VERSION,
  activeWorkOrder,
  allowedActionsForAssignment,
  allowedActionsForWorkOrder,
  assignedVanIds,
  crewResponsibility,
  dateRange,
  equipmentTechnicalProjection,
  fieldAssignmentForIdentity,
  fieldError,
  loadAssignedJob,
  loadAssignedOrdersForDate,
  loadAssignedSchedule,
  normalizeFieldIdentity,
  normalizeFieldRole,
  orderAssignedToIdentity,
  plannedWorkItems,
  profileVanFallbackAllowed,
  projectScheduleJob,
  scheduleVisibleWorkOrder,
  validDateKey,
};