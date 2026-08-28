'use client';

import { AfterHoursEmergencyPanel } from './after-hours-emergency-panel';
import { BrowserDispatchOperations } from './browser-dispatch-operations';
import { BrowserDispatchReadinessBoard } from './browser-dispatch-readiness-board';
import { LiveSchedulingOverview } from './live-scheduling-overview';
import { VanScheduleManualSend } from './van-schedule-manual-send';
import readableStyles from './scheduling-readable-type.module.css';
import styles from './scheduling-page-shell.module.css';

export type SchedulingView = 'schedule' | 'dispatch' | 'readiness';

type Props = {
  view?: SchedulingView;
};

export function SchedulingPageShell({ view = 'schedule' }: Props) {
  return (
    <div className={`${styles.shell} ${view === 'schedule' ? styles.scheduleCompact : ''} ${readableStyles.readable}`}>
      {view === 'schedule' ? <><VanScheduleManualSend /><LiveSchedulingOverview /><AfterHoursEmergencyPanel /></> : null}
      {view === 'dispatch' ? <BrowserDispatchOperations /> : null}
      {view === 'readiness' ? <BrowserDispatchReadinessBoard /> : null}
    </div>
  );
}
