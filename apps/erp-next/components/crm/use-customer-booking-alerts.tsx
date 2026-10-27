'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertDialog } from './customer-alert-manager';
import { alertCategoryLabels, alertDate, matchCustomerAlerts, mutateCustomerAlert, newAlertRequestId, type AlertContext, type AlertMatches } from '../../lib/customer-alerts';
import styles from './customer-alerts.module.css';

export function useCustomerBookingAlerts(context: AlertContext, userId: string, onDecline: () => void) {
  const signature = JSON.stringify([userId, context.customerId || '', context.propertyId || '', context.dwellingId || '', context.customerId ? '' : context.query || '']);
  const current = useRef({ signature, context }); current.current = { signature, context };
  const acknowledged = useRef(new Set<string>());
  const [result, setResult] = useState<{ signature: string; data: AlertMatches } | null>(null);
  const [error, setError] = useState(''), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(''), [different, setDifferent] = useState(false), [refresh, setRefresh] = useState(0);
  const request = useRef<Record<string, unknown> | null>(null);
  const sequence = useRef(0);
  const key = (id: string, version: number, token: string) => `${id}:${version}:${token}`;
  const load = useCallback(async () => {
    const captured = current.current, turn = ++sequence.current;
    try {
      const data = await matchCustomerAlerts(captured.context);
      if (current.current.signature !== captured.signature || turn !== sequence.current) return null;
      setResult({ signature: captured.signature, data }); setError('');
      const pending = data.matches.some(a => !acknowledged.current.has(key(a.id, a.version, data.contextToken)));
      if (pending) setOpen(true);
      return { data, pending };
    } catch (e) {
      if (current.current.signature === captured.signature && turn === sequence.current) setError(e instanceof Error ? e.message : 'No se pudieron verificar las alertas.');
      return null;
    }
  }, []);
  useEffect(() => {
    ++sequence.current; acknowledged.current.clear(); setResult(null); setOpen(false); setError(''); setDifferent(false); setReason(''); request.current = null;
    if (!context.customerId && (context.query || '').trim().length < 5) return;
    const timer = window.setTimeout(() => { void load(); }, 350);
    return () => { window.clearTimeout(timer); ++sequence.current; };
    // Signature covers all identity inputs and the authenticated principal.
  }, [signature, load, refresh]);
  const latest = result?.signature === signature ? result.data : null;
  const remaining = latest?.matches.filter(a => !acknowledged.current.has(key(a.id, a.version, latest.contextToken))) || [];
  const alert = remaining[0];
  const checking = useRef(false);
  const checkBeforeBooking = async () => {
    if (checking.current || busy) return false;
    checking.current = true;
    try { const check = await load(); return check !== null && !check.pending; }
    finally { checking.current = false; }
  };
  const decide = async (decision: 'continue' | 'decline' | 'different_customer') => {
    if (!alert || !latest || !context.customerId || busy) return;
    setBusy(true); setError('');
    const captured = signature;
    request.current ||= { id: alert.id, requestId: newAlertRequestId(), expectedVersion: alert.version, context, contextToken: latest.contextToken, decision, reason };
    try {
      await mutateCustomerAlert('review_customer_alert', request.current);
      if (current.current.signature !== captured) return;
      acknowledged.current.add(key(alert.id, alert.version, latest.contextToken));
      request.current = null; setDifferent(false); setReason('');
      if (decision === 'decline') { setOpen(false); onDecline(); return; }
      if (remaining.length === 1) setOpen(false);
    } catch (e) { if (current.current.signature === captured) setError(e instanceof Error ? e.message : 'No se confirmó la decisión. Reintenta.'); }
    finally { setBusy(false); }
  };
  const visible = Boolean(context.customerId || (context.query || '').trim().length >= 5);
  const notice = visible ? <>
    <div className={styles.panel} aria-live="polite"><div className={styles.head}><strong>{error ? 'No se pudieron verificar las alertas' : !latest ? 'Verificando alertas del cliente…' : remaining.length ? `⚠ ${remaining.length} alerta${remaining.length === 1 ? '' : 's'} pendiente${remaining.length === 1 ? '' : 's'} de revisar` : latest.matches.length ? 'Alertas revisadas por el operador' : 'Sin alertas coincidentes'}</strong>{remaining.length ? <button type="button" className={styles.warning} onClick={() => setOpen(true)}>Revisar alertas</button> : null}</div>{error ? <div className={styles.error} role="alert">{error}<button type="button" className={styles.button} onClick={() => setRefresh(v => v + 1)}>Reintentar consulta</button></div> : null}</div>
    {open && alert && latest ? <AlertDialog title="Alerta al agendar" onClose={() => setOpen(false)} busy={busy}><p className={styles.muted}>Revisa este antecedente antes de confirmar la cita.</p><span className={styles.badge}>{remaining.length} pendiente{remaining.length === 1 ? '' : 's'}</span><span className={styles.badge}>Coincidencia por {alert.matchKind === 'customer' ? 'cliente' : alert.matchKind === 'phone' ? 'teléfono' : 'dirección'}</span>
      {alert.matchKind !== 'customer' ? <div className={styles.info}>Compartir {alert.matchKind === 'phone' ? 'un teléfono' : 'una dirección'} no confirma que sea la misma persona.</div> : null}
      <div className={styles.pair}><div className={styles.identity}><small>Cliente con el antecedente</small><strong>{alert.customerName}</strong></div><div className={styles.identity}><small>Cliente de esta cita</small><strong>{latest.customerName || 'Selecciona un cliente'}</strong></div></div>
      {alert.address ? <p className={styles.muted}>Dirección registrada: {alert.address}</p> : null}
      <div className={styles.card}><span className={styles.badge}>{alertCategoryLabels[alert.category]}</span><strong>Comentario guardado</strong><p className={styles.comment}>{alert.comment}</p><small className={styles.muted}>{alert.createdBy.name} · {alertDate(alert.createdAt)}</small></div>
      {alert.canDismiss ? <div className={styles.identity} style={{ marginTop: 14 }}><strong>¿Es otro cliente / nuevo ocupante?</strong><p>La alerta permanecerá con el cliente anterior. Esta aclaración se guardará para el cliente y las coincidencias actuales.</p><button className={styles.button} disabled={busy || !!request.current} onClick={() => setDifferent(true)}>Es otro cliente / nuevo ocupante</button></div> : null}
      {different ? <div className={styles.form}><label>Cómo verificaste que es otra persona *<textarea maxLength={2000} disabled={busy || !!request.current} value={reason} onChange={e => setReason(e.target.value)}/></label></div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <footer className={styles.footer}><small className={styles.muted}>La decisión quedará registrada.</small><button type="button" className={styles.button} disabled={busy || !context.customerId || (!!request.current && request.current.decision !== 'decline')} onClick={() => void decide('decline')}>No agendar</button><button type="button" className={styles.primary} disabled={busy || !context.customerId || (different && reason.trim().length < 5) || (!!request.current && request.current.decision === 'decline')} onClick={() => void decide(different ? 'different_customer' : 'continue')}>{busy ? 'Guardando…' : different ? 'Confirmar otro cliente' : 'Revisar y continuar'}</button></footer>
    </AlertDialog> : null}
  </> : null;
  return { notice, checkBeforeBooking };
}
