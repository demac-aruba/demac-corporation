'use strict';

const { createHash } = require('node:crypto');
const ACTIONS = new Set(['list_customer_alerts', 'match_customer_alerts', 'create_customer_alert', 'set_customer_alert_status', 'review_customer_alert', 'customer_alert_history']);
const ROLES = new Set(['admin', 'office', 'supervisor']);
const CATEGORIES = new Set(['debt', 'conduct', 'other']);
const LIMIT = 500;
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const text = (v, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function id(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 180 || /[/\\\x00-\x1f]/.test(v) || ['.', '..'].includes(v)) fail('alert_identity', 'Identificador no válido.');
  return v;
}
function normalizePhone(v) {
  let raw = text(v, 80);
  if (!/^[+\d\s().-]+$/.test(raw)) return '';
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 7) digits = '297' + digits;
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
}
const normalizeAddress = v => text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const phoneKey = v => normalizePhone(v) ? 'p:' + normalizePhone(v) : '';
const addressKey = (address, unit = '') => normalizeAddress(address).length >= 5 ? 'a:' + normalizeAddress(address) + '|unit:' + normalizeAddress(unit) : '';
const unique = values => [...new Set(values.filter(Boolean))];
const record = snap => snap.exists ? { ...snap.data(), id: snap.id } : null;
const rows = snap => {
  if (snap.size > LIMIT) fail('alert_limit', 'Hay demasiadas coincidencias. Selecciona un cliente o una propiedad más específica.', 409);
  return snap.docs.map(record);
};
async function actorFor(get, db, uid) {
  const actor = record(await get(db.collection('users').doc(id(uid))));
  if (actor?.active !== true || !ROLES.has(actor.role)) fail('permission_denied', 'No tienes permiso para consultar o registrar alertas de clientes.', 403);
  return { id: uid, name: text(actor.name || actor.displayName || actor.email, 160), role: actor.role };
}

async function contextFor(get, db, data = {}) {
  const customerId = data.customerId ? id(data.customerId) : '';
  const propertyId = data.propertyId ? id(data.propertyId) : '';
  const dwellingId = data.dwellingId ? id(data.dwellingId) : '';
  if (!customerId && (propertyId || dwellingId)) fail('alert_customer', 'Selecciona el cliente.');
  const customer = customerId ? record(await get(db.collection('clients').doc(customerId))) : null;
  if (customerId && !customer) fail('alert_customer', 'El cliente ya no está disponible.', 404);
  const property = propertyId ? record(await get(db.collection('properties').doc(propertyId))) : null;
  if (propertyId && (!property || property.clientId !== customerId)) fail('alert_property', 'La propiedad no pertenece al cliente seleccionado.', 409);
  let dwelling = null;
  if (dwellingId) {
    if (!property) fail('alert_property', 'Selecciona la propiedad.');
    dwelling = record(await get(db.collection('properties').doc(propertyId).collection('dwellings').doc(dwellingId)));
    if (!dwelling || dwelling.clientId !== customerId || dwelling.propertyId !== propertyId || dwelling.active === false) fail('alert_dwelling', 'Revisa el apartamento o unidad seleccionado.', 409);
  }
  const phones = unique([phoneKey(customer?.phone), phoneKey(customer?.whatsapp)]);
  const locationKey = property && (!property.hasIndependentDwellings || dwelling) ? addressKey(property.address, dwelling?.code || dwelling?.name) : '';
  const query = !customerId ? text(data.query, 200) : '';
  const keys = unique([...phones, locationKey, ...(query ? [phoneKey(query), addressKey(query)] : [])]);
  return { customerId, propertyId, dwellingId, customerName: text(customer?.name || customer?.company, 200), phone: text(customer?.phone || customer?.whatsapp, 80), address: [text(property?.address), text(dwelling?.name || dwelling?.code)].filter(Boolean).join(' · '), phones, locationKey, keys };
}
function matchFor(alert, context) {
  const direct = alert.customerId === context.customerId && !!context.customerId;
  const keys = alert.matchKeys.filter(key => context.keys.includes(key));
  return direct || keys.length ? { ...alert, matchKind: direct ? 'customer' : keys.some(k => k.startsWith('p:')) ? 'phone' : 'address', matchedKeys: keys, canDismiss: !direct && !!context.customerId } : null;
}
const exceptionId = (context, keys) => hash([context.customerId, [...keys].sort()]);
const contextToken = c => hash([c.customerId, c.propertyId, c.dwellingId, [...c.keys].sort()]);

function createCustomerAlerts({ db, clock = () => new Date() }) {
  const collection = db.collection('customerAlerts');
  async function execute({ action, data = {}, uid }) {
    if (!ACTIONS.has(action)) fail('alert_action', 'Acción de alertas no válida.');
    await actorFor(ref => ref.get(), db, uid);
    if (action === 'list_customer_alerts') {
      const context = await contextFor(ref => ref.get(), db, { customerId: id(data.customerId) });
      const [alerts, properties] = await Promise.all([collection.where('customerId', '==', context.customerId).limit(LIMIT + 1).get(), db.collection('properties').where('clientId', '==', context.customerId).limit(LIMIT + 1).get()]);
      return { success: true, customer: { id: context.customerId, name: context.customerName, phone: context.phone }, alerts: rows(alerts).sort((a,b) => b.createdAt.localeCompare(a.createdAt)), properties: rows(properties).filter(p => p.active !== false).map(p => ({ id: p.id, name: text(p.name), address: text(p.address), hasIndependentDwellings: p.hasIndependentDwellings === true })) };
    }
    if (action === 'match_customer_alerts') {
      const context = await contextFor(ref => ref.get(), db, data);
      const sets = await Promise.all([
        ...(context.customerId ? [collection.where('customerId', '==', context.customerId).limit(LIMIT + 1).get()] : []),
        ...(context.keys.length ? [collection.where('matchKeys', 'array-contains-any', context.keys).limit(LIMIT + 1).get()] : []),
      ]);
      const candidates = [...new Map(sets.flatMap(rows).map(row => [row.id, row])).values()].filter(row => row.status === 'active');
      const matches = (await Promise.all(candidates.map(async alert => {
        const match = matchFor(alert, context);
        if (!match || !match.canDismiss) return match;
        const exception = record(await collection.doc(alert.id).collection('exceptions').doc(exceptionId(context, match.matchedKeys)).get());
        return exception?.alertVersion === alert.version ? null : match;
      }))).filter(Boolean);
      return { success: true, matches, contextToken: contextToken(context), customerName: context.customerName };
    }
    if (action === 'customer_alert_history') {
      const ref = collection.doc(id(data.id));
      if (!(await ref.get()).exists) fail('alert_missing', 'La alerta no existe.', 404);
      const snapshot = await ref.collection('events').orderBy('at', 'desc').limit(50).get();
      return { success: true, events: snapshot.docs.map(record), limit: 50 };
    }
    const alertId = id(data.id), requestId = id(data.requestId);
    const fingerprint = hash({ action, data });
    return db.runTransaction(async tx => {
      const get = ref => tx.get(ref), actor = await actorFor(get, db, uid);
      const ref = collection.doc(alertId), eventRef = ref.collection('events').doc(hash([uid, requestId]));
      const [snapshot, receipt] = await Promise.all([get(ref), get(eventRef)]);
      const before = record(snapshot);
      if (receipt.exists) {
        if (receipt.data().fingerprint !== fingerprint) fail('alert_replay', 'Esta solicitud ya se usó con otros datos. Recarga para verificar.', 409);
        return { success: true, replayed: true, alert: before };
      }
      const at = clock().toISOString();
      let next, event = { action, fingerprint, at, actor };
      if (action === 'create_customer_alert') {
        if (before) fail('alert_conflict', 'La alerta ya existe. Recarga para verificar.', 409);
        if (!CATEGORIES.has(data.category) || typeof data.comment !== 'string' || data.comment.trim().length < 5 || data.comment.length > 4000) fail('alert_input', 'Selecciona un motivo y escribe un comentario de 5 a 4000 caracteres.');
        if (typeof data.matchPhone !== 'boolean' || typeof data.matchAddress !== 'boolean') fail('alert_input', 'Revisa las coincidencias de teléfono y dirección.');
        const context = await contextFor(get, db, { ...data, customerId: id(data.customerId) });
        if (data.matchAddress && !context.locationKey) fail('alert_address', 'Selecciona una propiedad y su apartamento o unidad antes de vincular la dirección.');
        next = { id: alertId, customerId: context.customerId, customerName: context.customerName, propertyId: context.propertyId, dwellingId: context.dwellingId, phone: context.phone, address: context.address, category: data.category, comment: data.comment.trim(), matchKeys: unique([...(data.matchPhone ? context.phones : []), ...(data.matchAddress ? [context.locationKey] : [])]), status: 'active', version: 1, createdAt: at, createdBy: actor, updatedAt: at };
        event.after = next;
      } else {
        if (!before) fail('alert_missing', 'La alerta no existe.', 404);
        if (!Number.isSafeInteger(data.expectedVersion) || before.version !== data.expectedVersion) fail('alert_conflict', 'La alerta cambió. Recarga y revisa la versión actual.', 409);
        if (action === 'set_customer_alert_status') {
          if (!['active', 'resolved', 'invalidated'].includes(data.status) || text(data.reason, 2000).length < 5) fail('alert_reason', 'Indica el motivo del cambio (mínimo 5 caracteres).');
          next = { ...before, status: data.status, version: before.version + 1, updatedAt: at };
          event = { ...event, before, after: next, reason: text(data.reason, 2000) };
        } else {
          const context = await contextFor(get, db, data.context);
          if (!context.customerId || data.contextToken !== contextToken(context)) fail('alert_context', 'Los datos del cliente cambiaron. Revisa las coincidencias de nuevo.', 409);
          const match = matchFor(before, context);
          if (before.status !== 'active' || !match) fail('alert_conflict', 'Esta coincidencia cambió. Revisa las alertas de nuevo.', 409);
          if (!['continue', 'decline', 'different_customer'].includes(data.decision)) fail('alert_decision', 'Selecciona una decisión.');
          if (data.decision === 'different_customer') {
            if (!match.canDismiss) fail('alert_owner', 'La alerta pertenece a este cliente. Selecciona al nuevo cliente o resuelve la alerta original.', 409);
            if (text(data.reason, 2000).length < 5) fail('alert_reason', 'Explica cómo verificaste que es otro cliente (mínimo 5 caracteres).');
            tx.set(ref.collection('exceptions').doc(exceptionId(context, match.matchedKeys)), { customerId: context.customerId, matchKeys: match.matchedKeys, alertVersion: before.version, reason: text(data.reason, 2000), actor, at });
          }
          event = { ...event, decision: data.decision, reason: text(data.reason, 2000), customerId: context.customerId, propertyId: context.propertyId, dwellingId: context.dwellingId, alertVersion: before.version, matchedKeys: match.matchedKeys };
          // A booking decision never rewrites the incident, the customer or the appointment.
        }
      }
      if (next) tx.set(ref, next);
      tx.set(eventRef, event);
      return { success: true, alert: next || before };
    });
  }
  return { execute };
}
module.exports = { ACTIONS, createCustomerAlerts, normalizePhone, normalizeAddress, addressKey };
