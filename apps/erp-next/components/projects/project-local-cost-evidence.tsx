import type { BrowserProject } from '@/lib/browser-projects';
import styles from './projects-phase-workspace.module.css';

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : 'Not recorded';
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('en', { maximumFractionDigits: 8 }) : 'Unknown';

export function ProjectLocalCostEvidence({ project }: { project: BrowserProject }) {
  return <section className={styles.panel} aria-label="Browser-only cost evidence">
    <div className={styles.panelHeader}><div><h2>Browser-only cost evidence</h2>
      <p>These records belong to this browser. A local Approved status does not establish shared approval, payment, reconciliation or accounting synchronization.</p>
      <p>Current recorded material budget: {project.materialBudget == null ? 'Not estimated' : `AWG ${amount(project.materialBudget)}`}. Original budget and earlier revisions: not verified. Available balance and overrun: unknown until source allocations are verified.</p>
      <p>Project period: {text(project.startsOn)} – {text(project.estimatedCompletionOn)}. Scheduled slots and recorded hours are separate from money.</p>
    </div></div>
    {(['expenses', 'costEntries'] as const).map(kind => <details key={kind} className={styles.panelHeader}>
      <summary>{kind === 'expenses' ? 'Expense records' : 'Cost entries'} ({project[kind].length} local rows)</summary>
      <div><p>Amounts are shown as recorded; these legacy rows do not declare a currency. Related expense and cost-entry rows may represent the same operation and are not added together.</p>
        {!project[kind].length && <p>No rows in this browser snapshot. This does not certify zero Project spending.</p>}
        {project[kind].slice(0, 50).map((value, index) => {
          const row = value && typeof value === 'object' ? value as unknown as Record<string, unknown> : {};
          return <dl key={index} className={styles.detailList}>
            <div><dt>Record / date</dt><dd>{text(row.id)} · {text(row.date)}</dd></div>
            <div><dt>Description</dt><dd>{text(row.description)}</dd></div>
            <div><dt>Recorded amount</dt><dd>{amount(row.amount)} · currency not recorded</dd></div>
            <div><dt>Category / phase ID</dt><dd>{text(row.costType)} · {text(row.phaseId)}</dd></div>
            <div><dt>Provenance</dt><dd>{kind === 'expenses' ? `${text(row.source)} · ${text(row.vendor)} · local status: ${text(row.status)}` : `${text(row.sourceType)} · source ID: ${text(row.sourceId)} · ${text(row.vendorOrEmployee)}`}</dd></div>
          </dl>;
        })}
        {project[kind].length > 50 && <p>Showing the first 50 rows. All {project[kind].length} rows remain in the original browser source and recovery backup.</p>}
      </div>
    </details>)}
  </section>;
}
