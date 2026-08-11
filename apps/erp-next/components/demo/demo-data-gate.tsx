'use client';

import { useEffect, useState } from 'react';
import { clearDemoData, DEMO_DATA_DATE, ensureDemoDataForLiveReview, getDemoDataState, installDemoData, reloadDemoData, type DemoDataState } from '../../lib/browser-demo-data';
import styles from './demo-data-gate.module.css';

export function DemoDataGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<DemoDataState>({ ready: false, active: false, date: DEMO_DATA_DATE, workOrders: 0, customers: 0 });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      setState(ensureDemoDataForLiveReview());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to prepare demo data.');
      setState(getDemoDataState());
    }
  }, []);

  const run = (action: 'load' | 'reload' | 'clear') => {
    setBusy(true);
    setNotice(null);
    try {
      if (action === 'clear') clearDemoData();
      else if (action === 'reload') reloadDemoData();
      else installDemoData();
      window.location.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Demo data action failed.');
      setBusy(false);
      setState(getDemoDataState());
    }
  };

  if (!state.ready) {
    return <div className={styles.loading}><strong>Preparing ERP review dataset…</strong><span>Loading reversible fictitious records for Aug 11, 2026.</span></div>;
  }

  return <>
    <section className={`${styles.banner} ${state.active ? styles.active : styles.inactive}`}>
      <div className={styles.identity}><span>{state.active ? 'DEMO DATA ACTIVE' : 'DEMO DATA DISABLED'}</span><strong>{state.active ? 'Full-day operational review · Aug 11, 2026' : 'Live ERP is showing your normal preview data'}</strong><p>{state.active ? `${state.workOrders} fictitious Work Orders · 4 full vans · fictitious CRM, readiness, Field, Office Review and Finance signals. No Firebase/QBO/bank/WhatsApp production write is involved.` : 'You can reload the reversible full-day dataset at any time while we are optimizing the interface.'}</p></div>
      <div className={styles.actions}>
        {state.active ? <><button type="button" disabled={busy} onClick={() => run('reload')}>↻ Reset Demo Day</button><button type="button" className={styles.clear} disabled={busy} onClick={() => run('clear')}>Clear Demo Data</button></> : <button type="button" disabled={busy} onClick={() => run('load')}>Load Full Aug 11 Demo</button>}
      </div>
    </section>
    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {children}
  </>;
}
