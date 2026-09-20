'use client';
import { useEffect, useState } from 'react';
import type { CentralProject, ProjectActivity } from '@/lib/projects/registry-types';
import type { RegistryRequest } from '@/lib/projects/registry-client-core';
import s from './projects-central.module.css';

type Materials = {
  source: 'canonical_inventory_movements'; projectId: string; projectVersion: number; workOrderId: string;
  rows: Array<{ movementId: string; itemId: string; itemName: string; itemKind: string; quantity: number;
    occurredAt: string; sourceLocationId: string; workOrderStatus: string; totalCost: null }>;
  issues: Array<{ code: string; movementId: string }>; nextCursor: string | null;
  coverage: { pageValid: boolean; wholeProjectTotal: false; importReviewPending: boolean };
};
type Props = { project: CentralProject; activity: ProjectActivity; request: RegistryRequest };
export function ProjectMaterialsPanel({ project, activity, request }: Props) {
  const [selected, setSelected] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const [data, setData] = useState<Materials | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const selectedOrder = activity.rows.find(row => row.workOrderId === selected);
  useEffect(() => {
    setData(null); setError('');
    if (!selectedOrder) { setLoading(false); return; }
    let active = true; const controller = new AbortController(); setLoading(true);
    void request<Materials>({ action: 'get_materials', data: { projectId: project.id, workOrderId: selectedOrder.workOrderId,
      ...(cursor ? { afterId: cursor } : {}) } }, controller.signal).then(value => {
      if (value.source !== 'canonical_inventory_movements' || value.projectId !== project.id || value.projectVersion !== project.version
          || value.workOrderId !== selectedOrder.workOrderId || !Array.isArray(value.rows) || !Array.isArray(value.issues)
          || typeof value.coverage?.pageValid !== 'boolean' || (value.nextCursor !== null && typeof value.nextCursor !== 'string')) {
        throw new Error('The Project or Work Order changed. Refresh Projects before reviewing materials.');
      }
      if (active) setData(value);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Inventory evidence could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [request, project.id, project.version, selectedOrder?.workOrderId, cursor, refresh]);
  return <section className={`${s.card} ${s.form}`}>
    <h2>Materials issued to Project work</h2>
    <p className={s.notice}>Read-only evidence from Inventory Authority. An issue is not a new stock transaction, a current balance, or a certified accounting cost. Cancelling a job does not erase or automatically reverse its inventory history.</p>
    <label>Linked Work Order<select aria-label="Linked Work Order" value={selected} onChange={event => {
      setSelected(event.target.value); setCursor(undefined); setPrevious([]); setData(null);
    }}><option value="">Select a Work Order from the current activity page</option>
      {activity.rows.map(row => <option key={row.workOrderId} value={row.workOrderId}>{row.workOrderId} · {row.vanId || 'Van unresolved'} · {row.date || 'Date not recorded'}</option>)}
    </select></label>
    <p className={s.muted}>The selector uses the current Scheduling activity page. Open another activity page to inspect its Work Orders. Quantities are shown per inventory record, not summed across different items or presented as a whole-project total.</p>
    {selectedOrder && <button type="button" className={s.button} disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh material evidence</button>}
    {loading && <p role="status">Reading recorded inventory issues…</p>}
    {error && <p className={s.error} role="alert">{error}</p>}
    {data && <>
      {data.coverage.importReviewPending && <p className={s.warning}>Original Project history remains under review. This is evidence for the selected linked Work Order only.</p>}
      {data.issues.length > 0 && <div role="alert" className={s.warning}><strong>Some inventory evidence requires review.</strong>
        {data.issues.map(issue => <p key={issue.movementId}>{issue.movementId} · {issue.code.replaceAll('_', ' ')}</p>)}
      </div>}
      {data.rows.length === 0 && data.issues.length === 0 && <p>No inventory issues are recorded on this page. This is not proof that the Project used no materials or incurred no cost.</p>}
      {data.rows.map(row => <article className={s.card} key={row.movementId}>
        <div className={s.sectionTitle}><h3>{row.itemName || row.itemId}</h3><strong>{new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(row.quantity)} recorded units</strong></div>
        <p>{row.itemKind} · {row.sourceLocationId} · {row.occurredAt}</p>
        <p className={s.muted}>{row.movementId} · Work Order status: {row.workOrderStatus}</p>
        <p>Historical cost: <strong>Not available from the connected source</strong></p>
      </article>)}
      <div className={s.pager}><button type="button" className={s.button} disabled={!previous.length || loading} onClick={() => {
        setCursor(previous.at(-1)); setPrevious(values => values.slice(0, -1));
      }}>Previous issues</button><button type="button" className={s.button} disabled={!data.nextCursor || loading} onClick={() => {
        setPrevious(values => [...values, cursor]); setCursor(data.nextCursor!);
      }}>Next issues</button></div>
    </>}
    <p className={s.warning}>These inventory records do not provide historical cost values. Confirmed manual expenses can support operational cost tracking when their amount and Project allocation are verified; accounting, payment and synchronization remain separate states. Current catalog prices are not historical costs, and inventory issues must not count a purchase a second time.</p>
  </section>;
}
