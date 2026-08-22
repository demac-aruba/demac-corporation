'use client';

import { useEffect, useMemo, useState } from 'react';
import { type CanonicalVanHalfDaySchedule, weekdayLabel } from '../../lib/canonical-operations';
import { listFirestoreCollection } from '../../lib/firebase/firestore-rest';

function vanLabel(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.toUpperCase().match(/^VAN[-_ ]?([1-4])$/);
  return match ? `Van ${match[1]}` : raw || 'Van';
}

export function VanHalfDayPolicyBanner() {
  const [rules, setRules] = useState<CanonicalVanHalfDaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void listFirestoreCollection<CanonicalVanHalfDaySchedule>('vanHalfDaySchedules', 250)
      .then((items) => {
        if (cancelled) return;
        setRules(items.filter((item) => item.active !== false));
        setError('');
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Van half-day policy could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const summary = useMemo(() => [...rules]
    .sort((left, right) => Number(left.weekday ?? 99) - Number(right.weekday ?? 99) || vanLabel(left.vanId).localeCompare(vanLabel(right.vanId)))
    .map((rule) => `${vanLabel(rule.vanId)} · ${weekdayLabel(rule.weekday)} PM off`), [rules]);

  return (
    <section
      aria-label="Weekly van half-day policy"
      style={{
        margin: '0 0 10px',
        padding: '9px 12px',
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface-1, transparent)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <strong style={{ fontSize: 11, color: 'var(--text)' }}>Van half-days</strong>
      <span style={{ fontSize: 10, fontWeight: 750, color: error ? 'var(--danger)' : 'var(--warning)' }}>
        {loading ? 'Loading canonical van schedule…' : error ? `Schedule policy unavailable · ${error}` : summary.length ? summary.join('  ·  ') : 'No active van half-days configured'}
      </span>
      {!loading && !error ? <small style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--muted)' }}>Technicians & helpers inherit their assigned Van schedule.</small> : null}
    </section>
  );
}
