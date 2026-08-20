'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SCHEDULING_WORK_TYPES,
  formatSchedulingDuration,
  loadSchedulingWorkTypes,
  saveSchedulingWorkTypes,
  type SchedulingWorkType,
  type SchedulingWorkTypeKind,
} from '@/lib/scheduling-work-types';

const builtInIds = new Set(DEFAULT_SCHEDULING_WORK_TYPES.map((item) => item.id));

function normalizeOrder(items: SchedulingWorkType[]) {
  return items.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }));
}

function minutesFromHours(value: number) {
  const safe = Number.isFinite(value) ? value : 1;
  return Math.max(60, Math.min(720, Math.round(safe * 2) * 30));
}

export function SchedulingWorkTypesSettings() {
  const [items, setItems] = useState<SchedulingWorkType[]>(DEFAULT_SCHEDULING_WORK_TYPES.map((item) => ({ ...item })));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCount = useMemo(() => items.filter((item) => item.active !== false).length, [items]);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await loadSchedulingWorkTypes());
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const patch = (id: string, changes: Partial<SchedulingWorkType>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
    setDirty(true);
    setMessage('');
  };

  const move = (id: string, direction: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return normalizeOrder(next);
    });
    setDirty(true);
    setMessage('');
  };

  const addCustom = () => {
    const id = `custom_work_${Date.now()}`;
    setItems((current) => normalizeOrder([
      ...current,
      { id, label: 'New Work Type', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: (current.length + 1) * 10 },
    ]));
    setDirty(true);
    setMessage('New Work Type added. Rename it before saving.');
  };

  const restoreDefaults = () => {
    setItems(DEFAULT_SCHEDULING_WORK_TYPES.map((item) => ({ ...item })));
    setDirty(true);
    setMessage('Standard eight Work Types restored locally. Save to apply.');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = await saveSchedulingWorkTypes(items);
      setItems(next);
      setDirty(false);
      setMessage('Scheduling Work Types saved. New appointments will use this list immediately.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="panel sg-setting-card" style={{ gridColumn: '1 / -1' }}>
      <header>
        <div><span>Scheduling · Canonical</span><h2>Appointment Work Types</h2></div>
        <b>{activeCount} active</b>
      </header>

      <div className="sg-runtime-note">
        <strong>Fast agenda categories — not the commercial Service Catalog</strong>
        <p>These are the only quick choices shown in New Appointment → Work & Allocation. BTU-specific services remain in Services & Products for pricing, estimates and reporting, but they do not belong in the scheduling picker. The technician can confirm BTU/equipment details on site.</p>
      </div>

      {error ? <div className="sg-runtime-note"><strong>Unable to update Work Types</strong><p>{error}</p></div> : null}
      {message ? <div className="sg-runtime-note"><strong>Scheduling settings</strong><p>{message}</p></div> : null}

      <div style={{ display: 'grid', gap: 8, padding: 12 }}>
        {items.map((item, index) => {
          const manual = item.id === 'other' || item.manualDuration === true;
          return (
            <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(210px,1.6fr) minmax(135px,.75fr) minmax(150px,.8fr) 90px 116px', gap: 9, alignItems: 'end', padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
              <label>
                <span>Work Type</span>
                <input value={item.label} onChange={(event) => patch(item.id, { label: event.target.value })} />
                <small>{builtInIds.has(item.id) ? `Built-in · ${item.id}` : `Custom · ${item.id}`}</small>
              </label>

              <label>
                <span>{manual ? 'Appointment duration' : 'Time / unit (hours)'}</span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  step="0.5"
                  disabled={manual}
                  value={item.durationMinutesPerUnit / 60}
                  onChange={(event) => patch(item.id, { durationMinutesPerUnit: minutesFromHours(Number(event.target.value) || 1) })}
                />
                <small>{manual ? 'Entered manually on each appointment' : formatSchedulingDuration(item.durationMinutesPerUnit)}</small>
              </label>

              <label>
                <span>Category</span>
                <select value={item.kind} onChange={(event) => patch(item.id, { kind: event.target.value as SchedulingWorkTypeKind })} disabled={manual}>
                  <option value="service">Service</option>
                  <option value="installation">Installation</option>
                  <option value="commercial">Commercial</option>
                  <option value="other">Other</option>
                </select>
                <small>Operational grouping only</small>
              </label>

              <label>
                <span>Active</span>
                <input type="checkbox" checked={item.active !== false} onChange={(event) => patch(item.id, { active: event.target.checked })} />
                <small>{item.active !== false ? 'Shown' : 'Hidden'}</small>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                <button className="btn" type="button" disabled={index === 0 || loading || saving} onClick={() => move(item.id, -1)}>↑</button>
                <button className="btn" type="button" disabled={index === items.length - 1 || loading || saving} onClick={() => move(item.id, 1)}>↓</button>
                <small style={{ gridColumn: '1 / -1' }}>Picker order</small>
              </div>
            </div>
          );
        })}
      </div>

      <div className="page-actions" style={{ padding: '0 12px 12px', justifyContent: 'space-between' }}>
        <div className="page-actions">
          <button className="btn" type="button" disabled={loading || saving} onClick={addCustom}>＋ Add Work Type</button>
          <button className="btn" type="button" disabled={loading || saving} onClick={restoreDefaults}>Restore standard 8</button>
          <button className="btn" type="button" disabled={loading || saving || dirty} onClick={() => void refresh()}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        <button className="btn primary" type="button" disabled={loading || saving || !dirty} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Work Types'}</button>
      </div>

      <div className="sg-runtime-note">
        <strong>Other is intentionally different</strong>
        <p>When Other is selected in an appointment, the office chooses the scheduled hours manually. That appointment-specific value never changes the master duration of another Work Type.</p>
      </div>
    </article>
  );
}
