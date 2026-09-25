'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFieldProcedureSummary, isFieldProcedureTemporaryFailure, updateFieldProcedurePart } from '../../lib/field-authority';
import type { FieldPartCommand, FieldProcedurePart, FieldProcedureSummary, FieldProcedureTarget } from '../../lib/field-procedure-contract';
import { PortalIcon, fieldPortalStyles } from './field-portal-chrome';
import styles from './field-part-selector.module.css';
import { FieldProcedureWorkspace } from './field-procedure-workspace';

type Pending = { command: FieldPartCommand; requestId: string };
const descriptions = {
  indoor:'Carita, filtros, blower, coil, bandeja y área de trabajo',
  outdoor:'Presión, switch, coil, bracket, Armaflex y cubierta del lineset',
};
function UnitIllustration({ part }: { part: FieldProcedurePart }) {
  // Illustrative symbols, not a fabricated photo of the customer's equipment.
  if (part === 'indoor') return <PortalIcon name="unit" />;
  return <svg viewBox="0 0 60 52" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="5" width="52" height="40" rx="4" /><circle cx="25" cy="25" r="15" /><circle cx="25" cy="25" r="4" /><path d="M25 10v11m0 8v11M10 25h11m8 0h11M15 15l7 7m6 6 7 7M15 35l7-7m6-6 7-7M46 14h5m-5 5h5M10 45v4m37-4v4" /></svg>;
}
export function FieldPartSelector({ target, equipmentLabel, equipmentDescription, onBack, onOpenAddons }: {
  target: FieldProcedureTarget; equipmentLabel: string; equipmentDescription: string; onBack: () => void; onOpenAddons?: () => void;
}) {
  const identityKey = JSON.stringify([target.ownerUserId,target.visitId,target.interventionId,target.assetId]);
  // The keyed child synchronously discards old-user/context data, before effects run.
  return <PartSelectorSession key={identityKey} target={target} equipmentLabel={equipmentLabel} equipmentDescription={equipmentDescription} onBack={onBack} onOpenAddons={onOpenAddons} />;
}
function PartSelectorSession({ target, equipmentLabel, equipmentDescription, onBack, onOpenAddons }: {
  target: FieldProcedureTarget; equipmentLabel: string; equipmentDescription: string; onBack: () => void; onOpenAddons?: () => void;
}) {
  const [snapshot,setSnapshot] = useState<FieldProcedureSummary | null>(null);
  const [selected,setSelected] = useState<FieldProcedurePart | null>(null);
  const [openPart,setOpenPart] = useState<FieldProcedurePart | null>(null);
  const [fresh,setFresh] = useState(false),[loading,setLoading] = useState(true),[busy,setBusy] = useState(false);
  const [error,setError] = useState(''),[notice,setNotice] = useState(''),[reason,setReason] = useState('');
  const [retry,setRetry] = useState<Pending | null>(null);
  const requestVersion = useRef(0), alive = useRef(true), writeLock = useRef(false);
  const currentTarget = useRef(target).current;
  const load = useCallback(async () => {
    if (writeLock.current || !alive.current) return;
    const version = ++requestVersion.current;
    setLoading(true); setFresh(false);
    try {
      const next = await getFieldProcedureSummary(currentTarget);
      if (!alive.current || version !== requestVersion.current) return;
      setSnapshot(next); setFresh(navigator.onLine && document.visibilityState === 'visible'); setError('');
    } catch (e) {
      if (!alive.current || version !== requestVersion.current) return;
      if (!isFieldProcedureTemporaryFailure(e)) setSnapshot(null);
      setError(e instanceof Error ? e.message : 'No se pudo confirmar la coordinación.');
    } finally { if (alive.current && version === requestVersion.current) setLoading(false); }
  },[currentTarget]);
  useEffect(() => {
    alive.current = true; void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); },30_000);
    const disconnected = () => { requestVersion.current += 1; setFresh(false); setLoading(false); };
    const visible = () => { if (document.visibilityState === 'visible') void load(); else disconnected(); };
    window.addEventListener('online',load); window.addEventListener('offline',disconnected); document.addEventListener('visibilitychange',visible);
    return () => { alive.current=false; requestVersion.current += 1; window.clearInterval(timer); window.removeEventListener('online',load); window.removeEventListener('offline',disconnected); document.removeEventListener('visibilitychange',visible); };
  },[load]);
  async function mutate(command: FieldPartCommand, original?: Pending) {
    if (writeLock.current || !alive.current || (!fresh && !original)) return;
    const pending = original || {command,requestId:`field-part-${crypto.randomUUID()}`};
    writeLock.current = true; const mutationVersion = ++requestVersion.current; setBusy(true); setFresh(false); setError(''); setNotice('');
    try {
      const next = await updateFieldProcedurePart(currentTarget,pending.command,pending.requestId);
      if (!alive.current) return;
      setSnapshot(next); setFresh(mutationVersion === requestVersion.current && navigator.onLine && document.visibilityState === 'visible'); setRetry(null); setReason('');
      setNotice(command.action==='claim_part' ? 'Parte asignada por el servidor. No se inició ni se cerró el servicio.' : command.action==='release_part' ? 'Parte liberada. La contribución anterior permanece en el historial.' : 'Protocolo preparado desde el catálogo autorizado.');
    } catch (e) {
      if (!alive.current) return;
      if (isFieldProcedureTemporaryFailure(e)) setRetry(pending);
      else { setRetry(null); setSnapshot(null); }
      setError(e instanceof Error ? e.message : 'No se pudo confirmar el cambio.');
    } finally {
      writeLock.current=false;
      if (alive.current) { setBusy(false); setLoading(false); }
    }
  }
  const part = snapshot?.parts.find(p=>p.id===selected);
  const writable = fresh && !busy && !retry && snapshot?.allowedActions.includes('report.edit')
    && ['confirmed','in_progress'].includes(snapshot.interventionStatus);
  const mine = part?.ownerUserId === target.ownerUserId;
  if (openPart) return <FieldProcedureWorkspace target={target} initialPart={openPart} equipmentLabel={equipmentLabel} equipmentDescription={equipmentDescription} onBack={()=>setOpenPart(null)} onOpenAddons={onOpenAddons} />;
  return <section className={styles.panel} aria-label="Selección compartida de parte">
    <div className={styles.air}><PortalIcon name="unit" /><div><strong>{equipmentLabel}</strong><small>{equipmentDescription}</small>{snapshot?.protocolName ? <span className={styles.status}>{snapshot.protocolName}</span> : null}</div></div>
    <div className={styles.refresh}><h2>¿Qué vas a trabajar?</h2><button type="button" onClick={()=>void load()} disabled={loading||busy}>Actualizar</button></div>
    {error ? <div role="alert" className={styles.error}>{error}</div> : null}
    {!fresh ? <div role="status" className={styles.stale}>{loading ? 'Confirmando asignación con el servidor…' : 'Coordinación sin confirmar. La información anterior no autoriza iniciar, intervenir ni reenergizar.'}</div> : null}
    {notice ? <div role="status" className={styles.info}>{notice}</div> : null}
    {snapshot && snapshot.revision===null ? <div className={styles.info}><p>Esta intervención todavía no tiene un protocolo congelado. Se consultará su configuración autorizada; no se elegirá un protocolo por el nombre del servicio.</p><button className={fieldPortalStyles.secondary} type="button" disabled={!writable} onClick={()=>void mutate({action:'initialize'})}>Consultar protocolo del servicio</button></div> : null}
    <div className={styles.cards}>
      {snapshot?.parts.map(p=><button key={p.id} type="button" className={styles.card} aria-pressed={selected===p.id} onClick={()=>{setSelected(p.id);setReason('');}} disabled={busy||Boolean(retry)}>
        <span className={styles.illustration}><UnitIllustration part={p.id} /></span><span className={styles.cardText}><strong>{p.label}</strong><small>{descriptions[p.id]}</small><span className={styles.owner}>{p.ownerUserId ? `${p.ownerUserId===target.ownerUserId?'Tu parte · ':''}${p.ownerName || 'Miembro asignado'}` : 'Disponible para la cuadrilla'}</span><small>{p.documented} de {p.total} procedimientos documentados{p.exceptions ? ` · ${p.exceptions} con excepción` : ''}{p.pendingFiles ? ` · ${p.pendingFiles} archivo(s) pendientes de confirmar` : ''}</small>{p.completedAt ? <small>Documentación de parte finalizada; no implica aprobación de oficina.</small> : null}</span><PortalIcon name="chevron" />
      </button>)}
    </div>
    {retry ? <button type="button" className={fieldPortalStyles.primary} disabled={busy||loading} onClick={()=>void mutate(retry.command,retry)}>Reintentar la misma solicitud</button> : null}
    {part && !mine && !retry ? <button type="button" className={fieldPortalStyles.primary} disabled={!writable||Boolean(part.ownerUserId)||Boolean(part.completedAt)} onClick={()=>void mutate({action:'claim_part',part:part.id,expectedPartVersion:part.version})}>{busy ? 'Confirmando…' : part.ownerUserId ? `Asignada a ${part.ownerName || 'otro miembro'}` : `Tomar ${part.id==='indoor'?'evaporadora':'condensadora'}`}</button> : null}
    {mine ? <div className={styles.info}><p><strong>Tu parte está identificada.</strong> Abre los procedimientos para documentar cada paso con su evidencia y autoría. El cierre global del servicio continúa separado.</p><button type="button" className={fieldPortalStyles.primary} disabled={!snapshot?.revision||Boolean(retry)} onClick={()=>part&&setOpenPart(part.id)}>Abrir procedimientos</button></div> : null}
    {mine && !part?.completedAt ? <details className={styles.release}><summary>Liberar mi parte</summary><label>Motivo de la transferencia<textarea rows={2} value={reason} maxLength={1500} onChange={e=>setReason(e.target.value)} disabled={busy||Boolean(retry)} /></label><button type="button" className={fieldPortalStyles.secondary} disabled={!writable||reason.trim().length<3} onClick={()=>part&&void mutate({action:'release_part',part:part.id,expectedPartVersion:part.version,note:reason.trim()})}>Liberar sin borrar el historial</button></details> : null}
    <div className={styles.info}><p>Ambos miembros pueden abrir el mismo aire desde sus cuentas y escoger una parte. Una persona sola puede trabajar ambas. Son partes del mismo servicio, no dos cargos.</p><p>Las confirmaciones de la aplicación no sustituyen el aislamiento, la comunicación ni el control físico del equipo.</p></div>
    <button type="button" className={fieldPortalStyles.secondary} onClick={onBack}>Volver al trabajo</button>
  </section>;
}
