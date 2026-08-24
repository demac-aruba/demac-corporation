const FIELD_OPERATIONS_API_VERSION = 1;
const FIELD_ROLES = new Set(['technician', 'admin', 'office', 'supervisor', 'owner', 'super_admin', 'super-admin', 'superadmin']);
const OPERATIONS_ROLES = new Set(['admin', 'office', 'supervisor', 'owner', 'super_admin', 'super-admin', 'superadmin']);
const INACTIVE_WORK_ORDER_STATUSES = new Set(['Solicitud recibida', 'Reserva temporal', 'Cancelada', 'Reprogramada', 'Completada', 'Facturada', 'Pagada']);

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

function normalizeFieldIdentity({ uid, profile = {}, decoded = {} }) {
  const role = text(profile.role || decoded.role, 80).toLowerCase();
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
  while (cursor <= last && keys.length <= maximumDays) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (cursor <= last) throw fieldError('date_range_too_large', `Field schedule requests are limited to ${maximumDays} days.`);
  return keys;
}

function activeWorkOrder(order) {
  return Boolean(order) && !INACTIVE_WORK_ORDER_STATUSES.has(text(order.status, 80));
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

function crewResponsibility({ identity, dateKey, workOrder, dailyAssignments = [], vans = [] }) {
  if (identity.operations) return 'office';
  const staffId = identity.staffId;
  const vanId = text(workOrder?.vanId, 180);
  const daily = dailyAssignments.find((assignment) => text(assignment.date, 10) === dateKey && text(assignment.vanId, 180) === vanId);
  if (daily && text(daily.driverStaffId, 180) === staffId) return 'lead';
  if (daily && text(daily.helperStaffId, 180) === staffId) return 'helper';
  const van = vans.find((item) => text(item.id, 180) === vanId);
  if (!daily && van && text(van.responsibleStaffId, 180) === staffId) return 'lead';
  if (!daily && van && text(van.regularHelperId, 180) === staffId) return 'helper';
  if ((Array.isArray(workOrder?.technicianIds) ? workOrder.technicianIds : []).some((id) => text(id, 180) === staffId || text(id, 180) === identity.uid)) return 'technician';
  return 'technician';
}

async function loadCrewContext(db, dateKey) {
  const [assignmentSnapshot, vansSnapshot] = await Promise.all([
    db.collection('dailyVanAssignments').where('date', '==', dateKey).get(),
    db.collection('vans').get(),
  ]);
  return {
    dailyAssignments: snapshotItems(assignmentSnapshot),
    vans: snapshotItems(vansSnapshot),
  };
}

function assignedVanIds(identity, dateKey, context) {
  if (identity.operations) return [];
  const daily = context.dailyAssignments.filter((assignment) => (
    text(assignment.date, 10) === dateKey
    && (text(assignment.driverStaffId, 180) === identity.staffId || text(assignment.helperStaffId, 180) === identity.staffId)
  ));
  if (daily.length) return unique(daily.map((assignment) => assignment.vanId));
  const regular = context.vans.filter((van) => (
    text(van.responsibleStaffId, 180) === identity.staffId || text(van.regularHelperId, 180) === identity.staffId
  ));
  const fallbacks = [...regular.map((van) => van.id), identity.vanId];
  return unique(fallbacks);
}

async function loadAssignedOrdersForDate(db, identity, dateKey, context) {
  if (identity.operations) {
    return queryItems(db.collection('workOrders').where('date', '==', dateKey));
  }

  const queries = [];
  for (const technicianId of unique([identity.staffId, identity.uid])) {
    queries.push(db.collection('workOrders').where('date', '==', dateKey).where('technicianIds', 'array-contains', technicianId).get());
  }
  for (const vanId of assignedVanIds(identity, dateKey, context)) {
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
  if (identity.operations) return true;
  const technicianIds = Array.isArray(order?.technicianIds) ? order.technicianIds.map((id) => text(id, 180)) : [];
  if (technicianIds.includes(identity.staffId) || technicianIds.includes(identity.uid)) return true;
  return assignedVanIds(identity, dateKey, context).includes(text(order?.vanId, 180));
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

function projectScheduleJob({ order, client, property, appointment, responsibility }) {
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
    vanId: text(order.vanId, 180),
    technicianIds: unique(Array.isArray(order.technicianIds) ? order.technicianIds : []),
    responsibility,
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

async function loadAssignedSchedule(db, identity, startDate, endDate) {
  const dates = dateRange(startDate, endDate, 7);
  const rows = [];
  for (const dateKey of dates) {
    const context = await loadCrewContext(db, dateKey);
    const orders = (await loadAssignedOrdersForDate(db, identity, dateKey, context)).filter(activeWorkOrder);
    const maps = await loadRelatedMaps(db, orders);
    for (const order of orders) {
      if (!orderAssignedToIdentity(identity, order, dateKey, context)) continue;
      rows.push(projectScheduleJob({
        order,
        client: maps.clients.get(text(order.clientId, 180)),
        property: maps.properties.get(text(order.propertyId, 180)),
        appointment: maps.appointments.get(text(order.appointmentId, 180)),
        responsibility: crewResponsibility({ identity, dateKey, workOrder: order, ...context }),
      }));
    }
  }
  return rows.sort((a, b) => orderTimeKey(a).localeCompare(orderTimeKey(b)));
}

async function loadAssignedJob(db, identity, workOrderId) {
  const order = await getDocument(db, 'workOrders', workOrderId);
  if (!order || !activeWorkOrder(order)) throw fieldError('work_order_not_found', 'The requested Work Order is not available.', 404);
  const dateKey = validDateKey(order.date);
  const context = await loadCrewContext(db, dateKey);
  if (!orderAssignedToIdentity(identity, order, dateKey, context)) throw fieldError('permission_denied', 'You are not assigned to this Work Order.', 403);
  const maps = await loadRelatedMaps(db, [order]);
  const equipmentQuery = db.collection('equipmentSystems').where('clientId', '==', text(order.clientId, 180));
  const equipmentSnapshot = text(order.propertyId, 180)
    ? await equipmentQuery.where('propertyId', '==', text(order.propertyId, 180)).get()
    : await equipmentQuery.get();
  const equipment = snapshotItems(equipmentSnapshot)
    .filter((item) => item.active !== false)
    .map((item) => ({
      id: item.id,
      qrCode: text(item.qrCode, 180),
      locationLabel: text(item.locationLabel, 240),
      systemType: text(item.systemType, 120),
      brand: text(item.brand, 160),
      model: text(item.model, 180),
      serial: text(item.serial, 180),
      btu: item.btu ?? null,
      refrigerant: text(item.refrigerant, 80),
      voltage: text(item.voltage, 80),
      condition: text(item.condition, 120),
      active: item.active !== false,
    }));
  return {
    ...projectScheduleJob({
      order,
      client: maps.clients.get(text(order.clientId, 180)),
      property: maps.properties.get(text(order.propertyId, 180)),
      appointment: maps.appointments.get(text(order.appointmentId, 180)),
      responsibility: crewResponsibility({ identity, dateKey, workOrder: order, ...context }),
    }),
    knownEquipment: equipment,
  };
}

module.exports = {
  FIELD_OPERATIONS_API_VERSION,
  activeWorkOrder,
  assignedVanIds,
  crewResponsibility,
  dateRange,
  fieldError,
  loadAssignedJob,
  loadAssignedOrdersForDate,
  loadAssignedSchedule,
  normalizeFieldIdentity,
  orderAssignedToIdentity,
  plannedWorkItems,
  projectScheduleJob,
  validDateKey,
};
