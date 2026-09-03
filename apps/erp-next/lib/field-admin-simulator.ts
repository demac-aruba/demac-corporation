import type { CanonicalStaffProfile, CanonicalVan } from './canonical-operations';
import type {
  FieldAssignmentSource,
  FieldPlannedWork,
  FieldResponsibility,
  FieldScheduleJob,
} from './field-authority-contract';
import {
  getFirestoreDocument,
  listFirestoreCollection,
  queryFirestoreCollectionDateRange,
} from './firebase/firestore-rest';

const FIELD_VISIBLE_STATUSES = new Set([
  'Confirmada',
  'Asignada',
  'En camino',
  'En el sitio',
  'En proceso',
  'Pendiente',
  'Completada',
]);

export type FieldAdminSimulationWorkItem = {
  id?: string;
  serviceId?: string;
  presetId?: string;
  label?: string;
  presetLabel?: string;
  quantity?: number;
  durationMinutes?: number;
  manualDurationMinutes?: number;
};

export type FieldAdminSimulationWorkOrder = {
  id: string;
  appointmentId?: string;
  appointmentAssignmentRole?: string;
  appointmentEndTime?: string;
  appointmentWorkItems?: FieldAdminSimulationWorkItem[];
  clientId?: string;
  clientName?: string;
  propertyId?: string;
  date?: string;
  time?: string;
  status?: string;
  address?: string;
  vanId?: string;
  van?: string;
  technicianIds?: string[];
  customerFacingDescription?: string;
  problem?: string;
  technicianInstructions?: string;
  airConditionerCount?: number;
};

export type FieldAdminSimulationClient = {
  id: string;
  name?: string;
  company?: string;
  phone?: string;
  whatsapp?: string;
};

export type FieldAdminSimulationProperty = {
  id: string;
  name?: string;
  address?: string;
  addressRaw?: string;
  latitude?: number | string;
  longitude?: number | string;
  accessInstructions?: string;
  propertyAccessInstructions?: string;
  entryInstructions?: string;
  accessNotes?: string;
};

export type FieldAdminSimulationAppointment = {
  id: string;
  workLines?: FieldAdminSimulationWorkItem[];
};

export type FieldAdminSimulationDailyVanAssignment = {
  id: string;
  date?: string;
  vanId?: string;
  driverStaffId?: string;
  helperStaffId?: string;
  additionalHelperStaffId?: string;
  status?: string;
};

export type FieldAdminSimulationVan = CanonicalVan & {
  number?: number | string;
  vanNumber?: number | string;
  unitNumber?: number | string;
  label?: string;
  code?: string;
};

type SimulationCrew = {
  vanId: string;
  driverStaffId: string;
  helperStaffId: string;
  additionalHelperStaffId: string;
  technicianIds: string[];
  source: Extract<FieldAssignmentSource, 'daily_assignment' | 'regular_crew'>;
};

type SimulationRow = {
  baseJob: FieldScheduleJob;
  directStaffIds: string[];
  profileVanFallbackStaffIds: string[];
  crew: SimulationCrew;
};

export type FieldAdminSimulationTarget = {
  value: string;
  kind: 'all' | 'van' | 'staff';
  label: string;
  detail: string;
  staffId?: string;
  vanId?: string;
};

export type FieldAdminSimulationData = {
  dateKey: string;
  targets: FieldAdminSimulationTarget[];
  rows: SimulationRow[];
  staffProfiles: CanonicalStaffProfile[];
  activeTechnicianStaffIds: string[];
};

export type FieldAdminSimulationSource = {
  dateKey: string;
  workOrders: FieldAdminSimulationWorkOrder[];
  staffProfiles: CanonicalStaffProfile[];
  vans: FieldAdminSimulationVan[];
  dailyAssignments: FieldAdminSimulationDailyVanAssignment[];
  clients: FieldAdminSimulationClient[];
  properties: FieldAdminSimulationProperty[];
  appointments: FieldAdminSimulationAppointment[];
  users: FieldAdminSimulationUser[];
};

export type FieldAdminSimulationUser = {
  id: string;
  active?: boolean;
  role?: string;
  staffId?: string;
  vanId?: string;
  name?: string;
  email?: string;
};

export type FieldSimulationStage =
  | 'scheduled'
  | 'en_route'
  | 'on_site'
  | 'in_progress'
  | 'pending'
  | 'requires_return_visit'
  | 'ready_for_office_review'
  | 'completed'
  | 'no_access'
  | 'cancelled';

export const FIELD_SIMULATION_STAGE_LABELS: Record<FieldSimulationStage, string> = {
  scheduled: 'Lista para salir',
  en_route: 'En camino',
  on_site: 'En el sitio',
  in_progress: 'En proceso',
  pending: 'Pendiente',
  requires_return_visit: 'Requiere retorno',
  ready_for_office_review: 'Enviado a revisión',
  completed: 'Completada',
  no_access: 'Sin acceso',
  cancelled: 'Cancelada',
};

const FIELD_SIMULATION_TRANSITIONS: Record<FieldSimulationStage, FieldSimulationStage[]> = {
  scheduled: ['en_route', 'no_access', 'cancelled'],
  en_route: ['on_site', 'pending', 'no_access', 'cancelled'],
  on_site: ['in_progress', 'pending', 'requires_return_visit', 'no_access', 'cancelled'],
  in_progress: ['pending', 'requires_return_visit', 'ready_for_office_review', 'cancelled'],
  pending: ['in_progress', 'requires_return_visit', 'ready_for_office_review', 'cancelled'],
  requires_return_visit: ['ready_for_office_review', 'cancelled'],
  ready_for_office_review: [],
  completed: [],
  no_access: [],
  cancelled: [],
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function finiteNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : null;
}

function positiveQuantity(value: unknown, fallback = 1) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate > 0 ? Math.max(1, candidate) : fallback;
}

function assertDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('La fecha de simulación no es válida.');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('La fecha de simulación no es válida.');
  }
}

function canonicalVanNumber(value: unknown) {
  const compact = text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const match = compact.match(/^(?:van|v)([1-9]\d*)$/);
  return match ? Number(match[1]) : 0;
}

function canonicalVanIdFromValue(value: unknown) {
  const number = canonicalVanNumber(value);
  return number ? `VAN-${number}` : '';
}

function canonicalVanIdFromRecord(van: FieldAdminSimulationVan) {
  for (const value of [van.number, van.vanNumber, van.unitNumber]) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 1) return `VAN-${number}`;
  }
  for (const value of [van.name, van.label, van.code, van.id]) {
    const canonicalId = canonicalVanIdFromValue(value);
    if (canonicalId) return canonicalId;
  }
  return '';
}

function vanRecordPreference(van: FieldAdminSimulationVan, canonicalId: string) {
  if (text(van.id).toUpperCase() === canonicalId) return 3;
  if (canonicalVanIdFromValue(van.id) === canonicalId) return 2;
  return 1;
}

function activeVanCatalog(vans: FieldAdminSimulationVan[]) {
  const aliases = new Map<string, string>();
  const byCanonicalId = new Map<string, FieldAdminSimulationVan>();
  for (const van of vans) {
    if (van.active === false) continue;
    const canonicalId = canonicalVanIdFromRecord(van);
    if (!canonicalId) continue;
    aliases.set(text(van.id), canonicalId);
    aliases.set(canonicalId, canonicalId);
    const current = byCanonicalId.get(canonicalId);
    if (!current || vanRecordPreference(van, canonicalId) > vanRecordPreference(current, canonicalId)) {
      byCanonicalId.set(canonicalId, van);
    }
  }
  const canonicalVans = [...byCanonicalId.entries()]
    .map(([canonicalId, van]) => ({ ...van, canonicalId }))
    .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId, undefined, { numeric: true }));
  return { aliases, vans: canonicalVans };
}

function resolveFieldVanId(value: unknown, vans: FieldAdminSimulationVan[]) {
  const raw = text(value);
  if (!raw) return '';
  const catalog = activeVanCatalog(vans);
  return catalog.aliases.get(raw) || canonicalVanIdFromValue(raw) || raw;
}

function physicalVans(vans: FieldAdminSimulationVan[]) {
  return activeVanCatalog(vans).vans;
}

function crewForVan(
  vanId: string,
  dateKey: string,
  vans: FieldAdminSimulationVan[],
  dailyAssignments: FieldAdminSimulationDailyVanAssignment[],
): SimulationCrew {
  const van = physicalVans(vans).find((candidate) => candidate.canonicalId === vanId);
  if (!van) {
    return {
      vanId,
      driverStaffId: '',
      helperStaffId: '',
      additionalHelperStaffId: '',
      technicianIds: [],
      source: 'regular_crew',
    };
  }
  const daily = dailyAssignments.find((assignment) => assignment.date === dateKey
    && resolveFieldVanId(assignment.vanId, vans) === vanId);
  const driverStaffId = text(daily?.driverStaffId ?? van?.responsibleStaffId);
  const helperStaffId = text(daily?.helperStaffId ?? van?.regularHelperId);
  const additionalHelperStaffId = text(daily?.additionalHelperStaffId ?? van?.additionalHelperId);
  return {
    vanId,
    driverStaffId,
    helperStaffId,
    additionalHelperStaffId,
    technicianIds: unique([driverStaffId, helperStaffId, additionalHelperStaffId]),
    source: daily ? 'daily_assignment' : 'regular_crew',
  };
}

function plannedWorkItems(order: FieldAdminSimulationWorkOrder, appointment?: FieldAdminSimulationAppointment | null): FieldPlannedWork[] {
  const items = Array.isArray(order.appointmentWorkItems) && order.appointmentWorkItems.length
    ? order.appointmentWorkItems
    : Array.isArray(appointment?.workLines) ? appointment.workLines : [];
  return items.map((item, index) => ({
    id: text(item.id || item.presetId) || `planned-${index + 1}`,
    serviceId: text(item.serviceId) || undefined,
    presetId: text(item.presetId) || undefined,
    label: text(item.label || item.presetLabel || item.presetId) || 'Trabajo programado',
    quantity: positiveQuantity(item.quantity),
    durationMinutes: Math.max(0, Number(item.durationMinutes ?? item.manualDurationMinutes) || 0),
  }));
}

async function relatedDocuments<T extends { id: string }>(collection: string, values: unknown[]) {
  const ids = unique(values);
  const documents = await Promise.all(ids.map((id) => getFirestoreDocument<T>(collection, id)));
  const byId = new Map<string, T>();
  for (const item of documents) {
    if (item) byId.set(item.id, item);
  }
  return byId;
}

function targetLabelForVan(vanId: string, van: FieldAdminSimulationVan) {
  return text(van.name) || vanId.replace(/^VAN-/, 'Van ');
}

function staffName(staffId: string, profiles: CanonicalStaffProfile[]) {
  return text(profiles.find((profile) => profile.id === staffId)?.name) || staffId;
}

function isActiveTechnicianUser(user: FieldAdminSimulationUser) {
  const role = text(user.role).toLowerCase().replace(/[\s-]+/g, '_');
  return user.active === true && (role === 'technician' || role === 'tech') && Boolean(text(user.staffId));
}

function normalizedStaffClassification(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
}

function inferredTechnicianUsers(source: Omit<FieldAdminSimulationSource, 'users'>): FieldAdminSimulationUser[] {
  const assignedStaffIds = new Set(unique([
    ...source.vans.flatMap((van) => [
      van.responsibleStaffId,
      van.regularHelperId,
      van.additionalHelperId,
      ...(Array.isArray(van.technicianIds) ? van.technicianIds : []),
    ]),
    ...source.dailyAssignments.flatMap((assignment) => [
      assignment.driverStaffId,
      assignment.helperStaffId,
      assignment.additionalHelperStaffId,
    ]),
    ...source.workOrders.flatMap((order) => Array.isArray(order.technicianIds) ? order.technicianIds : []),
  ]));

  return source.staffProfiles
    .filter((profile) => profile.active !== false)
    .filter((profile) => {
      const employeeType = normalizedStaffClassification(profile.employeeType);
      const role = normalizedStaffClassification(profile.role);
      return assignedStaffIds.has(profile.id)
        || ['tecnico', 'technician'].includes(employeeType)
        || ['tecnico responsable', 'tecnico', 'ayudante', 'supervisor', 'technician', 'hvac technician', 'helper'].includes(role);
    })
    .map((profile) => ({
      id: profile.id,
      active: true,
      role: 'technician',
      staffId: profile.id,
      vanId: text(profile.primaryVanId) || undefined,
      name: profile.name,
      email: profile.email,
    }));
}

function buildTargets(
  profiles: CanonicalStaffProfile[],
  vans: FieldAdminSimulationVan[],
  dateKey: string,
  dailyAssignments: FieldAdminSimulationDailyVanAssignment[],
  users: FieldAdminSimulationUser[],
): FieldAdminSimulationTarget[] {
  const vanTargets = physicalVans(vans).map((van) => {
    const crew = crewForVan(van.canonicalId, dateKey, vans, dailyAssignments);
    const names = crew.technicianIds.map((id) => staffName(id, profiles));
    return {
      value: `van:${van.canonicalId}`,
      kind: 'van' as const,
      label: targetLabelForVan(van.canonicalId, van),
      detail: names.length ? names.join(' · ') : 'Sin tripulación asignada hoy',
      vanId: van.canonicalId,
    };
  });

  const technicianUsersByStaffId = new Map<string, FieldAdminSimulationUser>();
  for (const user of users) {
    const staffId = text(user.staffId);
    if (isActiveTechnicianUser(user) && !technicianUsersByStaffId.has(staffId)) {
      technicianUsersByStaffId.set(staffId, user);
    }
  }
  const staffTargets = [...technicianUsersByStaffId.entries()]
    .sort(([leftId, leftUser], [rightId, rightUser]) => {
      const left = text(profiles.find((profile) => profile.id === leftId)?.name || leftUser.name || leftUser.email) || leftId;
      const right = text(profiles.find((profile) => profile.id === rightId)?.name || rightUser.name || rightUser.email) || rightId;
      return left.localeCompare(right, 'es');
    })
    .map(([staffId, user]) => {
      const memberships = physicalVans(vans)
        .map((van) => crewForVan(van.canonicalId, dateKey, vans, dailyAssignments))
        .filter((crew) => crew.technicianIds.includes(staffId));
      return {
        value: `staff:${staffId}`,
        kind: 'staff' as const,
        label: text(profiles.find((profile) => profile.id === staffId)?.name || user.name || user.email) || staffId,
        detail: ['Técnico', ...memberships.map((crew) => crew.vanId.replace(/^VAN-/, 'Van '))].join(' · '),
        staffId,
        vanId: memberships[0]?.vanId,
      };
    });

  return [...vanTargets, ...staffTargets];
}

function baseResponsibilityForCrew(crew: SimulationCrew, activeTechnicianStaffIds: Set<string>): FieldResponsibility {
  return crew.driverStaffId && activeTechnicianStaffIds.has(crew.driverStaffId) ? 'lead' : 'office';
}

function assignmentForStaff(row: SimulationRow, staffId: string) {
  if (row.crew.driverStaffId === staffId) {
    return { responsibility: 'lead' as const, source: row.crew.source };
  }
  if (row.crew.helperStaffId === staffId || row.crew.additionalHelperStaffId === staffId) {
    return { responsibility: 'helper' as const, source: row.crew.source };
  }
  if (row.directStaffIds.includes(staffId)) {
    return { responsibility: 'technician' as const, source: 'direct_staff' as const };
  }
  if (row.profileVanFallbackStaffIds.includes(staffId)) {
    return { responsibility: 'technician' as const, source: 'profile_van_fallback' as const };
  }
  return null;
}

export function canUseFieldAdminSimulation(role: string, enabled: boolean) {
  return enabled && role === 'super_admin';
}

export function resolveFieldAdminSimulationJobs(data: FieldAdminSimulationData, targetValue: string): FieldScheduleJob[] {
  if (targetValue === 'all') {
    return data.rows.map((row) => ({ ...row.baseJob, responsibility: 'office', assignmentSource: 'office' }));
  }

  if (targetValue.startsWith('van:')) {
    const vanId = targetValue.slice(4);
    const activeTechnicianStaffIds = new Set(data.activeTechnicianStaffIds);
    return data.rows
      .filter((row) => row.crew.vanId === vanId)
      .map((row) => ({
        ...row.baseJob,
        responsibility: baseResponsibilityForCrew(row.crew, activeTechnicianStaffIds),
        assignmentSource: row.crew.source,
      }));
  }

  if (targetValue.startsWith('staff:')) {
    const staffId = targetValue.slice(6);
    return data.rows.flatMap((row) => {
      const assignment = assignmentForStaff(row, staffId);
      return assignment ? [{
        ...row.baseJob,
        responsibility: assignment.responsibility,
        assignmentSource: assignment.source,
      }] : [];
    });
  }

  return [];
}

export function nextFieldSimulationStage(stage: FieldSimulationStage): FieldSimulationStage {
  if (stage === 'scheduled') return 'en_route';
  if (stage === 'en_route') return 'on_site';
  if (stage === 'on_site' || stage === 'pending') return 'in_progress';
  if (stage === 'in_progress' || stage === 'requires_return_visit') return 'ready_for_office_review';
  return stage;
}

export function fieldSimulationTransitions(stage: FieldSimulationStage): FieldSimulationStage[] {
  return [...FIELD_SIMULATION_TRANSITIONS[stage]];
}

export function fieldSimulationStageForWorkOrderStatus(status: string): FieldSimulationStage {
  if (status === 'En camino') return 'en_route';
  if (status === 'En el sitio') return 'on_site';
  if (status === 'En proceso') return 'in_progress';
  if (status === 'Pendiente') return 'pending';
  if (status === 'Completada') return 'completed';
  return 'scheduled';
}

export function projectFieldAdminSimulationData(source: FieldAdminSimulationSource): FieldAdminSimulationData {
  assertDateKey(source.dateKey);
  const { dateKey, staffProfiles, vans, dailyAssignments } = source;
  const orders = source.workOrders.filter((order) => order.date === dateKey && FIELD_VISIBLE_STATUSES.has(text(order.status)));
  // The temporary owner simulator must not depend on listing the protected users
  // collection. The canonical staff roster and Van assignments already contain the
  // operational identities needed to preview today's routes.
  const technicianUsers = source.users.length
    ? source.users
    : inferredTechnicianUsers({ ...source, workOrders: orders });
  const clients = new Map(source.clients.map((item) => [item.id, item]));
  const properties = new Map(source.properties.map((item) => [item.id, item]));
  const appointments = new Map(source.appointments.map((item) => [item.id, item]));
  const userById = new Map(technicianUsers.filter((item) => item.active === true).map((item) => [item.id, item]));
  const userByStaffId = new Map(technicianUsers
    .filter(isActiveTechnicianUser)
    .map((item) => [text(item.staffId), item]));
  const rows = orders.map((order): SimulationRow => {
    const vanId = resolveFieldVanId(order.vanId, vans);
    const crew = crewForVan(vanId, dateKey, vans, dailyAssignments);
    const client = clients.get(text(order.clientId));
    const property = properties.get(text(order.propertyId));
    const appointment = appointments.get(text(order.appointmentId));
    const plannedWork = plannedWorkItems(order, appointment);
    const estimatedQuantity = Math.max(0, Number(order.airConditionerCount) || 0);
    const baseJob: FieldScheduleJob = {
      id: order.id,
      workOrderId: order.id,
      appointmentId: text(order.appointmentId),
      date: dateKey,
      time: text(order.time),
      endTime: text(order.appointmentEndTime) || undefined,
      status: text(order.status),
      customerId: text(order.clientId),
      customerName: text(client?.name || client?.company || order.clientName) || 'Cliente',
      propertyId: text(order.propertyId),
      propertyName: text(property?.name) || undefined,
      address: text(order.address || property?.address || property?.addressRaw),
      latitude: finiteNumber(property?.latitude),
      longitude: finiteNumber(property?.longitude),
      arrivalPhone: text(client?.phone) || undefined,
      arrivalWhatsapp: text(client?.whatsapp || client?.phone) || undefined,
      accessInstructions: text(property?.accessInstructions || property?.propertyAccessInstructions || property?.entryInstructions || property?.accessNotes) || undefined,
      customerFacingDescription: text(order.customerFacingDescription || order.problem) || undefined,
      technicianInstructions: text(order.technicianInstructions) || undefined,
      plannedWork,
      estimatedQuantity,
      vanId,
      responsibility: 'office',
      assignmentSource: 'office',
      allowedActions: ['read'],
      assignmentRole: text(order.appointmentAssignmentRole) || undefined,
      fieldVisit: null,
      canPrepareVisit: false,
      canCreateReturnVisit: false,
    };
    return {
      baseJob,
      directStaffIds: unique((Array.isArray(order.technicianIds) ? order.technicianIds : []).flatMap((id) => [id, userById.get(text(id))?.staffId])),
      profileVanFallbackStaffIds: [...userByStaffId.entries()].flatMap(([staffId, user]) => {
        const profileVanId = resolveFieldVanId(user.vanId, vans);
        if (!profileVanId || profileVanId !== vanId) return [];
        const hasDatedStaffAssignment = dailyAssignments.some((assignment) => assignment.date === dateKey && [
          assignment.driverStaffId,
          assignment.helperStaffId,
          assignment.additionalHelperStaffId,
        ].some((id) => text(id) === staffId));
        const profileVanHasDatedOverride = dailyAssignments.some((assignment) => assignment.date === dateKey
          && resolveFieldVanId(assignment.vanId, vans) === profileVanId);
        return hasDatedStaffAssignment || profileVanHasDatedOverride ? [] : [staffId];
      }),
      crew,
    };
  }).sort((left, right) => `${left.baseJob.time || '99:99'}|${left.baseJob.workOrderId}`.localeCompare(`${right.baseJob.time || '99:99'}|${right.baseJob.workOrderId}`));

  const activeProfiles = staffProfiles.filter((profile) => profile.active !== false);
  return {
    dateKey,
    rows,
    staffProfiles: activeProfiles,
    activeTechnicianStaffIds: technicianUsers.filter(isActiveTechnicianUser).map((user) => text(user.staffId)),
    targets: buildTargets(activeProfiles, vans, dateKey, dailyAssignments, technicianUsers),
  };
}

export async function loadFieldAdminSimulationData(dateKey: string): Promise<FieldAdminSimulationData> {
  assertDateKey(dateKey);
  const [workOrders, staffProfiles, vans, dailyAssignments] = await Promise.all([
    queryFirestoreCollectionDateRange<FieldAdminSimulationWorkOrder>({
      collectionId: 'workOrders',
      fieldPath: 'date',
      startInclusive: dateKey,
      endInclusive: dateKey,
      limit: 1000,
    }),
    listFirestoreCollection<CanonicalStaffProfile>('staffProfiles', 500),
    listFirestoreCollection<FieldAdminSimulationVan>('vans', 250),
    queryFirestoreCollectionDateRange<FieldAdminSimulationDailyVanAssignment>({
      collectionId: 'dailyVanAssignments',
      fieldPath: 'date',
      startInclusive: dateKey,
      endInclusive: dateKey,
      limit: 250,
    }),
  ]);

  const visibleOrders = workOrders.filter((order) => order.date === dateKey && FIELD_VISIBLE_STATUSES.has(text(order.status)));
  const [clientMap, propertyMap] = await Promise.all([
    relatedDocuments<FieldAdminSimulationClient>('clients', visibleOrders.map((order) => order.clientId)),
    relatedDocuments<FieldAdminSimulationProperty>('properties', visibleOrders.map((order) => order.propertyId)),
  ]);

  return projectFieldAdminSimulationData({
    dateKey,
    workOrders: visibleOrders,
    staffProfiles,
    vans,
    dailyAssignments,
    clients: [...clientMap.values()],
    properties: [...propertyMap.values()],
    // Work Orders already carry the scheduling work-item snapshots used by Agenda.
    // Reading appointments directly is not authorized by Firestore rules and is not
    // required for this temporary, read-only preview.
    appointments: [],
    users: [],
  });
}
