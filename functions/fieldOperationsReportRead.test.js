const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachInterventionReportsToJob,
  projectReportSectionStatus,
  reportPhotoOptions,
  reportProjectionFromStored,
} = require('./fieldOperationsReportRead');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createReadDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]),
  );
  function values(name) { return collections.get(name) || new Map(); }
  function query(name, filters = []) {
    return {
      where(field, op, expected) { return query(name, [...filters, { field, op, expected }]); },
      async get() {
        const docs = [...values(name).entries()]
          .filter(([, value]) => filters.every((filter) => filter.op === '==' && value?.[filter.field] === filter.expected))
          .map(([id, value]) => snapshot(id, value));
        return { docs };
      },
    };
  }
  return {
    collection(name) {
      return {
        where(field, op, expected) { return query(name, [{ field, op, expected }]); },
        async get() { return query(name).get(); },
      };
    },
  };
}

function template() {
  return {
    id: 'standard-report',
    name: 'Standard Report',
    serviceId: 'service-standard',
    version: 2,
    sections: [
      { id: 'condition', title: 'Condition', type: 'checklist', required: true },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 2 },
    ],
  };
}

function storedIntervention(overrides = {}) {
  return {
    id: 'WI-1',
    fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1',
    assetId: 'AC-1',
    plannedWorkLineId: 'line-standard',
    serviceCatalogItemId: 'service-standard',
    interventionType: 'Standard Service',
    origin: 'planned',
    requestedBy: 'office',
    status: 'in_progress',
    templateId: 'standard-report',
    templateVersion: 2,
    reportTemplateSnapshot: template(),
    reportSectionStatus: { condition: 'pending', photos: 'in_progress' },
    startedAt: '2026-08-25T10:20:00.000Z',
    performedByStaffIds: ['staff-1'],
    createdAt: '2026-08-25T10:10:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z',
    updatedByUserId: 'uid-1',
    version: 3,
    ...overrides,
  };
}

function projectedIntervention(overrides = {}) {
  return {
    id: 'WI-1',
    visitId: 'visit-WO-1',
    visitAssetId: 'VA-1',
    assetId: 'AC-1',
    plannedWorkLineId: 'line-standard',
    serviceCatalogItemId: 'service-standard',
    interventionType: 'Standard Service',
    origin: 'planned',
    requestedBy: 'office',
    status: 'in_progress',
    templateId: 'standard-report',
    templateVersion: 2,
    startedAt: '2026-08-25T10:20:00.000Z',
    performedByStaffIds: ['staff-1'],
    createdAt: '2026-08-25T10:10:00.000Z',
    createdBy: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z',
    updatedBy: 'uid-1',
    version: 3,
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    workOrderId: 'WO-1',
    customerId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    allowedActions: ['read', 'report.edit', 'evidence.add'],
    fieldVisit: { id: 'visit-WO-1', status: 'in_progress' },
    workInterventions: [projectedIntervention()],
    ...overrides,
  };
}

function reportEvidence(overrides = {}) {
  return {
    id: 'EVID-1',
    fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1',
    assetId: 'AC-1',
    interventionId: 'WI-1',
    sectionId: 'photos',
    evidenceKind: 'photo',
    targetType: 'work_intervention_report',
    storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/photos/photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    capturedAt: '2026-08-25T10:29:00.000Z',
    createdAt: '2026-08-25T10:29:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:29:00.000Z',
    updatedByUserId: 'uid-1',
    version: 1,
    ...overrides,
  };
}

test('frozen template and exact section state project as one canonical intervention report', () => {
  const result = reportProjectionFromStored(storedIntervention(), projectedIntervention());
  assert.equal(result.interventionId, 'WI-1');
  assert.equal(result.template.id, 'standard-report');
  assert.deepEqual(result.sectionStatus, { condition: 'pending', photos: 'in_progress' });
  assert.deepEqual(result.evidence, []);
});

test('report state fails closed when keys/status/template identity drift', () => {
  assert.throws(() => projectReportSectionStatus({ condition: 'pending' }, template()), (error) => error?.code === 'invalid_work_intervention_report_state');
  assert.throws(() => projectReportSectionStatus({ condition: 'future', photos: 'pending' }, template()), (error) => error?.code === 'invalid_work_intervention_report_state');
  assert.throws(
    () => reportProjectionFromStored(storedIntervention({ templateId: 'other' }), projectedIntervention({ templateId: 'other' })),
    (error) => error?.code === 'work_intervention_template_identity_conflict',
  );
});

test('job read composes frozen report, persisted photo evidence and server-owned photo options', async () => {
  const db = createReadDb({
    workInterventions: [storedIntervention()],
    fieldEvidence: [reportEvidence()],
  });
  const result = await attachInterventionReportsToJob(db, job());
  assert.equal(result.interventionReports.length, 1);
  assert.equal(result.interventionReports[0].evidence.length, 1);
  assert.equal(result.interventionReports[0].evidence[0].id, 'EVID-1');
  assert.deepEqual(result.reportPhotoOptions, [{ interventionId: 'WI-1', sectionIds: ['photos'] }]);
  assert.equal(result.canAddReportPhoto, true);
});

test('report photo options consume allowedActions literally and never reconstruct role policy', () => {
  const reports = [{
    interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
    template: template(), sectionStatus: { condition: 'pending', photos: 'pending' }, evidence: [],
  }];
  assert.deepEqual(reportPhotoOptions(job({ allowedActions: ['read', 'evidence.add'] }), reports), [
    { interventionId: 'WI-1', sectionIds: ['photos'] },
  ]);
  assert.deepEqual(reportPhotoOptions(job({ allowedActions: ['read'] }), reports), []);
  assert.deepEqual(reportPhotoOptions(job({ fieldVisit: { id: 'visit-WO-1', status: 'on_site' } }), reports), []);
  assert.deepEqual(reportPhotoOptions(job({ workInterventions: [projectedIntervention({ status: 'completed' })] }), reports), []);
});

test('completed photo sections disappear from mutation options but remain in historical report projection', () => {
  const reports = [{
    interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
    template: template(), sectionStatus: { condition: 'pending', photos: 'completed' }, evidence: [reportEvidence()],
  }];
  assert.deepEqual(reportPhotoOptions(job(), reports), []);
  assert.equal(reports[0].evidence.length, 1);
});

test('persisted report evidence cannot point to an intervention or section outside the canonical report graph', async () => {
  const foreignInterventionDb = createReadDb({
    workInterventions: [storedIntervention()],
    fieldEvidence: [reportEvidence({ interventionId: 'WI-OTHER' })],
  });
  await assert.rejects(
    () => attachInterventionReportsToJob(foreignInterventionDb, job()),
    (error) => error?.code === 'report_evidence_identity_conflict' && error?.status === 409,
  );

  const wrongSectionDb = createReadDb({
    workInterventions: [storedIntervention()],
    fieldEvidence: [reportEvidence({ sectionId: 'condition' })],
  });
  await assert.rejects(
    () => attachInterventionReportsToJob(wrongSectionDb, job()),
    (error) => error?.code === 'report_evidence_identity_conflict' && error?.status === 409,
  );
});

test('service with no frozen template produces no shadow report definition', async () => {
  const raw = storedIntervention({
    templateId: undefined,
    templateVersion: undefined,
    reportTemplateSnapshot: undefined,
    reportSectionStatus: undefined,
  });
  const projected = projectedIntervention({ templateId: undefined, templateVersion: undefined });
  const db = createReadDb({ workInterventions: [raw], fieldEvidence: [] });
  const result = await attachInterventionReportsToJob(db, job({ workInterventions: [projected] }));
  assert.deepEqual(result.interventionReports, []);
  assert.deepEqual(result.reportPhotoOptions, []);
  assert.equal(result.canAddReportPhoto, false);
});