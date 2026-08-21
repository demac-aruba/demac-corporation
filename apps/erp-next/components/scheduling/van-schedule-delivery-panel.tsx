'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import { firebaseClientConfig } from '../../lib/firebase/client-config';
import { requireFirebaseWebSession } from '../../lib/firebase/session';
import { currentArubaDateKey } from '../../lib/scheduling-capacity';

export type VanScheduleGroup = {
  vanId: string;
  sourceVanId?: string;
  vanName: string;
  groupName: string;
  groupJid: string;
  enabled: boolean;
  configured: boolean;
};

type GroupResponse = { success: true; version: number; groups: VanScheduleGroup[] };
type SendResponse = {
  success: true;
  dateKey: string;
  vanCount: number;
  workOrderCount: number;
  messageCount: number;
  results: Array<{ queued: boolean; created?: boolean; vanId?: string; groupName?: string; workOrderId?: string; reason?: string }>;
};

const EXPECTED_GROUP_NAMES: Record<string, string> = {
  'VAN-1': 'TEC - Miguel',
  'VAN-2': 'Gollo y Walter',
  'VAN-3': 'TEC - Mario y Ronald',
  'VAN-4': 'TEC - Alejandro y Edwin',
};

async function callAuthority<T>(action: string, data: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/officeBookingAuthority`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || 'Van schedule operation failed.');
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function VanScheduleDeliveryPanel() {
  const { principal } = useAuth();
  const canManage = principal.active && principal.capabilities.has('scheduling.manage');
  const [groups, setGroups] = useState<VanScheduleGroup[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dateKey, setDateKey] = useState(() => currentArubaDateKey());
  const [vanId, setVanId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const configuredCount = useMemo(() => groups.filter((group) => group.configured && group.enabled).length, [groups]);

  const load = async () => {
    if (!canManage) return;
    setError('');
    try {
      const result = await callAuthority<GroupResponse>('get_van_schedule_groups', {}, 10_000);
      setGroups(result.groups.map((group) => ({ ...group, groupName: group.groupName || EXPECTED_GROUP_NAMES[group.vanId] || group.vanName })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Van WhatsApp groups could not be loaded.');
    }
  };

  useEffect(() => { void load(); }, [canManage]);

  if (!canManage) return null;

  const save = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await callAuthority<GroupResponse>('save_van_schedule_groups', {
        groups: groups.map((group) => ({ vanId: group.vanId, groupName: group.groupName, groupJid: group.groupJid.trim(), enabled: group.enabled })),
      });
      setGroups(result.groups);
      setEditing(false);
      setMessage('Van WhatsApp groups saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Van WhatsApp groups could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const targetLabel = vanId ? vanId.replace('VAN-', 'Van ') : 'all configured vans';
    if (!window.confirm(`Send the ${dateKey} work schedule now to ${targetLabel}? Each Work Order will be a separate WhatsApp group message.`)) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await callAuthority<SendResponse>('send_van_schedules_now', {
        dateKey,
        ...(vanId ? { vanId } : {}),
        requestId: requestId('van-schedule-manual'),
      }, 30_000);
      const failed = result.results.filter((item) => !item.queued);
      setMessage(`${result.messageCount} work message${result.messageCount === 1 ? '' : 's'} processed for ${result.workOrderCount} Work Order${result.workOrderCount === 1 ? '' : 's'}${failed.length ? ` · ${failed.length} failed` : ' · queued successfully'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Van schedules could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ padding: '11px 13px', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <strong style={{ display: 'block', fontSize: 12 }}>WhatsApp Van Schedules</strong>
          <span style={{ color: 'var(--muted)', fontSize: 10 }}>8:00 AM automatic delivery · one message per Work Order · {configuredCount}/4 van groups configured</span>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <input aria-label="Schedule date" type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} disabled={busy} style={{ minHeight: 34 }} />
          <select aria-label="Target van" value={vanId} onChange={(event) => setVanId(event.target.value)} disabled={busy} style={{ minHeight: 34 }}>
            <option value="">All vans</option>
            {[1, 2, 3, 4].map((number) => <option key={number} value={`VAN-${number}`}>Van {number}</option>)}
          </select>
          <button type="button" onClick={() => setEditing((value) => !value)} disabled={busy}>{editing ? 'Close Groups' : 'Configure Groups'}</button>
          <button type="button" onClick={() => void send()} disabled={busy || configuredCount === 0}>{busy ? 'Working…' : 'Send Now'}</button>
        </div>
      </div>

      {editing ? <div style={{ borderTop: '1px solid var(--border)', padding: 12, display: 'grid', gap: 8 }}>
        {groups.map((group, index) => <div key={group.vanId} style={{ display: 'grid', gridTemplateColumns: '90px minmax(160px,1fr) minmax(260px,2fr) 80px', gap: 8, alignItems: 'center' }}>
          <strong>{group.vanId.replace('VAN-', 'Van ')}</strong>
          <input value={group.groupName} onChange={(event) => setGroups((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, groupName: event.target.value } : item))} placeholder={EXPECTED_GROUP_NAMES[group.vanId]} />
          <input value={group.groupJid} onChange={(event) => setGroups((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, groupJid: event.target.value } : item))} placeholder="WhatsApp Group JID · …@g.us" autoCapitalize="none" autoCorrect="off" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}><input type="checkbox" checked={group.enabled} onChange={(event) => setGroups((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} /> Active</label>
        </div>)}
        <div><button type="button" onClick={() => void save()} disabled={busy || !groups.length}>{busy ? 'Saving…' : 'Save Group Mapping'}</button></div>
      </div> : null}

      {message ? <div style={{ padding: '8px 13px', borderTop: '1px solid var(--border)', color: 'var(--success, #157347)', fontSize: 10, fontWeight: 700 }}>{message}</div> : null}
      {error ? <div style={{ padding: '8px 13px', borderTop: '1px solid var(--border)', color: 'var(--danger)', fontSize: 10, fontWeight: 700 }}>{error}</div> : null}
    </section>
  );
}
