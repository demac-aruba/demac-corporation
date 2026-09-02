const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachInterventionReportsToJob,
  reportFreeTextOptions,
} = require('./fieldOperationsReportRead');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createReadDb(seed = {}) {
  const collections = new Map(Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]));
  function values(name) { return collections.get(name) || new Map(); }
  function query(name, filters = []) {
    return {
      where(field, op, expected) { return query(name, [...filters, { field, op, expected }]); },
      async get() {
        return {
          docs: [...values(name).entries()]
            .filter(([, value]) => filters.every((filter) => filter.op === '==' && value?.[filter.field] === filter.expected))
            .map(([id, value]) => snapshot(id, value)),
        };
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
    id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 2,
    sections: [{ id: 'notes', title: 'Technical notes', type: 'free_text', required: true }],
  };
}

function storedIntervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
    origin: 'planned', requestedBy: 'office', status: 'in_progress', templateId: 'standard-report', templateVersion: 2,
    reportTemplateSnapshot: template(), reportSectionStatus: { notes: 'completed' }, startedAt: '2026-08-25T10:20:00.000Z',
    performedByStaffIds: ['staff-1'], createdAt: '2026-08-25T10:10:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z', updatedByUserId: 'uid-1', version: 3, ...overrides,
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

function freeTextResponse(overrides = {}) {
  return {
    id: 'FTXT-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'notes', value: 'Drain and electrical connections checked.',
    technicianStaffId: 'staff-1', respondedAt: '2026-08-25T10:29:00.000Z', lastRequestId: 'free-text-001',
    createdAt: '2026-08-25T10:29:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:29:00.000Z',
    updatedByUserId: 'uid-1', version: 1, ...overrides,
  };
}

function job(overrides = {}) {
  return {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', allowedActions: ['read', 'report.edit'],
    fieldVisit: { id: 'visit-WO-1', status: 'in_progress' }, workInterventions: [projectedIntervention()], ...overrides,
  };
}

function seed(intervention = storedIntervention(), responses = [freeTextResponse()]) {
  return createReadDb({
    workInterventions: [intervention], fieldEvidence: [], fieldMeasurements: [], fieldFindings: [], fieldChecklistResponses: [],
    fieldFreeTextResponses: responses,
  });
}

test('job read projects exactly one canonical free-text response and keeps completed sections correctable', async () => {
  const result = await attachInterventionReportsToJob(seed(), job());
  assert.equal(result.interventionReports.length, 1);
  assert.equal(result.interventionReports[0].freeTextResponses.length, 1);
  assert.equal(result.interventionReports[0].freeTextResponses[0].value, 'Drain and electrical connections checked.');
  assert.deepEqual(result.reportFreeTextOptions, [{ interventionId: 'WI-1', sectionIds: ['notes'] }]);
  assert.equal(result.canEditReportFreeText, true);
});

test('free-text options consume report.edit literally and never reconstruct role policy', () => {
  const reports = [{
    interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
    template: template(), sectionStatus: { notes: 'completed' }, evidence: [], measurements: [], findings: [], checklistResponses: [], freeTextResponses: [],
  }];
  assert.deepEqual(reportFreeTextOptions(job(), reports), [{ interventionId: 'WI-1', sectionIds: ['notes'] }]);
  assert.deepEqual(reportFreeTextOptions(job({ allowedActions: ['read'] }), reports), []);
  assert.deepEqual(reportFreeTextOptions(job({ fieldVisit: { id: 'visit-WO-1', status: 'on_site' } }), reports), []);
  assert.deepEqual(reportFreeTextOptions(job({ workInterventions: [projectedIntervention({ status: 'completed' })] }), reports), []);
});

test('free-text read fails closed on wrong section, equipment drift and completion-state drift', async () => {
  const wrongSection = seed(storedIntervention(), [freeTextResponse({ sectionId: 'other' })]);
  await assert.rejects(() => attachInterventionReportsToJob(wrongSection, job()), (error) => error?.code === 'field_free_text_response_identity_conflict');

  const equipmentDrift = seed(storedIntervention(), [freeTextResponse({ assetId: 'AC-OTHER' })]);
  await assert.rejects(() => attachInterventionReportsToJob(equipmentDrift, job()), (error) => error?.code === 'field_free_text_response_identity_conflict');

  const stateDrift = seed(storedIntervention({ reportSectionStatus: { notes: 'completed' } }), [freeTextResponse({ value: '' })]);
  await assert.rejects(() => attachInterventionReportsToJob(stateDrift, job()), (error) => error?.code === 'field_free_text_report_state_conflict');
});

test('empty cleared response is valid only while section is not completed', async () => {
  const result = await attachInterventionReportsToJob(
    seed(storedIntervention({ reportSectionStatus: { notes: 'in_progress' } }), [freeTextResponse({ value: '' })]),
    job(),
  );
  assert.equal(result.interventionReports[0].freeTextResponses[0].value, '');
  assert.equal(result.interventionReports[0].sectionStatus.notes, 'in_progress');
});
