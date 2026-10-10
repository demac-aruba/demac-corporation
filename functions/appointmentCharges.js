'use strict';

// Operational charge/receipt evidence owned by an Appointment. This never issues
// invoices, reconciles bank transactions, or changes Field, capacity or payroll.
const crypto = require('node:crypto');
const { companyMatrixPrice, resolveServicePriceSnapshot, PRICING_RULE_KINDS } = require('./servicePricingAuthority');
const { projectBillingCandidate } = require('./fieldOperationsBillingCandidates');
const { fieldFirestoreData } = require('./fieldOperationsFirestoreData');
const SOURCE = 'appointment-operational';
const ACTIONS = new Set(['list_charge_services', 'quote_appointment_charges', 'get_appointment_charges', 'save_appointment_estimate',
  'finalize_appointment_charges', 'record_appointment_payment', 'void_appointment_payment']);
const WRITERS = new Set(['admin', 'owner', 'super_admin', 'superadmin', 'supervisor', 'operations', 'office', 'operator', 'office_operator', 'finance', 'accounting', 'accountant']);
const METHODS = new Set(['cash', 'transfer', 'pos', 'suave']);
const MAX_CENTS = 100000000;
const clean = (value, limit = 500) => String(value ?? '').trim().slice(0, limit);
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (value === undefined) return 'null';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function id(value, label = 'Identidad') {
  const result = clean(value, 240);
  if (!result || result.length > 180 || /[/\\\x00-\x1f]/.test(result)) fail('charge_identity', `${label} no válida.`);
  return result;
}
function decimal(value, places, maximum, label) {
  if (!['string', 'number'].includes(typeof value) || !new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(String(value))) fail('charge_number', `${label}: usa un número positivo con hasta ${places} decimales.`);
  const scale = 10 ** places;
  const [whole, fraction = ''] = String(value).split('.');
  const result = Number(whole) * scale + Number(fraction.padEnd(places, '0'));
  if (!Number.isSafeInteger(result) || result > maximum) fail('charge_number', `${label} fuera del rango permitido.`);
  return result;
}
function inputLines(value) {
  if (!Array.isArray(value) || !value.length || value.length > 60) fail('charge_lines', 'Agrega entre 1 y 60 conceptos.');
  const lines = value.map(line => {
    const quantityMillis = decimal(line.quantity, 3, 10000000, 'Cantidad');
    if (!quantityMillis) fail('charge_quantity', 'La cantidad debe ser mayor que cero.');
    const btu = line.btu === '' || line.btu === undefined || line.btu === null ? null : Number(line.btu);
    if (btu !== null && (!Number.isSafeInteger(btu) || btu <= 0 || btu > 10000000)) fail('charge_btu', 'BTU no válido.');
    return { id: id(line.id, 'Concepto'), workLineId: line.workLineId ? id(line.workLineId) : '',
      presetId: clean(line.presetId, 120), serviceId: line.serviceId ? id(line.serviceId) : '',
      label: clean(line.label, 220), btu, quantityMillis,
      overrideCents: line.unitPrice === undefined || line.unitPrice === null || line.unitPrice === '' ? null : decimal(line.unitPrice, 2, MAX_CENTS, 'Precio'),
      reason: clean(line.reason, 700) };
  });
  if (new Set(lines.map(line => line.id)).size !== lines.length) fail('charge_duplicate_line', 'Cada concepto debe tener su propia identidad.');
  return lines;
}
function paymentInput(value, now) {
  if (!value || typeof value !== 'object') fail('payment_input', 'Completa los datos del pago.');
  const amountCents = decimal(value.amount, 2, MAX_CENTS, 'Monto del pago');
  if (!amountCents) fail('payment_amount', 'El pago debe ser mayor que cero.');
  if (!METHODS.has(value.method)) fail('payment_method', 'Selecciona efectivo, transferencia, POS o SUAVE.');
  const reference = clean(value.reference, 180);
  if (value.method !== 'cash' && !reference) fail('payment_reference', 'Ingresa la referencia de la transferencia o transacción.');
  const receivedAt = clean(value.receivedAt, 40) || now.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(receivedAt) || !Number.isFinite(Date.parse(receivedAt)) || Date.parse(receivedAt) > now.getTime() + 60000) fail('payment_date', 'La fecha de recepción no puede estar en el futuro.');
  return { amountCents, method: value.method, reference, receivedAt: new Date(receivedAt).toISOString(), note: clean(value.note, 700) };
}
function initialInput(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) fail('charge_input', 'Importes no válidos.');
  // Retain the exact entered receipt date in the replay identity; never hash a
  // server-generated timestamp which changes between retries.
  return { lines: inputLines(input.lines), note: clean(input.note, 1000), payment: input.payment || null, quoteToken: clean(input.quoteToken, 64) };
}
const chargeFingerprint = input => hash(stable(initialInput(input)));
async function actorFor(get, db, uid, write = true) {
  const snapshot = await get(db.collection('users').doc(id(uid, 'Usuario')));
  const profile = snapshot.exists ? snapshot.data() : null;
  const role = clean(profile?.role, 80).toLowerCase().replace(/[\s-]+/g, '_');
  if (profile?.active !== true || !(WRITERS.has(role) || (!write && role === 'auditor'))) fail('permission_denied', 'Se requiere una cuenta de oficina o contabilidad activa.', 403);
  return { id: uid, name: clean(profile.name || profile.displayName, 180), role };
}
async function quoteLines({ db, get, lines, now }) {
  const rules = await get(db.collection('businessSettings').doc('company-service-pricing-rules'));
  const pricingSettings = rules.exists ? rules.data() : null;
  const result = [];
  for (const line of lines) {
    let base = null, label = line.label, pendingReason = '', pricingVersion = '';
    try {
      if (line.serviceId) {
        const snapshot = await get(db.collection('services').doc(line.serviceId));
        if (!snapshot.exists || snapshot.data().active === false) fail('charge_catalog', 'El servicio seleccionado no está activo.');
        const service = { ...snapshot.data(), id: line.serviceId };
        label ||= clean(service.name, 220);
        if (['fixed', 'per_unit', undefined].includes(service.pricingDefinition?.mode) && !PRICING_RULE_KINDS.has(service.pricingRuleKind)
          && (service.basePrice === null || service.basePrice === '')) throw Object.assign(new Error('Precio base no configurado.'), { code: 'service_pricing_not_configured' });
        base = resolveServicePriceSnapshot({ service, pricingSettings, btu: line.btu, capturedAt: now.toISOString() });
      } else if (PRICING_RULE_KINDS.has(line.presetId)) {
        // These three exact Scheduling kinds explicitly refer to the governed
        // company BTU matrix, not a guessed catalog product or label match.
        base = companyMatrixPrice({ service: { bookingCode: line.presetId }, pricingSettings, btu: line.btu });
      } else pendingReason = 'Selecciona un servicio del catálogo o ingresa un precio con motivo.';
    } catch (error) {
      if (!String(error.code || '').startsWith('service_pricing_')) throw error;
      pendingReason = line.btu ? 'Tarifa no configurada; ingresa un precio autorizado con motivo.' : 'BTU o tarifa por confirmar.';
    }
    if (!label) fail('charge_label', 'Cada concepto necesita una descripción.');
    const baseUnitCents = base ? decimal(base.unitPrice.toFixed(2), 2, MAX_CENTS, 'Precio base') : null;
    pricingVersion = base?.pricingVersion || '';
    const changed = line.overrideCents !== null && line.overrideCents !== baseUnitCents;
    if (changed && !line.reason) fail('charge_override_reason', 'Explica el precio manual o ajuste de cada concepto.');
    const unitCents = line.overrideCents ?? baseUnitCents;
    result.push({ ...line, label, baseUnitCents, unitCents, totalCents: unitCents === null ? null : Math.round(unitCents * line.quantityMillis / 1000),
      pricingVersion, pendingReason: unitCents === null ? pendingReason : '', manualPrice: changed });
  }
  const knownTotalCents = result.reduce((sum, line) => sum + (line.totalCents ?? 0), 0);
  if (!Number.isSafeInteger(knownTotalCents) || knownTotalCents > MAX_CENTS) fail('charge_total', 'El total supera el límite por cita.');
  const value = { lines: result, totalCents: result.every(line => line.unitCents !== null) ? knownTotalCents : null, knownTotalCents, currency: 'AWG' };
  return { ...value, quoteToken: hash(stable(value)), capturedAt: now.toISOString() };
}
function assertQuote(quote, token) {
  if (token && quote.quoteToken !== token) fail('charge_quote_changed', 'La tarifa cambió. Revisa la proyección actualizada antes de guardar.', 409);
}
async function authorizeInitialCharges({ db, get, input, actor }) {
  if (input === undefined || input === null) return;
  if (actor?.source !== 'office-scheduling') fail('permission_denied', 'Solo oficina puede registrar importes.', 403);
  return actorFor(get, db, actor.id);
}
function emptyState() { return { schemaVersion: 1, version: 0, originalEstimate: null, estimate: null, final: null, receivedCents: 0, paymentCount: 0 }; }
function validateState(state) {
  if (state && (state.schemaVersion !== 1 || !Number.isSafeInteger(state.version) || state.version < 1
    || !Number.isSafeInteger(state.receivedCents) || state.receivedCents < 0 || state.receivedCents > MAX_CENTS
    || !Number.isSafeInteger(state.paymentCount) || state.paymentCount < 0)) fail('charge_state', 'El historial requiere revisión de contabilidad.', 409);
  return state || emptyState();
}
function paymentDocument(payment, appointment, appointmentId, actor, paymentId, now) {
  return { id: paymentId, source: SOURCE, appointmentId, customerId: appointment.customerId,
    propertyId: appointment.propertyId, workOrderIds: appointment.workOrderIds || [], currency: 'AWG',
    ...payment, amount: { amount: payment.amountCents / 100, currency: 'AWG' }, status: 'recorded',
    verificationStatus: 'office_recorded', createdAt: now.toISOString(), createdBy: actor.id, createdByName: actor.name };
}
function eventRef(db, appointmentId, uid, requestId) {
  return db.collection('appointments').doc(appointmentId).collection('chargeEvents').doc(hash(`${uid}|${requestId}`));
}
async function prepareInitialCharges({ db, transaction, input, actor, appointmentId, appointment, now = new Date() }) {
  const normalized = initialInput(input);
  if (!normalized) return null;
  const authorized = await authorizeInitialCharges({ db, get: ref => transaction.get(ref), input, actor });
  const estimate = { ...await quoteLines({ db, get: ref => transaction.get(ref), lines: normalized.lines, now }), note: normalized.note, actor: authorized };
  assertQuote(estimate, normalized.quoteToken);
  const payment = normalized.payment ? paymentInput(normalized.payment, now) : null;
  if (payment && appointment.status === 'temporary_hold') fail('payment_hold', 'Confirma la cita antes de registrar un pago.');
  const value = { ...emptyState(), version: 1, originalEstimate: estimate, estimate, receivedCents: payment?.amountCents || 0,
    paymentCount: payment ? 1 : 0, updatedAt: now.toISOString(), updatedBy: authorized.id };
  const receiptId = `APT-PAY-${hash(`${appointmentId}|initial`).slice(0,32)}`;
  return { value, write() {
    transaction.set(eventRef(db, appointmentId, authorized.id, 'initial'), { action: 'initial_estimate', at: now.toISOString(), actor: authorized, version: 1, estimate,
      ...(payment ? { paymentId: receiptId } : {}) });
    if (payment) transaction.set(db.collection('payments').doc(receiptId), paymentDocument(payment, appointment, appointmentId, authorized, receiptId, now));
  } };
}
function hasLegacyMoney(record) {
  if (!record) return false;
  return ['invoiceId','paymentId','qboInvoiceId'].some(key => Boolean(record[key]))
    || ['invoiceIds','paymentIds'].some(key => Array.isArray(record[key]) && record[key].length)
    || ['paid','amountPaid','totalPaid','amount'].some(key => record[key] !== undefined && record[key] !== null && record[key] !== '' && Number(record[key]) !== 0);
}
async function legacyBlocker({ db, get, appointment, appointmentId }) {
  // Guard original legacy financial evidence; never import it as zero or silently
  // create a second balance beside an existing invoice/receipt.
  if (hasLegacyMoney(appointment)) return 'Esta cita tiene importes o documentos anteriores. Contabilidad debe conciliarlos antes de usar el nuevo registro.';
  const refs = [['invoices','appointmentId',appointmentId]];
  for (const workOrderId of appointment.workOrderIds || []) {
    const order = await get(db.collection('workOrders').doc(id(workOrderId)));
    if (order.exists && hasLegacyMoney(order.data())) return 'La orden tiene importes o pagos anteriores que requieren conciliación.';
    refs.push(['invoices','workOrderId',workOrderId], ['payments','workOrderId',workOrderId]);
  }
  for (const [collection, field, value] of refs) {
    const snap = await get(db.collection(collection).where(field,'==',value).limit(1));
    if (!snap.empty) return 'Hay facturas o pagos vinculados que requieren conciliación de contabilidad.';
  }
  return '';
}
async function candidateEvidence({ db, get, appointment, appointmentId }) {
  const queries = [db.collection('fieldBillingCandidates').where('appointmentId', '==', appointmentId).limit(61),
    ...(appointment.workOrderIds || []).map(workOrderId => db.collection('fieldBillingCandidates').where('workOrderId', '==', workOrderId).limit(61))];
  const records = new Map();
  for (const query of queries) {
    const snapshot = await get(query);
    for (const doc of snapshot.docs) records.set(doc.id, { ...doc.data(), id: doc.id });
  }
  if (records.size > 60) return { records: [], fingerprint: '', blocker: 'El volumen de revisiones Field requiere conciliación de contabilidad.' };
  const projected = [];
  for (const record of records.values()) {
    try {
      const candidate = projectBillingCandidate(record, { appointmentId, customerId: appointment.customerId, propertyId: appointment.propertyId });
      if (!(appointment.workOrderIds || []).includes(candidate.workOrderId) || candidate.lines.some(line => line.currency !== 'AWG')) throw Error('Candidate relationship/currency conflict');
      projected.push(fieldFirestoreData(candidate));
    } catch {
      return { records: [], fingerprint: '', blocker: 'Una revisión Field tiene vínculos o facturación que requieren conciliación de contabilidad.' };
    }
  }
  projected.sort((a,b) => a.id.localeCompare(b.id));
  return { records: projected, fingerprint: hash(stable(projected)), blocker: '' };
}
async function paymentRecords(db, get, appointmentId) {
  const snapshot = await get(db.collection('payments').where('appointmentId','==',appointmentId).limit(301));
  if (snapshot.docs.length > 300) fail('payment_limit', 'Esta cita requiere revisión de contabilidad por el volumen de pagos.', 409);
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}
function receiptBlocker(payments, state) {
  if (payments.some(payment => payment.source !== SOURCE)) return 'Hay pagos anteriores que requieren conciliación de contabilidad.';
  if (payments.some(payment => !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 || !METHODS.has(payment.method)
    || !['recorded','voided'].includes(payment.status) || !Number.isFinite(Date.parse(payment.receivedAt)))) return 'Hay un recibo inválido que requiere conciliación de contabilidad.';
  const total = payments.filter(payment => payment.status === 'recorded').reduce((sum, payment) => sum + payment.amountCents, 0);
  if (!Number.isSafeInteger(total) || total !== (state?.receivedCents || 0)) return 'El total de pagos necesita conciliación; no se sobrescribirá.';
  return '';
}
function createAppointmentCharges({ db, clock = () => new Date() }) {
  async function execute({ action, data = {}, uid }) {
    if (!ACTIONS.has(action)) fail('charge_action', 'Acción no válida.');
    const now = clock();
    const readOnly = ['get_appointment_charges', 'quote_appointment_charges', 'list_charge_services'].includes(action);
    await actorFor(ref => ref.get(), db, uid, !readOnly);
    if (action === 'list_charge_services') {
      const services = await db.collection('services').limit(1001).get();
      if (services.docs.length > 1000) fail('charge_catalog_limit', 'El catálogo requiere una búsqueda específica.', 409);
      return { success: true, services: services.docs.filter(doc => doc.data().active !== false).map(doc => ({ id: doc.id, name: clean(doc.data().name || doc.data().label || doc.id, 220) })).sort((a,b) => a.name.localeCompare(b.name)) };
    }
    if (action === 'quote_appointment_charges') {
      return { success: true, quote: await quoteLines({ db, get: ref => ref.get(), lines: inputLines(data.lines), now }) };
    }
    const appointmentId = id(data.appointmentId, 'Cita');
    const ref = db.collection('appointments').doc(appointmentId);
    if (readOnly) {
      return db.runTransaction(async transaction => {
      const get = ref => transaction.get(ref);
      await actorFor(get, db, uid, false);
      const snapshot = await get(ref);
      if (!snapshot.exists) fail('not_found', 'La cita ya no existe.', 404);
      const appointment = snapshot.data();
      const state = validateState(appointment.jobCharges);
      const payments = await paymentRecords(db, get, appointmentId);
      const candidates = await candidateEvidence({ db, get, appointment, appointmentId });
      const blocker = receiptBlocker(payments, state) || candidates.blocker || await legacyBlocker({ db, get, appointment, appointmentId });
      const events = await get(ref.collection('chargeEvents').orderBy('at','desc').limit(100));
      return { success: true, state: appointment.jobCharges || null, payments: blocker ? [] : payments, blocker, candidateEvidence: candidates,
        workItems: (appointment.workItems || appointment.workLines || []).map((line, index) => ({ id: `work-${index + 1}`, label: clean(line.label || line.workTypeName || line.presetId, 220), quantity: line.quantity || 1, presetId: line.presetId || '', serviceId: line.serviceId || '' })),
        history: events.docs.map(doc => ({ ...doc.data(), id: doc.id })), appointmentStatus: appointment.status };
      });
    }
    const requestId = id(data.requestId, 'Solicitud');
    if (requestId.length < 8) fail('charge_request', 'La solicitud necesita una identidad estable.');
    const fingerprint = hash(stable({ action, data }));
    return db.runTransaction(async transaction => {
      const get = ref => transaction.get(ref);
      const actor = await actorFor(get, db, uid);
      const auditRef = eventRef(db, appointmentId, uid, requestId);
      const [snapshot, replay] = await Promise.all([get(ref), get(auditRef)]);
      if (!snapshot.exists) fail('not_found', 'La cita ya no existe.', 404);
      const appointment = snapshot.data();
      const current = validateState(appointment.jobCharges);
      if (replay.exists) {
        if (replay.data().fingerprint !== fingerprint) fail('idempotency_conflict', 'La solicitud ya se usó con otros datos.', 409);
        return { success: true, replayed: true, state: appointment.jobCharges || null };
      }
      if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion !== current.version) fail('charge_conflict', 'Otro operador actualizó los importes. Recarga antes de guardar.', 409);
      if (!appointment.customerId || !appointment.propertyId) fail('charge_relationship', 'La cita necesita cliente y propiedad canónicos.', 409);
      const payments = await paymentRecords(db, get, appointmentId);
      const candidates = await candidateEvidence({ db, get, appointment, appointmentId });
      const blocker = receiptBlocker(payments, current) || candidates.blocker || await legacyBlocker({ db, get, appointment, appointmentId });
      if (blocker) fail('charge_reconciliation', blocker, 409);
      const next = { ...current, version: current.version + 1, updatedAt: now.toISOString(), updatedBy: actor.id };
      const audit = { action, fingerprint, at: now.toISOString(), actor, version: next.version, requestId };
      let receipt = null, receiptRef = null, voidRef = null, voidPatch = null;
      if (action === 'save_appointment_estimate' || action === 'finalize_appointment_charges') {
        if (['cancelled','canceled'].includes(appointment.status)) fail('charge_cancelled', 'La cita está cancelada; conserva sus importes e historial.', 409);
        if (action === 'save_appointment_estimate' && current.final) fail('charge_final_exists', 'El monto final ya está confirmado; usa una corrección de cierre con motivo.', 409);
        const quote = await quoteLines({ db, get, lines: inputLines(data.lines), now });
        assertQuote(quote, data.quoteToken);
        const note = clean(data.note, 1000);
        if ((current.originalEstimate || current.estimate || current.final) && !note) fail('charge_change_reason', 'Explica el cambio respecto al importe anterior.');
        const value = { ...quote, note, actor };
        if (action === 'finalize_appointment_charges') {
          if (appointment.status === 'temporary_hold') fail('charge_hold', 'Confirma la cita antes de cerrar sus importes.');
          if (quote.totalCents === null) fail('charge_unpriced', 'Completa todos los precios antes de confirmar el monto final.');
          if (data.scopeReviewed !== true) fail('charge_scope', 'Confirma que revisaste los trabajos realizados y los adicionales.');
          if (candidates.records.length && (data.candidateReviewed !== true || data.candidateFingerprint !== candidates.fingerprint || !note)) fail('charge_field_review', 'Revisa los conceptos Field y confirma que están conciliados en el monto final, con una nota.', 409);
          next.final = { ...value, candidateEvidence: candidates };
          audit.candidateEvidence = candidates;
        } else { next.estimate = value; next.originalEstimate ||= value; }
        audit.before = action === 'save_appointment_estimate' ? current.estimate : current.final;
        audit.after = value;
      } else if (action === 'record_appointment_payment') {
        if (appointment.status === 'temporary_hold') fail('payment_hold', 'Confirma la cita antes de registrar un pago.');
        if (payments.length >= 300) fail('payment_limit', 'Esta cita alcanzó el límite de recibos.', 409);
        const payment = paymentInput(data.payment, now);
        if (payment.reference && payments.some(p => p.status === 'recorded' && p.method === payment.method && clean(p.reference).toLowerCase() === payment.reference.toLowerCase())) fail('payment_duplicate', 'Ya existe un pago con este método y referencia. Revisa el historial.', 409);
        const paymentId = `APT-PAY-${hash(`${appointmentId}|${uid}|${requestId}`).slice(0,32)}`;
        receiptRef = db.collection('payments').doc(paymentId);
        const existing = await get(receiptRef);
        if (existing.exists) fail('payment_identity', 'La identidad del recibo ya existe.', 409);
        receipt = paymentDocument(payment, appointment, appointmentId, actor, paymentId, now);
        next.receivedCents += payment.amountCents;
        if (next.receivedCents > MAX_CENTS) fail('payment_limit', 'El monto recibido supera el límite por cita.');
        next.paymentCount++;
        audit.paymentId = paymentId;
        audit.amountCents = payment.amountCents;
      } else if (action === 'void_appointment_payment') {
        const reason = clean(data.reason, 700);
        if (!reason) fail('payment_void_reason', 'Explica por qué se anula este registro.');
        const paymentId = id(data.paymentId, 'Pago');
        const payment = payments.find(item => item.id === paymentId && item.appointmentId === appointmentId);
        if (!payment || payment.source !== SOURCE || payment.status !== 'recorded') fail('payment_unavailable', 'El pago no está disponible para anulación.', 409);
        voidRef = db.collection('payments').doc(paymentId);
        voidPatch = { status: 'voided', voidReason: reason, voidedAt: now.toISOString(), voidedBy: actor.id, voidedByName: actor.name };
        next.receivedCents -= payment.amountCents;
        audit.paymentId = paymentId;
        audit.amountCents = -payment.amountCents;
        audit.reason = reason;
      }
      // No reads after this point. Updates are field patches, never reconstructed
      // appointments or Work Orders; concurrent booking mutations conflict/retry.
      transaction.update(ref, { jobCharges: next });
      transaction.set(auditRef, audit);
      if (receipt) transaction.set(receiptRef, receipt);
      if (voidRef) transaction.update(voidRef, voidPatch);
      return { success: true, state: next, paymentId: receipt?.id || null };
    });
  }
  return { execute };
}
module.exports = { ACTIONS, SOURCE, inputLines, paymentInput, chargeFingerprint, prepareInitialCharges, authorizeInitialCharges, createAppointmentCharges, quoteLines };
