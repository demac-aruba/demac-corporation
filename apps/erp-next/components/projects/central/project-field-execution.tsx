'use client';

import { useEffect, useState } from 'react';
import { minutesLabel, type RegistryRequest } from '@/lib/projects/registry-client-core';
import s from './projects-central.module.css';

type ExecutionPage = {
  projectId: string;
  projectVersion: number;
  source: 'canonical_field_event_timeline';
  timeBasis: 'closed_in_progress_intervals_not_person_hours';
  nextCursor: string | null;
  issues: Array<{ code: string; visitId?: string; workOrderId?: string }>;
  coverage: { pageComplete: boolean; allProjectLinksIncluded: boolean; eventReadComplete: boolean };
  pageTotals: { closedRecordedMinutes: number | null; openIntervals: number; visits: number; approvedReports: number };
  projectRecordedMinutes: number | null;
  rows: Array<{
    workOrderId: string;
    appointmentId: string;
    vanId: string | null;
    date: string | null;
    cancelled: boolean;
    scheduledSlots: number | null;
    plannedVanMinutes: number | null;
    reviewStatus: string | null;
    visits: Array<{
      visitId: string;
      status: string;
      closedRecordedMinutes: number | null;
      hasOpenInterval: boolean;
      complete: boolean;
      intervals: Array<{ startedAt: string; stoppedAt: string; startEventId: string; stopEventId: string }>;
    }>;
  }>;
};

const reason: Record<string, string> = {
  field_event_read_truncated: 'This page has more Field history than the safe read limit. No total has been certified.',
  field_event_read_incomplete: 'The complete event history was not available.',
  field_timeline_missing: 'There is no complete recorded timeline for this visit. Reserved time is not substituted.',
  field_timeline_gap_or_ambiguity: 'The status history has a gap or conflict and needs reconciliation.',
  field_timeline_start_mismatch: 'The first recorded work start does not match the current visit.',
  field_timeline_completion_mismatch: 'The completion record and event history do not agree.',
  field_timeline_current_status_mismatch: 'The event history and current visit status do not agree.',
  office_correction_time_unmeasured: 'Office returned the report for correction. That does not prove the technician resumed physical work.',
  field_visit_not_recorded: 'No Field visit is recorded for this Work Order. That is not proof of zero work.',
  field_event_invalid: 'A Field event has inconsistent identity, time or version information.',
  field_event_visit_missing: 'The event refers to a visit not present in this page’s validated history.',
  overlapping_van_execution: 'Recorded visits overlap for the same Van; reconcile them before comparing total time.',
  legacy_import_requires_reconciliation: 'Imported project history still needs reconciliation with canonical records.',
};

/** Mount only when requested. No timers, background polling or per-click booking queries. */
export function ProjectFieldExecution({ request, projectId, projectVersion, refreshToken }: {
  request: RegistryRequest;
  projectId: string;
  projectVersion: number;
  refreshToken: number;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const [page, setPage] = useState<ExecutionPage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setBusy(true);
    setPage(null);
    setError('');
    void request<ExecutionPage>({ action: 'get_execution', data: {
      projectId, ...(cursor ? { afterId: cursor } : {}),
    } }, controller.signal).then(result => {
      if (result.source !== 'canonical_field_event_timeline' || result.projectId !== projectId
          || result.projectVersion !== projectVersion || !Array.isArray(result.rows)
          || !Array.isArray(result.issues) || !result.coverage || !result.pageTotals) {
        throw new Error('Project changed or returned incomplete execution evidence. Refresh before reviewing the totals.');
      }
      if (current) setPage(result);
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : 'Field execution could not be loaded.');
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; controller.abort(); };
  }, [request, projectId, projectVersion, refreshToken, cursor]);

  return <section className={s.card} aria-label="Field execution evidence">
    <h2>Field execution</h2>
    <p className={s.notice}>Recorded time comes from closed <strong>In progress</strong> intervals in Field.
      Travel, pending periods and waiting for office review are excluded. This is not a timesheet,
      person-hours or a percentage of physical completion. An approved report does not certify payroll.</p>
    {busy && <p role="status">Reading Field history…</p>}
    {error && <p className={s.error} role="alert">{error}</p>}
    {page && <>
      <div className={s.grid}>
        <div className={s.metric}><span>Closed recorded time · this page</span><strong>{minutesLabel(page.pageTotals.closedRecordedMinutes)}</strong></div>
        <div className={s.metric}><span>Visits with a running interval</span><strong>{page.pageTotals.openIntervals}</strong></div>
        <div className={s.metric}><span>Reports approved by office · this page</span><strong>{page.pageTotals.approvedReports}</strong></div>
      </div>
      {page.projectRecordedMinutes !== null
        ? <p>Closed recorded time across all linked visits: <strong>{minutesLabel(page.projectRecordedMinutes)}</strong>.</p>
        : <p className={s.muted}>No complete project-time total is available from this page. Open intervals and unresolved history are not converted into zero.</p>}
      {page.issues.length > 0 && <details className={s.warning} open>
        <summary>History requiring review ({page.issues.length})</summary>
        {page.issues.map((issue, index) => <p key={`${issue.code}-${index}`}>
          {reason[issue.code] || issue.code.replaceAll('_', ' ')}{' '}
          <small>{issue.visitId || issue.workOrderId || ''}</small>
        </p>)}
      </details>}
      {!page.rows.length && <p className={s.empty}>No linked work on this page. This does not prove that no work has taken place.</p>}
      {page.rows.map(row => <article className={s.card} key={row.workOrderId}>
        <div className={s.sectionTitle}><h3>{row.date || 'Date not recorded'} · {row.vanId || 'Van unresolved'}</h3>
          <span className={s.badge}>{row.reviewStatus ? `Office: ${row.reviewStatus}` : 'Not submitted to office'}</span></div>
        <p>{row.workOrderId} · {row.scheduledSlots ?? 'Unknown'} scheduled slots · {minutesLabel(row.plannedVanMinutes)} planned</p>
        {row.cancelled && <p className={s.warning}>Booking cancelled. Any recorded execution remains visible; cancellation does not erase work already performed.</p>}
        {row.visits.map(visit => <div key={visit.visitId}>
          <p><strong>{visit.status.replaceAll('_', ' ')}</strong> · {visit.visitId}</p>
          <p>Closed recorded time: <strong>{minutesLabel(visit.closedRecordedMinutes)}</strong>
            {visit.hasOpenInterval ? ' · Current interval is open and not included.' : ''}</p>
          {visit.closedRecordedMinutes !== null && visit.intervals.length > 0 && <details>
            <summary>Source intervals ({visit.intervals.length})</summary>
            {visit.intervals.map(interval => <p key={interval.startEventId}>
              {interval.startedAt} → {interval.stoppedAt}<br />
              <small>Field events: {interval.startEventId} / {interval.stopEventId}</small>
            </p>)}
          </details>}
        </div>)}
      </article>)}
      <div className={s.pager}>
        <button className={s.button} disabled={busy || !previous.length} onClick={() => {
          setCursor(previous.at(-1)); setPrevious(value => value.slice(0, -1));
        }}>Previous execution page</button>
        <button className={s.button} disabled={busy || !page.nextCursor} onClick={() => {
          setPrevious(value => [...value, cursor]); setCursor(page.nextCursor!);
        }}>Next execution page</button>
      </div>
    </>}
  </section>;
}
