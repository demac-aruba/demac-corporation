const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachCustomerAcknowledgementsToJob,
  customerAcknowledgementOptions,
} = require('./fieldOperationsCustomerAcknowledgementRead');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function dbWith(acknowledgements = []) {
  return {
    collection(name) {
      assert.equal(name, 'fieldCustomerAcknowledgements');
      return {
        where(field, op, expected) {
          return {
            async get() {
              return {
                docs: acknowledgements
                  .filter((value) => op === '==' && value?.[field] === expected)
                  .map((value) => snapshot(value.id, value)),
              };
            },
          };
        },
      };
    },
  };
}

function acknowledgement(overrides = {}) {
  return {
    id: 'CACK-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'ack', receiverName: 'Maria Customer', method: 'verbal', note: 'Reviewed',
    acknowledgedAt: '2026-08-25T10:30:00.000Z', recordedByStaffId: 'staff-1', requestId: 'customer-ack-001',
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    interventionId: 'WI-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
    template: {
      id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 1,
      sections: [
        { id: 'ack', title: 'Customer acknowledgement', type: 'customer_acknowledgement', required: true },
        { id: 'notes', title: 'Notes', type: 'free_text', required: false },
      ],
    },
    sectionStatus: { ack: 'pending', notes: 'pending' }, evidence: [], measurements: [], findings: [], checklistResponses: [], freeTextResponses: [],
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', allowedActions: ['read', 'execute', 'report.edit'],
    fieldVisit: { id: 'visit-WO-1', status: 'in_progress' },
    workInterventions: [{ id: 'WI-1', status: 'in_progress' }], interventionReports: [report()],
    ...overrides,
  };
}

test('pending acknowledgement section is server-projected as eligible only with execute authority', async () => {
  const result = await attachCustomerAcknowledgementsToJob(dbWith(), job());
  assert.deepEqual(result.interventionReports[0].customerAcknowledgements, []);
  assert.deepEqual(result.reportCustomerAcknowledgementOptions, [{ interventionId: 'WI-1', sectionIds: ['ack'] }]);
  assert.equal(result.canRecordCustomerAcknowledgement, true);
  assert.deepEqual(customerAcknowledgementOptions(job({ allowedActions: ['read'] }), [report()]), []);
  assert.deepEqual(customerAcknowledgementOptions(job({ fieldVisit: { id: 'visit-WO-1', status: 'on_site' } }), [report()]), []);
});

test('persisted acknowledgement closes its immutable section and remains visible historically', async () => {
  const completed = report({ sectionStatus: { ack: 'completed', notes: 'pending' } });
  const result = await attachCustomerAcknowledgementsToJob(dbWith([acknowledgement()]), job({ interventionReports: [completed] }));
  assert.equal(result.interventionReports[0].customerAcknowledgements.length, 1);
  assert.equal(result.interventionReports[0].customerAcknowledgements[0].receiverName, 'Maria Customer');
  assert.deepEqual(result.reportCustomerAcknowledgementOptions, []);
  assert.equal(result.canRecordCustomerAcknowledgement, false);
});

test('acknowledgement read fails closed on missing evidence, wrong section or equipment identity drift', async () => {
  const completed = report({ sectionStatus: { ack: 'completed', notes: 'pending' } });
  await assert.rejects(
    () => attachCustomerAcknowledgementsToJob(dbWith(), job({ interventionReports: [completed] })),
    (error) => error?.code === 'customer_acknowledgement_report_state_conflict',
  );
  await assert.rejects(
    () => attachCustomerAcknowledgementsToJob(dbWith([acknowledgement({ sectionId: 'notes' })]), job()),
    (error) => error?.code === 'customer_acknowledgement_identity_conflict',
  );
  await assert.rejects(
    () => attachCustomerAcknowledgementsToJob(dbWith([acknowledgement({ assetId: 'AC-X' })]), job()),
    (error) => error?.code === 'customer_acknowledgement_identity_conflict',
  );
});

test('duplicate acknowledgement evidence for one section fails closed', async () => {
  const completed = report({ sectionStatus: { ack: 'completed', notes: 'pending' } });
  await assert.rejects(
    () => attachCustomerAcknowledgementsToJob(dbWith([
      acknowledgement({ id: 'CACK-1' }), acknowledgement({ id: 'CACK-2', requestId: 'customer-ack-002' }),
    ]), job({ interventionReports: [completed] })),
    (error) => error?.code === 'customer_acknowledgement_identity_conflict',
  );
});
