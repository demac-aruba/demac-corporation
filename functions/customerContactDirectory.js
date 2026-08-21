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
  const input = link.contact || {};
  const contactId = existingContactId || contactIdFor(clientId, input);
  const role = cleanText(link.role, 120) || 'Contact';
  return {
    contactId,
    existingContactId,
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

  // Firestore transactions require every read to happen before the first write.
  // Resolve both contact and assignment snapshots first, then apply writes in a second pass.
  const prepared = [];
  for (const item of normalized) {
    const contactRef = db.collection(CONTACT_COLLECTION).doc(item.contactId);
    const assignmentRef = db.collection(CONTACT_ASSIGNMENT_COLLECTION).doc(item.assignment.id);
    const [contactSnapshot, assignmentSnapshot] = await Promise.all([
      transaction.get(contactRef),
      transaction.get(assignmentRef),
    ]);

    if (item.existingContactId) {
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

    const contact = item.existingContactId
      ? null
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
      transaction.set(
        entry.contactRef,
        entry.contactSnapshot.exists
          ? { ...entry.contact, createdAt: entry.contactSnapshot.data()?.createdAt || now }
          : entry.contact,
        { merge: true },
      );
    }
    transaction.set(entry.assignmentRef, entry.assignment, { merge: true });
  }

  return prepared.map((entry) => ({ contactId: entry.item.contactId, assignmentId: entry.assignment.id }));
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
  const effective = new Map();
  relevantAssignments
    .sort((a, b) => Number(a.scope === 'property') - Number(b.scope === 'property'))
    .forEach((assignment) => effective.set(assignment.contactId, assignment));
  let contactRecipients = [...effective.values()]
    .map((assignment) => contactRecipient(contactById.get(assignment.contactId), assignment))
    .filter(Boolean);
  if (!contactRecipients.length && Array.isArray(property.contacts)) {
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
  contactIdFor,
  normalizeContactLink,
  normalizeRules,
  resolveAppointmentRecipients,
  writeContactLinks,
};
