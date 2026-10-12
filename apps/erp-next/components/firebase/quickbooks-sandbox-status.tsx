'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { loadQuickBooksSandbox, readQuickBooksSandboxStatus, startQuickBooksSandbox, type QuickBooksSandboxStatus } from '@/lib/firebase/quickbooks-sandbox';
import styles from './quickbooks-sandbox-status.module.css';

function SandboxCard({ uid }: { uid: string | null }) {
  const [status, setStatus] = useState<QuickBooksSandboxStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    setBusy(true);
    setError(null);
    void loadQuickBooksSandbox(uid).then(result => { if (active) setStatus(result); }, async failure => {
      if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la conexión.');
      // A cancelled/expired handshake must not disable the button needed to start a fresh one.
      try { const result = await readQuickBooksSandboxStatus(uid); if (active) setStatus(result); } catch { /* Retain safe error and retry control. */ }
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [uid, reload]);

  async function connect() {
    if (!uid || busy) return;
    setBusy(true);
    setError(null);
    try { await startQuickBooksSandbox(uid); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo iniciar la conexión.');
      setBusy(false);
    }
  }
  const connection = status?.connection;
  return <article className={`panel sg-integration-card ${styles.card}`} aria-busy={busy}>
    <div className="sg-integration-head">
      <div className="sg-provider-mark">QB</div>
      <div><span>Accounting · prueba</span><h2>QuickBooks Online</h2></div>
      <b className={connection ? 'ready' : ''}>{connection ? 'Sandbox autorizado' : status?.configured ? 'Por conectar' : 'Configuración pendiente'}</b>
    </div>
    <p>Primero autorizamos la empresa de prueba y verificamos su identidad. La sincronización de facturas, pagos y gastos todavía no está habilitada.</p>
    {connection ? <div className={styles.details}>
      <strong>{connection.companyName}</strong>
      <p>Empresa de prueba · ID {connection.realmId}{connection.country ? ` · ${connection.country}` : ''}<br />
        Identidad verificada: <time dateTime={connection.verifiedAt}>{new Date(connection.verifiedAt).toLocaleString('es')}</time>.
        Esta fecha corresponde a la última autorización; no confirma acceso continuo.</p>
    </div> : status?.configured ? <p>Sandbox esperado: {status.expectedRealmId}</p> : null}
    {!uid ? <p>Solo el propietario o un administrador puede gestionar esta conexión.</p> : null}
    {uid && status && !status.configured ? <p>Falta activar la conexión de prueba en el servidor. No introduzcas credenciales en esta pantalla.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="sg-integration-foot">
      <div><span>Environment</span><strong>Sandbox · sin movimientos contables</strong></div>
      {uid ? <button type="button" disabled={busy || !status?.configured} onClick={() => void connect()}>
        {busy ? 'Procesando…' : connection ? 'Volver a autorizar sandbox' : 'Conectar sandbox →'}
      </button> : null}
    </div>
    {uid ? <button className={`btn ${styles.retry}`} type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>Consultar estado / reintentar</button> : null}
  </article>;
}

export function QuickBooksSandboxStatusCard() {
  const { principal, status } = useAuth();
  const uid = status === 'ready' && principal.active && principal.role === 'super_admin' ? principal.userId : null;
  return <SandboxCard key={uid || 'unauthorized'} uid={uid} />;
}
