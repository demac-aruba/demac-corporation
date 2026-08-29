const crypto = require('node:crypto');
const { BOOKING_ERROR_CODES, BookingAuthorityError, cleanText } = require('./bookingAuthorityCore');

const CONTACT_COLLECTION = 'contacts';
const CONTACT_ASSIGNMENT_COLLECTION = 'contactPropertyAssignments';

function bool(value, fallback = false) {
  return value === undefined || value === null ? fallback : value === true;
}

function normalizePhone(value) {
  const raw = cleanText(value, 80);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 7) return `+297${digits}`;
  return `+${digits}`;
}

function normalizeEmail(value) {
  return cleanText(value, 180).toLowerCase();
}

function hashId(value, length = 24) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

async function readDocumentSnapshots(db, refs = [], batchSize = 100) {
  const snapshots = [];
  for (let index = 0; index < refs.length; index += batchSize) {
    const batch = refs.slice(index, index + batchSize);
    const values = typeof db.getAll === 'function'
      ? await db.getAll(...batch)
      : await Promise.all(batch.map((ref) => ref.get()));
    snapshots.push(...values);
  }
  return snapshots;
}

function contactIdentity(input = {}) {
  const whatsapp = normalizePhone(input.whatsapp || input.phone);
  const phone = normalizePhone(input.phone || input.whatsapp);
  const email = normalizeEmail(input.email);
  return { phone, whatsapp, email };
}

function contactIdFor(clientId, input = {}) {
  const identity = contactIdentity(input);
  const identityKey = identity.whatsapp || identity.phone || identity.email;
  if (!identityKey) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      'A contact requires at least one phone, WhatsApp, or email address.',
      { field: 'contact' },
    );
  }
  return `contact-${hashId(`${clientId}|${identityKey}`, 24)}`;
}

function linkedCustomerContactIdFor(clientId, linkedCustomerId) {
  const ownerId = cleanText(clientId, 180);
  const personId = cleanText(linkedCustomerId, 180);
  if (!ownerId || !personId) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      'Both the customer and linked customer are required for an existing-customer contact.',
      { field: !ownerId ? 'customerId' : 'link.linkedCustomerId' },
    );
  }
  return `contact-${hashId(`${ownerId}|linked-customer:${personId}`, 24)}`;
}

function assignmentIdFor({ clientId, contactId, scope, propertyId }) {
  const scopeKey = scope === 'all_properties' ? 'all' : cleanText(propertyId, 180);
  return `contact-assignment-${hashId(`${clientId}|${contactId}|${scope}|${scopeKey}`, 24)}`;
}

function normalizeRules(input = {}) {
  return {
    appointmentConfirmation: bool(input.appointmentConfirmation),
    appointmentReminder: bool(input.appointmentReminder, true),
    technicianArrival: bool(input.technicianArrival, true),
    invoice: bool(input.invoice),
    serviceReport: bool(input.serviceReport),
  };
}

function normalizeScope(value) {
  return cleanText(value, 40) === 'all_properties' ? 'all_properties' : 'property';
}

function normalizeContactLink(link = {}, { clientId, propertyId }) {
  const scope = normalizeScope(link.scope);
  const existingContactId = cleanText(link.contactId, 180);
  const linkedCustomerId = cleanText(link.linkedCustomerId, 180);
  const input = link.contact || {};
  const hasManualContact = Object.prototype.hasOwnProperty.call(link, 'contact');
  const identitySourceCount = Number(Boolean(existingContactId)) + Number(Boolean(linkedCustomerId)) + Number(hasManualContact);
  if (identitySourceCount > 1) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      'Choose one contact identity source: an existing customer, an existing contact, or a new contact.',
      {
        reason: 'ambiguous_contact_identity',
        contactId: existingContactId,
        linkedCustomerId,
        hasManualContact,
      },
    );
  }
  const contactId = existingContactId
    || (linkedCustomerId ? linkedCustomerContactIdFor(clientId, linkedCustomerId) : contactIdFor(clientId, input));
  const role = cleanText(link.role, 120) || 'Contact';
  return {
    contactId,
    existingContactId,
    linkedCustomerId,
    contactInput: input,
    assignment: {
      id: assignmentIdFor({ clientId, contactId, scope, propertyId }),
      clientId,
      contactId,
      scope,
      ...(scope === 'property' ? { propertyId } : {}),
      role,
      ...normalizeRules(link),
    },
  };
}

function buildLinkedCustomerContactRecord({ id, clientId, linkedCustomerId, identity = {}, now }) {
  return {
    id,
    clientId,
    linkedCustomerId,
    identitySource: 'linked_customer',
    active: true,
    createdAt: now,
    updatedAt: now,
    createdById: cleanText(identity.uid, 160),
    createdByName: cleanText(identity.name || identity.email, 180),
  };
}

function projectLinkedCustomerContact(contact = {}, linkedCustomer = {}) {
  const linkedCustomerId = cleanText(contact.linkedCustomerId, 180);
  if (!linkedCustomerId) return contact;
  return {
    ...contact,
    linkedCustomerId,
    identitySource: 'linked_customer',
    active: contact.active !== false && linkedCustomer.active !== false,
    name: cleanText(linkedCustomer.name || linkedCustomer.company, 180),
    phone: normalizePhone(linkedCustomer.phone),
    phoneCountry: cleanText(linkedCustomer.phoneCountry, 20) || (linkedCustomer.phone ? 'AW' : ''),
    whatsapp: normalizePhone(linkedCustomer.whatsapp || linkedCustomer.phone),
    whatsappCountry: cleanText(linkedCustomer.whatsappCountry || linkedCustomer.phoneCountry, 20)
      || (linkedCustomer.whatsapp || linkedCustomer.phone ? 'AW' : ''),
    email: normalizeEmail(linkedCustomer.email),
    preferredLanguage: cleanText(linkedCustomer.preferredLanguage, 80) || 'Papiamento',
    linkedCustomerActive: linkedCustomer.active !== false,
  };
}

function buildContactRecord({ id, clientId, input = {}, identity = {}, now }) {
  const name = cleanText(input.name, 180);
  if (!name) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      'Contact name is required.',
      { field: 'contact.name' },
    );
  }
  const channels = contactIdentity(input);
  if (!channels.phone && !channels.whatsapp && !channels.email) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      'A contact requires at least one phone, WhatsApp, or email address.',
      { field: 'contact' },
    );
  }
  return {
    id,
    clientId,
    name,
    phone: channels.phone,
    phoneCountry: channels.phone ? 'AW' : '',
    whatsapp: channels.whatsapp,
    whatsappCountry: channels.whatsapp ? 'AW' : '',
    email: channels.email,
    preferredLanguage: cleanText(input.preferredLanguage, 80) || 'Papiamento',
    active: true,
    createdAt: now,
    updatedAt: now,
    createdById: cleanText(identity.uid, 160),
    createdByName: cleanText(identity.name || identity.email, 180),
  };
}

async function writeContactLinks(transaction, db, { clientId, propertyId, links = [], identity = {}, now }) {
  const normalized = Array.isArray(links)
    ? links.filter((link) => link && typeof link === 'object').map((link) => normalizeContactLink(link, { clientId, propertyId }))
    : [];
  if (!normalized.length) return [];

  const assignmentIds = new Set();
  for (const item of normalized) {
    if (item.linkedCustomerId === clientId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        'A customer cannot be linked as its own contact.',
        { reason: 'linked_customer_self_reference', customerId: clientId },
      );
    }
    if (assignmentIds.has(item.assignment.id)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        'The same contact relationship was supplied more than once.',
        { reason: 'duplicate_contact_assignment', assignmentId: item.assignment.id },
      );
    }
    assignmentIds.add(item.assignment.id);
  }

  // Firestore transactions require every read to happen before the first write.
  // Resolve both contact and assignment snapshots first, then apply writes in a second pass.
  const prepared = [];
  for (const item of normalized) {
    const contactRef = db.collection(CONTACT_COLLECTION).doc(item.contactId);
    const assignmentRef = db.collection(CONTACT_ASSIGNMENT_COLLECTION).doc(item.assignment.id);
    const linkedCustomerRef = item.linkedCustomerId ? db.collection('clients').doc(item.linkedCustomerId) : null;
    const [contactSnapshot, assignmentSnapshot, linkedCustomerSnapshot] = await Promise.all([
      transaction.get(contactRef),
      transaction.get(assignmentRef),
      linkedCustomerRef ? transaction.get(linkedCustomerRef) : Promise.resolve(null),
    ]);

    if (item.linkedCustomerId) {
      if (!linkedCustomerSnapshot?.exists || linkedCustomerSnapshot.data()?.active === false) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND,
          'The selected existing customer no longer exists or is inactive.',
          { reason: 'linked_customer_not_found', linkedCustomerId: item.linkedCustomerId },
        );
      }
      const linkedCustomer = linkedCustomerSnapshot.data() || {};
      const linkedCustomerName = cleanText(linkedCustomer.name || linkedCustomer.company, 180);
      const linkedCustomerChannels = contactIdentity(linkedCustomer);
      if (!linkedCustomerName
        || (!linkedCustomerChannels.phone && !linkedCustomerChannels.whatsapp && !linkedCustomerChannels.email)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          'The selected customer profile needs a name and at least one communication channel before it can be linked as a contact.',
          { reason: 'linked_customer_unusable', linkedCustomerId: item.linkedCustomerId },
        );
      }
      if (contactSnapshot.exists) {
        const existing = contactSnapshot.data() || {};
        if (cleanText(existing.clientId, 180) !== clientId
          || cleanText(existing.linkedCustomerId, 180) !== item.linkedCustomerId) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.INVALID_REQUEST,
            'The linked-customer contact identity conflicts with an existing contact.',
            { reason: 'linked_customer_contact_conflict', contactId: item.contactId, linkedCustomerId: item.linkedCustomerId },
          );
        }
      }
    } else if (item.existingContactId) {
      if (!contactSnapshot.exists || cleanText(contactSnapshot.data()?.clientId, 180) !== clientId || contactSnapshot.data()?.active === false) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          'The selected contact does not belong to this customer or is inactive.',
          { contactId: item.contactId },
        );
      }
    } else if (contactSnapshot.exists && cleanText(contactSnapshot.data()?.clientId, 180) !== clientId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        'Contact identity conflicts with another customer.',
        { contactId: item.contactId },
      );
    }

    if (assignmentSnapshot.exists) {
      const existing = assignmentSnapshot.data() || {};
      const sameProperty = item.assignment.scope === 'all_properties'
        || cleanText(existing.propertyId, 180) === cleanText(item.assignment.propertyId, 180);
      if (cleanText(existing.clientId, 180) !== clientId
        || cleanText(existing.contactId, 180) !== item.contactId
        || cleanText(existing.scope, 40) !== item.assignment.scope
        || !sameProperty) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          'The contact relationship conflicts with an existing assignment.',
          { reason: 'contact_assignment_conflict', assignmentId: item.assignment.id },
        );
      }
    }

    const contact = item.existingContactId
      ? null
      : item.linkedCustomerId
        ? buildLinkedCustomerContactRecord({
          id: item.contactId,
          clientId,
          linkedCustomerId: item.linkedCustomerId,
          identity,
          now,
        })
        : buildContactRecord({ id: item.contactId, clientId, input: item.contactInput, identity, now });
    const assignment = {
      ...item.assignment,
      active: true,
      createdAt: assignmentSnapshot.exists ? assignmentSnapshot.data()?.createdAt || now : now,
      updatedAt: now,
      createdById: assignmentSnapshot.exists ? assignmentSnapshot.data()?.createdById || cleanText(identity.uid, 160) : cleanText(identity.uid, 160),
      createdByName: assignmentSnapshot.exists ? assignmentSnapshot.data()?.createdByName || cleanText(identity.name || identity.email, 180) : cleanText(identity.name || identity.email, 180),
    };
    prepared.push({ item, contactRef, contactSnapshot, contact, assignmentRef, assignment });
  }

  for (const entry of prepared) {
    if (entry.contact) {
      const existingContact = entry.contactSnapshot.exists ? entry.contactSnapshot.data() || {} : {};
      transaction.set(
        entry.contactRef,
        entry.contactSnapshot.exists
          ? {
            ...entry.contact,
            createdAt: existingContact.createdAt || now,
            createdById: existingContact.createdById || entry.contact.createdById,
            createdByName: existingContact.createdByName || entry.contact.createdByName,
          }
          : entry.contact,
        { merge: true },
      );
    }
    transaction.set(entry.assignmentRef, entry.assignment, { merge: true });
  }

  return prepared.map((entry) => ({
    contactId: entry.item.contactId,
    assignmentId: entry.assignment.id,
    ...(entry.item.linkedCustomerId ? { linkedCustomerId: entry.item.linkedCustomerId } : {}),
  }));
}

function legacyContactRecipient(contact = {}) {
  const whatsapp = normalizePhone(contact.whatsapp || contact.phone);
  const phone = normalizePhone(contact.phone || contact.whatsapp);
  if (!whatsapp && !phone) return null;
  return {
    id: `legacy-contact-${cleanText(contact.id, 120) || hashId(`${contact.name}|${whatsapp || phone}`, 12)}`,
    recipientType: 'contact',
    sourceId: cleanText(contact.id, 120) || `legacy-${hashId(`${contact.name}|${whatsapp || phone}`, 12)}`,
    name: cleanText(contact.name, 180) || 'Property contact',
    role: cleanText(contact.role, 120) || 'Contact',
    phone,
    phoneCountry: cleanText(contact.phoneCountry, 20) || 'AW',
    whatsapp: whatsapp || phone,
    whatsappCountry: cleanText(contact.whatsappCountry || contact.phoneCountry, 20) || 'AW',
    email: normalizeEmail(contact.email),
    preferredLanguage: cleanText(contact.preferredLanguage, 80) || 'Papiamento',
    sendConfirmation: contact.defaultSendConfirmation === true,
    sendReminder: contact.defaultSendReminder !== false,
    technicianArrival: contact.arrivalContact !== false,
    sendInvoice: false,
    sendServiceReport: false,
    source: 'legacy_property_contact',
  };
}

function primaryCustomerRecipient(customer = {}, useAsDefault) {
  const whatsapp = normalizePhone(customer.whatsapp || customer.phone);
  const phone = normalizePhone(customer.phone || customer.whatsapp);
  const email = normalizeEmail(customer.email);
  if (!whatsapp && !phone && !email) return null;
  return {
    id: `client-${customer.id}`,
    recipientType: 'client',
    sourceId: customer.id,
    name: cleanText(customer.name || customer.company, 180) || 'Customer',
    role: 'Customer / owner',
    phone,
    phoneCountry: cleanText(customer.phoneCountry, 20) || 'AW',
    whatsapp: whatsapp || phone,
    whatsappCountry: cleanText(customer.whatsappCountry || customer.phoneCountry, 20) || 'AW',
    email,
    preferredLanguage: cleanText(customer.preferredLanguage, 80) || 'Papiamento',
    sendConfirmation: useAsDefault,
    sendReminder: useAsDefault,
    technicianArrival: useAsDefault,
    sendInvoice: Boolean(email),
    sendServiceReport: false,
    source: 'customer_primary',
  };
}

function contactRecipient(contact = {}, assignment = {}) {
  const whatsapp = normalizePhone(contact.whatsapp || contact.phone);
  const phone = normalizePhone(contact.phone || contact.whatsapp);
  const email = normalizeEmail(contact.email);
  if (!whatsapp && !phone && !email) return null;
  return {
    id: `contact-${contact.id}`,
    recipientType: 'contact',
    sourceId: contact.id,
    assignmentId: assignment.id,
    name: cleanText(contact.name, 180) || 'Contact',
    role: cleanText(assignment.role, 120) || 'Contact',
    phone,
    phoneCountry: cleanText(contact.phoneCountry, 20) || 'AW',
    whatsapp: whatsapp || phone,
    whatsappCountry: cleanText(contact.whatsappCountry || contact.phoneCountry, 20) || 'AW',
    email,
    preferredLanguage: cleanText(contact.preferredLanguage, 80) || 'Papiamento',
    linkedCustomerId: cleanText(contact.linkedCustomerId, 180),
    sendConfirmation: assignment.appointmentConfirmation === true,
    sendReminder: assignment.appointmentReminder === true,
    technicianArrival: assignment.technicianArrival === true,
    sendInvoice: assignment.invoice === true,
    sendServiceReport: assignment.serviceReport === true,
    source: 'canonical_contact_assignment',
  };
}

function selectionKey(value = {}) {
  const type = cleanText(value.recipientType, 40) === 'client' ? 'client' : 'contact';
  return `${type}:${cleanText(value.sourceId, 180)}`;
}

function applyRecipientSelections(recipients, selections) {
  if (!Array.isArray(selections) || !selections.length) return recipients;
  const byKey = new Map(selections.map((selection) => [selectionKey(selection), selection]));
  return recipients.map((recipient) => {
    const override = byKey.get(`${recipient.recipientType}:${recipient.sourceId}`);
    if (!override) return recipient;
    return {
      ...recipient,
      sendConfirmation: override.sendConfirmation === true,
      sendReminder: override.sendReminder === true,
    };
  });
}

async function clientCollectionSnapshot(db, collectionName, clientId) {
  const collection = db.collection(collectionName);
  if (typeof collection.where === 'function') return collection.where('clientId', '==', clientId).get();
  return collection.get();
}

async function resolveAppointmentRecipients(db, { clientId, propertyId, selections = [] }) {
  const customerRef = db.collection('clients').doc(clientId);
  const propertyRef = db.collection('properties').doc(propertyId);
  const [customerSnapshot, propertySnapshot, contactSnapshot, assignmentSnapshot] = await Promise.all([
    customerRef.get(),
    propertyRef.get(),
    clientCollectionSnapshot(db, CONTACT_COLLECTION, clientId),
    clientCollectionSnapshot(db, CONTACT_ASSIGNMENT_COLLECTION, clientId),
  ]);
  if (!customerSnapshot.exists || !propertySnapshot.exists) return [];
  const customer = { id: customerSnapshot.id || clientId, ...customerSnapshot.data() };
  const property = { id: propertySnapshot.id || propertyId, ...propertySnapshot.data() };
  const contacts = contactSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((contact) => contact.active !== false && cleanText(contact.clientId, 180) === clientId);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const relevantAssignments = assignmentSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((assignment) => assignment.active !== false
      && cleanText(assignment.clientId, 180) === clientId
      && (assignment.scope === 'all_properties' || cleanText(assignment.propertyId, 180) === propertyId));
  const linkedCustomerIds = [...new Set(relevantAssignments
    .map((assignment) => cleanText(contactById.get(assignment.contactId)?.linkedCustomerId, 180))
    .filter(Boolean))];
  const linkedCustomerSnapshots = await readDocumentSnapshots(
    db,
    linkedCustomerIds.map((linkedCustomerId) => db.collection('clients').doc(linkedCustomerId)),
  );
  const linkedCustomerById = new Map(linkedCustomerSnapshots
    .map((item, index) => item.exists && item.data()?.active !== false
      ? [linkedCustomerIds[index], { id: linkedCustomerIds[index], ...(item.data() || {}) }]
      : null)
    .filter(Boolean));
  const effective = new Map();
  relevantAssignments
    .sort((a, b) => Number(a.scope === 'property') - Number(b.scope === 'property'))
    .forEach((assignment) => effective.set(assignment.contactId, assignment));
  let contactRecipients = [...effective.values()]
    .map((assignment) => {
      const contact = contactById.get(assignment.contactId);
      if (!contact) return null;
      const linkedCustomerId = cleanText(contact.linkedCustomerId, 180);
      if (!linkedCustomerId) return contactRecipient(contact, assignment);
      const linkedCustomer = linkedCustomerById.get(linkedCustomerId);
      if (!linkedCustomer) return null;
      return contactRecipient(projectLinkedCustomerContact({ ...contact, linkedCustomerId }, linkedCustomer), assignment);
    })
    .filter(Boolean);
  if (!relevantAssignments.length && Array.isArray(property.contacts)) {
    contactRecipients = property.contacts.filter((contact) => contact?.active !== false).map(legacyContactRecipient).filter(Boolean);
  }
  const hasContactNoticeDefault = contactRecipients.some((recipient) => recipient.sendConfirmation || recipient.sendReminder);
  const primary = primaryCustomerRecipient(customer, !hasContactNoticeDefault);
  const recipients = [...(primary ? [primary] : []), ...contactRecipients];
  return applyRecipientSelections(recipients, selections);
}

module.exports = {
  CONTACT_ASSIGNMENT_COLLECTION,
  CONTACT_COLLECTION,
  applyRecipientSelections,
  assignmentIdFor,
  buildContactRecord,
  buildLinkedCustomerContactRecord,
  contactIdFor,
  linkedCustomerContactIdFor,
  normalizeContactLink,
  normalizeRules,
  projectLinkedCustomerContact,
  readDocumentSnapshots,
  resolveAppointmentRecipients,
  writeContactLinks,
};
