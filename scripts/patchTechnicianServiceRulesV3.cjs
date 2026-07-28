const { read, write, replaceOnce, insertAfter, replaceRange } = require('./serviceFlowPatchUtils.cjs');

// ---------------------------------------------------------------------------
// Firestore rules generated during patching. Deploy after merge with
// `npm run patch:all` before firebase deploy.
// ---------------------------------------------------------------------------
const rulesFile = 'firestore.rules';
insertAfter(
  rulesFile,
  "    function technicianReportSectionFieldsOnly() {\n      return request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n        'status',\n        'assignedToStaffId',\n        'assignedToName',\n        'fields',\n        'missingRequiredFieldKeys',\n        'evidenceIds',\n        'lock',\n        'completedAt',\n        'updatedAt',\n        'updatedByUserId',\n        'updatedByStaffId',\n        'updatedByName',\n        'version'\n      ]);\n    }",
  `

    function technicianAddOnFieldsOnly() {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly([
        'status',
        'beforeEvidenceId',
        'afterEvidenceId',
        'notes',
        'updatedAt',
        'updatedByUserId',
        'updatedByStaffId',
        'updatedByName',
        'version'
      ]);
    }`,
  'function technicianAddOnFieldsOnly',
);
replaceOnce(
  rulesFile,
  "    match /equipmentSystems/{equipmentId} {",
  `    match /workVisitAddOns/{addOnId} {
      allow read: if activeStaff();
      allow create: if operationsRole()
        || (assignedToVisitId(request.resource.data.visitId)
          && request.resource.data.workOrderId == visitData(request.resource.data.visitId).workOrderId
          && request.resource.data.createdByUserId == request.auth.uid);
      allow update: if operationsRole()
        || (assignedToVisitId(resource.data.visitId)
          && request.resource.data.workOrderId == resource.data.workOrderId
          && request.resource.data.visitId == resource.data.visitId
          && request.resource.data.visitUnitId == resource.data.visitUnitId
          && request.resource.data.interventionId == resource.data.interventionId
          && request.resource.data.type == resource.data.type
          && request.resource.data.createdAt == resource.data.createdAt
          && request.resource.data.createdByUserId == resource.data.createdByUserId
          && technicianAddOnFieldsOnly());
      allow delete: if operationsRole();
    }

    match /equipmentSystems/{equipmentId} {`,
  'match /workVisitAddOns/{addOnId}',
);
replaceOnce(
  rulesFile,
  "    function technicianInterventionFieldsOnly() {\n      return request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n        'status',",
  "    function technicianInterventionFieldsOnly() {\n      return request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n        'type',\n        'templateId',\n        'templateVersion',\n        'status',",
  "        'type',\n        'templateId',\n        'templateVersion',",
);

console.log('patchTechnicianServiceRulesV3.cjs applied.');
