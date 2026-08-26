const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachProfessionalReportPreviewToJob,
  buildProfessionalReportPreview,
} = require('./fieldOperationsProfessionalReport');

function completion({ required = 1, completed = required, incomplete = [] } = {}) {
  return {
    requiredSectionCount: required,
    completedRequiredSectionCount: completed,
    incompleteRequiredSections: incomplete,
    complete: incomplete.length === 0,
  };
}

function job(overrides = {}) {
  return {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    fieldVisit: { id: 'visit-WO-1', status: 'in_progress' },
    plannedWork: [{ id: 'line-1', label: 'Standard Service', quantity: 1 }],
    visitAssets: [{ id: 'VA-1' }],
    workInterventions: [{
      id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1',
      serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
      status: 'completed', templateId: 'report-standard', templateVersion: 1,
    }],
    interventionReports: [{
      interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
      completion: completion(),
    }],
    ...overrides,
  };
}

test('completed canonical field work projects a field-complete professional report preview', () => {
  const preview = buildProfessionalReportPreview(job());
  assert.equal(preview.source, 'canonical_field_truth');
  assert.equal(preview.status, 'field_complete');
  assert.equal(preview.plannedQuantity, 1);
  assert.equal(preview.actualAssetCount, 1);
  assert.equal(preview.interventionCount, 1);
  assert.equal(preview.completedInterventionCount, 1);
  assert.equal(preview.requiredSectionCount, 1);
  assert.equal(preview.completedRequiredSectionCount, 1);
  assert.deepEqual(preview.incompleteRequiredSections, []);
});

test('required report gaps project incomplete-report status with exact intervention and section identity', () => {
  const preview = buildProfessionalReportPreview(job({
    workInterventions: [{
      id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1',
      serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
      status: 'in_progress', templateId: 'report-standard', templateVersion: 1,
    }],
    interventionReports: [{
      interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
      completion: completion({
        required: 2,
        completed: 1,
        incomplete: [{ id: 'photos', title: 'Photos', type: 'photos', status: 'pending' }],
      }),
    }],
  }));
  assert.equal(preview.status, 'incomplete_report');
  assert.deepEqual(preview.incompleteRequiredSections, [{
    interventionId: 'WI-1', sectionId: 'photos', title: 'Photos', type: 'photos', status: 'pending',
  }]);
});

test('pending-part work projects partial status without pretending the professional report is final', () => {
  const preview = buildProfessionalReportPreview(job({
    workInterventions: [{
      id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1',
      serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
      status: 'pending_part', templateId: 'report-standard', templateVersion: 1,
    }],
  }));
  assert.equal(preview.status, 'partial');
  assert.equal(preview.pendingPartInterventionCount, 1);
});

test('professional report is a derived read projection and returns null before a physical WorkVisit exists', () => {
  const projected = attachProfessionalReportPreviewToJob({ ...job(), fieldVisit: null });
  assert.equal(projected.professionalReportPreview, null);
});

test('completed intervention with incomplete required report state fails closed instead of producing contradictory output', () => {
  assert.throws(
    () => buildProfessionalReportPreview(job({
      interventionReports: [{
        interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
        completion: completion({
          required: 1,
          completed: 0,
          incomplete: [{ id: 'photos', title: 'Photos', type: 'photos', status: 'pending' }],
        }),
      }],
    })),
    (error) => error?.code === 'professional_report_state_conflict' && error?.status === 409,
  );
});

test('report template identity drift fails closed', () => {
  assert.throws(
    () => buildProfessionalReportPreview(job({ interventionReports: [] })),
    (error) => error?.code === 'professional_report_identity_conflict' && error?.status === 409,
  );
});
