const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachInterventionReportsToJob,
  projectReportSectionStatus,
  reportFindingOptions,
  reportMeasurementOptions,
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
      { id: 'measurements', title: 'Measurements', type: 'measurement_table', required: true, minMeasurementCount: 1 },
      { id: 'findings', title: 'Findings', type: 'findings', required: true },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 2 },
    ],
  };
}

function storedIntervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard',
    serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service', origin: 'planned', requestedBy: 'office',
    status: 'in_progress', templateId: 'standard-report', templateVersion: 2, reportTemplateSnapshot: template(),
    reportSectionStatus: { condition: 'pending', measurements: 'in_progress', findings: 'in_progress', photos: 'in_progress' },
    startedAt: '2026-08-25T10:20:00.000Z', performedByStaffIds: ['staff-1'],
    createdAt: '2026-08-25T10:10:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:30:00.000Z',
    updatedByUserId: 'uid-1', version: 3, ...overrides,
  };
}

function projectedIntervention(overrides = {}) {
  return {
    id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard',
    serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service', origin: 'planned', requestedBy: 'office',
    status: 'in_progress', templateId: 'standard-report', templateVersion: 2, startedAt: '2026-08-25T10:20:00.000Z',
    performedByStaffIds: ['staff-1'], createdAt: '2026-08-25T10:10:00.000Z', createdBy: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z', updatedBy: 'uid-1', version: 3, ...overrides,
  };
}

function job(overrides = {}) {
  return {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    allowedActions: ['read', 'report.edit', 'evidence.add', 'measurement.add', 'finding.add'],
    fieldVisit: { id: 'visit-WO-1', status: 'in_progress' }, workInterventions: [projectedIntervention()], ...overrides,
  };
}

function reportEvidence(overrides = {}) {
  return {
    id: 'EVID-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'photos',
    evidenceKind: 'photo', targetType: 'work_intervention_report',
    storagePath: 'field-evidence/visit-WO-1/interventions/WI-1/photos/photo.jpg', contentType: 'image/jpeg', sizeBytes: 1024,
    capturedAt: '2026-08-25T10:29:00.000Z', createdAt: '2026-08-25T10:29:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:29:00.000Z', updatedByUserId: 'uid-1', version: 1, ...overrides,
  };
}

function fieldMeasurement(overrides = {}) {
  return {
    id: 'MEAS-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'measurements',
    metric: 'Supply temperature', value: 18.5, unit: '°C', moment: 'after', technicianStaffId: 'staff-1',
    measuredAt: '2026-08-25T10:28:00.000Z', createdAt: '2026-08-25T10:28:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:28:00.000Z', updatedByUserId: 'uid-1', version: 1, ...overrides,
  };
}

function fieldFinding(overrides = {}) {
  return {
    id: 'FIND-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'findings',
    summary: 'Drain restriction observed', details: 'Drain pan contains standing water and slow discharge.',
    recommendation: 'Clean drain line and retest.', technicianStaffId: 'staff-1', observedAt: '2026-08-25T10:27:00.000Z',
    createdAt: '2026-08-25T10:27:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:27:00.000Z',
    updatedByUserId: 'uid-1', version: 1, ...overrides,
  };
}

test('frozen template and exact section state project as one canonical intervention report', () => {
  const result = reportProjectionFromStored(storedIntervention(), projectedIntervention());
  assert.equal(result.interventionId, 'WI-1');
  assert.equal(result.template.id, 'standard-report');
  assert.deepEqual(result.sectionStatus, { condition: 'pending', measurements: 'in_progress', findings: 'in_progress', photos: 'in_progress' });
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.measurements, []);
  assert.deepEqual(result.findings, []);
});

test('report state fails closed when keys/status/template identity drift', () => {
  assert.throws(() => projectReportSectionStatus({ condition: 'pending' }, template()), (error) => error?.code === 'invalid_work_intervention_report_state');
  assert.throws(() => projectReportSectionStatus({ condition: 'future', measurements: 'pending', findings: 'pending', photos: 'pending' }, template()), (error) => error?.code === 'invalid_work_intervention_report_state');
  assert.throws(
    () => reportProjectionFromStored(storedIntervention({ templateId: 'other' }), projectedIntervention({ templateId: 'other' })),
    (error) => error?.code === 'work_intervention_template_identity_conflict',
  );
});

test('job read composes frozen report, photos, measurements, findings and server-owned mutation options', async () => {
  const db = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [reportEvidence()],
    fieldMeasurements: [fieldMeasurement()], fieldFindings: [fieldFinding()],
  });
  const result = await attachInterventionReportsToJob(db, job());
  assert.equal(result.interventionReports.length, 1);
  assert.equal(result.interventionReports[0].evidence[0].id, 'EVID-1');
  assert.equal(result.interventionReports[0].measurements[0].id, 'MEAS-1');
  assert.equal(result.interventionReports[0].findings[0].id, 'FIND-1');
  assert.deepEqual(result.reportPhotoOptions, [{ interventionId: 'WI-1', sectionIds: ['photos'] }]);
  assert.equal(result.canAddReportPhoto, true);
  assert.deepEqual(result.reportMeasurementOptions, [{ interventionId: 'WI-1', sectionIds: ['measurements'] }]);
  assert.equal(result.canAddReportMeasurement, true);
  assert.deepEqual(result.reportFindingOptions, [{ interventionId: 'WI-1', sectionIds: ['findings'] }]);
  assert.equal(result.canAddReportFinding, true);
});

test('report section options consume allowedActions literally and never reconstruct role policy', () => {
  const reports = [{
    interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
    template: template(), sectionStatus: { condition: 'pending', measurements: 'pending', findings: 'pending', photos: 'pending' },
    evidence: [], measurements: [], findings: [],
  }];
  assert.deepEqual(reportPhotoOptions(job({ allowedActions: ['read', 'evidence.add'] }), reports), [{ interventionId: 'WI-1', sectionIds: ['photos'] }]);
  assert.deepEqual(reportMeasurementOptions(job({ allowedActions: ['read', 'measurement.add'] }), reports), [{ interventionId: 'WI-1', sectionIds: ['measurements'] }]);
  assert.deepEqual(reportFindingOptions(job({ allowedActions: ['read', 'finding.add'] }), reports), [{ interventionId: 'WI-1', sectionIds: ['findings'] }]);
  assert.deepEqual(reportPhotoOptions(job({ allowedActions: ['read'] }), reports), []);
  assert.deepEqual(reportMeasurementOptions(job({ allowedActions: ['read'] }), reports), []);
  assert.deepEqual(reportFindingOptions(job({ allowedActions: ['read'] }), reports), []);
  assert.deepEqual(reportFindingOptions(job({ fieldVisit: { id: 'visit-WO-1', status: 'on_site' } }), reports), []);
  assert.deepEqual(reportFindingOptions(job({ workInterventions: [projectedIntervention({ status: 'completed' })] }), reports), []);
});

test('completed report sections disappear from mutation options but remain in historical report projection', () => {
  const reports = [{
    interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
    template: template(), sectionStatus: { condition: 'pending', measurements: 'completed', findings: 'completed', photos: 'completed' },
    evidence: [reportEvidence()], measurements: [fieldMeasurement()], findings: [fieldFinding()],
  }];
  assert.deepEqual(reportPhotoOptions(job(), reports), []);
  assert.deepEqual(reportMeasurementOptions(job(), reports), []);
  assert.deepEqual(reportFindingOptions(job(), reports), []);
  assert.equal(reports[0].evidence.length, 1);
  assert.equal(reports[0].measurements.length, 1);
  assert.equal(reports[0].findings.length, 1);
});

test('persisted report evidence cannot point outside the canonical report graph', async () => {
  const foreignInterventionDb = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [reportEvidence({ interventionId: 'WI-OTHER' })],
    fieldMeasurements: [], fieldFindings: [],
  });
  await assert.rejects(() => attachInterventionReportsToJob(foreignInterventionDb, job()), (error) => error?.code === 'report_evidence_identity_conflict');

  const wrongSectionDb = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [reportEvidence({ sectionId: 'condition' })],
    fieldMeasurements: [], fieldFindings: [],
  });
  await assert.rejects(() => attachInterventionReportsToJob(wrongSectionDb, job()), (error) => error?.code === 'report_evidence_identity_conflict');
});

test('persisted measurement must match canonical report and full visit identity', async () => {
  const foreignInterventionDb = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [], fieldMeasurements: [fieldMeasurement({ interventionId: 'WI-OTHER' })], fieldFindings: [],
  });
  await assert.rejects(() => attachInterventionReportsToJob(foreignInterventionDb, job()), (error) => error?.code === 'field_measurement_identity_conflict');

  const wrongSectionDb = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [], fieldMeasurements: [fieldMeasurement({ sectionId: 'photos' })], fieldFindings: [],
  });
  await assert.rejects(() => attachInterventionReportsToJob(wrongSectionDb, job()), (error) => error?.code === 'field_measurement_identity_conflict');

  const corruptCustomerDb = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [], fieldMeasurements: [fieldMeasurement({ clientId: 'CLIENT-OTHER' })], fieldFindings: [],
  });
  await assert.rejects(
    () => attachInterventionReportsToJob(corruptCustomerDb, job()),
    (error) => error?.code === 'field_measurement_identity_conflict' && error?.details?.key === 'customerId',
  );
});

test('persisted finding must match canonical report and full visit identity', async () => {
  const foreignInterventionDb = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [], fieldMeasurements: [], fieldFindings: [fieldFinding({ interventionId: 'WI-OTHER' })],
  });
  await assert.rejects(() => attachInterventionReportsToJob(foreignInterventionDb, job()), (error) => error?.code === 'field_finding_identity_conflict');

  const wrongSectionDb = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [], fieldMeasurements: [], fieldFindings: [fieldFinding({ sectionId: 'photos' })],
  });
  await assert.rejects(() => attachInterventionReportsToJob(wrongSectionDb, job()), (error) => error?.code === 'field_finding_identity_conflict');

  const corruptCustomerDb = createReadDb({
    workInterventions: [storedIntervention()], fieldEvidence: [], fieldMeasurements: [], fieldFindings: [fieldFinding({ clientId: 'CLIENT-OTHER' })],
  });
  await assert.rejects(
    () => attachInterventionReportsToJob(corruptCustomerDb, job()),
    (error) => error?.code === 'field_finding_identity_conflict' && error?.details?.key === 'customerId',
  );
});

test('service with no frozen template produces no shadow report definition', async () => {
  const raw = storedIntervention({ templateId: undefined, templateVersion: undefined, reportTemplateSnapshot: undefined, reportSectionStatus: undefined });
  const projected = projectedIntervention({ templateId: undefined, templateVersion: undefined });
  const db = createReadDb({ workInterventions: [raw], fieldEvidence: [], fieldMeasurements: [], fieldFindings: [] });
  const result = await attachInterventionReportsToJob(db, job({ workInterventions: [projected] }));
  assert.deepEqual(result.interventionReports, []);
  assert.deepEqual(result.reportPhotoOptions, []);
  assert.equal(result.canAddReportPhoto, false);
  assert.deepEqual(result.reportMeasurementOptions, []);
  assert.equal(result.canAddReportMeasurement, false);
  assert.deepEqual(result.reportFindingOptions, []);
  assert.equal(result.canAddReportFinding, false);
});