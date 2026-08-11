'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BrowserFieldExecutionRecord } from '../../lib/browser-field';
import { loadBrowserInventoryTransfers } from '../../lib/browser-inventory-transfers';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import { deriveWorkOrderMaterialReadiness, inventorySnapshotForMaterialPlanning, loadWorkOrderMaterialPlans, saveWorkOrderMaterialPlan, type BrowserWorkOrderMaterialPlan, type WorkOrderMaterialPlanMode, type WorkOrderMaterialRequirementLine } from '../../lib/browser-workorder-materials';
import styles from './browser-workorder-materials.module.css';

function amount(value: number, unit: string) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
}

export function BrowserWorkOrderMaterials() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [plans, setPlans] = useState<BrowserWorkOrderMaterialPlan[]>([]);
  const [executions, setExecutions] = useState<BrowserFieldExecutionRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<WorkOrderMaterialPlanMode>('requirements');
  const [lines, setLines] = useState<WorkOrderMaterialRequirementLine[]>([]);
  const [itemCode, setItemCode] = useState('SW-220V');
  const [locationId, setLocationId] = useState('VAN-1');
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    const storedPlans = loadWorkOrderMaterialPlans();
    const storedExecutions = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
    setOrders(storedOrders);
    setPlans(storedPlans);
    setExecutions(storedExecutions);
    setSelectedId(storedOrders[storedOrders.length - 1]?.id ?? '');
  }, []);

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? orders[0];
  const selectedExecution = executions.find((execution) => execution.workOrderId === selectedOrder?.id);
  const balances = useMemo(() => inventorySnapshotForMaterialPlanning(), [plans, selectedId]);
  const transfers = useMemo(() => loadBrowserInventoryTransfers(), [plans, selectedId]);
  const assignedVans = useMemo(() => selectedOrder ? [selectedOrder.primaryVanId, selectedOrder.supportVanId].filter(Boolean) as string[] : [], [selectedOrder]);
  const catalog = useMemo(() => {
    const map = new Map<string, { itemCode: string; itemName: string; unit: 'ea' | 'lb' }>();
    for (const balance of balances.filter((item) => assignedVans.includes(item.locationId))) map.set(balance.itemCode, { itemCode: balance.itemCode, itemName: balance.itemName, unit: balance.unit });
    return [...map.values()];
  }, [assignedVans, balances]);

  useEffect(() => {
    if (!selectedOrder) return;
    const stored = plans.find((plan) => plan.workOrderId === selectedOrder.id);
    setMode(stored?.mode ?? 'requirements');
    setLines(stored?.lines ?? []);
    setLocationId(selectedOrder.primaryVanId);
    const first = catalog[0];
    if (first) setItemCode(first.itemCode);
    setQuantity(1);
    setNotice(null);
  }, [selectedOrder?.id, plans.length, catalog.length]);

  const draftPlan: BrowserWorkOrderMaterialPlan | undefined = selectedOrder ? {
    workOrderId: selectedOrder.id,
    mode,
    lines: mode === 'not_required' ? [] : lines,
    updatedAt: new Date().toISOString(),
    updatedBy: 'Operations / Preview',
  } : undefined;

  const draftPlans = useMemo(() => {
    if (!draftPlan) return plans;
    return plans.some((plan) => plan.workOrderId === draftPlan.workOrderId)
      ? plans.map((plan) => plan.workOrderId === draftPlan.workOrderId ? draftPlan : plan)
      : [...plans, draftPlan];
  }, [draftPlan, plans]);

  const readiness = selectedOrder ? deriveWorkOrderMaterialReadiness(selectedOrder, { plans: draftPlans, balances, transfers, orders, executions }) : null;
  const locked = selectedExecution?.technicianStatus === 'submitted';

  const metrics = useMemo(() => {
    const values = orders.map((order) => deriveWorkOrderMaterialReadiness(order, { plans, balances, transfers, orders, executions }));
    return {
      ready: values.filter((item) => item.status === 'ready').length,
      atRisk: values.filter((item) => item.status === 'at_risk').length,
      blocked: values.filter((item) => item.status === 'blocked').length,
      notChecked: values.filter((item) => item.planState === 'not_checked').length,
    };
  }, [balances, executions, orders, plans, transfers]);

  const addRequirement = () => {
    if (!selectedOrder || locked) return;
    const item = catalog.find((candidate) => candidate.itemCode === itemCode);
    if (!item || quantity <= 0 || !assignedVans.includes(locationId)) return;
    setMode('requirements');
    setLines((current) => {
      const existing = current.find((line) => line.itemCode === item.itemCode && line.assignedLocationId === locationId);
      if (existing) return current.map((line) => line.id === existing.id ? { ...line, quantity: line.quantity + quantity } : line);
      return [...current, { id: `MAT-${Date.now().toString().slice(-8)}`, itemCode: item.itemCode, itemName: item.itemName, unit: item.unit, quantity, assignedLocationId: locationId as WorkOrderMaterialRequirementLine['assignedLocationId'] }];
    });
    setNotice(`${item.itemName} added to the ${selectedOrder.id} material plan. Save the plan to make it operational.`);
  };

  const savePlan = () => {
    if (!selectedOrder || !draftPlan || locked) return;
    if (mode === 'requirements' && !lines.length) {
      setNotice('Add at least one requirement or explicitly choose “No additional tracked materials required.”');
      return;
    }
    const saved = saveWorkOrderMaterialPlan(draftPlan);
    setPlans((current) => current.some((plan) => plan.workOrderId === saved.workOrderId) ? current.map((plan) => plan.workOrderId === saved.workOrderId ? saved : plan) : [...current, saved]);
    setNotice(`${selectedOrder.id} material plan saved. Current stock, earlier reservations and inbound transfer commitments now determine this readiness dimension.`);
  };

  if (!orders.length) return null;

  return (
    <section className={styles.workspace}>
      <header><div><span>WORK ORDER READINESS · MATERIALS</span><h2>Material Requirements & Reservation Readiness</h2><p>Define what the job actually needs. ERP Next then checks physical van stock, earlier Work Order reservations and inbound transfer commitments without inventing parts.</p></div><label>Work Order<select value={selectedOrder.id} onChange={(event) => setSelectedId(event.target.value)}>{orders.slice().reverse().map((order) => <option value={order.id} key={order.id}>{order.id} · {order.customer}</option>)}</select></label></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <div className={styles.metrics}><article><span>Material Ready</span><strong>{metrics.ready}</strong><small>Explicitly checked and physically covered</small></article><article><span>At Risk</span><strong className={metrics.atRisk ? styles.warnText : ''}>{metrics.atRisk}</strong><small>Not checked or dependent on inbound stock</small></article><article><span>Blocked</span><strong className={metrics.blocked ? styles.dangerText : ''}>{metrics.blocked}</strong><small>Explicit shortage remains uncovered</small></article><article><span>Not Checked</span><strong>{metrics.notChecked}</strong><small>No material decision recorded yet</small></article></div>

      <div className={styles.context}><article><span>Customer / Site</span><strong>{selectedOrder.customer}</strong><small>{selectedOrder.site} · {selectedOrder.sector}</small></article><article><span>Assigned Stock Locations</span><strong>{assignedVans.join(' + ')}</strong><small>Requirements must be assigned to a van actually working this Work Order.</small></article><article><span>Material Readiness</span><strong className={readiness?.status === 'ready' ? styles.goodText : readiness?.status === 'blocked' ? styles.dangerText : styles.warnText}>{readiness?.status.replace('_', ' ').toUpperCase()}</strong><small>{readiness?.reason}</small></article></div>

      {locked ? <div className={styles.locked}><span>PLAN LOCKED</span><strong>Field report has already been submitted.</strong><p>Material requirements cannot be silently rewritten after technician submission. A future governed correction/adjustment workflow must preserve history.</p></div> : null}

      <div className={styles.modeBar}><div><strong>Material decision</strong><span>“Not required” is an explicit office decision. Leaving a Work Order unchecked remains At Risk.</span></div><div><button type="button" disabled={locked} className={mode === 'requirements' ? styles.activeMode : ''} onClick={() => setMode('requirements')}>Tracked requirements</button><button type="button" disabled={locked} className={mode === 'not_required' ? styles.activeMode : ''} onClick={() => { setMode('not_required'); setLines([]); }}>No additional tracked materials required</button></div></div>

      {mode === 'requirements' ? <>
        <section className={styles.creator}><div><strong>Add Required Material</strong><span>Current preview Item Master includes tracked operational lines already connected to the inventory ledger.</span></div><label>Assigned van<select disabled={locked} value={locationId} onChange={(event) => setLocationId(event.target.value)}>{assignedVans.map((van) => <option value={van} key={van}>{van}</option>)}</select></label><label>Item<select disabled={locked} value={itemCode} onChange={(event) => setItemCode(event.target.value)}>{catalog.map((item) => <option value={item.itemCode} key={item.itemCode}>{item.itemName}</option>)}</select></label><label>Quantity<input disabled={locked} type="number" min="0.1" step={catalog.find((item) => item.itemCode === itemCode)?.unit === 'lb' ? '0.1' : '1'} value={quantity} onChange={(event) => setQuantity(Math.max(0, Number(event.target.value) || 0))}/></label><button type="button" disabled={locked || !catalog.length || quantity <= 0} onClick={addRequirement}>Add Requirement</button></section>

        <div className={styles.tableWrap}><div className={styles.table}><div className={`${styles.row} ${styles.head}`}><span>Required Item</span><span>Van</span><span>Required</span><span>On Hand</span><span>Reserved Ahead</span><span>Available</span><span>Inbound</span><span>Status</span><span>Action</span></div>{readiness?.lines.length ? readiness.lines.map((line) => <div className={styles.row} key={line.id}><div><strong>{line.itemName}</strong><small>{line.itemCode}</small></div><strong>{line.assignedLocationId}</strong><span>{amount(line.quantity, line.unit)}</span><span>{amount(line.onHand, line.unit)}</span><span>{amount(line.reservedAhead, line.unit)}</span><strong>{amount(line.availableForJob, line.unit)}</strong><span>{amount(line.inboundIssued, line.unit)} issued<small>{amount(line.inboundPlanned, line.unit)} planned</small></span><b className={line.status === 'ready' ? styles.ready : line.status === 'blocked' ? styles.blocked : styles.risk}>{line.status.replace('_', ' ')}</b><button type="button" disabled={locked} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>Remove</button><p>{line.explanation}</p></div>) : <div className={styles.empty}><strong>No material requirements defined</strong><p>Add required tracked materials, or explicitly confirm that no additional tracked materials are required.</p></div>}</div></div>
      </> : <section className={styles.noMaterials}><span>EXPLICIT MATERIAL DECISION</span><strong>No additional tracked materials required for this Work Order.</strong><p>After saving, the material dimension is READY by policy. Normal van consumables remain governed by van stock-health policies but are not treated as explicit job blockers.</p></section>}

      <footer><div><span>READINESS RULE</span><strong>READY = required quantity physically available after earlier Work Order reservations.</strong><small>Issued/planned inbound stock can reduce a BLOCKED shortage to AT RISK, but never becomes READY until physically received.</small></div><div><a href="/inventory/">Open Inventory →</a><button type="button" disabled={locked} onClick={savePlan}>Save Material Plan</button></div></footer>
    </section>
  );
}
