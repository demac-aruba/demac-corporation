'use strict';
const { randomUUID } = require('node:crypto');

// Private, short-lived coordination on the existing appointment; never a balance
// or an operational appointment field. All callers authorize the actor first.
const EDIT_ACTIONS = new Set(['acquire_appointment_charge_edit', 'renew_appointment_charge_edit', 'release_appointment_charge_edit']);
const EDIT_TTL_MS = 90_000;
const reject = (code, message) => { throw Object.assign(new Error(message), { code, status: 409 }); };
function editSession(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(value)) reject('charge_edit_session', 'Actualiza la página del ERP para iniciar una sesión de edición protegida.');
  return value;
}
const editingRef = (db, appointmentId) => db.collection('appointments').doc(appointmentId).collection('chargeEditing').doc('current');
const active = (lease, now) => lease && Number.isSafeInteger(lease.expiresAtMs) && lease.expiresAtMs > now.getTime();
const owns = (lease, actor, sessionId) => lease?.ownerId === actor.id && lease?.sessionId === sessionId;
function assertEditing(lease, actor, sessionId, token, now) {
  editSession(sessionId);
  if (!active(lease, now) || !owns(lease, actor, sessionId) || lease.token !== token) reject('charge_edit_lost', active(lease, now)
    ? `${lease.ownerName || 'Otro operador'} está editando los importes y pagos de esta cita. Tu borrador se conserva.`
    : 'Tu sesión de edición venció. Recupera el acceso y revisa los datos antes de guardar.');
}
function projectEditing(lease, actor, sessionId, now) {
  const held = Boolean(active(lease, now));
  return { held, mine: held && owns(lease, actor, sessionId), ownerName: held ? lease.ownerName : '',
    expiresAt: held ? new Date(lease.expiresAtMs).toISOString() : null, serverTime: now.toISOString(), ttlMs: EDIT_TTL_MS,
    ...(held && owns(lease, actor, sessionId) ? { token: lease.token, financialVersion: lease.financialVersion } : {}) };
}
async function changeEditing({ db, transaction, appointmentId, action, actor, sessionId, token, now, fenceVersion }) {
  editSession(sessionId);
  const ref = editingRef(db, appointmentId), snapshot = await transaction.get(ref), lease = snapshot.exists ? snapshot.data() : null;
  if (action === 'release_appointment_charge_edit') {
    // A delayed release from an old tab must never release a new owner's lease.
    const release = owns(lease, actor, sessionId) && lease.token === token;
    if (release) transaction.delete(ref);
    return { success: true, edit: projectEditing(release ? null : lease, actor, sessionId, now) };
  }
  if (action === 'renew_appointment_charge_edit') assertEditing(lease, actor, sessionId, token, now);
  else if (active(lease, now) && !owns(lease, actor, sessionId)) return { success: true, edit: projectEditing(lease, actor, sessionId, now) };
  const reuse = active(lease, now) && owns(lease, actor, sessionId);
  // Conflict with an already-running pre-lease financial transaction on the same
  // appointment. Retries of this grant and renewals must not invalidate drafts.
  const financialVersion = reuse ? lease.financialVersion : fenceVersion();
  const next = { ownerId: actor.id, ownerName: actor.name || 'Operador de oficina', sessionId,
    token: reuse ? lease.token : randomUUID(), financialVersion, expiresAtMs: now.getTime() + EDIT_TTL_MS };
  transaction.set(ref, next);
  return { success: true, edit: projectEditing(next, actor, sessionId, now) };
}
module.exports = { EDIT_ACTIONS, EDIT_TTL_MS, editingRef, assertEditing, changeEditing };
