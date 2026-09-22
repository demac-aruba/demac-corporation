const crypto = require('node:crypto');
const { BookingAuthorityError, BOOKING_ERROR_CODES, cleanText } = require('./bookingAuthorityCore');
const { assignmentIdFor, projectLinkedCustomerContact } = require('./customerContactDirectory');

const text = (value) => cleanText(value, 180);
const record = (snapshot) => snapshot?.exists ? { ...snapshot.data(), id: snapshot.id } : null;
const records = (snapshot) => (snapshot?.docs || []).map(record).filter(Boolean);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
function fail(reason, message) {
  throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, message, { reason });
}
function id(value, label) {
  if (String(value ?? '').trim().length > 180) fail('invalid_location_id', `${label} is too long.`);
  const normalized = text(value);
  if (!normalized || normalized.includes('/') || normalized === '.' || normalized === '..') fail('invalid_location_id', `${label} is required.`);
  return normalized;
}
function code(value) {
  return text(value).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ');
}
function propertyBelongsTo(customer, property, customerId) {
  if (!customer || customer.active === false) fail('customer_not_available', 'The customer is unavailable.');
  if (!property || property.active === false || text(property.clientId) !== customerId) fail('property_customer_mismatch', 'The property does not belong to this active customer.');
}
function locationRef(db, propertyId, kind, locationId) {
  return db.collection('properties').doc(id(propertyId, 'Property')).collection(kind).doc(id(locationId, 'Location'));
}

/** Transactional validation, also used by Booking and Field; no name-derived identity. */
async function resolvePropertyLocation({ db, transaction, customer, property, request, requireExplicit = true }) {
  const read = (ref) => transaction ? transaction.get(ref) : ref.get();
  propertyBelongsTo(customer, property, request.customerId);
  const dwellingId = text(request.dwellingId);
  const areaId = text(request.areaId);
  if (requireExplicit && property.hasIndependentDwellings === true && !dwellingId) {
    fail('dwelling_selection_required', 'Select the dwelling for this visit explicitly.');
  }
  let dwelling;
  if (dwellingId) {
    dwelling = record(await read(locationRef(db, property.id, 'dwellings', dwellingId)));
    if (!dwelling || dwelling.active === false || dwelling.propertyId !== property.id || dwelling.clientId !== customer.id) {
      fail('dwelling_property_mismatch', 'The dwelling does not belong to this property.');
    }
  }
  let area;
  if (areaId) {
    area = record(await read(locationRef(db, property.id, 'areas', areaId)));
    if (!area || area.active === false || area.propertyId !== property.id || area.clientId !== customer.id || text(area.dwellingId) !== dwellingId) {
      fail('area_location_mismatch', 'The area does not belong to the selected location.');
    }
  }
  const party = async (partyId) => {
    if (!partyId) return null;
    if (partyId === `client:${customer.id}`) return { recipientType: 'client', sourceId: customer.id, name: text(customer.name || customer.company), phone: text(customer.whatsapp || customer.phone), email: text(customer.email) };
    if (!partyId.startsWith('contact:')) fail('invalid_visit_contact', 'Select a canonical customer contact.');
    let contact = record(await read(db.collection('contacts').doc(id(partyId.slice(8), 'Contact'))));
    if (!contact || contact.active === false || contact.clientId !== customer.id) fail('visit_contact_customer_mismatch', 'The visit contact does not belong to this customer.');
    if (contact.linkedCustomerId) {
      const linked = record(await read(db.collection('clients').doc(id(contact.linkedCustomerId, 'Linked customer'))));
      if (!linked || linked.active === false) fail('visit_contact_inactive', 'The linked contact is unavailable.');
      contact = projectLinkedCustomerContact(contact, linked);
    }
    return { recipientType: 'contact', sourceId: contact.id, name: text(contact.name), phone: text(contact.whatsapp || contact.phone), email: text(contact.email) };
  };
  const requester = await party(text(request.requesterId));
  const accessContact = await party(text(request.accessContactId));
  return {
    ...(dwelling ? { dwellingId: dwelling.id, dwellingName: dwelling.name, dwellingCode: dwelling.code } : {}),
    ...(area ? { areaId: area.id, areaName: area.name } : {}),
    propertyId: property.id,
    propertyAddress: text(property.address),
    locationLabel: [text(property.name || property.address), dwelling?.name, area?.name].filter(Boolean).join(' · '),
    accessInstructions: [cleanText(property.accessInstructions, 1500), dwelling?.accessInstructions].filter(Boolean).join('\n'),
    requester,
    accessContact,
  };
}

function createPropertyLocationService({ db, now = () => new Date().toISOString() }) {
  async function list(data) {
    const customerId = id(data.customerId, 'Customer');
    const propertyId = id(data.propertyId, 'Property');
    const propertyRef = db.collection('properties').doc(propertyId);
    const [customerSnapshot, propertySnapshot] = await Promise.all([db.collection('clients').doc(customerId).get(), propertyRef.get()]);
    const property = record(propertySnapshot);
    propertyBelongsTo(record(customerSnapshot), property, customerId);
    const [dwellingSnapshot, areaSnapshot, assignmentSnapshot] = await Promise.all([
      propertyRef.collection('dwellings').get(), propertyRef.collection('areas').get(),
      db.collection('contactPropertyAssignments').where('propertyId', '==', propertyId).get(),
    ]);
    const dwellings = records(dwellingSnapshot).filter((row) => row.active !== false).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
    const areas = records(areaSnapshot).filter((row) => row.active !== false);
    let equipment;
    if (data.includeEquipment === true) {
      equipment = records(await db.collection('equipmentSystems').where('propertyId', '==', propertyId).get())
        .filter((row) => (row.clientId || row.customerId) === customerId && (data.dwellingId === undefined || text(row.dwellingId) === text(data.dwellingId)));
    }
    return { success: true, property, dwellings, areas, assignments: records(assignmentSnapshot).filter((row) => row.active !== false), ...(equipment ? { equipment } : {}) };
  }

  async function save(data, identity) {
    const customerId = id(data.customerId, 'Customer');
    const propertyId = id(data.propertyId, 'Property');
    const requestId = id(data.requestId, 'Request');
    if (requestId.length < 8) fail('invalid_request_id', 'A stable request ID is required.');
    const kind = data.kind;
    if (!['dwellings', 'areas'].includes(kind)) fail('invalid_location_kind', 'Choose dwellings or areas.');
    if (!Array.isArray(data.rows) || data.rows.length < 1 || data.rows.length > 100) fail('invalid_batch', 'Save between 1 and 100 rows per batch. Larger properties can use more batches.');
    if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0) fail('location_version_required', 'Reload the property before saving.');
    const fingerprint = digest(JSON.stringify({ customerId, propertyId, kind, rows: data.rows, expectedVersion: data.expectedVersion }));
    const ledgerRef = db.collection('bookingIdempotency').doc(`location-${digest(`${identity.uid}:${requestId}`)}`);
    const propertyRef = db.collection('properties').doc(propertyId);
    return db.runTransaction(async (transaction) => {
      const [customerSnapshot, propertySnapshot, ledgerSnapshot] = await Promise.all([
        transaction.get(db.collection('clients').doc(customerId)), transaction.get(propertyRef), transaction.get(ledgerRef),
      ]);
      const property = record(propertySnapshot);
      propertyBelongsTo(record(customerSnapshot), property, customerId);
      if (ledgerSnapshot.exists) {
        const ledger = ledgerSnapshot.data();
        if (ledger.fingerprint !== fingerprint || ledger.actorId !== identity.uid) fail('idempotency_conflict', 'This request ID was already used for a different change.');
        return { success: true, replayed: true, ids: ledger.ids, version: ledger.version };
      }
      const version = Number(property.locationVersion || 0);
      if (version !== data.expectedVersion) fail('location_version_conflict', 'This property changed in another session. Reload and review your draft before retrying.');
      const existing = records(await transaction.get(propertyRef.collection(kind)));
      const existingById = new Map(existing.map((row) => [row.id, row]));
      const stamp = now();
      const ids = new Set();
      const rows = data.rows.map((input, index) => {
        const rowId = input.id ? id(input.id, 'Location') : `${kind === 'dwellings' ? 'dw' : 'ar'}-${digest(`${identity.uid}:${requestId}:${index}`)}`;
        if (ids.has(rowId)) fail('duplicate_location_id', 'A location can only appear once in a batch.');
        ids.add(rowId);
        const previous = existingById.get(rowId);
        if (input.id && !previous) fail('location_not_found', 'The location no longer exists in this property.');
        const name = text(input.name);
        const rowCode = text(input.code);
        if (!name || !rowCode) fail('location_name_required', 'Every location requires a name and code.');
        const dwellingId = kind === 'areas' ? text(input.dwellingId) : '';
        if (previous && kind === 'areas' && text(previous.dwellingId) !== dwellingId) fail('area_move_not_allowed', 'An existing area cannot be moved to another dwelling.');
        const dwellingType = kind === 'dwellings' ? text(input.type || previous?.type || 'apartment') : '';
        if (kind === 'dwellings' && !['main_house', 'apartment', 'annex'].includes(dwellingType)) fail('invalid_dwelling_type', 'Choose main house, apartment or annex.');
        return {
          ...previous, id: rowId, clientId: customerId, propertyId, name, code: rowCode,
          ...(kind === 'dwellings' ? { type: dwellingType, accessInstructions: cleanText(input.accessInstructions, 1500) } : { dwellingId }),
          active: true, createdAt: previous?.createdAt || stamp, updatedAt: stamp,
          createdById: previous?.createdById || identity.uid, updatedById: identity.uid,
        };
      });
      const combined = [...existing.filter((row) => !ids.has(row.id)), ...rows];
      const seenCodes = new Set();
      for (const row of combined.filter((row) => row.active !== false)) {
        const key = `${kind === 'areas' ? text(row.dwellingId) : ''}|${code(row.code)}`;
        if (seenCodes.has(key)) fail('duplicate_location_code', `Code ${row.code} already exists in this container.`);
        seenCodes.add(key);
      }
      // All relationship reads finish before any transaction write.
      for (const row of rows.filter((row) => kind === 'areas' && row.dwellingId)) {
        const dwelling = record(await transaction.get(locationRef(db, propertyId, 'dwellings', row.dwellingId)));
        if (!dwelling || dwelling.active === false || dwelling.clientId !== customerId) fail('area_dwelling_mismatch', 'The area dwelling is unavailable in this property.');
      }
      const assignmentWrites = [];
      if (kind === 'dwellings') {
        const assignments = records(await transaction.get(db.collection('contactPropertyAssignments').where('propertyId', '==', propertyId)));
        for (let index = 0; index < rows.length; index++) {
          const input = data.rows[index];
          if (input.contactIds === undefined) continue;
          if (!Array.isArray(input.contactIds) || input.contactIds.length > 20) fail('invalid_contact_list', 'Select up to 20 existing contacts per dwelling.');
          const contactIds = [...new Set(input.contactIds.map((value) => id(value, 'Contact')))];
          for (const contactId of contactIds) {
            const contact = record(await transaction.get(db.collection('contacts').doc(contactId)));
            if (!contact || contact.active === false || contact.clientId !== customerId) fail('dwelling_contact_mismatch', 'A dwelling contact must belong to this customer.');
            if (contact.linkedCustomerId) {
              const linked = record(await transaction.get(db.collection('clients').doc(id(contact.linkedCustomerId, 'Linked customer'))));
              if (!linked || linked.active === false) fail('dwelling_contact_inactive', 'The linked customer contact is unavailable.');
            }
            const assignmentId = assignmentIdFor({ clientId: customerId, propertyId, contactId, scope: 'property', dwellingId: rows[index].id });
            const previous = assignments.find((row) => row.id === assignmentId);
            assignmentWrites.push({
              ...previous, id: assignmentId, clientId: customerId, propertyId, contactId,
              dwellingId: rows[index].id, scope: 'property', role: previous?.role || 'Access contact',
              appointmentConfirmation: previous?.appointmentConfirmation === true,
              appointmentReminder: previous?.appointmentReminder ?? true, technicianArrival: previous?.technicianArrival ?? true,
              invoice: previous?.invoice === true, serviceReport: previous?.serviceReport === true,
              active: true, createdAt: previous?.createdAt || stamp, updatedAt: stamp, updatedById: identity.uid,
            });
          }
          assignmentWrites.push(...assignments.filter((row) => row.dwellingId === rows[index].id && !contactIds.includes(row.contactId))
            .map((row) => ({ ...row, active: false, updatedAt: stamp, updatedById: identity.uid })));
        }
      }
      if (rows.length + assignmentWrites.length > 200) fail('location_batch_too_large', 'Split this batch into smaller groups of dwellings and contacts.');
      rows.forEach((row) => transaction.set(propertyRef.collection(kind).doc(row.id), row));
      assignmentWrites.forEach((row) => transaction.set(db.collection('contactPropertyAssignments').doc(row.id), row));
      const summary = { locationVersion: version + 1, updatedAt: stamp, updatedById: identity.uid };
      if (kind === 'dwellings') Object.assign(summary, { hasIndependentDwellings: true, dwellingCount: combined.filter((row) => row.active !== false).length });
      transaction.set(propertyRef, summary, { merge: true });
      const resultIds = rows.map((row) => row.id);
      transaction.create(ledgerRef, { operation: `save_property_${kind}`, fingerprint, actorId: identity.uid, customerId, propertyId, ids: resultIds, version: version + 1, occurredAt: stamp, before: existing.filter((row) => ids.has(row.id)), after: rows, contactAssignmentsAfter: assignmentWrites });
      return { success: true, replayed: false, ids: resultIds, version: version + 1 };
    });
  }
  return { list, save };
}

module.exports = { createPropertyLocationService, resolvePropertyLocation, locationRef };
