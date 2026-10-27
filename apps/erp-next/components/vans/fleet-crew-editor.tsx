'use client';
import { useEffect, useRef, useState } from 'react';
import { officeBookingOutcomeUnknown } from '@/lib/office-booking-authority';
import { loadVanRoster, rosterCrewChanged, saveVanRoster, type VanRoster, type VanRosterRequest, type VanRosterRow } from '@/lib/van-roster';
import { weekdayLabel } from '@/lib/canonical-operations';
import styles from './advanced-vans-workspace.module.css';

export function FleetCrewEditor({ userId, onSaved }: { userId: string; onSaved: () => Promise<void> }) {
  const [roster, setRoster] = useState<VanRoster | null>(null);
  const [rows, setRows] = useState<VanRosterRow[]>([]);
  const [pending, setPending] = useState<VanRosterRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const saving = useRef(false);
  const generation = useRef(0);
  const storageKey = `demac-van-roster-pending-v1:${userId}`;
  const dirty = Boolean(pending || roster && rosterCrewChanged(rows, roster.rows));

  useEffect(() => {
    let active = true;
    const version = ++generation.current;
    setRoster(null); setRows([]); setPending(null); setError(''); setMessage('');
    let retained: VanRosterRequest | null = null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        retained = JSON.parse(raw) as VanRosterRequest;
        if (!retained.requestId || !retained.expectedToken || !Array.isArray(retained.rows)) throw Error('Unreadable pending save');
        setPending(retained);
      }
    } catch { setError('No se pudo leer el guardado pendiente. No vuelvas a guardar hasta revisar el resultado.'); return () => { active = false; }; }
    void loadVanRoster().then(result => {
      if (!active || generation.current !== version) return;
      setRoster(result); setRows(retained ? retained.rows : result.rows);
      if (retained) setMessage('Hay un guardado pendiente de confirmar. Reintenta la misma operación para conocer su resultado.');
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function reload() {
    if (busy || pending) return;
    if (dirty && !window.confirm('¿Descartar el borrador de equipos y cargar la distribución guardada?')) return;
    setBusy(true); setError('');
    const version = generation.current;
    try { const result = await loadVanRoster(); if (version === generation.current) { setRoster(result); setRows(result.rows); setMessage(''); } }
    catch (cause) { if (version === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (version === generation.current) setBusy(false); }
  }

  function change(id: string, key: 'responsibleStaffId' | 'regularHelperId' | 'additionalHelperId', value: string) {
    if (busy || pending) return;
    setRows(current => current.map(row => row.id === id ? { ...row, [key]: value } : row));
    setError(''); setMessage('');
  }
  async function save() {
    if (!roster || saving.current || !dirty) return;
    saving.current = true; setBusy(true); setError(''); setMessage('');
    const version = generation.current;
    const request = pending || { expectedToken: roster.token, effectiveDate: roster.effectiveDate, requestId: crypto.randomUUID(), rows };
    let sent = false;
    try {
      // Retain the exact request before dispatch. An uncertain response must never create a new transfer.
      sessionStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request); sent = true;
      const result = await saveVanRoster(request);
      if (version !== generation.current) return;
      try { sessionStorage.removeItem(storageKey); }
      catch {
        setError('El guardado fue confirmado, pero este navegador no pudo cerrar el reintento pendiente. Reintenta la misma operación para confirmar; no se repetirá el traslado.');
        return;
      }
      setPending(null);
      setRoster(current => current ? { ...current, rows: request.rows } : current);
      setMessage(`Equipos guardados desde ${result.effectiveDate}. ${result.changedVans} vans actualizadas y ${result.updatedWorkOrders} trabajos pendientes sincronizados.`);
      try {
        const fresh = await loadVanRoster();
        if (version === generation.current) { setRoster(fresh); setRows(fresh.rows); await onSaved(); }
      } catch { if (version === generation.current) setError('El guardado fue confirmado. Actualiza la vista para cargar la distribución vigente.'); }
    } catch (cause) {
      if (version !== generation.current) return;
      const unknown = sent && officeBookingOutcomeUnknown(cause);
      if (!unknown) {
        try { sessionStorage.removeItem(storageKey); setPending(null); }
        catch { setError('No se pudo cerrar el reintento en este navegador. Conserva esta ventana y confirma el mismo guardado.'); return; }
      }
      setError(`${cause instanceof Error ? cause.message : String(cause)}${unknown ? ' El resultado no está confirmado. Reintenta este mismo guardado; el borrador queda protegido.' : ''}`);
    } finally { saving.current = false; if (version === generation.current) setBusy(false); }
  }
  return <section className={styles.fleetEditor} aria-label="Fleet crew editor" id="fleet-crew-editor">
    <div className={styles.fleetEditorHead}><div><span className={styles.eyebrow}>Fleet crew planning</span><h2>Organiza todos los equipos</h2><p>Mueve técnicos y ayudantes entre vans y guarda una sola vez. Cada empleado hereda el día parcial de su nueva van desde hoy.</p></div>
      <span className={dirty ? styles.unsaved : styles.readonlyControl}>{dirty ? 'Cambios pendientes' : 'Distribución guardada'}</span></div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {message && <div className={styles.success} role="status">{message}</div>}
    {!roster ? <p>Cargando equipos…</p> : <div className={styles.fleetRows}>{rows.map(row => <div className={styles.fleetRow} key={row.id}>
      <div><strong>{row.name}</strong><small>{row.status}</small><small>Día parcial: {row.schedule?.active ? `${weekdayLabel(row.schedule.weekday)} · ${row.schedule.workdayStart}–${row.schedule.workdayEnd}` : 'Sin configurar'}</small></div>
      {(['responsibleStaffId', 'regularHelperId', 'additionalHelperId'] as const).map((key, index) => <label key={key}>
        <span>{['Técnico responsable / conductor', 'Ayudante', 'Tercer integrante (opcional)'][index]}</span>
        <select aria-label={`${row.name} ${['responsable', 'ayudante', 'tercer integrante'][index]}`} className={styles.control} value={row[key]} onChange={event => change(row.id, key, event.target.value)} disabled={busy || Boolean(pending)}>
          <option value="">Sin asignar</option>
          {roster.staff.filter(person => index !== 0 || person.canDriveVan).map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
        </select>
      </label>)}
    </div>)}</div>}
    <div className={styles.fleetEditorFooter}><p>Se valida la distribución final. Los trabajos terminados y la asistencia registrada conservan su historial.</p><div>
      <button type="button" className={styles.ghostButton} disabled={busy || Boolean(pending)} onClick={() => void reload()}>Recargar / descartar</button>
      <button type="button" className={styles.primaryButton} disabled={busy || !roster || !dirty} onClick={() => void save()}>{busy ? 'Guardando…' : pending ? 'Confirmar guardado pendiente' : 'Guardar todos los cambios'}</button>
    </div></div>
  </section>;
}
