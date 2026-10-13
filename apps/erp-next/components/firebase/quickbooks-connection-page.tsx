'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { captureConnectionReturn, disconnectConnection, hasPendingConnection, loadConnection, readConnectionStatus, startConnection,
  type QuickBooksConnectionStatus } from '@/lib/firebase/quickbooks-connection';
import styles from './quickbooks-connection-page.module.css';
import { QuickBooksProductionReports } from './quickbooks-production-reports';

type Intent = 'connect' | 'disconnect';
function ConnectionActions({ uid, intent }: { uid: string; intent: Intent }) {
  const [snapshot, setSnapshot] = useState<QuickBooksConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const mounted = useRef(false);
  const actionLock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; setBusy(true); setError(null); setCheckedAt(null); setConfirmed(false); setPending(hasPendingConnection(uid));
    // Page visits only read status. Completion and revocation both need an explicit button.
    void readConnectionStatus(uid).then(result => { if (active) { setSnapshot(result); setCheckedAt(new Date().toLocaleTimeString('es')); } }, failure => {
      if (active) { setSnapshot(null); setError(failure instanceof Error ? failure.message : 'No se pudo consultar el estado.'); }
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [uid, reload]);
  async function act(kind: 'start' | 'finish' | 'disconnect') {
    if (busy || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(null); setDisconnected(false); setConfirmed(false);
    let navigating = false;
    try {
      if (kind === 'start') { await startConnection(uid); navigating = true; return; }
      const result = kind === 'finish' ? await loadConnection(uid) : await disconnectConnection(uid, snapshot!.disconnectVersion!);
      if (mounted.current) { setSnapshot(result); setPending(hasPendingConnection(uid)); setConfirmed(false); setDisconnected(kind === 'disconnect'); }
    } catch (failure) {
      if (mounted.current) { setPending(hasPendingConnection(uid)); setError(failure instanceof Error ? failure.message : 'No se pudo confirmar la operación.'); }
      try { const current = await readConnectionStatus(uid); if (mounted.current) setSnapshot(current); }
      catch { if (mounted.current) setSnapshot(null); }
    } finally { if (!navigating) { actionLock.current = false; if (mounted.current) setBusy(false); } }
  }
  const phase = snapshot?.phase;
  const labels: Record<QuickBooksConnectionStatus['phase'], string> = {
    'not-configured': 'Activación pendiente', disconnected: 'Sin conexión registrada', connected: 'Identidad de empresa verificada',
    'confirmation-pending': 'Autorización pendiente de confirmar', 'disconnect-pending': 'Desconexión pendiente de confirmar',
  };
  return <section className={styles.status} aria-busy={busy} aria-label="Estado de la conexión">
    <h2>{snapshot ? labels[snapshot.phase] : busy ? 'Consultando estado…' : 'Estado no disponible'}</h2>
    {snapshot && !snapshot.configured ? <p>La conexión con la empresa real está pendiente de configuración y revisión. El sandbox continúa separado. No se han habilitado movimientos contables.</p> : null}
    {snapshot?.connection ? <dl><dt>Empresa</dt><dd>{snapshot.connection.companyName}</dd><dt>Company ID</dt><dd>{snapshot.connection.realmId}</dd><dt>País informado por QuickBooks</dt><dd>{snapshot.connection.country || 'No informado'}</dd><dt>Última verificación</dt><dd>{new Date(snapshot.connection.verifiedAt).toLocaleString('es')}</dd></dl> : null}
    {phase === 'connected' ? <p>Esta es la última autorización registrada; no confirma acceso continuo. La sincronización de ventas, pagos y gastos permanece deshabilitada.</p> : null}
    {phase === 'confirmation-pending' ? <p>{pending ? 'Confirma ahora desde esta misma pestaña. El proceso dispone de 10 minutos desde que se inicia la conexión.' : 'La confirmación venció o no está disponible en esta pestaña. Usa «Gestionar desconexión» para retirar la autorización pendiente y después vuelve a conectar.'}</p> : null}
    {phase === 'disconnect-pending' ? <p>El acceso desde el ERP está suspendido. QuickBooks todavía no confirmó la revocación; puedes reintentarla de forma explícita.</p> : null}
    {disconnected ? <p className={styles.success} role="status">QuickBooks confirmó la revocación. Las credenciales de esta conexión se retiraron del ERP.</p> : null}
    {intent === 'connect' && snapshot?.configured && phase !== 'disconnect-pending' ? <div className={styles.actions}>
      {pending ? <button className="btn primary" disabled={busy || phase !== 'confirmation-pending'} onClick={() => void act('finish')}>Confirmar autorización de DEMAC</button> : null}
      {phase !== 'confirmation-pending' ? <button className="btn primary" disabled={busy} onClick={() => void act('start')}>{snapshot.connection ? 'Volver a conectar con QuickBooks' : 'Conectar con QuickBooks'}</button> : null}
    </div> : null}
    {intent === 'disconnect' && snapshot?.configured && snapshot.disconnectVersion ? <div className={styles.confirmation}>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Confirmo que quiero retirar el acceso de DEMAC ERP a esta empresa de QuickBooks.</label>
      <button className="btn" disabled={busy || !confirmed} onClick={() => void act('disconnect')}>{phase === 'disconnect-pending' ? 'Reintentar desconexión' : 'Confirmar desconexión'}</button>
    </div> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.actions}>
      <button className="btn" disabled={busy} onClick={() => setReload(value => value + 1)}>{busy ? 'Procesando…' : 'Consultar estado'}</button>
      <Link href={intent === 'connect' ? '/quickbooks/disconnect/' : '/quickbooks/connect/'}>{intent === 'connect' ? 'Gestionar desconexión' : 'Conectar o reconectar'}</Link>
    </div>
    {checkedAt && !busy ? <p className={styles.success} role="status">Estado consultado a las {checkedAt}.</p> : null}
    {intent === 'connect' && phase === 'connected' && snapshot?.connection ? <QuickBooksProductionReports key={snapshot.connection.connectedAt} uid={uid} /> : null}
  </section>;
}
export function QuickBooksConnectionPage({ intent }: { intent: Intent }) {
  const { mode, status, principal } = useAuth();
  const [ready, setReady] = useState(false);
  const [canonical, setCanonical] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Proof in sessionStorage is origin-bound. Do not start OAuth on the www alias.
    setCanonical(window.location.hostname === 'demac-aruba.com' || ['localhost', '127.0.0.1'].includes(window.location.hostname));
    try { if (intent === 'connect') captureConnectionReturn(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo verificar el retorno de QuickBooks.'); }
    setReady(true);
  }, [intent]);
  const signedIn = mode === 'firebase' && status === 'ready' && principal.active;
  const authorized = signedIn && principal.role === 'super_admin';
  const target = `/quickbooks/${intent}/`;
  return <main className={styles.page}><article className={styles.card}>
    <header><span className={styles.eyebrow}>DEMAC ERP · QuickBooks Online</span><h1>{intent === 'connect' ? 'Conectar QuickBooks con DEMAC' : 'Gestionar la desconexión de QuickBooks'}</h1>
      <p>Acceso interno de DEMAC Professional Cooling Solutions.</p></header>
    {intent === 'disconnect' ? <p>Si retiraste la autorización desde QuickBooks, vuelve a conectar cuando quieras restablecerla. Para desconectar desde el ERP, inicia sesión y confirma la operación. Abrir esta página no cambia tu conexión ni elimina facturas, pagos o gastos.</p> : <p>Autoriza la empresa de DEMAC desde tu cuenta de QuickBooks y confirma su identidad. Esta etapa no activa la sincronización contable.</p>}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {!ready || status === 'loading' ? <p role="status">Verificando sesión…</p> : !canonical ? <p><a href={`https://demac-aruba.com${target}`}>Continuar en el acceso de DEMAC</a></p> : !signedIn ? <div className={styles.actions}><Link className="btn primary" href={`/login?next=${encodeURIComponent(target)}`}>Iniciar sesión en DEMAC ERP</Link></div> : !authorized ? <p role="alert">Esta sección requiere una cuenta de administrador autorizada por DEMAC.</p> : <ConnectionActions key={principal.userId} uid={principal.userId} intent={intent} />}
    <footer><Link href="/integrations/">Volver a Integrations</Link><span>Ayuda: <a href="mailto:sales@demac-aruba.com">sales@demac-aruba.com</a></span>
      <span><a href="/legal/quickbooks-terms.html">Terms of Use</a> · <a href="/legal/quickbooks-privacy.html">Privacy Policy</a></span></footer>
  </article></main>;
}
