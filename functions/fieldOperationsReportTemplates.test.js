const assert = require('node:assert/strict');
const test = require('node:test');
const {
  fieldReportTemplateSnapshotForService,
  projectStoredReportTemplateSnapshot,
  requireReportChecklistItem,
} = require('./fieldOperationsReportTemplates');

function service(overrides = {}) {
  return {
    id: 'service-standard',
    fieldExecutionDefinition: {
      version: 1,
      reportTemplate: {
        id: 'standard-service-report',
        name: 'Standard Service Report',
        version: 3,
        sections: [
          {
            id: 'condition',
            title: 'Condition',
            type: 'checklist',
            required: true,
            checklistItems: [
              { id: 'filter-clean', label: 'Filter cleaned and reinstalled' },
              { id: 'drain-clear', label: 'Drain verified clear' },
            ],
          },
          { id: 'measurements', title: 'Measurements', type: 'measurement_table', required: true, minMeasurementCount: 1 },
          { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 2 },
        ],
      },
    },
    ...overrides,
  };
}

test('service Field metadata produces an immutable-shaped report template snapshot', () => {
  const snapshot = fieldReportTemplateSnapshotForService(service());
  assert.deepEqual(snapshot, {
    id: 'standard-service-report',
    name: 'Standard Service Report',
    serviceId: 'service-standard',
    version: 3,
    sections: [
      {
        id: 'condition',
        title: 'Condition',
        type: 'checklist',
        required: true,
        checklistItems: [
          { id: 'filter-clean', label: 'Filter cleaned and reinstalled' },
          { id: 'drain-clear', label: 'Drain verified clear' },
        ],
      },
      { id: 'measurements', title: 'Measurements', type: 'measurement_table', required: true, minMeasurementCount: 1 },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 2 },
    ],
  });
  assert.equal(requireReportChecklistItem(snapshot, 'condition', 'drain-clear').item.label, 'Drain verified clear');
});

test('service without Field execution metadata remains a valid service with no report template', () => {
  assert.equal(fieldReportTemplateSnapshotForService({ id: 'service-basic' }), undefined);
  assert.equal(fieldReportTemplateSnapshotForService({
    id: 'service-basic',
    fieldExecutionDefinition: { version: 1 },
  }), undefined);
});

test('malformed configured Field metadata fails closed rather than silently dropping requirements', () => {
  const base = service().fieldExecutionDefinition.reportTemplate;
  const invalidDefinitions = [
    { version: 2, reportTemplate: base },
    { version: 1, reportTemplate: { ...base, id: '' } },
    { version: 1, reportTemplate: { ...base, version: 0 } },
    { version: 1, reportTemplate: { ...base, sections: [] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'x', title: 'X', type: 'future_type', required: true }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'x', title: 'X', type: 'photos' }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'x', title: 'X', type: 'photos', required: true, minEvidenceCount: -1 }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: '../photos', title: 'Unsafe', type: 'photos', required: true }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'photos/other', title: 'Unsafe', type: 'photos', required: true }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'condition', title: 'Condition', type: 'checklist', required: true }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'condition', title: 'Condition', type: 'checklist', required: true, checklistItems: [] }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'condition', title: 'Condition', type: 'checklist', required: true, checklistItems: [{ id: '../unsafe', label: 'Unsafe' }] }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'condition', title: 'Condition', type: 'checklist', required: true, checklistItems: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }] }] } },
    { version: 1, reportTemplate: { ...base, sections: [{ id: 'photos', title: 'Photos', type: 'photos', required: true, checklistItems: [{ id: 'x', label: 'X' }] }] } },
    { version: 1, reportTemplate: { ...base, sections: [
      { id: 'same', title: 'A', type: 'photos', required: true },
      { id: 'same', title: 'B', type: 'findings', required: false },
    ] } },
  ];
  for (const fieldExecutionDefinition of invalidDefinitions) {
    assert.throws(
      () => fieldReportTemplateSnapshotForService(service({ fieldExecutionDefinition })),
      (error) => error?.code === 'invalid_field_report_template' && error?.status === 409,
    );
  }
});

test('stored WorkIntervention snapshot must preserve exact canonical Service identity and checklist items', () => {
  const snapshot = fieldReportTemplateSnapshotForService(service());
  assert.deepEqual(projectStoredReportTemplateSnapshot(snapshot, 'service-standard'), snapshot);
  assert.throws(
    () => projectStoredReportTemplateSnapshot({ ...snapshot, serviceId: 'service-other' }, 'service-standard'),
    (error) => error?.code === 'work_intervention_template_identity_conflict' && error?.status === 409,
  );
  assert.throws(
    () => requireReportChecklistItem(snapshot, 'condition', 'not-configured'),
    (error) => error?.code === 'report_checklist_item_not_available' && error?.status === 409,
  );
});