const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getBytes, ref, uploadBytes } = require('firebase/storage');

const projectId = 'demo-demac-technician-portal-rules';
const repoRoot = path.resolve(__dirname, '..');
const storageEnabled = Boolean(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
let environment;

test.before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8') },
    ...(storageEnabled ? { storage: { rules: fs.readFileSync(path.join(repoRoot, 'storage.rules'), 'utf8') } } : {}),
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const fixtures = [
      setDoc(doc(db, 'users/tech-assigned'), { active: true, role: 'technician', staffId: 'staff-assigned', vanId: 'van-assigned' }),
      setDoc(doc(db, 'users/tech-unassigned'), { active: true, role: 'technician', staffId: 'staff-unassigned', vanId: 'van-unassigned' }),
      setDoc(doc(db, 'users/tech-participant'), { active: true, role: 'technician', staffId: 'staff-participant', vanId: 'van-participant' }),
      setDoc(doc(db, 'users/tech-inactive'), { active: false, role: 'technician', staffId: 'staff-inactive' }),
      setDoc(doc(db, 'users/office-user'), { active: true, role: 'office' }),
      setDoc(doc(db, 'workOrders/WO-ASSIGNED'), {
        clientId: 'CLIENT-1',
        propertyId: 'PROPERTY-1',
        technicianIds: ['staff-assigned'],
        vanId: 'van-assigned',
      }),
      setDoc(doc(db, 'workVisits/visit-WO-ASSIGNED'), {
        workOrderId: 'WO-ASSIGNED',
        participatingStaffIds: ['staff-assigned', 'staff-participant'],
        leadTechnicianStaffId: 'staff-assigned',
      }),
      setDoc(doc(db, 'workInterventions/WI-ASSIGNED'), {
        visitId: 'visit-WO-ASSIGNED',
        workOrderId: 'WO-ASSIGNED',
      }),
    ];
    if (storageEnabled) {
      const storage = context.storage();
      fixtures.push(
        uploadBytes(ref(storage, 'field-evidence/visit-WO-ASSIGNED/register-seed/reference.jpg'), new Uint8Array([1]), {
          contentType: 'image/jpeg', customMetadata: { uploadedByUid: 'tech-assigned' },
        }),
        uploadBytes(ref(storage, 'work-orders/WO-ASSIGNED/unit-1/legacy-seed.jpg'), new Uint8Array([1]), {
          contentType: 'image/jpeg', customMetadata: { uploadedByUid: 'tech-assigned' },
        }),
      );
    }
    await Promise.all(fixtures);
  });
});

test.after(async () => {
  if (environment) await environment.cleanup();
});

test('Firestore denies anonymous and inactive reads', async () => {
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'workOrders/WO-ASSIGNED')));
  await assertFails(getDoc(doc(environment.authenticatedContext('tech-inactive').firestore(), 'workOrders/WO-ASSIGNED')));
});

test('Firestore allows assigned technician and Office reads', async () => {
  await assertSucceeds(getDoc(doc(environment.authenticatedContext('tech-assigned').firestore(), 'workOrders/WO-ASSIGNED')));
  await assertSucceeds(getDoc(doc(environment.authenticatedContext('office-user').firestore(), 'workOrders/WO-ASSIGNED')));
});

test('Firestore visit assignment is sufficient only for Visit-scoped data', async () => {
  const db = environment.authenticatedContext('tech-participant').firestore();
  await assertFails(getDoc(doc(db, 'workOrders/WO-ASSIGNED')));
  await assertSucceeds(getDoc(doc(db, 'workVisits/visit-WO-ASSIGNED')));
  await assertSucceeds(getDoc(doc(db, 'workInterventions/WI-ASSIGNED')));
});

test('TARGET: Firestore denies an active unassigned technician who knows the Work Order ID', async () => {
  await assertFails(getDoc(doc(environment.authenticatedContext('tech-unassigned').firestore(), 'workOrders/WO-ASSIGNED')));
  await assertFails(getDoc(doc(environment.authenticatedContext('tech-unassigned').firestore(), 'workVisits/visit-WO-ASSIGNED')));
  await assertFails(getDoc(doc(environment.authenticatedContext('tech-unassigned').firestore(), 'workInterventions/WI-ASSIGNED')));
});

test('Firestore denies direct client writes to canonical server-only Field collections', async () => {
  const db = environment.authenticatedContext('tech-assigned').firestore();
  await assertFails(setDoc(doc(db, 'fieldOperationEvents/fabricated-event'), { workOrderId: 'WO-ASSIGNED' }));
  await assertFails(setDoc(doc(db, 'fieldOfficeReviews/fabricated-review'), { workOrderId: 'WO-ASSIGNED' }));
  await assertFails(setDoc(doc(db, 'fieldBillingCandidates/fabricated-billing'), { workOrderId: 'WO-ASSIGNED' }));
});

test('TARGET: Storage allows an assigned technician to create and read canonical registration evidence', { skip: !storageEnabled }, async () => {
  const storage = environment.authenticatedContext('tech-assigned').storage();
  const evidence = ref(storage, 'field-evidence/visit-WO-ASSIGNED/register-001/reference.jpg');
  await assertSucceeds(uploadBytes(evidence, new Uint8Array([1, 2, 3]), {
    contentType: 'image/jpeg',
    customMetadata: { uploadedByUid: 'tech-assigned' },
  }));
  await assertSucceeds(getBytes(evidence));
});

test('TARGET: Storage allows an assigned technician to create canonical report voice evidence', { skip: !storageEnabled }, async () => {
  const storage = environment.authenticatedContext('tech-assigned').storage();
  const evidence = ref(storage, 'field-evidence/visit-WO-ASSIGNED/interventions/WI-1/voice/voice/report-voice-001.webm');
  await assertSucceeds(uploadBytes(evidence, new Uint8Array([1, 2, 3]), {
    contentType: 'audio/webm',
    customMetadata: { uploadedByUid: 'tech-assigned', mediaKind: 'audio' },
  }));
});

test('Storage allows a participating technician to read Visit-scoped canonical evidence', { skip: !storageEnabled }, async () => {
  const evidence = ref(environment.authenticatedContext('tech-participant').storage(), 'field-evidence/visit-WO-ASSIGNED/register-seed/reference.jpg');
  await assertSucceeds(getBytes(evidence));
});

test('TARGET: Storage denies an unassigned technician reading canonical evidence from another Work Visit', { skip: !storageEnabled }, async () => {
  const evidence = ref(environment.authenticatedContext('tech-unassigned').storage(), 'field-evidence/visit-WO-ASSIGNED/register-seed/reference.jpg');
  await assertFails(getBytes(evidence));
});

test('Storage denies anonymous and inactive reads but preserves governed Office reads', { skip: !storageEnabled }, async () => {
  const path = 'field-evidence/visit-WO-ASSIGNED/register-seed/reference.jpg';
  await assertFails(getBytes(ref(environment.unauthenticatedContext().storage(), path)));
  await assertFails(getBytes(ref(environment.authenticatedContext('tech-inactive').storage(), path)));
  await assertSucceeds(getBytes(ref(environment.authenticatedContext('office-user').storage(), path)));
});

test('Canonical Storage evidence is immutable after creation', { skip: !storageEnabled }, async () => {
  const evidence = ref(environment.authenticatedContext('tech-assigned').storage(), 'field-evidence/visit-WO-ASSIGNED/register-seed/reference.jpg');
  await assertFails(uploadBytes(evidence, new Uint8Array([9]), { contentType: 'image/jpeg' }));
});

test('TARGET: Storage denies an unassigned technician creating canonical evidence under another Work Visit ID', { skip: !storageEnabled }, async () => {
  const evidence = ref(environment.authenticatedContext('tech-unassigned').storage(), 'field-evidence/visit-WO-ASSIGNED/register-foreign/reference.jpg');
  await assertFails(uploadBytes(evidence, new Uint8Array([4, 5, 6]), {
    contentType: 'image/jpeg',
    customMetadata: { uploadedByUid: 'tech-unassigned' },
  }));
});

test('TARGET: Legacy Work Order evidence path does not bypass assignment-aware access', { skip: !storageEnabled }, async () => {
  const storage = environment.authenticatedContext('tech-unassigned').storage();
  await assertFails(getBytes(ref(storage, 'work-orders/WO-ASSIGNED/unit-1/legacy-seed.jpg')));
  await assertFails(uploadBytes(ref(storage, 'work-orders/WO-ASSIGNED/unit-1/legacy-foreign.jpg'), new Uint8Array([4, 5, 6]), {
    contentType: 'image/jpeg',
    customMetadata: { uploadedByUid: 'tech-unassigned' },
  }));
});

test('Storage preserves assigned access to the legacy Work Order evidence path', { skip: !storageEnabled }, async () => {
  const storage = environment.authenticatedContext('tech-assigned').storage();
  await assertSucceeds(getBytes(ref(storage, 'work-orders/WO-ASSIGNED/unit-1/legacy-seed.jpg')));
});
