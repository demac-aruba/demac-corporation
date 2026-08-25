const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inboundPhoneCandidates,
  normalizePhone,
  resolveInboundParty,
} = require('./customerContactDirectory');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  return {
    collection(name) {
      const values = seed[name] || [];
      return {
        doc(id) {
          return {
            async get() {
              const item = values.find((value) => value.id === id);
              return snapshot(id, item ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id')) : undefined);
            },
          };
        },
        where(field, operator, value) {
          assert.equal(operator, '==');
          return {
            async get() {
              return {
                docs: values
                  .filter((item) => item[field] === value)
                  .map((item) => snapshot(item.id, Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id')))),
              };
            },
          };
        },
      };
    },
  };
}

test('Aruba inbound phone normalization covers canonical, digits-only, and local storage forms', () => {
  assert.equal(normalizePhone('564-2625'), '+2975642625');
  assert.equal(normalizePhone('297 564 2625'), '+2975642625');
  assert.equal(normalizePhone('+297 564 2625'), '+2975642625');
  assert.deepEqual(inboundPhoneCandidates('564-2625'), ['+2975642625', '2975642625', '5642625']);
});

test('canonical client phone resolves as an existing party', async () => {
  const db = createDb({
    clients: [{ id: 'client-1', name: 'Customer', phone: '5642625', active: true }],
    contacts: [],
  });
  const result = await resolveInboundParty(db, { phone: '+297 564-2625' });
  assert.equal(result.status, 'existing');
  assert.equal(result.isNewContact, false);
  assert.equal(result.clientId, 'client-1');
  assert.equal(result.source, 'canonical_client_phone');
});

test('canonical contact resolves to its owning client and is never treated as a new contact', async () => {
  const db = createDb({
    clients: [{ id: 'client-1', name: 'Customer', phone: '+2975600000', active: true }],
    contacts: [{ id: 'contact-1', clientId: 'client-1', name: 'Manager', whatsapp: '+2975642625', active: true }],
  });
  const result = await resolveInboundParty(db, { whatsapp: '5642625' });
  assert.equal(result.status, 'existing');
  assert.equal(result.isNewContact, false);
  assert.equal(result.clientId, 'client-1');
  assert.deepEqual(result.contactIds, ['contact-1']);
  assert.equal(result.source, 'canonical_contact');
});

test('absence from canonical clients and contacts is the only condition that classifies a phone as new', async () => {
  const db = createDb({ clients: [], contacts: [] });
  const result = await resolveInboundParty(db, { phone: '5642625' });
  assert.equal(result.status, 'new_contact');
  assert.equal(result.isNewContact, true);
  assert.equal(result.ambiguous, false);
  assert.equal(result.source, 'canonical_directory_absence');
});

test('missing inbound identity fails closed instead of becoming a new contact', async () => {
  const result = await resolveInboundParty(createDb(), {});
  assert.equal(result.status, 'missing_identity');
  assert.equal(result.isNewContact, false);
});

test('the same normalized identity belonging to two clients is ambiguous and not autonomous', async () => {
  const db = createDb({
    clients: [
      { id: 'client-1', phone: '+2975642625', active: true },
      { id: 'client-2', whatsapp: '5642625', active: true },
    ],
    contacts: [],
  });
  const result = await resolveInboundParty(db, { phone: '2975642625' });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.isNewContact, false);
  assert.equal(result.ambiguous, true);
  assert.equal(result.source, 'multiple_canonical_clients');
});

test('a canonical contact pointing at a missing client fails closed', async () => {
  const db = createDb({
    clients: [],
    contacts: [{ id: 'contact-orphan', clientId: 'client-missing', whatsapp: '+2975642625', active: true }],
  });
  const result = await resolveInboundParty(db, { phone: '5642625' });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.isNewContact, false);
  assert.equal(result.source, 'contact_owner_not_active');
});

test('an explicit canonical client id is authoritative only when that client exists and is active', async () => {
  const db = createDb({
    clients: [{ id: 'client-1', name: 'Known', active: true }],
    contacts: [],
  });
  const existing = await resolveInboundParty(db, { clientId: 'client-1', phone: '9999999' });
  assert.equal(existing.status, 'existing');
  assert.equal(existing.clientId, 'client-1');
  assert.equal(existing.source, 'canonical_client_id');

  const invalid = await resolveInboundParty(db, { clientId: 'client-missing', phone: '5642625' });
  assert.equal(invalid.status, 'ambiguous');
  assert.equal(invalid.isNewContact, false);
  assert.equal(invalid.source, 'invalid_canonical_client_id');
});
