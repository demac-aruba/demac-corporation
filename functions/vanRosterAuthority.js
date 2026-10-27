'use strict';

const { createHash } = require('node:crypto');
const { canonicalizeVanCatalog, resolveCanonicalVanId } = require('./bookingVanIdentity');
const { arubaDateParts, resolveCrewMembership, staffUnavailable } = require('./bookingSchedulingPrimitives');
const { crewFields, scheduleFields, appendVersion } = require('./vanRosterHistory');
const { initialVisitDocumentId } = require('./fieldOperationsAuthorityWorkVisit');
const { assertNoProjectAssignmentExecution, executionMarker } = require('./projectCommercialGuard');
const ACTIONS = new Set(['get_van_roster', 'save_van_roster']);
const ROLES = new Set(['admin', 'office', 'supervisor']);
const TERMINAL = new Set(['Completada', 'Facturada', 'Pagada', 'Cancelada', 'Reprogramada']);
const PENDING = new Set(['Confirmada', 'Asignada', 'Pendiente', 'Reserva temporal', 'Solicitud recibida']);
const stable = value => value === undefined ? 'null' : !value || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : typeof value.toJSON === 'function' ? stable(value.toJSON())
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const items = snapshot => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
const technical = staff => staff && staff.active !== false && staff.availability !== 'Inactivo'
  && (staff.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(staff.role));
const id = value => typeof value === 'string' && value.length <= 180 && !/[/\\\x00-\x1f]/.test(value);
const eventRef = (db, uid, requestId) => db.collection('businessSettings').doc('van-roster').collection('events').doc(hash({ uid, requestId }));

function snapshotProjection(vans, schedules, staff) {
  const catalog = canonicalizeVanCatalog(vans);
  const rows = catalog.vans.map(van => {
    const rules = schedules.filter(rule => rule.active !== false && resolveCanonicalVanId(rule.vanId, catalog.aliases) === van.id);
    if (rules.length > 1) fail('roster_ambiguous_schedule', `${van.name} tiene más de una regla semanal; requiere revisión.`);
    return { id: van.sourceVanId, vanId: van.id, name: van.name, status: van.status || 'Disponible',
      ...crewFields(van), schedule: rules.length ? { ...scheduleFields(rules[0]), id: rules[0].id } : null };
  });
  return { rows, catalog, token: hash({ vans, schedules }), staff: staff.filter(technical).map(person => ({
    id: person.id, name: person.name || person.id, canDriveVan: person.canDriveVan === true,
  })) };
}
function validateRows(rows, current, staff) {
  if (!Array.isArray(rows) || rows.length !== current.rows.length || rows.length > 50) fail('roster_input', 'Revisa la distribución completa de las vans.', 400);
  const seenVans = new Set(), seenStaff = new Map(), staffById = new Map(staff.map(person => [person.id, person]));
  return rows.map(row => {
    if (!row || !id(row.id) || seenVans.has(row.id)) fail('roster_input', 'Van repetida o identidad inválida.', 400);
    seenVans.add(row.id);
    const before = current.rows.find(item => item.id === row.id);
    if (!before) fail('roster_conflict', 'La flota cambió. Recarga y revisa tu borrador.');
    const fields = crewFields(row);
    for (const key of ['responsibleStaffId', 'regularHelperId', 'additionalHelperId']) {
      if (!id(fields[key])) fail('roster_input', 'Empleado inválido.', 400);
      if (!fields[key]) continue;
      const person = staffById.get(fields[key]);
      if (!technical(person)) fail('roster_staff', `${before.name}: selecciona personal técnico activo.`, 400);
      if (key === 'responsibleStaffId' && person.canDriveVan !== true) fail('roster_driver', `${before.name}: el responsable debe estar autorizado para conducir.`, 400);
      if (seenStaff.has(person.id)) fail('roster_duplicate', `${person.name || person.id} está repetido en ${seenStaff.get(person.id)} y ${before.name}. Completa el intercambio antes de guardar.`, 400);
      seenStaff.set(person.id, before.name);
    }
    if (before.status === 'Disponible' && (!fields.responsibleStaffId || !fields.regularHelperId)) fail('roster_incomplete', `${before.name} necesita un responsable y un ayudante.`, 400);
    // The fleet editor moves people; it never changes Van identity, status or the team's weekly rule.
    return { ...before, ...fields };
  });
}
function createVanRosterAuthority({ db, clock = () => new Date() }) {
  async function execute({ action, data = {}, uid }) {
    if (!ACTIONS.has(action) || !id(uid) || !uid) fail('roster_input', 'Solicitud inválida.', 400);
    if (JSON.stringify(data).length > 50000) fail('roster_input', 'La solicitud supera el tamaño permitido.', 400);
    return db.runTransaction(async tx => {
      const actorDoc = await tx.get(db.collection('users').doc(uid));
      const actor = actorDoc.exists && actorDoc.data();
      if (actor?.active !== true || !ROLES.has(actor.role)) fail('permission_denied', 'No tienes permiso para administrar los equipos de las vans.', 403);
      let audit, fingerprint;
      if (action === 'save_van_roster') {
        if (!id(data.requestId) || data.requestId.length < 8 || !/^[a-f0-9]{64}$/.test(data.expectedToken || '')) fail('roster_request', 'Recarga la flota antes de guardar.', 400);
        audit = eventRef(db, uid, data.requestId);
        fingerprint = hash(data);
        const replay = await tx.get(audit);
        if (replay.exists) {
          if (replay.data().fingerprint !== fingerprint) fail('roster_replay', 'Esta operación ya se usó con otro borrador.');
          return { ...replay.data().result, replayed: true };
        }
      }
      const [vanSnap, ruleSnap, staffSnap] = await Promise.all(['vans', 'vanHalfDaySchedules', 'staffProfiles'].map(name => tx.get(db.collection(name))));
      const vans = items(vanSnap), schedules = items(ruleSnap), staff = items(staffSnap);
      const current = snapshotProjection(vans, schedules, staff);
      const at = clock().toISOString(), today = arubaDateParts(new Date(at)).date;
      if (action === 'get_van_roster') return { success: true, rows: current.rows, staff: current.staff, token: current.token, effectiveDate: today };
      if (data.expectedToken !== current.token) fail('roster_conflict', 'Otro operador cambió la flota o su horario. Tu borrador se conserva; recarga y revisa.');
      if (data.effectiveDate !== today) fail('roster_date', 'Cambió el día de trabajo. Recarga la flota antes de guardar.');
      const rows = validateRows(data.rows, current, staff);
      const changes = rows.filter(row => stable(crewFields(row)) !== stable(crewFields(current.rows.find(item => item.id === row.id))));
      if (!changes.length) fail('roster_unchanged', 'No hay cambios de personal para guardar.', 400);
      const changedLanes = new Set(changes.map(row => row.vanId));
      const nextVans = current.catalog.vans.map(van => ({ ...van, ...crewFields(rows.find(row => row.id === van.sourceVanId)) }));
      const [dailySnap, orderSnap, absenceSnap] = await Promise.all([
        tx.get(db.collection('dailyVanAssignments').where('date', '>=', today).limit(1001)),
        tx.get(db.collection('workOrders').where('date', '>=', today).limit(1001)),
        tx.get(db.collection('staffAbsences')),
      ]);
      if (dailySnap.size > 1000 || orderSnap.size > 1000) fail('roster_limit', 'El volumen de agenda requiere una revisión asistida; no se aplicó ningún cambio.');
      const daily = items(dailySnap).filter(item => item.status !== 'Cancelled').map(item => ({ ...item, vanId: resolveCanonicalVanId(item.vanId, current.catalog.aliases) }));
      const dates = new Set([today, ...daily.map(item => item.date)]);
      for (const date of dates) {
        const seen = new Map();
        for (const van of nextVans) {
          if (daily.filter(item => item.vanId === van.id && item.date === date).length > 1) fail('roster_daily', `${van.name} tiene excepciones diarias duplicadas el ${date}.`);
          const membership = resolveCrewMembership({ ...van, crewHistory: undefined }, date, daily);
          for (const person of membership.technicianIds) {
            if (seen.has(person)) fail('roster_daily', `La excepción del ${date} asigna al mismo empleado a ${seen.get(person)} y ${van.name}. Corrige esa excepción antes del intercambio.`);
            seen.set(person, van.name);
          }
        }
      }
      const orders = items(orderSnap).filter(order => changedLanes.has(resolveCanonicalVanId(order.vanId ?? order.van, current.catalog.aliases)) && !TERMINAL.has(order.status));
      const writes = [], orderChanges = new Map(), appointmentChanges = new Map(), projectChanges = new Map();
      const get = ref => tx.get(ref);
      for (const order of orders) {
        const lane = resolveCanonicalVanId(order.vanId ?? order.van, current.catalog.aliases), van = nextVans.find(item => item.id === lane);
        const crew = resolveCrewMembership({ ...van, crewHistory: undefined }, order.date, daily);
        if (stable(order.technicianIds || []) === stable(crew.technicianIds)) continue;
        if (!PENDING.has(order.status) || executionMarker(order) || order.workStartedAt || order.actualStartAt || order.backdated) fail('roster_work_started', `${van.name} tiene el trabajo ${order.id} iniciado o con ejecución registrada. Finalízalo o revisa su asignación antes de mover el equipo.`);
        const [initial, visits] = await Promise.all([
          get(db.collection('workVisits').doc(initialVisitDocumentId(order.id))),
          get(db.collection('workVisits').where('workOrderId', '==', order.id).limit(1)),
        ]);
        if (initial.exists || !visits.empty) fail('roster_work_started', `${van.name}: ${order.id} ya tiene una visita registrada. Su equipo requiere una revisión antes del traslado.`);
        if (!crew.driverStaffId || !crew.helperStaffId || crew.technicianIds.some(personId => staffUnavailable(staff.find(person => person.id === personId), order.date, items(absenceSnap)))) fail('roster_unavailable', `${van.name} no tiene el equipo completo disponible para el trabajo del ${order.date}.`);
        const patch = { technicianIds: crew.technicianIds, updatedAtIso: at, crewRevision: data.requestId,
          crewChangedBy: uid, crewChangedAt: at };
        for (const [key, value] of Object.entries({ driverStaffId: crew.driverStaffId || '', helperStaffId: crew.helperStaffId || '', additionalHelperStaffId: crew.additionalHelperStaffId || '' })) if (Object.hasOwn(order, key)) patch[key] = value;
        writes.push([db.collection('workOrders').doc(order.id), patch]);
        orderChanges.set(order.id, { order, lane, crew });
        if (order.appointmentId) {
          if (!appointmentChanges.has(order.appointmentId)) {
            const snap = await get(db.collection('appointments').doc(order.appointmentId));
            if (!snap.exists) fail('roster_link', `El trabajo ${order.id} perdió el vínculo con su cita.`);
            appointmentChanges.set(order.appointmentId, snap.data());
          }
        }
        if (order.projectId && !projectChanges.has(order.projectId)) {
          const snap = await get(db.collection('projectRecords').doc(order.projectId));
          if (!snap.exists) fail('roster_link', `El trabajo ${order.id} perdió el vínculo con su proyecto.`);
          projectChanges.set(order.projectId, snap.data());
        }
      }
      for (const [appointmentId, appointment] of appointmentChanges) {
        const linked = [...orderChanges.values()].filter(item => item.order.appointmentId === appointmentId);
        if (!Array.isArray(appointment.assignments)) fail('roster_link', `La cita ${appointmentId} requiere revisar sus asignaciones.`);
        if (!['confirmed', 'temporary_hold', 'pending'].includes(appointment.status) || executionMarker(appointment)) fail('roster_work_started', `La cita ${appointmentId} ya tiene ejecución o un estado incompatible con el traslado.`);
        const visits = await get(db.collection('workVisits').where('appointmentId', '==', appointmentId).limit(1));
        if (!visits.empty) fail('roster_work_started', `La cita ${appointmentId} tiene una visita registrada.`);
        for (const item of linked) {
          const matches = appointment.assignments.filter(assignment => item.lane === resolveCanonicalVanId(assignment.vanId, current.catalog.aliases));
          if (appointment.date !== item.order.date || matches.length !== 1
            || linked.filter(other => other.lane === item.lane).length !== 1
            || (item.order.projectId && appointment.projectId !== item.order.projectId)) fail('roster_link', `La cita ${appointmentId} y el trabajo ${item.order.id} tienen vínculos inconsistentes.`);
        }
        const assignments = appointment.assignments.map(assignment => {
          const match = linked.find(item => item.lane === resolveCanonicalVanId(assignment.vanId, current.catalog.aliases));
          return match ? { ...assignment, technicianIds: match.crew.technicianIds } : assignment;
        });
        writes.push([db.collection('appointments').doc(appointmentId), { assignments, crewRevision: data.requestId, updatedAtIso: at }]);
        if (appointment.projectId && !projectChanges.has(appointment.projectId)) {
          const snap = await get(db.collection('projectRecords').doc(appointment.projectId));
          if (!snap.exists) fail('roster_link', 'No se pudo verificar el proyecto vinculado.');
          projectChanges.set(appointment.projectId, snap.data());
        }
      }
      for (const [projectId, project] of projectChanges) {
        if (!Array.isArray(project.assignments)) fail('roster_link', 'El proyecto requiere revisar sus asignaciones.');
        const linked = [...orderChanges.values()].filter(item => item.order.projectId === projectId || appointmentChanges.get(item.order.appointmentId)?.projectId === projectId);
        for (const item of linked) {
          const matches = project.assignments.filter(assignment => assignment.workOrderId === item.order.id);
          if (matches.length !== 1 || matches[0].appointmentId !== item.order.appointmentId
            || resolveCanonicalVanId(matches[0].vanId, current.catalog.aliases) !== item.lane) fail('roster_link', `El proyecto ${projectId} perdió el vínculo exacto con el trabajo ${item.order.id}.`);
        }
        const assignments = project.assignments.map(assignment => {
          const change = orderChanges.get(assignment.workOrderId);
          if (!change) return assignment;
          try { assertNoProjectAssignmentExecution(assignment); } catch { fail('roster_work_started', 'El proyecto tiene ejecución registrada; no se cambiará su personal.'); }
          return { ...assignment, technicianIds: change.crew.technicianIds };
        });
        writes.push([db.collection('projectRecords').doc(projectId), { assignments, serverVersion: Number(project.serverVersion || 0) + 1, updatedAtIso: at, updatedBy: uid }]);
      }
      for (const row of changes) {
        const before = vans.find(van => van.id === row.id), after = crewFields(row);
        writes.push([db.collection('vans').doc(row.id), { ...after, crewHistory: appendVersion(before, 'crewHistory', crewFields(before), after, today, at, uid), updatedAt: at, crewRevision: data.requestId }]);
      }
      const affectedPeople = new Set(changes.flatMap(row => [...crewFields(row).technicianIds, ...crewFields(vans.find(van => van.id === row.id)).technicianIds]));
      for (const personId of affectedPeople) {
        const van = rows.find(row => row.technicianIds.includes(personId));
        writes.push([db.collection('staffProfiles').doc(personId), { primaryVanId: van?.vanId || '', updatedAt: at }]);
        // Field/Legacy authentication profiles also retain a compatibility Van reference.
        // Update linked accounts without touching role, staff identity or authentication state.
        const accounts = await get(db.collection('users').where('staffId', '==', personId));
        for (const account of accounts.docs) writes.push([db.collection('users').doc(account.id), { vanId: van?.vanId || '', updatedAt: at }]);
      }
      if (writes.length > 450) fail('roster_limit', 'Demasiados vínculos para un guardado seguro. No se aplicó ningún cambio.');
      const result = { success: true, effectiveDate: today, changedVans: changes.length, updatedWorkOrders: orderChanges.size, updatedAppointments: appointmentChanges.size, updatedProjects: projectChanges.size };
      // No writes until every authorization, link, execution and final-state check passed.
      for (const [ref, patch] of writes) tx.update(ref, patch);
      tx.set(audit, { fingerprint, actor: { id: uid, name: actor.name || actor.displayName || '', role: actor.role }, at, effectiveDate: today,
        before: current.rows, after: rows, workOrders: [...orderChanges.keys()], result });
      return result;
    });
  }
  return { execute };
}
module.exports = { ACTIONS, createVanRosterAuthority, snapshotProjection, validateRows };
