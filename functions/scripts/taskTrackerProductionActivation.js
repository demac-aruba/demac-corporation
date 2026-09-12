'use strict';

const { getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'demac-corporation';
const SETTINGS_PATH = 'businessSettings/task-tracker';
const MANAGER_ROLES = new Set(['super_admin', 'operations', 'project_manager']);

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

function text(value) {
  return String(value ?? '').trim();
}

function normalizeRole(value) {
  const role = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['owner', 'admin', 'superadmin', 'super_admin'].includes(role)) return 'super_admin';
  if (['operation', 'operations', 'manager', 'supervisor'].includes(role)) return 'operations';
  if (['office', 'operator', 'office_operator'].includes(role)) return 'office_operator';
  if (['project_manager', 'projects'].includes(role)) return 'project_manager';
  return null;
}

function normalizeArubaPhone(value) {
  const digits = text(value).replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 7 ? `297${digits}` : digits;
}

function validClock(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text(value));
}

async function loadPreflight() {
  const users = await db.collection('users').get();
  let activeTaskManagers = 0;
  let activeOfficeOperators = 0;
  const problems = [];

  for (const document of users.docs) {
    const user = document.data() || {};
    if (user.active !== true) continue;
    const role = normalizeRole(user.role);
    if (MANAGER_ROLES.has(role)) activeTaskManagers += 1;
    if (role !== 'office_operator') continue;

    activeOfficeOperators += 1;
    const staffId = text(user.staffId);
    if (!staffId) {
      problems.push('An active Office Operator ERP account is missing its canonical staffId link.');
      continue;
    }

    const staffSnapshot = await db.collection('staffProfiles').doc(staffId).get();
    if (!staffSnapshot.exists) {
      problems.push('An active Office Operator ERP account points to a missing staffProfiles record.');
      continue;
    }

    const staff = staffSnapshot.data() || {};
    if (staff.active === false) problems.push('An active Office Operator ERP account points to an inactive staff profile.');
    if (!normalizeArubaPhone(staff.phone || staff.mobile)) problems.push('An active Office Operator staff profile is missing a WhatsApp-capable phone number.');
  }

  const uniqueProblems = [...new Set(problems)];
  return {
    activeTaskManagers,
    activeOfficeOperators,
    problems: uniqueProblems,
  };
}

async function preflight() {
  const result = await loadPreflight();
  console.log(JSON.stringify({
    mode: 'preflight',
    activeTaskManagers: result.activeTaskManagers,
    activeOfficeOperators: result.activeOfficeOperators,
    problemCount: result.problems.length,
    problems: result.problems,
  }, null, 2));

  if (result.activeTaskManagers < 1) throw new Error('No active Task Tracker manager account is provisioned. Activation aborted.');
  if (result.problems.length) throw new Error('Task Tracker operator identity preflight failed. Activation aborted before deployment/settings changes.');
}

async function activate() {
  const preflightResult = await loadPreflight();
  if (preflightResult.activeTaskManagers < 1 || preflightResult.problems.length) {
    throw new Error('Production activation refused because the operator identity preflight is not clean.');
  }

  const ref = db.doc(SETTINGS_PATH);
  const commit = text(process.env.GITHUB_SHA || process.argv[3] || 'manual');
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() || {} : {};
    transaction.set(ref, {
      ...existing,
      backendEnabled: true,
      enabled: true,
      dailySummaryEnabled: true,
      dailySummaryTime: validClock(existing.dailySummaryTime) ? existing.dailySummaryTime : '08:00',
      twentyFourHoursBefore: existing.twentyFourHoursBefore !== false,
      threeHoursBefore: existing.threeHoursBefore !== false,
      oneHourBefore: existing.oneHourBefore !== false,
      deadlineAlert: existing.deadlineAlert !== false,
      overdueReminders: existing.overdueReminders !== false,
      overdueIntervalHours: Math.max(1, Number(existing.overdueIntervalHours || 12)),
      escalateOverdue: existing.escalateOverdue === true,
      escalateAfterHours: Math.max(1, Number(existing.escalateAfterHours || 24)),
      productionActivatedAt: FieldValue.serverTimestamp(),
      productionActivationCommit: commit,
    }, { merge: true });
  });

  console.log(JSON.stringify({
    mode: 'activate',
    backendEnabled: true,
    enabled: true,
    dailySummaryEnabled: true,
    activationCommit: commit,
  }, null, 2));
}

async function verify() {
  const result = await loadPreflight();
  if (result.activeTaskManagers < 1 || result.problems.length) throw new Error('Production identity verification failed after activation.');

  const snapshot = await db.doc(SETTINGS_PATH).get();
  if (!snapshot.exists) throw new Error('Task Tracker production settings document does not exist.');
  const settings = snapshot.data() || {};
  const checks = {
    backendEnabled: settings.backendEnabled === true,
    enabled: settings.enabled === true,
    dailySummaryEnabled: settings.dailySummaryEnabled === true,
    dailySummaryTime: validClock(settings.dailySummaryTime) ? settings.dailySummaryTime : null,
    activeTaskManagers: result.activeTaskManagers,
    activeOfficeOperators: result.activeOfficeOperators,
  };
  console.log(JSON.stringify({ mode: 'verify', ...checks }, null, 2));
  if (!checks.backendEnabled || !checks.enabled || !checks.dailySummaryEnabled || !checks.dailySummaryTime) {
    throw new Error('Task Tracker settings verification failed after activation.');
  }
}

async function main() {
  const mode = text(process.argv[2] || 'preflight').toLowerCase();
  if (mode === 'preflight') return preflight();
  if (mode === 'activate') return activate();
  if (mode === 'verify') return verify();
  throw new Error(`Unsupported mode: ${mode}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
