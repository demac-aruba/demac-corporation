'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { readConnectionStatus, type QuickBooksConnectionStatus } from '@/lib/firebase/quickbooks-connection';
import { QuickBooksCatalog } from './quickbooks-catalog';
import styles from './quickbooks-comparison-page.module.css';
function ConnectedComparison({ uid }: { uid: string }) {
  const [connection, setConnection] = useState<QuickBooksConnectionStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let current = true;
    void readConnectionStatus(uid).then(value => { if (current) setConnection(value); }, () => { if (current) setError('No se pudo verificar la conexión. Revisa el estado de QuickBooks.'); });
    return () => { current = false; };
  }, [uid]);
  if (error) return <p role="alert">{error} <Link href="/quickbooks/connect/">Consultar estado</Link></p>;
  if (!connection) return <p role="status">Verificando la conexión con DEMAC…</p>;
  if (connection.phase !== 'connected' || !connection.connection) return <p>Completa la conexión de DEMAC para consultar los catálogos. <Link href="/quickbooks/connect/">Ver conexión</Link></p>;
  return <QuickBooksCatalog key={`${uid}-${connection.connection.connectedAt}`} uid={uid} />;
}
export function QuickBooksComparisonPage() {
  const { mode, status, principal } = useAuth(); const [canonical, setCanonical] = useState<boolean | null>(null);
  useEffect(() => { setCanonical(['demac-aruba.com', 'localhost', '127.0.0.1'].includes(window.location.hostname)); }, []);
  const signedIn = mode === 'firebase' && status === 'ready' && principal.active;
  return <main className={styles.page}><div className={styles.content}>
    <header className={styles.header}><div><Link href="/integrations/" className={styles.back}>← Integrations</Link><span className={styles.brand}>DEMAC ERP · QUICKBOOKS ONLINE</span><h1>Comparación de catálogos</h1></div><Link className={styles.connection} href="/quickbooks/connect/">Ver conexión e informes →</Link></header>
    {canonical === null || status === 'loading' ? <p role="status">Verificando sesión…</p> : !canonical ? <p><a href="https://demac-aruba.com/quickbooks/compare/">Abrir la comparación en DEMAC</a></p> : !signedIn ? <p><Link className="btn primary" href="/login?next=%2Fquickbooks%2Fcompare%2F">Iniciar sesión en DEMAC ERP</Link></p> : principal.role !== 'super_admin' ? <p role="alert">Esta sección requiere la cuenta de propietario autorizada por DEMAC.</p> : <ConnectedComparison key={principal.userId} uid={principal.userId} />}
  </div></main>;
}
