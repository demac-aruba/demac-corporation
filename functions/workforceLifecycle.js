const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { onRequest } = require('firebase-functions/v2/https');

if (!getApps().length) initializeApp();

const auth = getAuth();
const db = getFirestore();

function cleanText(value, maxLength = 300) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanDate(value) {
  const date = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error('Selecciona una fecha válida.');
    error.status = 400;
    error.code = 'invalid-date';
    throw error;
  }
  return date;
}

function setCors(request, response) {
  const origin = request.get('origin') || '*';
  response.set('Access-Control-Allow-Origin', origin);
  response.set('Vary', 'Origin');
  response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.set('Access-Control-Max-Age', '3600');
}

async function requireAdmin(request) {
  const authorization = cleanText(request.get('authorization'), 5000);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Tu sesión no es válida. Inicia sesión nuevamente.');
    error.status = 401;
    error.code = 'missing-token';
    throw error;
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(match[1], true);
  } catch {
    const error = new Error('Tu sesión venció. Inicia sesión nuevamente.');
    error.status = 401;
    error.code = 'invalid-token';
    throw error;
  }

  const profileSnapshot = await db.collection('users').doc(decoded.uid).get();
  const profile = profileSnapshot.data() ?? {};
  if (!profileSnapshot.exists || profile.active !== true || profile.role !== 'admin') {
    const error = new Error('Solamente un administrador activo puede cambiar el ciclo laboral de un empleado.');
    error.status = 403;
    error.code = 'admin-required';
    throw error;
  }

  return {
    uid: decoded.uid,
    email: decoded.email ?? profile.email ?? '',
    name: profile.name ?? decoded.name ?? decoded.email ?? 'Administrador DEMAC',
  };
}

function archiveEmailForUid(uid) {
  const safeUid = cleanText(uid, 128).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `retired-${safeUid}@demac.invalid`.toLowerCase();
}

async function linkedAccessForStaff(staffId) {
  const snapshot = await db.collection('users').where('staffId', '==', staffId).get();
  const active = snapshot.docs.filter((document) => document.data().active !== false);
  if (active.length > 1) {
    const error = new Error('Se detectaron varias cuentas activas vinculadas al mismo empleado. Corrige Access Control antes de continuar.');
    error.status = 409;
    error.code = 'multiple-active-access-links';
    throw error;
  }
  return active[0] ?? snapshot.docs[0] ?? null;
}

async function assertAdminCanBeRetired(actorUid, accessDocument) {
  if (!accessDocument) return;
  const profile = accessDocument.data();
  if (accessDocument.id === actorUid) {
    const error = new Error('No puedes desactivar tu propio perfil laboral desde esta operación.');
    error.status = 400;
    error.code = 'cannot-offboard-self';
    throw error;
  }
  if (profile.role !== 'admin' || profile.active === false) return;
  const activeAdmins = await db.collection('users').where('role', '==', 'admin').where('active', '==', true).get();
  if (!activeAdmins.docs.some((document) => document.id !== accessDocument.id)) {
    const error = new Error('Debe permanecer por lo menos un administrador activo en el sistema.');
    error.status = 400;
    error.code = 'last-admin';
    throw error;
  }
}

async function updateAuthForRetirement(accessDocument, releaseLoginEmail) {
  if (!accessDocument) return null;
  const uid = accessDocument.id;
  let authUser;
  try {
    authUser = await auth.getUser(uid);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return { uid, authMissing: true };
    throw error;
  }

  const previous = {
    email: authUser.email ?? null,
    displayName: authUser.displayName ?? null,
    disabled: authUser.disabled,
    emailVerified: authUser.emailVerified,
  };
  const archiveEmail = releaseLoginEmail ? archiveEmailForUid(uid) : null;
  await auth.updateUser(uid, {
    disabled: true,
    ...(archiveEmail ? { email: archiveEmail, emailVerified: false } : {}),
  });
  await auth.revokeRefreshTokens(uid);
  return { uid, previous, archiveEmail, authMissing: false };
}

async function rollbackAuthRetirement(authChange) {
  if (!authChange || authChange.authMissing || !authChange.previous) return;
  try {
    await auth.updateUser(authChange.uid, {
      email: authChange.previous.email ?? undefined,
      displayName: authChange.previous.displayName ?? undefined,
      disabled: authChange.previous.disabled,
      emailVerified: authChange.previous.emailVerified,
    });
  } catch (error) {
    logger.error('Could not roll back workforce auth retirement.', { uid: authChange.uid, error });
  }
}

async function clearFutureDailyAssignments(staffId, endDate) {
  const snapshot = await db.collection('dailyVanAssignments').where('date', '>=', endDate).get();
  const affected = snapshot.docs.filter((document) => {
    const value = document.data();
    return value.driverStaffId === staffId || value.helperStaffId === staffId;
  });
  const chunks = [];
  for (let index = 0; index < affected.length; index += 400) chunks.push(affected.slice(index, index + 400));
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((document) => {
      const value = document.data();
      const changes = { updatedAt: FieldValue.serverTimestamp() };
      if (value.driverStaffId === staffId) changes.driverStaffId = FieldValue.delete();
      if (value.helperStaffId === staffId) changes.helperStaffId = FieldValue.delete();
      batch.set(document.ref, changes, { merge: true });
    });
    await batch.commit();
  }
  return affected.length;
}

async function offboardEmployee(payload, actor) {
  const staffId = cleanText(payload.staffId, 180);
  const endDate = cleanDate(payload.endDate);
  const reason = cleanText(payload.reason, 500) || 'Employment ended';
  if (!staffId) {
    const error = new Error('No se recibió el empleado que deseas desactivar.');
    error.status = 400;
    error.code = 'staff-required';
    throw error;
  }

  const staffRef = db.collection('staffProfiles').doc(staffId);
  const [staffSnapshot, accessDocument, vansSnapshot] = await Promise.all([
    staffRef.get(),
    linkedAccessForStaff(staffId),
    db.collection('vans').get(),
  ]);
  if (!staffSnapshot.exists) {
    const error = new Error('El empleado ya no existe en el registro maestro.');
    error.status = 404;
    error.code = 'staff-not-found';
    throw error;
  }

  const staff = staffSnapshot.data() ?? {};
  await assertAdminCanBeRetired(actor.uid, accessDocument);
  const linkedAccess = accessDocument?.data() ?? null;
  const loginEmail = cleanText(linkedAccess?.email || staff.loginEmail || '', 320).toLowerCase();
  const releaseLoginEmail = payload.releaseLoginEmail !== undefined
    ? payload.releaseLoginEmail === true
    : staff.loginEmailKind === 'company';

  const authChange = await updateAuthForRetirement(accessDocument, releaseLoginEmail);
  const nowFields = {
    offboardedAt: FieldValue.serverTimestamp(),
    offboardedByUserId: actor.uid,
    offboardedByName: actor.name,
  };

  try {
    const batch = db.batch();
    batch.set(staffRef, {
      active: false,
      availability: 'Inactivo',
      employmentEndedAt: endDate,
      offboardingReason: reason,
      ...nowFields,
      userId: FieldValue.delete(),
      loginEmail: FieldValue.delete(),
      loginEmailKind: FieldValue.delete(),
      ...(loginEmail ? { formerLoginEmails: FieldValue.arrayUnion(loginEmail) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    let regularVanAssignmentsCleared = 0;
    vansSnapshot.docs.forEach((document) => {
      const van = document.data();
      const changes = {};
      if (van.responsibleStaffId === staffId) changes.responsibleStaffId = FieldValue.delete();
      if (van.regularHelperId === staffId) changes.regularHelperId = FieldValue.delete();
      if (Array.isArray(van.technicianIds) && van.technicianIds.includes(staffId)) changes.technicianIds = FieldValue.arrayRemove(staffId);
      if (Object.keys(changes).length) {
        changes.updatedAt = FieldValue.serverTimestamp();
        batch.set(document.ref, changes, { merge: true });
        regularVanAssignmentsCleared += 1;
      }
    });

    if (accessDocument) {
      const archiveEmail = authChange?.archiveEmail || linkedAccess.email || null;
      batch.set(accessDocument.ref, {
        active: false,
        staffId: null,
        accessState: releaseLoginEmail ? 'retired_email_released' : 'retired',
        email: archiveEmail,
        ...(loginEmail ? { formerEmail: loginEmail, emailHistory: FieldValue.arrayUnion(loginEmail) } : {}),
        retiredAt: FieldValue.serverTimestamp(),
        retiredById: actor.uid,
        retiredByName: actor.name,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(db.collection('userAuditLogs').doc(), {
        action: releaseLoginEmail ? 'retired_email_released' : 'retired',
        targetUid: accessDocument.id,
        targetEmail: loginEmail || linkedAccess.email || null,
        staffId,
        performedByUid: actor.uid,
        performedByName: actor.name,
        performedByEmail: actor.email,
        performedAt: FieldValue.serverTimestamp(),
      });
    }

    batch.set(db.collection('employeePayrollSettings').doc(staffId), {
      id: staffId,
      sourceStaffId: staffId,
      active: false,
      employmentEndedAt: endDate,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const eventRef = db.collection('employeeLifecycleEvents').doc();
    batch.set(eventRef, {
      type: 'offboarded',
      staffId,
      employeeName: staff.name ?? staffId,
      endDate,
      reason,
      releasedLoginEmail: releaseLoginEmail ? loginEmail || null : null,
      accessUid: accessDocument?.id ?? null,
      performedByUid: actor.uid,
      performedByName: actor.name,
      performedByEmail: actor.email,
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
    const futureAssignmentsCleared = await clearFutureDailyAssignments(staffId, endDate);
    return {
      staffId,
      employeeName: staff.name ?? staffId,
      endDate,
      releasedLoginEmail: releaseLoginEmail ? loginEmail || null : null,
      accessRetired: Boolean(accessDocument),
      regularVanAssignmentsCleared,
      futureAssignmentsCleared,
    };
  } catch (error) {
    await rollbackAuthRetirement(authChange);
    throw error;
  }
}

async function reactivateEmployee(payload, actor) {
  const staffId = cleanText(payload.staffId, 180);
  if (!staffId) {
    const error = new Error('No se recibió el empleado que deseas reactivar.');
    error.status = 400;
    error.code = 'staff-required';
    throw error;
  }
  const staffRef = db.collection('staffProfiles').doc(staffId);
  const snapshot = await staffRef.get();
  if (!snapshot.exists) {
    const error = new Error('El empleado ya no existe en el registro maestro.');
    error.status = 404;
    error.code = 'staff-not-found';
    throw error;
  }
  const staff = snapshot.data() ?? {};
  const batch = db.batch();
  batch.set(staffRef, {
    active: true,
    availability: 'Disponible',
    employmentEndedAt: FieldValue.delete(),
    offboardingReason: FieldValue.delete(),
    offboardedAt: FieldValue.delete(),
    offboardedByUserId: FieldValue.delete(),
    offboardedByName: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.collection('employeePayrollSettings').doc(staffId), {
    id: staffId,
    sourceStaffId: staffId,
    active: true,
    employmentEndedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.collection('employeeLifecycleEvents').doc(), {
    type: 'reactivated',
    staffId,
    employeeName: staff.name ?? staffId,
    performedByUid: actor.uid,
    performedByName: actor.name,
    performedByEmail: actor.email,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { staffId, employeeName: staff.name ?? staffId };
}

function friendlyError(error) {
  if (error?.status && error?.message) return error;
  logger.error('Unexpected workforce lifecycle error.', error);
  const friendly = new Error('No se pudo completar la operación del empleado. No se hicieron borrados destructivos.');
  friendly.status = 500;
  friendly.code = error?.code ? String(error.code) : 'internal';
  return friendly;
}

exports.adminWorkforceLifecycle = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request, response) => {
    setCors(request, response);
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }
    if (request.method !== 'POST') {
      response.status(405).json({ ok: false, message: 'Método no permitido.' });
      return;
    }
    try {
      const actor = await requireAdmin(request);
      const action = cleanText(request.body?.action, 40);
      const payload = request.body?.payload ?? {};
      if (action === 'offboard') {
        response.status(200).json({ ok: true, result: await offboardEmployee(payload, actor) });
        return;
      }
      if (action === 'reactivate') {
        response.status(200).json({ ok: true, result: await reactivateEmployee(payload, actor) });
        return;
      }
      response.status(400).json({ ok: false, code: 'unsupported-action', message: 'La acción solicitada no existe.' });
    } catch (cause) {
      const error = friendlyError(cause);
      response.status(error.status || 500).json({ ok: false, code: error.code || 'internal', message: error.message });
    }
  },
);

exports._private = { archiveEmailForUid, cleanDate };
