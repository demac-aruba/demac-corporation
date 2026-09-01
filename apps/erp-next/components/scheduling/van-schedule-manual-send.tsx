'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import { currentArubaDateKey } from '../../lib/scheduling-capacity';
import {
  getVanScheduleGroupSettings,
  sendVanSchedulesNow,
  type VanScheduleGroupSetting,
} from '../../lib/van-schedule-settings';

function requestId() {
  return `van-schedule-manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function VanScheduleManualSend() {
  const { principal } = useAuth();
  const canManage = principal.active && principal.capabilities.has('scheduling.manage');
  const [groups, setGroups] = useState<VanScheduleGroupSetting[]>([]);
  const [dateKey, setDateKey] = useState(() => currentArubaDateKey());
  const [vanId, setVanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const enabledGroups = useMemo(
    () => groups.filter((group) => group.enabled && group.configured),
    [groups],
  );

  useEffect(() => {
    if (!canManage) return;
    void getVanScheduleGroupSettings()
      .then((result) => setGroups(result.groups))
      .catch(() => {
        // Sending remains available; the authority validates the current canonical Van configuration.
      });
  }, [canManage]);

  if (!canManage) return null;

  const send = async () => {
    const target = groups.find((group) => group.vanId === vanId);
    const targetLabel = vanId ? target?.vanName || target?.groupName || vanId : 'all vans';
    if (!window.confirm(`Send the ${dateKey} work schedule now to ${targetLabel}? Each Work Order will be sent as a separate WhatsApp group message.`)) return;

    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await sendVanSchedulesNow({
        dateKey,
        ...(vanId ? { vanId } : {}),
        requestId: requestId(),
      });
      const failed = result.results.filter((item) => !item.queued);
      setMessage(
        `${result.messageCount} message${result.messageCount === 1 ? '' : 's'} processed for ${result.workOrderCount} Work Order${result.workOrderCount === 1 ? '' : 's'}${failed.length ? ` · ${failed.length} failed` : ' · queued successfully'}.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Van schedules could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ padding: '4px 14px 0' }}>
      <div style={{ minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
        <strong style={{ marginRight: 'auto', fontSize: 10.5 }}>WhatsApp Schedule</strong>
        {enabledGroups.length ? <span style={{ color: 'var(--muted)', fontSize: 9 }}>{enabledGroups.length} groups ready</span> : null}
        <input aria-label="Schedule date" type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} disabled={busy} style={{ minHeight: 30, height: 30 }} />
        <select aria-label="Target van" value={vanId} onChange={(event) => setVanId(event.target.value)} disabled={busy} style={{ minHeight: 30, height: 30 }}>
          <option value="">All vans</option>
          {groups.map((group) => <option key={group.vanId} value={group.vanId}>{group.vanName || group.vanId} · {group.configured && group.enabled ? 'ready' : 'not configured'}</option>)}
        </select>
        <button type="button" onClick={() => void send()} disabled={busy} style={{ minHeight: 30, height: 30, padding: '0 10px' }}>
          {busy ? 'Sending…' : 'Send Now'}
        </button>
      </div>
      {message ? <div style={{ padding: '3px 0', color: 'var(--success, #157347)', fontSize: 9, fontWeight: 700, textAlign: 'right' }}>{message}</div> : null}
      {error ? <div style={{ padding: '3px 0', color: 'var(--danger)', fontSize: 9, fontWeight: 700, textAlign: 'right' }}>{error}</div> : null}
    </section>
  );
}
