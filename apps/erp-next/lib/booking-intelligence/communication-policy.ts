export type CommunicationPurpose = 'confirmation' | 'reminder' | 'arrival' | 'billing';

export type CommunicationContact = {
  id: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  preferredLanguage?: string;
  primary?: boolean;
  sendConfirmationDefault?: boolean;
  sendReminderDefault?: boolean;
  arrivalContact?: boolean;
  billingContact?: boolean;
};

export type CommunicationRecipient = {
  contactId: string;
  name: string;
  phone?: string;
  email?: string;
  preferredLanguage?: string;
  reason: string;
};

function hasChannel(contact: CommunicationContact) {
  return Boolean(contact.phone?.trim() || contact.email?.trim());
}

export function selectCommunicationRecipients(
  contacts: CommunicationContact[],
  purpose: CommunicationPurpose,
): CommunicationRecipient[] {
  const usable = contacts.filter(hasChannel);
  if (!usable.length) return [];
  let selected: CommunicationContact[] = [];
  if (purpose === 'confirmation') selected = usable.filter((contact) => contact.sendConfirmationDefault);
  if (purpose === 'reminder') selected = usable.filter((contact) => contact.sendReminderDefault);
  if (purpose === 'arrival') selected = usable.filter((contact) => contact.arrivalContact);
  if (purpose === 'billing') selected = usable.filter((contact) => contact.billingContact);
  if (!selected.length) selected = usable.filter((contact) => contact.primary);
  if (!selected.length) selected = [usable[0]];
  return selected.map((contact) => ({
    contactId: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    preferredLanguage: contact.preferredLanguage,
    reason: purpose === 'arrival'
      ? contact.arrivalContact ? 'Property arrival contact' : 'Primary contact fallback'
      : purpose === 'billing'
        ? contact.billingContact ? 'Billing contact' : 'Primary contact fallback'
        : purpose === 'confirmation'
          ? contact.sendConfirmationDefault ? 'Confirmation preference' : 'Primary contact fallback'
          : contact.sendReminderDefault ? 'Reminder preference' : 'Primary contact fallback',
  }));
}

export function shouldNotifyCustomerForScheduleChange(args: {
  oldDate: string;
  oldStart: string;
  newDate: string;
  newStart: string;
  primaryVanChanged?: boolean;
}) {
  if (args.oldDate !== args.newDate) return { recommended: true, reason: 'Promised service date changed' };
  if (args.oldStart !== args.newStart) return { recommended: true, reason: 'Promised service time changed' };
  if (args.primaryVanChanged) return { recommended: false, reason: 'Internal van reassignment only; promised date/time is unchanged' };
  return { recommended: false, reason: 'No customer-facing schedule change' };
}
