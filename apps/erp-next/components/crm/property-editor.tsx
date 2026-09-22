'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { BookingContact } from '@/lib/customer-contacts';
import { OfficeBookingRequestError } from '@/lib/office-booking-authority';
import { loadPropertyLocations, type LocationDraft, type PropertyLocationData } from '@/lib/property-locations';
import { changedDwellings, dwellingDrafts, dwellingTypeLabels, emptyPropertyEditor, newDwelling, validateDwellingDrafts, type DwellingDraft, type PropertyEditorValue } from '@/lib/property-editor-draft';
import { suggestArubaAddresses } from '@/lib/aruba-address-directory';
import { useDialogFocus } from './use-dialog-focus';
import { PropertyIcon } from './property-icons';
import styles from './property-editor.module.css';

type Props = {
  mode: 'create' | 'edit'; requestId: string; customerId: string; customerName: string;
  contacts: BookingContact[]; initial?: PropertyEditorValue; extraFields?: ReactNode;
  submitLabel?: string; validationMessage?: string;
  onClose: () => void; onSave: (value: PropertyEditorValue) => Promise<void>;
};
const iconFor = (type?: LocationDraft['type']) => type === 'main_office' ? 'office' : type === 'apartment' ? 'building' : 'house';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'No se pudo confirmar el guardado.';

/** One draft and one atomic save for the property and its independent units. */
export function PropertyEditor({ mode, requestId, customerId, customerName, contacts, initial, extraFields, submitLabel, validationMessage, onClose, onSave }: Props) {
  const [form, setForm] = useState<PropertyEditorValue>(initial ?? emptyPropertyEditor);
  const [data, setData] = useState<PropertyLocationData | null>(null);
  const [rows, setRows] = useState<DwellingDraft[]>([]);
  const [original, setOriginal] = useState<DwellingDraft[]>([]);
  const [areas, setAreas] = useState<LocationDraft[]>([]);
  const [multiple, setMultiple] = useState(false);
  const [principalType, setPrincipalType] = useState<'main_house' | 'main_office'>(initial?.type === 'Complejo de apartamentos' ? 'main_office' : 'main_house');
  const [expanded, setExpanded] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(mode === 'edit');
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<PropertyEditorValue | null>(null);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const titleId = useId();
  const addressListId = useId();
  const dialogRef = useDialogFocus(true, onClose, saving || uncertain);
  const load = useCallback(async () => {
    if (mode !== 'edit' || !initial?.id) return;
    const current = ++sequence.current;
    setLoading(true); setLoadFailed(false); setError('');
    try {
      const result = await loadPropertyLocations(customerId, initial.id);
      if (sequence.current !== current) return;
      setData(result);
      const drafts = dwellingDrafts(result);
      setRows(drafts); setOriginal(drafts); setMultiple(drafts.length > 0);
      const property = result.property;
      setForm({ id: property.id, expectedUpdatedAt: property.updatedAt, name: property.name || '', type: property.type || 'Casa', address: property.address || property.addressRaw || '', zone: property.zone || property.operationalZone || '', neighborhood: property.neighborhood || '', accessInstructions: property.accessInstructions || '', notes: property.notes || '' });
      setPrincipalType(drafts.some((row) => row.type === 'main_office') || property.type === 'Complejo de apartamentos' ? 'main_office' : 'main_house');
    } catch (cause) { if (sequence.current === current) { setError(message(cause)); setLoadFailed(true); } }
    finally { if (sequence.current === current) setLoading(false); }
  }, [customerId, initial?.id, mode]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  const update = <K extends keyof PropertyEditorValue>(key: K, value: PropertyEditorValue[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateRow = (key: string, patch: Partial<DwellingDraft>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  const apartments = rows.filter((row) => row.type === 'apartment').length;
  const existingApartments = rows.filter((row) => row.id && row.type === 'apartment').length;
  const main = rows.find((row) => row.type === principalType);
  const add = (type: NonNullable<LocationDraft['type']>) => setRows((current) => [...current, newDwelling(type, current)]);
  const setApartmentCount = (value: number) => {
    const count = Math.max(existingApartments, Math.min(99, Math.floor(Number.isFinite(value) ? value : 0)));
    setRows((current) => {
      let next = [...current];
      while (next.filter((row) => row.type === 'apartment').length < count) next.push(newDwelling('apartment', next));
      for (let index = next.length - 1; index >= 0 && next.filter((row) => row.type === 'apartment').length > count; index--) {
        if (next[index].type === 'apartment' && !next[index].id) next.splice(index, 1);
      }
      return next;
    });
  };
  const chooseDistribution = (value: boolean) => {
    if (!value && original.length) return;
    setMultiple(value);
    if (!value) { setRows([]); setExpanded(''); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || loading || loadFailed) return;
    const problem = validateDwellingDrafts(rows) || (multiple && !rows.length ? 'Añade al menos una vivienda o selecciona «Una sola unidad».' : '') || validationMessage;
    if (!pending.current && problem) { setError(problem); return; }
    const value = pending.current ?? { ...form, requestId, locations: { expectedVersion: data?.property.locationVersion || 0, rows: changedDwellings(rows, original), ...(areas.length ? { areas } : {}) } };
    pending.current = value;
    inFlight.current = true; setSaving(true); setError('');
    try { await onSave(value); pending.current = null; setUncertain(false); onClose(); }
    catch (cause) {
      const unknown = !(cause instanceof OfficeBookingRequestError) || cause.outcomeUnknown;
      if (!unknown) pending.current = null;
      setUncertain(unknown); setError(message(cause));
    } finally { inFlight.current = false; setSaving(false); }
  };
  const availableContacts = contacts.filter((contact) => contact.clientId === customerId && contact.active !== false);
  const filtered = rows.filter((row) => `${row.name} ${row.code}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const title = mode === 'create' ? 'Crear propiedad' : 'Editar propiedad';
  const blocked = saving || uncertain || loading || loadFailed;
  const principalLabel = dwellingTypeLabels[principalType];
  const suggestions = form.address.length > 1 ? suggestArubaAddresses(form.address, 6) : [];

  return <div className={styles.overlay}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={loading || saving}>
      <header className={styles.header}><div><span className={styles.eyebrow}>DEMAC · Propiedades</span><h2 id={titleId}>{title}</h2><p>Una dirección. Cada espacio, en su lugar.</p></div><button type="button" className={styles.iconButton} aria-label="Cerrar editor de propiedad" disabled={saving || uncertain} onClick={onClose}><PropertyIcon name="close" /></button></header>
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <div className={styles.body}>
          <fieldset className={styles.fieldset} disabled={blocked}>
            <section className={styles.left}>
              <div className={styles.sectionTitle}><PropertyIcon name="pin" /><h3>Datos de la propiedad</h3></div>
              <div className={styles.owner}><div className={styles.ownerAvatar}>{customerName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CL'}</div><div><small>Cliente / propietario</small><strong>{customerName || 'Nuevo cliente'}</strong></div></div>
              {extraFields}
              
              <div className={styles.fields}>
                <label className={`${styles.field} ${styles.full}`}><span>Nombre de la propiedad</span><input autoFocus value={form.name} maxLength={180} onChange={(event) => update('name', event.target.value)} placeholder="Ej. Morgenster Apartments" /></label>
                <label className={`${styles.field} ${styles.full}`}><span>Dirección completa *</span><input required value={form.address} list={addressListId} onChange={(event) => { const address = event.target.value; const match = suggestions.find((item) => item.canonical === address); setForm((current) => ({ ...current, address, ...(match ? { zone: match.operationalZone || current.zone, neighborhood: match.neighborhood || current.neighborhood } : {}) })); }} placeholder="Calle y número de propiedad" /><datalist id={addressListId}>{suggestions.map((suggestion) => <option key={suggestion.canonical} value={suggestion.canonical} />)}</datalist></label>
                <label className={styles.field}><span>Zona *</span><input required value={form.zone} onChange={(event) => update('zone', event.target.value)} placeholder="Ej. Oranjestad" /></label>
                
                <label className={styles.field}><span>Tipo de propiedad</span><select value={form.type} onChange={(event) => { update('type', event.target.value); setPrincipalType(event.target.value === 'Complejo de apartamentos' ? 'main_office' : 'main_house'); }}><option>Casa</option><option>Complejo de apartamentos</option><option>Apartamento</option><option>Oficina</option><option>Local comercial</option><option>Otro</option>{!['Casa', 'Complejo de apartamentos', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'].includes(form.type) ? <option>{form.type}</option> : null}</select></label>
              </div>
              <div className={styles.divider} />
              <div className={styles.sectionTitle}><PropertyIcon name="grid" /><h3>Distribución de la propiedad</h3></div>
              <div className={styles.choiceGrid}>
                {[false, true].map((value) => <button key={String(value)} type="button" className={styles.choice} aria-pressed={multiple === value} disabled={!value && original.length > 0} onClick={() => chooseDistribution(value)}><span className={styles.iconTile}><PropertyIcon name={value ? 'building' : 'house'} /></span><span><strong>{value ? 'Varias unidades' : 'Una sola unidad'}</strong><small>{value ? 'Apartamentos y anexos' : 'Casa, oficina o local'}</small></span>{multiple === value ? <span className={styles.selectionCheck}><PropertyIcon name="check" /></span> : null}</button>)}
              </div>
              {multiple ? <>
                <div className={styles.builder}>
                  <div className={styles.builderRow}><PropertyIcon name={iconFor(principalType)} /><label className={styles.principal}><select aria-label="Unidad principal" value={principalType} onChange={(event) => setPrincipalType(event.target.value as typeof principalType)}><option value="main_house">Casa principal</option><option value="main_office">Oficina principal</option></select></label><button type="button" className={styles.switch} role="switch" aria-label={`Incluir ${principalLabel.toLocaleLowerCase()}`} aria-checked={Boolean(main)} disabled={Boolean(main?.id)} onClick={() => main ? setRows(rows.filter((row) => row.key !== main.key)) : add(principalType)}><span /></button></div>
                  <div className={styles.builderRow}><span className={styles.builderLabel}><PropertyIcon name="building" />Apartamentos</span><div className={styles.stepper}><button type="button" aria-label="Quitar un apartamento nuevo" disabled={apartments <= existingApartments} onClick={() => setApartmentCount(apartments - 1)}><PropertyIcon name="minus" /></button><input aria-label="Cantidad de apartamentos" type="number" min={existingApartments} max={99} value={apartments} onChange={(event) => setApartmentCount(Number(event.target.value))} /><button type="button" aria-label="Añadir un apartamento" disabled={apartments >= 99} onClick={() => setApartmentCount(apartments + 1)}><PropertyIcon name="plus" /></button></div></div>
                  <div className={styles.builderBottom}><button type="button" className={styles.textButton} onClick={() => add('annex')}><PropertyIcon name="plus" />Añadir anexo</button></div>
                </div>
                <div className={styles.summary}><PropertyIcon name="check" /><div><strong>{rows.length} {rows.length === 1 ? 'unidad en esta propiedad' : 'unidades en esta propiedad'}</strong><small>{rows.filter((row) => row.type !== 'apartment').map((row) => row.name).join(' · ')}{apartments ? ` ${rows.some((row) => row.type !== 'apartment') ? '· ' : ''}${apartments} apartamento${apartments === 1 ? '' : 's'}` : ''}</small></div></div>
              </> : null}
              <p className={styles.optional}><PropertyIcon name="snow" />Los equipos A/C se pueden registrar después, dentro de cada espacio.</p>
              <details className={styles.disclosure}><summary>Barrio, acceso y notas de la propiedad</summary><div className={styles.fields}><label className={styles.field}><span>Barrio</span><input value={form.neighborhood} onChange={(event) => update('neighborhood', event.target.value)} placeholder="Opcional" /></label><label className={`${styles.field} ${styles.full}`}><span>Acceso, estacionamiento o portón</span><textarea rows={2} value={form.accessInstructions} onChange={(event) => update('accessInstructions', event.target.value)} /></label><label className={`${styles.field} ${styles.full}`}><span>Notas internas</span><textarea rows={2} value={form.notes} onChange={(event) => update('notes', event.target.value)} /></label></div></details>
              {mode === 'edit' && data ? <details className={styles.disclosure}><summary>Áreas generales y A/C sin vivienda</summary><LocationInventory customerId={customerId} propertyId={initial!.id!} dwellingId="" data={data} pendingAreas={areas} onAdd={(area) => setAreas((current) => [...current, area])} onRemove={(area) => setAreas((current) => current.filter((item) => item !== area))} /></details> : null}
            </section>
            <section className={styles.right}>
              <div className={styles.rightHeader}><div><div className={styles.sectionTitle}><PropertyIcon name="building" /><h3>Unidades de la propiedad</h3><span className={styles.badge}>{rows.length}</span></div><p className={styles.hint}>Nombre, código y acceso de cada espacio.</p></div><button type="button" className={styles.secondary} onClick={() => { setMultiple(true); add('apartment'); }}><PropertyIcon name="plus" />Añadir unidad</button></div>
              {loading ? <p role="status">Cargando la propiedad…</p> : multiple && rows.length ? <>
                <label className={styles.search}><PropertyIcon name="search" /><input aria-label="Buscar unidad" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o código…" /></label>
                <div className={styles.rows}>{filtered.map((row) => <article key={row.key} className={`${styles.dwelling} ${expanded === row.key ? styles.dwellingExpanded : ''}`}>
                  <div className={styles.dwellingHeader}><span className={styles.iconTile}><PropertyIcon name={iconFor(row.type)} /></span><div className={styles.dwellingLabel}><button type="button" aria-expanded={expanded === row.key} onClick={() => setExpanded(expanded === row.key ? '' : row.key)}>{row.name || 'Nueva unidad'}</button><small>{dwellingTypeLabels[row.type || 'apartment']}{row.contactIds?.length ? ` · ${row.contactIds.length} contacto${row.contactIds.length === 1 ? '' : 's'}` : ''}</small></div><label className={`${styles.code} ${styles.field}`}><span>Código</span><input aria-label={`Código de ${row.name}`} maxLength={180} value={row.code} onChange={(event) => updateRow(row.key, { code: event.target.value })} /></label><button type="button" className={styles.iconButton} aria-label={`Editar ${row.name}`} aria-expanded={expanded === row.key} onClick={() => setExpanded(expanded === row.key ? '' : row.key)}><PropertyIcon name="chevron" /></button></div>
                  {expanded === row.key ? <div className={styles.dwellingBody}><div className={styles.fields}><label className={styles.field}><span>Nombre de la unidad</span><input value={row.name} maxLength={180} onChange={(event) => updateRow(row.key, { name: event.target.value })} /></label><label className={styles.field}><span>Tipo de unidad</span><select value={row.type} onChange={(event) => updateRow(row.key, { type: event.target.value as LocationDraft['type'] })}>{Object.entries(dwellingTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
                    <div className={styles.fields}><div><label className={styles.field}><span>Contactos de esta unidad · opcional</span><select value="" onChange={(event) => { if (event.target.value) updateRow(row.key, { contactIds: [...(row.contactIds || []), event.target.value] }); }}><option value="">{availableContacts.length ? 'Añadir un contacto del cliente' : 'Sin contactos registrados todavía'}</option>{availableContacts.filter((contact) => !row.contactIds?.includes(contact.id)).map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label><div className={styles.contactChips}>{row.contactIds?.map((id) => <button className={styles.contactChip} type="button" key={id} aria-label={`Quitar contacto ${contacts.find((contact) => contact.id === id)?.name || id}`} onClick={() => updateRow(row.key, { contactIds: row.contactIds!.filter((item) => item !== id) })}><PropertyIcon name="person" />{contacts.find((contact) => contact.id === id)?.name || 'Contacto'}<PropertyIcon name="close" /></button>)}</div></div>
                    <label className={styles.field}><span>Indicaciones de acceso</span><textarea rows={2} value={row.accessInstructions || ''} onChange={(event) => updateRow(row.key, { accessInstructions: event.target.value })} placeholder="Ej. Entrada lateral, tocar el timbre 2" /></label></div>
                    {row.id && data ? <details className={styles.disclosure}><summary>Ver áreas y equipos A/C</summary><LocationInventory customerId={customerId} propertyId={initial!.id!} dwellingId={row.id} data={data} pendingAreas={areas} onAdd={(area) => setAreas((current) => [...current, area])} onRemove={(area) => setAreas((current) => current.filter((item) => item !== area))} /></details> : <button type="button" className={`${styles.textButton} ${styles.removeDraft}`} onClick={() => setRows(rows.filter((item) => item.key !== row.key))}><PropertyIcon name="close" />Quitar esta unidad nueva</button>}
                  </div> : null}
                </article>)}</div>{filtered.length === 0 ? <p className={styles.hint}>Ninguna unidad coincide con la búsqueda.</p> : null}
              </> : <div className={styles.empty}><span className={styles.iconTile}><PropertyIcon name={multiple ? 'building' : 'house'} /></span><strong>{multiple ? 'Cada unidad tiene su espacio' : 'Una propiedad, un solo espacio'}</strong><p>{multiple ? 'Incluye la casa u oficina principal y el número de apartamentos. Aparecerán aquí para personalizarlos.' : 'La dirección y los equipos pertenecen directamente a esta propiedad. Si tiene apartamentos o anexos, selecciona «Varias unidades».'}</p></div>}
            </section>
          </fieldset>
        </div>
        {error ? <div className={styles.error} role="alert">{error}{uncertain ? <p>El resultado no se ha confirmado. Reintenta el mismo guardado para recuperar el resultado sin duplicar la propiedad.</p> : null}{loadFailed ? <button type="button" className={styles.textButton} onClick={() => void load()}>Volver a cargar</button> : null}</div> : null}
        <footer className={styles.footer}><span className={styles.footerNote}><PropertyIcon name="check" />Todo se guarda en la misma propiedad</span><div className={styles.footerActions}><button type="button" className={styles.secondary} disabled={saving || uncertain} onClick={onClose}>Cancelar</button><button type="submit" className={styles.primary} disabled={saving || loading || loadFailed || !form.address.trim() || !form.zone.trim()}><PropertyIcon name={mode === 'create' ? 'plus' : 'check'} />{saving ? 'Guardando…' : uncertain ? 'Reintentar guardado' : submitLabel || (mode === 'create' ? 'Crear propiedad' : 'Guardar cambios')}</button></div></footer>
      </form>
    </section>
  </div>;
}

function LocationInventory({ customerId, propertyId, dwellingId, data, pendingAreas, onAdd, onRemove }: { customerId: string; propertyId: string; dwellingId: string; data: PropertyLocationData; pendingAreas: LocationDraft[]; onAdd: (area: LocationDraft) => void; onRemove: (area: LocationDraft) => void }) {
  const [equipment, setEquipment] = useState<PropertyLocationData['equipment']>();
  const [error, setError] = useState('');
  const [areaName, setAreaName] = useState('');
  const [areaCode, setAreaCode] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const details = parentRef.current?.closest('details');
    const toggle = () => { if (details?.open) setOpened(true); };
    toggle(); details?.addEventListener('toggle', toggle);
    return () => details?.removeEventListener('toggle', toggle);
  }, []);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    loadPropertyLocations(customerId, propertyId, dwellingId).then((result) => { if (active) setEquipment(result.equipment || []); }).catch((cause) => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [customerId, propertyId, dwellingId, opened]);
  const persisted = data.areas.filter((area) => area.dwellingId === dwellingId);
  const drafts = pendingAreas.filter((area) => area.dwellingId === dwellingId);
  return <div ref={parentRef} className={styles.inventory}>
    <strong>Áreas del espacio</strong><ul>{persisted.map((area) => <li key={area.id}><PropertyIcon name="grid" />{area.name} · {area.code}</li>)}{drafts.map((area, index) => <li key={index}><PropertyIcon name="grid" />{area.name} · {area.code}<button type="button" className={styles.textButton} aria-label={`Quitar área nueva ${area.name}`} onClick={() => onRemove(area)}>×</button></li>)}</ul>
    <div className={styles.addArea}><label className={styles.field}><span>Nombre del área</span><input value={areaName} onChange={(event) => setAreaName(event.target.value)} placeholder="Ej. Sala" /></label><label className={styles.field}><span>Código del área</span><input value={areaCode} onChange={(event) => setAreaCode(event.target.value)} placeholder="Ej. SALA" /></label><button type="button" className={styles.secondary} disabled={!areaName.trim() || !areaCode.trim()} onClick={() => { onAdd({ name: areaName.trim(), code: areaCode.trim(), dwellingId }); setAreaName(''); setAreaCode(''); }}><PropertyIcon name="plus" />Área</button></div>
    <div className={styles.divider} /><strong>Equipos A/C {equipment ? `· ${equipment.length}` : ''}</strong>
    {error ? <p role="alert" className={styles.error}>{error}</p> : equipment ? <ul>{equipment.map((item) => <li key={item.id}><PropertyIcon name="snow" /><span>{item.locationLabel || item.brand || 'A/C'} · {item.capacityBtu || item.btu || '—'} BTU<br /><small>{data.areas.find((area) => area.id === item.areaId)?.name || 'Área sin clasificar'}</small></span></li>)}{!equipment.length ? <li>Sin equipos registrados.</li> : null}</ul> : <p className={styles.hint}>Cargando equipos…</p>}
    <p className={styles.hint}>El técnico registra los equipos durante la visita.</p>
  </div>;
}
