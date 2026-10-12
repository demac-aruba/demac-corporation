'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { normalizeCatalogService } = require('./serviceCatalog');
const ACTIONS = new Set(['list_managed_catalog', 'save_catalog_item', 'delete_catalog_item']);
const WRITERS = new Set(['admin', 'office', 'supervisor']); // Same existing Firestore operationsRole.
const FIELDS = ['name','itemType','category','description','sku','active','featured','basePrice','durationMinutes','pricingDefinition','serviceDefinition'];
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const stable = value => value === undefined ? 'null' : !value || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : typeof value.toJSON === 'function' ? stable(value.toJSON())
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const project = (id, value) => ({ ...value, id, name: text(value.name || value.label) || id, catalogToken: hash(value) });
const text = (value, max = 220) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
function identity(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 180 || /[/\\\x00-\x1f]/.test(value)) fail('catalog_identity', 'Identidad de catálogo no válida.');
  return value;
}
const normalizeCode = value => text(value, 120).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80);
const bookingCode = value => value ? normalizeCatalogService(value)?.id || '' : '';
const claimRef = (db, code) => db.collection('businessSettings').doc('service-catalog').collection('codeClaims').doc(hash(code));
const PAGE_SIZE = 200;
function catalogPage(db, cursor) {
  const query = db.collection('services').orderBy('__name__').limit(PAGE_SIZE);
  return cursor ? query.startAfter(identity(cursor)) : query;
}
const validMoney = price => typeof price === 'number' && Number.isFinite(price) && price >= 0 && price <= 1000000 && Math.abs(price * 100 - Math.round(price * 100)) <= 0.00001;
async function actorFor(get, db, uid, write) {
  const snapshot = await get(db.collection('users').doc(identity(uid)));
  const actor = snapshot.exists ? snapshot.data() : null;
  if (actor?.active !== true || (write && !WRITERS.has(actor.role))) fail('permission_denied', 'Tu cuenta no tiene permiso para cambiar el catálogo.', 403);
  return { id: uid, name: text(actor.name || actor.displayName), role: actor.role };
}
function patchInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('catalog_input', 'Completa los datos del artículo.');
  if (JSON.stringify(value).length > 50000) fail('catalog_input', 'El artículo supera el tamaño permitido.');
  const patch = {};
  for (const field of FIELDS) if (Object.hasOwn(value, field) && value[field] !== undefined) patch[field] = value[field];
  for (const field of ['name','category','description','sku']) if (Object.hasOwn(patch, field)) patch[field] = text(patch[field], field === 'description' ? 4000 : 220);
  for (const field of ['active','featured']) if (Object.hasOwn(patch, field) && typeof patch[field] !== 'boolean') fail('catalog_input', 'Estado de catálogo no válido.');
  if (Object.hasOwn(patch,'basePrice')) {
    const price = patch.basePrice;
    // Null is intentionally unpriced. A blank input is never coerced into zero.
    if (price !== null && !validMoney(price)) fail('catalog_price', 'El precio debe tener como máximo dos decimales; déjalo vacío si está pendiente.');
  }
  return patch;
}
function validate(next, before, patch) {
  if (!next.name) fail('catalog_name', 'Escribe el nombre del artículo.');
  const kind = next.itemType || 'Servicio';
  if (!['Servicio','Producto'].includes(kind) || (before && (before.itemType || 'Servicio') !== kind)) fail('catalog_type', 'El tipo del artículo no se cambia después de crearlo.');
  if (!before || Object.hasOwn(patch,'durationMinutes')) {
    if (!Number.isSafeInteger(next.durationMinutes) || next.durationMinutes < 0 || next.durationMinutes > 720 || (kind === 'Servicio' && next.durationMinutes < 30)) fail('catalog_duration', 'Revisa la duración estimada del servicio.');
  }
  if (Object.hasOwn(patch, 'serviceDefinition')) {
    if (before?.serviceDefinition && before.serviceDefinition.version !== 1) fail('catalog_definition', 'Esta versión de servicio requiere revisión; no se convertirá automáticamente.');
    const definition = patch.serviceDefinition;
    if (!definition || definition.version !== 1 || !normalizeCode(definition.bookingCode) || !Number.isSafeInteger(definition.duration?.minutes) || definition.duration.minutes < 30 || definition.duration.minutes > 720) fail('catalog_definition', 'Código o duración de servicio no válidos.');
    if (definition.duration.minutes !== next.durationMinutes) fail('catalog_duration', 'La duración del servicio y su definición deben coincidir.');
    next.serviceDefinition = { ...before?.serviceDefinition, ...definition, bookingCode: normalizeCode(definition.bookingCode), duration: { ...before?.serviceDefinition?.duration, ...definition.duration } };
  }
  if (Object.hasOwn(patch,'durationMinutes') && next.serviceDefinition?.version === 1 && next.serviceDefinition.duration?.minutes !== next.durationMinutes) fail('catalog_duration', 'La duración del servicio y su definición deben coincidir.');
  if (Object.hasOwn(patch, 'pricingDefinition')) {
    if (before?.pricingDefinition && before.pricingDefinition.version !== 1) fail('catalog_pricing', 'Esta versión de tarifa requiere revisión; no se convertirá automáticamente.');
    const definition = patch.pricingDefinition;
    if (!definition || definition.version !== 1 || !['fixed','per_unit','tiered_btu','quote'].includes(definition.mode) || definition.currency !== 'AWG') fail('catalog_pricing', 'La configuración de tarifa requiere revisión.');
    if (definition.mode === 'tiered_btu') {
      const tiers = definition.tiers;
      if (!Array.isArray(tiers) || !tiers.length || tiers.length > 100 || tiers.some(tier => !tier || !validMoney(tier.amount) || ['minBtu','maxBtu'].some(key => tier[key] != null && (!Number.isSafeInteger(tier[key]) || tier[key] <= 0)))) fail('catalog_pricing', 'Completa todas las tarifas por BTU; un valor vacío no es cero.');
      const ranges = tiers.map(tier => [tier.minBtu ?? 1, tier.maxBtu ?? Infinity]).sort((a,b) => a[0] - b[0]);
      if (ranges.some(([min,max], index) => max < min || (index > 0 && min <= ranges[index - 1][1]))) fail('catalog_pricing', 'Los rangos de BTU no pueden superponerse.');
    }
    next.pricingDefinition = { ...before?.pricingDefinition, ...definition };
  }
}
function createServiceCatalogEditing({ db, clock = () => new Date() }) {
  async function execute({ action, data = {}, uid }) {
    if (!ACTIONS.has(action)) fail('catalog_action', 'Acción de catálogo no válida.');
    if (action === 'list_managed_catalog') {
      await actorFor(ref => ref.get(), db, uid, false);
      const snapshot = await catalogPage(db, data.cursor).get();
      return { success: true, items: snapshot.docs.map(doc => project(doc.id, doc.data())), nextCursor: snapshot.size === PAGE_SIZE ? snapshot.docs.at(-1).id : null };
    }
    const id = identity(data.id), patch = action === 'save_catalog_item' ? patchInput(data.patch) : {};
    const expected = data.expectedToken;
    if (expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) fail('catalog_version', 'Recarga el catálogo y vuelve a abrir el artículo.', 409);
    const fingerprint = hash({ action, id, expected, patch });
    return db.runTransaction(async transaction => {
      const get = ref => transaction.get(ref), actor = await actorFor(get, db, uid, true);
      if (action === 'delete_catalog_item' && !['admin','supervisor'].includes(actor.role)) fail('permission_denied', 'Solo administración puede eliminar un artículo.', 403);
      const ref = db.collection('services').doc(id);
      // Stable per version: a lost response can be retried exactly, never replayed with a different patch.
      const auditRef = ref.collection('catalogEvents').doc(hash({ uid, expected }));
      const identityRef = ref.collection('catalogIdentity').doc('current');
      const [snapshot, replay, identitySnapshot] = await Promise.all([get(ref),get(auditRef),get(identityRef)]);
      const before = snapshot.exists ? snapshot.data() : null;
      if (replay.exists) {
        if (replay.data().fingerprint !== fingerprint) fail('catalog_replay', 'Esta versión ya se guardó con otros cambios. Conserva tu borrador y recarga.', 409);
        return { success: true, replayed: true, item: before ? project(id, before) : null };
      }
      if ((expected === null && before) || (expected !== null && (!before || hash(before) !== expected))) fail('catalog_conflict', 'Otro operador cambió este artículo. Tu borrador se conserva; recarga y revisa antes de guardar.', 409);
      if (!before && identitySnapshot.exists) fail('catalog_identity_retired', 'Esta identidad pertenece a un artículo eliminado. Crea un artículo nuevo.', 409);
      if (!before && action === 'delete_catalog_item') fail('catalog_missing', 'El artículo ya no existe.', 404);
      const now = clock().toISOString();
      const next = { ...before, ...patch, updatedAt: now, updatedById: uid, updatedByName: actor.name, catalogRevision: randomUUID() };
      if (!before) Object.assign(next, { createdAt: now, createdById: uid, createdByName: actor.name });
      if (action === 'save_catalog_item') validate(next, before, patch);
      const oldCode = before ? bookingCode({ ...before, id }) : '', newCode = action === 'save_catalog_item' ? bookingCode({ ...next, id }) : '';
      const oldClaim = oldCode ? await get(claimRef(db, oldCode)) : null;
      const newClaim = newCode ? newCode === oldCode ? oldClaim : await get(claimRef(db, newCode)) : null;
      if (newCode) {
        if (newClaim?.exists && newClaim.data().serviceId !== id) fail('catalog_code_conflict', 'Otro servicio activo ya usa ese código de booking.', 409);
        if (!newClaim?.exists) {
          // Compatibility with pre-claim records; no migration or guessed cleanup.
          let cursor = null;
          do {
            const legacy = await get(catalogPage(db, cursor));
            if (legacy.docs.some(doc => doc.id !== id && bookingCode({ ...doc.data(), id: doc.id }) === newCode)) fail('catalog_code_conflict', 'Otro servicio activo ya usa ese código de booking.', 409);
            cursor = legacy.size === PAGE_SIZE ? legacy.docs.at(-1).id : null;
          } while (cursor);
        }
      }
      if (action === 'delete_catalog_item') {
        for (const [collection, field] of [['workOrders','serviceId'],['fieldSaleLines','catalogItemId'],['workInterventions','serviceCatalogItemId']]) {
          if (!(await get(db.collection(collection).where(field,'==',id).limit(1))).empty) fail('catalog_linked', 'El artículo tiene trabajos o ventas vinculados. Desactívalo en vez de eliminarlo.', 409);
        }
        if ((await get(db.collection('commercialProductStock').doc(id))).exists) fail('catalog_linked', 'El producto tiene inventario vinculado. Desactívalo en vez de eliminarlo.', 409);
      }
      if (oldCode && oldCode !== newCode && oldClaim?.exists && oldClaim.data().serviceId === id) transaction.delete(claimRef(db, oldCode));
      if (newCode) transaction.set(claimRef(db, newCode), { serviceId: id, bookingCode: newCode });
      if (!identitySnapshot.exists) transaction.set(identityRef, { createdAt: now, serviceId: id });
      if (action === 'delete_catalog_item') transaction.delete(ref); else transaction.set(ref, next);
      transaction.set(auditRef, { action, fingerprint, at: now, actor, before, after: action === 'delete_catalog_item' ? null : next });
      return { success: true, item: action === 'delete_catalog_item' ? null : project(id, next) };
    });
  }
  return { execute };
}
module.exports = { ACTIONS, createServiceCatalogEditing, bookingCode };
