'use client';

import { useEffect, useState } from 'react';
import { ensureDemoDataForLiveReview } from '../../lib/browser-demo-data';
import { BrowserDispatchOperations } from './browser-dispatch-operations';
import { BrowserDispatchReadinessBoard } from './browser-dispatch-readiness-board';
import { LiveSchedulingOverview } from './live-scheduling-overview';
import { SchedulingOverviewV2 } from './scheduling-overview-v2';
import readableStyles from './scheduling-readable-type.module.css';
import styles from './scheduling-page-shell.module.css';

type SchedulingView = 'schedule' | 'dispatch' | 'readiness';
type SchedulingDataMode = 'checking' | 'demo' | 'live';

export function SchedulingPageShell() {
  const [view, setView] = useState<SchedulingView>('schedule');
  const [dataMode, setDataMode] = useState<SchedulingDataMode>('checking');

  useEffect(() => {
    const demoState = ensureDemoDataForLiveReview();
    setDataMode(demoState.active ? 'demo' : 'live');
  }, []);

  return (
    <div className={`${styles.shell} ${readableStyles.readable}`}>
      <nav className={styles.viewNav} aria-label="Scheduling workspace views">
        <div>
          <span>Scheduling workspace</span>
          <strong>{view === 'schedule' ? 'Schedule & Capacity' : view === 'dispatch' ? 'Daily Dispatch Control' : 'Dispatch Readiness Board'}</strong>
        </div>
        <div className={styles.viewButtons}>
          <button type="button" className={view === 'schedule' ? styles.active : ''} onClick={() => setView('schedule')}>
            <span>SC</span>
            <div><strong>Schedule & Capacity</strong><small>{dataMode === 'live' ? 'Live Booking Authority agenda' : 'Default agenda view'}</small></div>
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

      {view === 'schedule' && dataMode === 'checking' ? <div style={{ padding: 24 }}>Loading scheduling workspace…</div> : null}
      {view === 'schedule' && dataMode === 'demo' ? <SchedulingOverviewV2 /> : null}
      {view === 'schedule' && dataMode === 'live' ? <LiveSchedulingOverview /> : null}
      {view === 'dispatch' ? <BrowserDispatchOperations /> : null}
      {view === 'readiness' ? <BrowserDispatchReadinessBoard /> : null}
    </div>
  );
}
