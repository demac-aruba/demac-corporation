'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createOfficeLifecycleRequestId, OfficeBookingRequestError } from '@/lib/office-booking-authority';
import { loadPropertyLocations, savePropertyLocations, type LocationDraft, type PropertyLocationData } from '@/lib/property-locations';
import type { BookingContact } from '@/lib/customer-contacts';
import styles from './property-locations.module.css';

type Props = {
  customerId: string; propertyId: string; contacts: BookingContact[]; booking?: boolean; selectedId?: string;
  onSelect?: (id: string) => void;
  onLoaded?: (data: PropertyLocationData | null) => void;
};
export function PropertyLocations({ customerId, propertyId, contacts, booking = false, selectedId = '', onSelect, onLoaded }: Props) {
  const [data, setData] = useState<PropertyLocationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const [rows, setRows] = useState<LocationDraft[] | null>(null);
  const [kind, setKind] = useState<'dwellings' | 'areas'>('dwellings');
  const [count, setCount] = useState(1);
  const [includeHouse, setIncludeHouse] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef<Parameters<typeof savePropertyLocations>[0] | null>(null);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const loadedCallback = useRef(onLoaded); loadedCallback.current = onLoaded;
  const selected = booking ? selectedId : localSelection;
  const reload = useCallback(async (equipmentId?: string) => {
    const current = ++sequence.current;
    setLoading(true); setError(''); loadedCallback.current?.(null);
    try {
      const next = await loadPropertyLocations(customerId, propertyId, equipmentId);
      if (current !== sequence.current) return;
      setData(next); loadedCallback.current?.(next);
    } catch (cause) {
      if (current === sequence.current) setError(cause instanceof Error ? cause.message : 'Unable to load locations. Retry safely.');
    } finally { if (current === sequence.current) setLoading(false); }
  }, [customerId, propertyId]);
  useEffect(() => { void reload(); return () => { sequence.current++; }; }, [reload]);
  const choose = (id: string) => { setLocalSelection(id); onSelect?.(id); if (!booking) void reload(id); };
  const availableContacts = contacts.filter((contact) => contact.clientId === customerId && contact.active !== false);
  const dwelling = data?.dwellings.find((item) => item.id === selected);
  const currentAreas = data?.areas.filter((item) => item.dwellingId === (selected || '')) ?? [];
  const generate = () => {
    const quantity = Math.max(1, Math.min(99, count));
    setKind('dwellings'); setError(''); setNotice(''); pending.current = null;
    setRows([
      ...(includeHouse ? [{ code: 'MAIN', name: 'Main house', type: 'main_house' as const, contactIds: [] }] : []),
      ...Array.from({ length: quantity }, (_, index) => ({ code: String(index + 1), name: `Apartment ${index + 1}`, type: 'apartment' as const, contactIds: [] })),
    ]);
  };
  const update = (index: number, patch: Partial<LocationDraft>) => setRows((current) => current?.map((row, i) => i === index ? { ...row, ...patch } : row) ?? null);
  const save = async () => {
    if (!data || !rows?.length || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError('');
    const input = pending.current ?? {
      requestId: createOfficeLifecycleRequestId('property-location'), customerId, propertyId,
      expectedVersion: data.property.locationVersion || 0, kind, rows,
    };
    pending.current = input;
    try {
      const result = await savePropertyLocations(input);
      pending.current = null; setUncertain(false); setRows(null);
      setNotice(`${result.ids.length} ${kind === 'dwellings' ? 'dwelling(s)' : 'area(s)'} saved.`);
      if (kind === 'dwellings' && result.ids.length === 1) { onSelect?.(result.ids[0]); setLocalSelection(result.ids[0]); }
      await reload(booking ? undefined : kind === 'dwellings' && result.ids.length === 1 ? result.ids[0] : selected ?? undefined);
    } catch (cause) {
      const knownRejection = cause instanceof OfficeBookingRequestError && !cause.outcomeUnknown;
      if (knownRejection) pending.current = null;
      setUncertain(!knownRejection);
      setError(cause instanceof Error ? cause.message : 'Save could not be confirmed. Retry the same request.');
    } finally { inFlight.current = false; setSaving(false); }
  };
  const patchContact = (contactId: string, checked: boolean) => {
    const ids = rows?.[0]?.contactIds ?? [];
    update(0, { contactIds: checked ? [...ids, contactId] : ids.filter((id) => id !== contactId) });
  };

  return <section className={styles.panel} aria-label="Property dwellings and areas" aria-busy={loading || saving}>
    <header className={styles.header}><div><h4>{booking ? 'Select dwelling' : 'Dwellings, areas & A/C'}</h4><p>{data ? `${data.dwellings.length} dwelling(s) · ${data.areas.length} area(s)` : 'Loading property locations…'}</p></div><button type="button" disabled={saving || uncertain} onClick={() => void reload(booking ? undefined : selected ?? undefined)}>Reload</button></header>
    {error ? <div role="alert" className={styles.error}>{error}{uncertain ? <p>The outcome is unknown. Retry the same request to recover; the draft is preserved.</p> : null}</div> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {data && !data.dwellings.length ? <p>This is a simple property. Independent dwellings are optional; existing A/C records remain accessible.</p> : null}
    {data && data.dwellings.length > 0 ? <>
      <label>Find dwelling<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or apartment number" /></label>
      <div className={styles.list}>{data.dwellings.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(query.toLowerCase())).map((item) => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => choose(item.id)} disabled={saving || uncertain}><strong>{item.name}</strong><small>{item.code} · {item.type.replaceAll('_', ' ')}</small></button>)}</div>
      {booking && !dwelling ? <p>Select a dwelling explicitly before checking availability.</p> : null}
    </> : null}
    {!booking ? <button type="button" aria-pressed={selected === ''} onClick={() => choose('')}>Property areas / unclassified A/C</button> : null}
    <details><summary>Add independent dwellings</summary><div className={styles.draft}><p>Add apartments or annexes to this same property. Review every code before saving.</p><div className={styles.grid}><label>Number of apartments<input type="number" min="1" max="99" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label><label><span>Include main house</span><input type="checkbox" checked={includeHouse} onChange={(event) => setIncludeHouse(event.target.checked)} /></label></div><button type="button" disabled={saving || uncertain || !data || loading} onClick={generate}>Review {count + Number(includeHouse)} dwellings</button></div></details>
    {dwelling ? <div className={styles.actions}><p>{dwelling.accessInstructions || 'Access instructions pending'}</p><button type="button" disabled={saving || uncertain} onClick={() => { setKind('dwellings'); setRows([{ ...dwelling, contactIds: data?.assignments.filter((item) => item.dwellingId === dwelling.id).map((item) => item.contactId) ?? [] }]); pending.current = null; }}>Edit dwelling & contacts</button></div> : null}
    {rows ? <div className={styles.draft}>
      <h4>Review {rows.length} {kind === 'dwellings' ? 'dwelling(s)' : 'area(s)'}</h4>
      <fieldset disabled={saving || uncertain} style={{ border: 0, padding: 0, minWidth: 0 }}><div className={styles.scroll}>{rows.map((row, index) => <div className={styles.row} key={index}><label>Code<input value={row.code} onChange={(event) => update(index, { code: event.target.value })} /></label><label>Name<input value={row.name} onChange={(event) => update(index, { name: event.target.value })} /></label>{kind === 'dwellings' ? <label>Type<select aria-label="Dwelling type" value={row.type} onChange={(event) => update(index, { type: event.target.value as LocationDraft['type'] })}><option value="apartment">Apartment</option><option value="main_house">Main house</option><option value="annex">Annex</option></select></label> : null}<button type="button" onClick={() => setRows(rows.filter((_, i) => i !== index))} aria-label={`Remove row ${index + 1}`}>×</button></div>)}</div>
      {rows.length === 1 && kind === 'dwellings' ? <><label>Access instructions<textarea value={rows[0].accessInstructions || ''} onChange={(event) => update(0, { accessInstructions: event.target.value })} /></label><p>Existing customer contacts · optional</p><div className={styles.contacts}>{availableContacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={rows[0].contactIds?.includes(contact.id) || false} onChange={(event) => patchContact(contact.id, event.target.checked)} />{contact.name}</label>)}</div></> : null}</fieldset>
      <div className={styles.actions}><button type="button" disabled={saving || !rows.length || rows.some((row) => !row.name.trim() || !row.code.trim())} onClick={() => void save()}>{saving ? 'Saving…' : uncertain ? 'Retry same save' : 'Save locations'}</button><button type="button" disabled={saving || uncertain} onClick={() => { setRows(null); pending.current = null; }}>Cancel</button></div>
    </div> : null}
    {!booking && selected !== null ? <><div className={styles.header}><h4>{dwelling?.name || 'Property'} · areas</h4><button type="button" disabled={saving || uncertain || loading} onClick={() => { setKind('areas'); setRows([{ code: '', name: '', dwellingId: selected || '' }]); pending.current = null; }}>+ Add area</button></div><ul className={styles.equipment}>{currentAreas.map((area) => <li key={area.id}><strong>{area.name}</strong><small> · {area.code}</small></li>)}</ul><h4>Registered A/C · {data?.equipment?.length ?? 0}</h4>{loading ? <p>Loading equipment…</p> : <ul className={styles.equipment}>{data?.equipment?.map((item) => <li key={item.id}><strong>{item.locationLabel || 'A/C'}</strong> · {item.brand || item.systemType} · {item.capacityBtu || item.btu || '—'} BTU<p>{data.areas.find((area) => area.id === item.areaId)?.name || 'Area not classified'} · {item.id}</p></li>)}</ul>}<p>New A/C equipment is registered through the assigned technical visit. No equipment is created when adding dwellings.</p></> : null}
  </section>;
}
