import { saveFirestoreDocument } from './firebase/firestore-rest';
import {
  invalidateLiveSchedulingReferenceCache,
  loadLiveSchedulingReferenceData,
  type LiveSchedulingClient,
  type LiveSchedulingProperty,
  type LiveSchedulingReferenceData,
} from './live-scheduling-fast';

export type BookingCustomer = LiveSchedulingClient;
export type BookingProperty = LiveSchedulingProperty;
export type BookingReferenceData = Pick<LiveSchedulingReferenceData, 'clients' | 'properties'>;

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
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function compactId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function comparable(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9+]/g, '');
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
  const references = await loadLiveSchedulingReferenceData();
  return {
    clients: references.clients.filter((client) => client.active !== false),
    properties: references.properties.filter((property) => property.active !== false),
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

  const now = new Date().toISOString();
  const clientId = compactId('client');
  const propertyId = compactId('property');
  const customer: BookingCustomer = {
    id: clientId,
    name,
    company: text(args.customer.company) || undefined,
    phone,
    phoneCountry: 'AW',
    whatsapp,
    whatsappCountry: 'AW',
    email: text(args.customer.email) || undefined,
    preferredLanguage: text(args.customer.preferredLanguage) || 'Papiamento',
    address,
    zone,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const property: BookingProperty = {
    id: propertyId,
    clientId,
    name: text(args.property.name) || 'Primary Property',
    type: text(args.property.type) || 'Casa',
    address,
    addressRaw: address,
    addressNormalized: address,
    neighborhood: text(args.property.neighborhood) || undefined,
    zone,
    operationalZone: zone,
    notes: text(args.property.notes) || undefined,
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  await saveFirestoreDocument('clients', customer);
  try {
    await saveFirestoreDocument('properties', property);
  } catch (error) {
    invalidateLiveSchedulingReferenceCache();
    throw new Error(`${error instanceof Error ? error.message : 'The property could not be saved.'} The customer was created, but the property was not. Select the new customer and add its property before booking.`);
  }
  invalidateLiveSchedulingReferenceCache();
  return { customer, property };
}

export async function createBookingProperty(clientId: string, input: NewBookingProperty) {
  const ownerId = text(clientId);
  const address = text(input.address);
  const zone = text(input.zone);
  if (!ownerId) throw new Error('Select a customer before adding a property.');
  if (!address) throw new Error('Property address is required.');
  if (!zone) throw new Error('Property area / zone is required.');

  const now = new Date().toISOString();
  const property: BookingProperty = {
    id: compactId('property'),
    clientId: ownerId,
    name: text(input.name) || 'Property',
    type: text(input.type) || 'Casa',
    address,
    addressRaw: address,
    addressNormalized: address,
    neighborhood: text(input.neighborhood) || undefined,
    zone,
    operationalZone: zone,
    notes: text(input.notes) || undefined,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await saveFirestoreDocument('properties', property);
  invalidateLiveSchedulingReferenceCache();
  return property;
}
