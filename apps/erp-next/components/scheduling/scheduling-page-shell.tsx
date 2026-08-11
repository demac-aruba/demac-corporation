'use client';

import { useState } from 'react';
import { BrowserDispatchOperations } from './browser-dispatch-operations';
import { BrowserDispatchReadinessBoard } from './browser-dispatch-readiness-board';
import { SchedulingOverviewV2 } from './scheduling-overview-v2';
import styles from './scheduling-page-shell.module.css';

type SchedulingView = 'schedule' | 'dispatch' | 'readiness';

export function SchedulingPageShell() {
  const [view, setView] = useState<SchedulingView>('schedule');

  return (
    <div className={styles.shell}>
      <nav className={styles.viewNav} aria-label="Scheduling workspace views">
        <div>
          <span>Scheduling workspace</span>
          <strong>{view === 'schedule' ? 'Schedule & Capacity' : view === 'dispatch' ? 'Daily Dispatch Control' : 'Dispatch Readiness Board'}</strong>
        </div>
        <div className={styles.viewButtons}>
          <button type="button" className={view === 'schedule' ? styles.active : ''} onClick={() => setView('schedule')}>
            <span>SC</span>
            <div><strong>Schedule & Capacity</strong><small>Default agenda view</small></div>
          </button>
          <button type="button" className={view === 'dispatch' ? styles.active : ''} onClick={() => setView('dispatch')}>
            <span>DC</span>
            <div><strong>Daily Dispatch Control</strong><small>Departures, delays & exceptions</small></div>
          </button>
          <button type="button" className={view === 'readiness' ? styles.active : ''} onClick={() => setView('readiness')}>
            <span>RB</span>
            <div><strong>Dispatch Readiness Board</strong><small>Pre-dispatch readiness</small></div>
          </button>
        </div>
      </nav>

      {view === 'schedule' ? <SchedulingOverviewV2 /> : null}
      {view === 'dispatch' ? <BrowserDispatchOperations /> : null}
      {view === 'readiness' ? <BrowserDispatchReadinessBoard /> : null}
    </div>
  );
}
