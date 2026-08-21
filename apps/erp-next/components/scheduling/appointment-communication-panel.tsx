'use client';

import { useEffect, useState } from 'react';
import {
  createOfficeLifecycleRequestId,
  getOfficeAppointmentCommunication,
  sendOfficeAppointmentCommunication,
  updateOfficeAppointmentReminderRecipient,
  type OfficeAppointmentCommunication,
  type OfficeAppointmentCommunicationRecipient,
  type OfficeCommunicationPurpose,
  type OfficeRecipientCommunicationState,
} from '../../lib/office-booking-authority';
import styles from './scheduling-overview-v2.module.css';

function stateLabel(value?: string) {
  switch (String(value || '').toLowerCase()) {
    case 'not_requested': return 'Not requested';
    case 'not_sent': return 'Not sent yet';
    case 'closed': return 'Closed';
    case 'queued': return 'Queued';
    case 'processing': return 'Sending';
    case 'accepted':
    case 'sent': return 'Sent';
    case 'delivered': return 'Delivered';
    case 'read': return 'Read';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    case 'partial': return 'Partial';
    case 'missing': return 'Status unavailable';
    default: return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not recorded';
  }
}

function isSuccessful(value?: string) {
  return ['accepted', 'sent', 'delivered', 'read'].includes(String(value || '').toLowerCase());
}

function isActive(value?: string) {
  return ['queued', 'processing'].includes(String(value || '').toLowerCase());
}

function purposeTitle(purpose: OfficeCommunicationPurpose) {
  return purpose === 'confirmation' ? 'Confirmation' : 'Reminder';
}

function lifecycleBadge(purpose: OfficeCommunicationPurpose, state: OfficeRecipientCommunicationState) {
  if (purpose === 'confirmation' && state.state === 'closed') return 'CLOSED AFTER REMINDER';
  if (purpose === 'confirmation') return state.selected ? 'REQUESTED AT BOOKING' : 'NOT REQUESTED';
  return state.selected ? 'AUTOMATIC ON' : 'AUTOMATIC OFF';
}

function policyCopy(purpose: OfficeCommunicationPurpose, state: OfficeRecipientCommunicationState) {
  if (purpose === 'confirmation' && state.state === 'closed') {
    return state.blockedReason === 'reminder-in-progress'
      ? 'The confirmation phase is closed because the reminder is already in progress.'
      : 'The confirmation phase is closed because the reminder has already been sent.';
  }
  if (purpose === 'confirmation') {
    return state.selected ? 'Requested when this appointment was booked.' : 'Not requested by the operator for this appointment.';
  }
  return state.selected ? 'Automatic reminder is enabled for this contact.' : 'Automatic reminder is not enabled for this contact.';
}

function stateCopy(purpose: OfficeCommunicationPurpose, state: OfficeRecipientCommunicationState) {
  if (state.state === 'closed') return 'No confirmation can be sent after the reminder lifecycle has started. Previous attempts remain in the audit history only.';
  if (state.state === 'not_requested') return 'No message is expected unless an operator sends one manually.';
  if (state.state === 'not_sent') {
    return purpose === 'reminder' && state.selected
      ? 'Selected for the automatic reminder; no send attempt has been created yet.'
      : 'Selected for this communication, but no send attempt has been created yet.';
  }
  if (state.state === 'queued') return 'The message is waiting in the shared WhatsApp queue.';
  if (state.state === 'processing') return 'wacli is processing this message.';
  if (isSuccessful(state.state)) return state.manual ? 'Sent manually through the DEMAC WhatsApp queue.' : 'Sent successfully through the DEMAC WhatsApp queue.';
  if (state.state === 'failed') return state.lastError ? `Latest requested attempt failed: ${state.lastError}` : 'The latest requested attempt failed.';
  if (state.state === 'cancelled') return 'The queued attempt was cancelled.';
  return `Current status: ${stateLabel(state.state)}.`;
}

function sendButtonLabel(purpose: OfficeCommunicationPurpose, state: OfficeRecipientCommunicationState) {
  const title = purposeTitle(purpose);
  if (state.state === 'closed') return `${title} Closed`;
  if (isSuccessful(state.state)) return `${title} Sent`;
  if (isActive(state.state)) return `${title} ${stateLabel(state.state)}`;
  return `Send ${title} Now`;
}

function PurposeCard({
  recipient,
  purpose,
  busy,
  onSend,
  onToggleReminder,
}: {
  recipient: OfficeAppointmentCommunicationRecipient;
  purpose: OfficeCommunicationPurpose;
  busy: boolean;
  onSend: (recipientId: string, purpose: OfficeCommunicationPurpose) => Promise<void>;
  onToggleReminder: (recipient: OfficeAppointmentCommunicationRecipient) => Promise<void>;
}) {
  const state = recipient[purpose];
  const successful = isSuccessful(state.state);
  return <div style={{ border: '1px solid var(--border)', borderRadius: 9, padding: 9, background: 'var(--surface)', display: 'grid', gap: 6 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
      <div>
        <span style={{ color: 'var(--muted)', fontSize: 6.2, fontWeight: 750, textTransform: 'uppercase' }}>{purposeTitle(purpose)}</span>
        <strong style={{ display: 'block', marginTop: 3, fontSize: 7.2 }}>{stateLabel(state.state)}</strong>
      </div>
      <span style={{ fontSize: 5.8, color: state.state === 'closed' ? 'var(--muted)' : state.selected ? 'var(--brand)' : 'var(--muted)', fontWeight: 750 }}>
        {lifecycleBadge(purpose, state)}
      </span>
    </div>
    <span style={{ color: 'var(--muted)', fontSize: 5.8, lineHeight: 1.45 }}>{policyCopy(purpose, state)}</span>
    <span style={{ fontSize: 5.9, lineHeight: 1.45, color: state.state === 'failed' ? 'var(--danger)' : 'var(--text)' }}>{stateCopy(purpose, state)}</span>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 2 }}>
      {purpose === 'reminder' ? <button
        type="button"
        className={styles.secondary}
        disabled={busy || successful || isActive(state.state)}
        onClick={() => void onToggleReminder(recipient)}
      >{state.selected ? 'Turn Automatic Reminder Off' : 'Turn Automatic Reminder On'}</button> : null}
      <button
        type="button"
        className={styles.primary}
        disabled={busy || !state.canSendNow}
        onClick={() => void onSend(recipient.id, purpose)}
      >{sendButtonLabel(purpose, state)}</button>
    </div>
  </div>;
}

export function AppointmentCommunicationPanel({ appointmentId }: { appointmentId: string }) {
  const [communication, setCommunication] = useState<OfficeAppointmentCommunication | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setCommunication(null);
    setError('');
    void getOfficeAppointmentCommunication(appointmentId)
      .then((value) => { if (active) setCommunication(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Communication status could not be loaded.'); });
    return () => { active = false; };
  }, [appointmentId]);

  const sendNow = async (recipientId: string, purpose: OfficeCommunicationPurpose) => {
    const key = `${recipientId}:${purpose}:send`;
    if (busyKey) return;
    const title = purposeTitle(purpose).toLowerCase();
    if (!window.confirm(`Send this appointment ${title} now through the DEMAC WhatsApp queue?`)) return;
    setBusyKey(key);
    setError('');
    try {
      const next = await sendOfficeAppointmentCommunication({
        appointmentId,
        recipientId,
        purpose,
        requestId: createOfficeLifecycleRequestId(`manual-${purpose}`),
      });
      setCommunication(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `The appointment ${title} could not be queued manually.`);
    } finally {
      setBusyKey('');
    }
  };

  const toggleReminder = async (recipient: OfficeAppointmentCommunicationRecipient) => {
    const key = `${recipient.id}:reminder:policy`;
    if (busyKey) return;
    setBusyKey(key);
    setError('');
    try {
      const next = await updateOfficeAppointmentReminderRecipient({
        appointmentId,
        recipientId: recipient.id,
        enabled: !recipient.reminder.selected,
        requestId: createOfficeLifecycleRequestId('reminder-recipient-preference'),
      });
      setCommunication(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The reminder preference could not be updated.');
    } finally {
      setBusyKey('');
    }
  };

  return <section className={styles.formSection}>
    <header><strong>Customer communication</strong><span>Per-recipient policy and actual WhatsApp delivery state.</span></header>
    {communication ? <div style={{ padding: 11, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <div><strong style={{ display: 'block', fontSize: 7 }}>WhatsApp communication</strong><span style={{ display: 'block', color: 'var(--muted)', fontSize: 5.7, marginTop: 2 }}>Uses the canonical Work Order recipient snapshot and shared wacli queue.</span></div>
        <span style={{ fontSize: 5.9, fontWeight: 800, color: communication.whatsappEnabled ? 'var(--brand)' : 'var(--muted)' }}>{communication.whatsappEnabled ? 'AUTOMATIC COMMUNICATION ACTIVE' : 'NO AUTOMATIC COMMUNICATION SELECTED'}</span>
      </div>
      {communication.recipients.length ? communication.recipients.map((recipient) => <div key={recipient.id} style={{ border: '1px solid var(--border)', borderRadius: 11, background: 'var(--surface-2)', padding: 10, display: 'grid', gap: 9 }}>
        <div>
          <strong style={{ display: 'block', fontSize: 7.4 }}>{recipient.name || recipient.phone}</strong>
          <span style={{ display: 'block', color: 'var(--muted)', fontSize: 5.8, marginTop: 3 }}>{recipient.role || 'Contact'}{recipient.phone ? ` · ${recipient.phone}` : ''}{recipient.preferredLanguage ? ` · ${recipient.preferredLanguage}` : ''}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
          <PurposeCard recipient={recipient} purpose="confirmation" busy={Boolean(busyKey)} onSend={sendNow} onToggleReminder={toggleReminder} />
          <PurposeCard recipient={recipient} purpose="reminder" busy={Boolean(busyKey)} onSend={sendNow} onToggleReminder={toggleReminder} />
        </div>
      </div>) : <div className={styles.descriptionPreview}><span>NO RECIPIENT SNAPSHOT</span><strong>This appointment does not have a canonical WhatsApp recipient saved.</strong></div>}
    </div> : <div className={styles.descriptionPreview}><span>COMMUNICATION STATUS</span><strong>{error || 'Loading confirmation and reminder status…'}</strong></div>}
    {error && communication ? <div className={styles.descriptionPreview}><span>COMMUNICATION ATTENTION</span><strong>{error}</strong></div> : null}
  </section>;
}
