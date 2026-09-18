'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  captureLocalBackup, verifyLocalBackup, inspectLocalBackup, MAX_BACKUP_BYTES,
  type BackupInspection,
} from '../../../../functions/projects/recovery';
import styles from './projects-recovery.module.css';

export function ProjectsRecovery() {
  const { principal } = useAuth();
  const allowed = principal.active && principal.capabilities.has('projects.view') && principal.capabilities.has('projects.manage');
  const access = useRef({ principal, allowed });
  access.current = { principal, allowed };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [verified, setVerified] = useState(false);
  // Result ownership prevents a newly signed-in user from seeing the prior user's file summary.
  const [resultOwner, setResultOwner] = useState<typeof principal | null>(null);
  const busyRef = useRef(false);

  const begin = () => {
    if (!access.current.allowed || busyRef.current) return false;
    busyRef.current = true; setBusy(true); setMessage(''); setInspection(null); setVerified(false);
    setResultOwner(principal);
    return true;
  };
  const assertAccess = () => {
    if (!access.current.allowed || access.current.principal !== principal) throw new Error('Your session changed. Sign in and retry.');
  };
  const finish = () => { busyRef.current = false; setBusy(false); };

  const exportBackup = async () => {
    if (!begin()) return;
    try {
      const backup = await captureLocalBackup(window.localStorage, {
        capturedAt: new Date().toISOString(), origin: window.location.origin,
      });
      const serialized = JSON.stringify(backup);
      const checked = await verifyLocalBackup(serialized);
      assertAccess();
      const details = inspectLocalBackup(checked);
      setInspection(details);
      if (checked.body.entries.every((entry) => entry.raw === null)) {
        setMessage('No Projects data exists at this browser origin. Open the original ERP browser/profile; preview domains do not share its storage.');
        return;
      }
      const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `demac-projects-backup-${checked.body.capturedAt.replace(/[:.]/g, '-')}.json`;
      try { document.body.appendChild(link); link.click(); }
      finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000); }
      setMessage('Download requested. Select the saved file below to verify it. Keep it private; no cloud backup or migration has been performed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The backup could not be created. No data was changed.');
    } finally { finish(); }
  };

  const verifyFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !begin()) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup file exceeds 16 MiB.');
      const backup = await verifyLocalBackup(await file.text());
      assertAccess();
      setInspection(inspectLocalBackup(backup)); setVerified(true);
      setMessage('Saved file checksum verified. This confirms file integrity, not the correctness of project hours or permission to migrate. No data was restored or uploaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The backup could not be verified.');
    } finally { finish(); }
  };

  if (!allowed) return <section className={styles.panel}><h1>Projects recovery</h1><p>Projects management access is required.</p></section>;
  const visible = resultOwner === principal;
  return <section className={styles.root}>
    <header><p>PROJECTS · DATA SAFETY</p><h1>Protect your existing projects</h1><p>Export the original local records before centralizing Projects. This recovery page does not load the phase planner, clean sample records, or modify your agenda.</p></header>
    <article className={styles.panel}>
      <h2>1. Save a local backup</h2>
      <p>Use the same browser, profile and website where the projects were created. Only Projects and company phase templates are exported; session tokens and other ERP storage are excluded.</p>
      <button type="button" onClick={() => void exportBackup()} disabled={busy}>Export Projects backup</button>
    </article>
    <article className={styles.panel}>
      <h2>2. Verify the saved file</h2>
      <p>Verification runs on this device. It does not restore, merge, overwrite or upload anything. The file may contain private customer and project information.</p>
      <label>Choose the saved Projects backup <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void verifyFile(event)} /></label>
    </article>
    {visible && message && <p role="status" aria-live="polite" className={styles.panel}>{message}</p>}
    {visible && inspection && <article className={styles.panel}>
      <h2>{verified ? 'Saved file verified' : 'Captured source summary'}</h2>
      <dl className={styles.summary}>
        <dt>Source website</dt><dd>{inspection.origin}</dd>
        <dt>Capture time (UTC)</dt><dd>{inspection.capturedAt}</dd>
        <dt>Project records</dt><dd>{inspection.projectCount ?? 'Unavailable — review source data'}</dd>
        <dt>Company templates</dt><dd>{inspection.templateCount ?? 'Unavailable — review source data'}</dd>
        <dt>Source checks requiring review</dt><dd>{inspection.issues.length}</dd>
      </dl>
      {inspection.issues.length > 0 && <p>The original content is preserved, including invalid or duplicate records. These issues must be reviewed before any migration.</p>}
      <strong>No migration performed. Scheduled slots are not actual worked hours.</strong>
    </article>}
  </section>;
}
