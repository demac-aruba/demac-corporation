import type { BookingContact, BookingContactAssignment, NewBookingContactLink } from './customer-contacts';
import {
  createOfficeCustomerWithProperty,
  createOfficeLifecycleRequestId,
  createOfficeProperty,
  listOfficeContactDirectory,
} from './office-booking-authority';
import {
  loadLiveSchedulingReferenceData,
  primeLiveSchedulingReferenceCache,
  type LiveSchedulingClient,
  type LiveSchedulingProperty,
} from './live-scheduling-fast';

export type BookingCustomer = LiveSchedulingClient;
export type BookingProperty = LiveSchedulingProperty;
export type BookingReferenceData = {
  clients: BookingCustomer[];
  properties: BookingProperty[];
  contacts: BookingContact[];
  contactAssignments: BookingContactAssignment[];
};

export type NewBookingCustomer = {
  name: string;
  company?: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  preferredLanguage?: string;
};

export type NewBookingProperty = {
  name: string;
  type?: string;
  address: string;
  zone: string;
  neighborhood?: string;
  notes?: string;
  contactLinks?: NewBookingContactLink[];
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function comparable(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9+]/g, '');
}

function recordTime(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentCustomersFirst(a: BookingCustomer, b: BookingCustomer) {
  const aTime = Math.max(recordTime(a.updatedAt), recordTime(a.createdAt));
  const bTime = Math.max(recordTime(b.updatedAt), recordTime(b.createdAt));
  if (aTime !== bTime) return bTime - aTime;
  return (text(a.company) || text(a.name) || a.id).localeCompare(text(b.company) || text(b.name) || b.id);
}

export function normalizeBookingPhone(value: string) {
  const raw = text(value);
  if (!raw) return '';
  const plus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (plus && digits) return `+${digits}`;
  if (digits.length === 7) return `+297${digits}`;
  return digits ? `+${digits}` : raw;
}

export async function loadBookingReferenceData(): Promise<BookingReferenceData> {
  const [references, directory] = await Promise.all([
    loadLiveSchedulingReferenceData(),
    listOfficeContactDirectory(),
  ]);
  return {
    // The empty search state only renders a short list. Put the newest canonical
    // CRM relationships first so a customer created during booking remains visible
    // when the user opens a different day/slot immediately afterward.
    clients: references.clients.filter((client) => client.active !== false).sort(recentCustomersFirst),
    properties: references.properties.filter((property) => property.active !== false),
    contacts: (directory.contacts ?? []).filter((contact) => contact.active !== false),
    contactAssignments: (directory.assignments ?? []).filter((assignment) => assignment.active !== false),
  };
}

function assertCustomerDoesNotDuplicate(input: NewBookingCustomer, references: BookingReferenceData) {
  const phone = comparable(normalizeBookingPhone(input.phone));
  const whatsapp = comparable(normalizeBookingPhone(input.whatsapp || input.phone));
  const duplicate = references.clients.find((client) => {
    const candidatePhone = comparable(client.phone);
    const candidateWhatsapp = comparable(client.whatsapp);
    return Boolean(
      (phone && (candidatePhone === phone || candidateWhatsapp === phone))
      || (whatsapp && (candidatePhone === whatsapp || candidateWhatsapp === whatsapp)),
    );
  });
  if (duplicate) {
    throw new Error(`A customer with this phone or WhatsApp already exists: ${text(duplicate.name) || text(duplicate.company) || duplicate.id}. Select the existing customer instead.`);
  }
}

export async function createBookingCustomerWithProperty(args: {
  customer: NewBookingCustomer;
  property: NewBookingProperty;
  references: BookingReferenceData;
}) {
  const name = text(args.customer.name);
  const phone = normalizeBookingPhone(args.customer.phone);
  const whatsapp = normalizeBookingPhone(args.customer.whatsapp || args.customer.phone);
  const address = text(args.property.address);
  const zone = text(args.property.zone);
  if (!name) throw new Error('Customer name is required.');
  if (!phone) throw new Error('Customer phone / WhatsApp is required.');
  if (!address) throw new Error('The first property address is required.');
  if (!zone) throw new Error('The property area / zone is required.');
  assertCustomerDoesNotDuplicate(args.customer, args.references);

  const result = await createOfficeCustomerWithProperty({
    requestId: createOfficeLifecycleRequestId('schedule-customer'),
    customer: {
      name,
      company: text(args.customer.company),
      phone,
      whatsapp,
      email: text(args.customer.email),
      preferredLanguage: text(args.customer.preferredLanguage) || 'Papiamento',
    },
    property: {
      name: text(args.property.name) || 'Primary Property',
      type: text(args.property.type) || 'Casa',
      address,
      zone,
      neighborhood: text(args.property.neighborhood),
      notes: text(args.property.notes),
      contactLinks: args.property.contactLinks ?? [],
    },
  });

  const customer = result.customer as unknown as BookingCustomer;
  const property = result.property as unknown as BookingProperty;
  // The Cloud Function returns only after the Firestore transaction commits. Keep
  // that confirmed master data in the short-lived reference cache instead of
  // invalidating it and making booking success depend on a second list request.
  primeLiveSchedulingReferenceCache({ clients: [customer], properties: [property] });
  return { customer, property };
}

export async function createBookingProperty(clientId: string, input: NewBookingProperty) {
  const ownerId = text(clientId);
  const address = text(input.address);
  const zone = text(input.zone);
  if (!ownerId) throw new Error('Select a customer before adding a property.');
  if (!address) throw new Error('Property address is required.');
  if (!zone) throw new Error('Property area / zone is required.');

  const result = await createOfficeProperty({
    requestId: createOfficeLifecycleRequestId('schedule-property'),
    customerId: ownerId,
    property: {
      name: text(input.name) || 'Property',
      type: text(input.type) || 'Casa',
      address,
      zone,
      neighborhood: text(input.neighborhood),
      notes: text(input.notes),
      contactLinks: input.contactLinks ?? [],
    },
  });

  const property = result.property as unknown as BookingProperty;
  primeLiveSchedulingReferenceCache({ properties: [property] });
  return property;
}
