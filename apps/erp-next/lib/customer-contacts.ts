export type ContactScope = 'property' | 'all_properties';

export type ContactCommunicationRules = {
  appointmentConfirmation: boolean;
  appointmentReminder: boolean;
  technicianArrival: boolean;
  invoice: boolean;
  serviceReport: boolean;
};

export type BookingContact = {
  id: string;
  clientId: string;
  name: string;
  phone?: string;
  phoneCountry?: string;
  whatsapp?: string;
  whatsappCountry?: string;
  email?: string;
  preferredLanguage?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type BookingContactAssignment = ContactCommunicationRules & {
  id: string;
  clientId: string;
  contactId: string;
  scope: ContactScope;
  propertyId?: string;
  role: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type NewBookingContactLink = ContactCommunicationRules & {
  contactId?: string;
  contact?: {
    name: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    preferredLanguage?: string;
  };
  scope: ContactScope;
  role: string;
};

export type AppointmentRecipientSelection = {
  recipientType: 'client' | 'contact';
  sourceId: string;
  sendConfirmation: boolean;
  sendReminder: boolean;
};

export type ResolvedPropertyContact = {
  contact: BookingContact;
  assignment: BookingContactAssignment;
};

export const defaultContactCommunicationRules: ContactCommunicationRules = {
  appointmentConfirmation: false,
  appointmentReminder: true,
  technicianArrival: true,
  invoice: false,
  serviceReport: false,
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function effectiveAssignmentsForProperty(
  assignments: BookingContactAssignment[],
  clientId: string,
  propertyId: string,
) {
  const relevant = assignments.filter((assignment) => assignment.active !== false
    && assignment.clientId === clientId
    && (assignment.scope === 'all_properties' || assignment.propertyId === propertyId));
  const byContact = new Map<string, BookingContactAssignment>();
  relevant
    .sort((a, b) => Number(a.scope === 'property') - Number(b.scope === 'property'))
    .forEach((assignment) => byContact.set(assignment.contactId, assignment));
  return [...byContact.values()];
}

export function resolvedContactsForProperty(
  contacts: BookingContact[],
  assignments: BookingContactAssignment[],
  clientId: string,
  propertyId: string,
): ResolvedPropertyContact[] {
  const contactById = new Map(contacts.filter((contact) => contact.active !== false && contact.clientId === clientId).map((contact) => [contact.id, contact]));
  return effectiveAssignmentsForProperty(assignments, clientId, propertyId)
    .map((assignment) => ({ contact: contactById.get(assignment.contactId), assignment }))
    .filter((item): item is ResolvedPropertyContact => Boolean(item.contact));
}

export function customerContacts(contacts: BookingContact[], clientId: string) {
  return contacts.filter((contact) => contact.clientId === clientId && contact.active !== false)
    .sort((a, b) => text(a.name).localeCompare(text(b.name)));
}

export function contactDisplayChannel(contact: BookingContact) {
  return text(contact.whatsapp) || text(contact.phone) || text(contact.email) || 'No communication channel';
}

export function communicationBadges(rules: ContactCommunicationRules) {
  const badges: string[] = [];
  if (rules.appointmentConfirmation) badges.push('Confirmation');
  if (rules.appointmentReminder) badges.push('Reminder');
  if (rules.technicianArrival) badges.push('Arrival');
  if (rules.invoice) badges.push('Invoice');
  if (rules.serviceReport) badges.push('Service report');
  return badges;
}
