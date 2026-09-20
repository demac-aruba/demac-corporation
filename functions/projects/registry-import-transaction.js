'use strict';
const d = require('./registry-domain');
const { prepareLegacyImport, publicImportPreview } = require('./registry-legacy-import');
const IMPORT_COLLECTION = 'projectLegacyImports';
function versionEvidence(snapshot) {
  if (!snapshot.exists) return { exists: false };
  const at = snapshot.updateTime;
  if (!at || !Number.isSafeInteger(at.seconds) || !Number.isSafeInteger(at.nanoseconds)) throw d.fault('source_version_missing', 'Source version is unavailable; retry the preview.', 409);
  return { exists: true, seconds: at.seconds, nanoseconds: at.nanoseconds };
}

/** Called only inside the authenticated registry transaction. Preview does not write. */
async function prepareImportTransaction({ db, transaction, input, principal, occurredAt, collections }) {
  if (principal.role !== 'super_admin') throw d.fault('import_owner_required', 'Only the owner may review or apply legacy import.', 403);
  const apply = input.action === 'import_legacy_plan';
  d.allowedKeys(input.data, apply ? ['candidate','previewHash','acknowledgedWarnings','backupConfirmed','reason'] : ['candidate']);
  const prepared = prepareLegacyImport(input.data.candidate);
  const importId = `PI-${d.digest({ projectId: prepared.projectId, sourceDigest: prepared.sourceDigest }).slice(0, 40)}`;
  const recordRef = db.collection(collections.records).doc(prepared.projectId);
  const numberRef = db.collection(collections.numbers).doc(prepared.projectNumberKey);
  const archiveRef = db.collection(IMPORT_COLLECTION).doc(importId);
  const snapshots = await transaction.getAll(
    recordRef, numberRef, archiveRef,
    db.collection('clients').doc(prepared.plan.customerId), db.collection('properties').doc(prepared.plan.propertyId),
  );
  const [existing, number, archive, client, property] = snapshots;
  // Orphan relations/history are not permission to re-create or overwrite a deleted Project.
  const [links, history] = await Promise.all([
    transaction.get(db.collection(collections.links).where('projectId', '==', prepared.projectId).limit(1)),
    transaction.get(db.collection(collections.events).where('projectId', '==', prepared.projectId).limit(1)),
  ]);
  const conflicts = [];
  if (existing.exists) conflicts.push('project_identity_exists');
  if (number.exists) conflicts.push('project_number_exists');
  if (archive.exists) conflicts.push('source_already_imported');
  if (!links.empty || !history.empty) conflicts.push('existing_project_history');
  if (!client.exists || client.data().active === false || !property.exists || property.data().active === false || property.data().clientId !== prepared.plan.customerId) conflicts.push('crm_identity_conflict');
  const previewHash = d.digest({
    contract: 'project-legacy-import-v1', sourceDigest: prepared.sourceDigest, plan: prepared.plan, warnings: prepared.warnings,
    versions: snapshots.map(versionEvidence),
    priorLinks: links.docs.map((s) => ({ id: s.id, ...versionEvidence(s) })),
    priorHistory: history.docs.map((s) => ({ id: s.id, ...versionEvidence(s) })),
  });
  const preview = { ...publicImportPreview(prepared), mode: 'dry_run', writesPerformed: 0, canImport: conflicts.length === 0, conflicts, previewHash };
  if (!apply) return { preview };
  if (conflicts.length) throw d.fault('legacy_import_conflict', 'The Project, number or source records require reconciliation. Nothing was imported.', 409);
  if (typeof input.data.previewHash !== 'string' || input.data.previewHash !== previewHash) throw d.fault('legacy_preview_changed', 'Source data changed after preview. Review the new preview before importing.', 409);
  if (input.data.backupConfirmed !== true) throw d.fault('backup_confirmation_required', 'Confirm that the original saved backup has been verified before importing.');
  const reason = d.text(input.data.reason, 'import approval reason', 1000);
  const acknowledged = input.data.acknowledgedWarnings;
  if (!Array.isArray(acknowledged) || acknowledged.length !== prepared.warnings.length || new Set(acknowledged).size !== acknowledged.length
      || acknowledged.some((code) => typeof code !== 'string' || !prepared.warnings.includes(code))) throw d.fault('import_warnings_unacknowledged', 'Review and acknowledge every limitation in this exact preview.');
  const { budgetedVanMinutes, ...fields } = prepared.plan;
  const next = {
    ...fields, id: prepared.projectId, projectNumber: prepared.projectNumber, schemaVersion: d.SCHEMA_VERSION, version: 1,
    planningStatus: prepared.planningStatus,
    budget: { unit: 'van_minutes', originalMinutes: budgetedVanMinutes, currentMinutes: budgetedVanMinutes, revision: 1 },
    materialBudgetBaseline: d.initialMaterialBudgetBaseline(prepared.plan, 'imported_snapshot'),
    migration: { status: 'pending_reconciliation', importId, sourceDigest: prepared.sourceDigest, capturedBaselineOnly: true, sourceDeclaredStatus: prepared.sourceDeclaredStatus },
    createdAt: occurredAt, createdBy: principal.uid, updatedAt: occurredAt, updatedBy: principal.uid,
  };
  return {
    recordRef, next,
    numberWrite: { ref: numberRef, data: { projectId: next.id, createdAt: occurredAt } },
    archiveWrite: { ref: archiveRef, data: { schemaVersion: 1, projectId: next.id, projectNumber: next.projectNumber, source: prepared.source, rawProjectJson: prepared.rawProjectJson, sourceDigest: prepared.sourceDigest, importedAt: occurredAt, importedBy: principal.uid, warningCodes: prepared.warnings } },
    importAudit: { importId, sourceDigest: prepared.sourceDigest, backupDigest: prepared.source.backupDigest, capturedAt: prepared.source.capturedAt, previewHash, acknowledgedWarnings: [...acknowledged].sort(), backupConfirmed: true, reason },
  };
}
async function readImportSource({ db, transaction, project, principal }) {
  if (principal.role !== 'super_admin') throw d.fault('import_owner_required', 'Only the owner may retrieve an archived browser record.', 403);
  const importId = project.migration?.importId;
  if (!importId) throw d.fault('import_source_not_found', 'This project has no legacy import archive.', 404);
  const snapshot = await transaction.get(db.collection(IMPORT_COLLECTION).doc(d.id(importId)));
  const archive = snapshot.exists ? snapshot.data() : null;
  if (!archive || archive.projectId !== project.id || archive.sourceDigest !== project.migration.sourceDigest
      || archive.sourceDigest !== d.digest({ source: archive.source, rawProjectJson: archive.rawProjectJson })) throw d.fault('import_archive_conflict', 'The archived source is missing or inconsistent. Do not restore automatically.', 409);
  return { projectId: project.id, source: archive.source, rawProjectJson: archive.rawProjectJson, mode: 'read_only_recovery', restored: false };
}
module.exports = { IMPORT_COLLECTION, prepareImportTransaction, readImportSource };
