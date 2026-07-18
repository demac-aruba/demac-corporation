const crypto = require("crypto");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onRequest } = require("firebase-functions/v2/https");

if (!getApps().length) initializeApp();

const auth = getAuth();
const db = getFirestore();
const ALLOWED_ROLES = new Set(["admin", "office", "supervisor", "technician", "accounting", "inventory"]);

function setCors(request, response) {
  const origin = request.get("origin") || "*";
  response.set("Access-Control-Allow-Origin", origin);
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Max-Age", "3600");
}

function cleanText(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanOptional(value, maxLength = 200) {
  const cleaned = cleanText(value, maxLength);
  return cleaned || null;
}

function normalizeEmail(value) {
  const email = cleanText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Escribe un correo electrónico válido.");
    error.status = 400;
    error.code = "invalid-email";
    throw error;
  }
  return email;
}

function normalizeRole(value) {
  const role = cleanText(value, 40);
  if (!ALLOWED_ROLES.has(role)) {
    const error = new Error("El rol seleccionado no es válido.");
    error.status = 400;
    error.code = "invalid-role";
    throw error;
  }
  return role;
}

function randomTemporaryPassword() {
  return `${crypto.randomBytes(24).toString("base64url")}Aa1!`;
}

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function authTimeToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function requireAdmin(request) {
  const authorization = cleanText(request.get("authorization"), 5000);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("Tu sesión no es válida. Inicia sesión nuevamente.");
    error.status = 401;
    error.code = "missing-token";
    throw error;
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(match[1], true);
  } catch {
    const error = new Error("Tu sesión venció. Inicia sesión nuevamente.");
    error.status = 401;
    error.code = "invalid-token";
    throw error;
  }

  const profileSnapshot = await db.collection("users").doc(decoded.uid).get();
  const profile = profileSnapshot.data() ?? {};
  if (!profileSnapshot.exists || profile.active !== true || profile.role !== "admin") {
    const error = new Error("Solamente un administrador activo puede gestionar usuarios.");
    error.status = 403;
    error.code = "admin-required";
    throw error;
  }

  return {
    uid: decoded.uid,
    email: decoded.email ?? profile.email ?? "",
    name: profile.name ?? decoded.name ?? decoded.email ?? "Administrador DEMAC",
  };
}

async function listAllAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);
  return users;
}

function managedUserFrom(profileId, profile, authUser) {
  const disabled = authUser?.disabled ?? profile?.active === false;
  return {
    id: profileId,
    uid: profileId,
    name: profile?.name ?? authUser?.displayName ?? authUser?.email ?? "Usuario sin nombre",
    email: profile?.email ?? authUser?.email ?? "",
    phone: profile?.phone ?? authUser?.phoneNumber ?? null,
    role: profile?.role ?? "office",
    staffId: profile?.staffId ?? null,
    vanId: profile?.vanId ?? null,
    active: profile?.active !== false && !disabled,
    disabled,
    emailVerified: authUser?.emailVerified ?? false,
    authMissing: !authUser,
    profileMissing: !profile,
    authCreatedAt: authTimeToIso(authUser?.metadata?.creationTime),
    lastSignInAt: authTimeToIso(authUser?.metadata?.lastSignInTime),
    createdAt: timestampToIso(profile?.createdAt),
    updatedAt: timestampToIso(profile?.updatedAt),
    createdByName: profile?.createdByName ?? null,
  };
}

async function listManagedUsers() {
  const [authUsers, profilesSnapshot] = await Promise.all([
    listAllAuthUsers(),
    db.collection("users").get(),
  ]);
  const authById = new Map(authUsers.map((user) => [user.uid, user]));
  const profileById = new Map(profilesSnapshot.docs.map((document) => [document.id, document.data()]));
  const ids = new Set([...authById.keys(), ...profileById.keys()]);
  return [...ids]
    .map((uid) => managedUserFrom(uid, profileById.get(uid), authById.get(uid)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureStaffAvailable(staffId, targetUid) {
  if (!staffId) return;
  const staffSnapshot = await db.collection("staffProfiles").doc(staffId).get();
  if (!staffSnapshot.exists) {
    const error = new Error("El empleado seleccionado ya no existe.");
    error.status = 400;
    error.code = "staff-not-found";
    throw error;
  }

  const linked = await db.collection("users").where("staffId", "==", staffId).get();
  const conflict = linked.docs.find((document) => document.id !== targetUid);
  if (conflict) {
    const data = conflict.data();
    const error = new Error(`Este empleado ya está vinculado al usuario ${data.name || data.email || conflict.id}.`);
    error.status = 409;
    error.code = "staff-already-linked";
    throw error;
  }
}

async function assertAdminWillRemain(actorUid, targetUid, before, after) {
  if (actorUid === targetUid && (after.role !== "admin" || after.active !== true)) {
    const error = new Error("No puedes quitarte tu propio acceso de administrador ni desactivar tu cuenta.");
    error.status = 400;
    error.code = "cannot-demote-self";
    throw error;
  }

  const removesActiveAdmin = before?.role === "admin"
    && before?.active === true
    && (after.role !== "admin" || after.active !== true);
  if (!removesActiveAdmin) return;

  const activeAdmins = await db.collection("users")
    .where("role", "==", "admin")
    .where("active", "==", true)
    .get();
  const anotherAdminExists = activeAdmins.docs.some((document) => document.id !== targetUid);
  if (!anotherAdminExists) {
    const error = new Error("Debe permanecer por lo menos un administrador activo en el sistema.");
    error.status = 400;
    error.code = "last-admin";
    throw error;
  }
}

function profileSnapshotForAudit(profile) {
  if (!profile) return null;
  return {
    name: profile.name ?? null,
    email: profile.email ?? null,
    phone: profile.phone ?? null,
    role: profile.role ?? null,
    staffId: profile.staffId ?? null,
    vanId: profile.vanId ?? null,
    active: profile.active ?? null,
  };
}

async function createManagedUser(payload, actor) {
  const name = cleanText(payload.name, 160);
  const email = normalizeEmail(payload.email);
  const role = normalizeRole(payload.role);
  const phone = cleanOptional(payload.phone, 40);
  const staffId = cleanOptional(payload.staffId, 160);
  const vanId = cleanOptional(payload.vanId, 160);
  const active = payload.active !== false;
  if (!name) {
    const error = new Error("Escribe el nombre del usuario.");
    error.status = 400;
    error.code = "name-required";
    throw error;
  }

  await ensureStaffAvailable(staffId, null);

  let authUser;
  try {
    authUser = await auth.createUser({
      email,
      displayName: name,
      password: randomTemporaryPassword(),
      disabled: !active,
      emailVerified: false,
    });
  } catch (error) {
    if (error?.code === "auth/email-already-exists") {
      const friendly = new Error("Ya existe una cuenta de acceso con ese correo electrónico.");
      friendly.status = 409;
      friendly.code = "email-already-exists";
      throw friendly;
    }
    throw error;
  }

  const profile = {
    id: authUser.uid,
    name,
    email,
    phone,
    role,
    staffId,
    vanId,
    active,
    authProvider: "firebase",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdById: actor.uid,
    createdByName: actor.name,
  };

  try {
    const batch = db.batch();
    batch.set(db.collection("users").doc(authUser.uid), profile);
    if (staffId) {
      batch.set(db.collection("staffProfiles").doc(staffId), {
        userId: authUser.uid,
        loginEmail: email,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    batch.set(db.collection("userAuditLogs").doc(), {
      action: "created",
      targetUid: authUser.uid,
      targetEmail: email,
      before: null,
      after: profileSnapshotForAudit(profile),
      performedByUid: actor.uid,
      performedByName: actor.name,
      performedByEmail: actor.email,
      performedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    await auth.deleteUser(authUser.uid).catch(() => undefined);
    throw error;
  }

  return managedUserFrom(authUser.uid, profile, authUser);
}

async function updateManagedUser(payload, actor) {
  const targetUid = cleanText(payload.uid || payload.id, 160);
  if (!targetUid) {
    const error = new Error("No se recibió el usuario que deseas editar.");
    error.status = 400;
    error.code = "uid-required";
    throw error;
  }

  const [profileSnapshot, authUser] = await Promise.all([
    db.collection("users").doc(targetUid).get(),
    auth.getUser(targetUid),
  ]);
  const before = profileSnapshot.data() ?? {
    name: authUser.displayName ?? authUser.email ?? "Usuario",
    email: authUser.email ?? "",
    role: "office",
    active: !authUser.disabled,
  };

  const after = {
    ...before,
    name: payload.name !== undefined ? cleanText(payload.name, 160) : before.name,
    email: payload.email !== undefined ? normalizeEmail(payload.email) : before.email,
    phone: payload.phone !== undefined ? cleanOptional(payload.phone, 40) : (before.phone ?? null),
    role: payload.role !== undefined ? normalizeRole(payload.role) : before.role,
    staffId: payload.staffId !== undefined ? cleanOptional(payload.staffId, 160) : (before.staffId ?? null),
    vanId: payload.vanId !== undefined ? cleanOptional(payload.vanId, 160) : (before.vanId ?? null),
    active: payload.active !== undefined ? payload.active === true : before.active !== false,
    authProvider: "firebase",
    updatedAt: FieldValue.serverTimestamp(),
    updatedById: actor.uid,
    updatedByName: actor.name,
  };

  if (!after.name) {
    const error = new Error("Escribe el nombre del usuario.");
    error.status = 400;
    error.code = "name-required";
    throw error;
  }

  await ensureStaffAvailable(after.staffId, targetUid);
  await assertAdminWillRemain(actor.uid, targetUid, before, after);

  try {
    await auth.updateUser(targetUid, {
      email: after.email,
      displayName: after.name,
      disabled: !after.active,
    });
  } catch (error) {
    if (error?.code === "auth/email-already-exists") {
      const friendly = new Error("Ese correo electrónico ya pertenece a otro usuario.");
      friendly.status = 409;
      friendly.code = "email-already-exists";
      throw friendly;
    }
    throw error;
  }

  const batch = db.batch();
  batch.set(db.collection("users").doc(targetUid), after, { merge: true });
  if (before.staffId && before.staffId !== after.staffId) {
    batch.set(db.collection("staffProfiles").doc(before.staffId), {
      userId: FieldValue.delete(),
      loginEmail: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  if (after.staffId) {
    batch.set(db.collection("staffProfiles").doc(after.staffId), {
      userId: targetUid,
      loginEmail: after.email,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  batch.set(db.collection("userAuditLogs").doc(), {
    action: after.active === false && before.active !== false
      ? "disabled"
      : after.active === true && before.active === false
        ? "reactivated"
        : "updated",
    targetUid,
    targetEmail: after.email,
    before: profileSnapshotForAudit(before),
    after: profileSnapshotForAudit(after),
    performedByUid: actor.uid,
    performedByName: actor.name,
    performedByEmail: actor.email,
    performedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  if (!after.active || before.role !== after.role || before.email !== after.email) {
    await auth.revokeRefreshTokens(targetUid);
  }

  const updatedAuthUser = await auth.getUser(targetUid);
  return managedUserFrom(targetUid, after, updatedAuthUser);
}

function friendlyInternalError(error) {
  if (error?.message && error?.status) return error;
  logger.error("Unexpected user management error.", error);
  const friendly = new Error("No se pudo completar la operación de usuarios. Revisa los datos e intenta nuevamente.");
  friendly.status = 500;
  friendly.code = error?.code ? String(error.code) : "internal";
  return friendly;
}

exports.adminManageUser = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (request, response) => {
    setCors(request, response);
    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }
    if (request.method !== "POST") {
      response.set("Allow", "POST, OPTIONS");
      response.status(405).json({ ok: false, message: "Método no permitido." });
      return;
    }

    try {
      const actor = await requireAdmin(request);
      const action = cleanText(request.body?.action, 40);
      const payload = request.body?.payload ?? {};

      if (action === "list") {
        response.status(200).json({ ok: true, users: await listManagedUsers() });
        return;
      }
      if (action === "create") {
        const user = await createManagedUser(payload, actor);
        response.status(201).json({ ok: true, user });
        return;
      }
      if (action === "update") {
        const user = await updateManagedUser(payload, actor);
        response.status(200).json({ ok: true, user });
        return;
      }

      response.status(400).json({ ok: false, code: "invalid-action", message: "La acción solicitada no es válida." });
    } catch (originalError) {
      const error = friendlyInternalError(originalError);
      response.status(error.status || 500).json({
        ok: false,
        code: error.code || "internal",
        message: error.message,
      });
    }
  },
);
