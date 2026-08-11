'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { applyScopeToFieldExecution, loadWorkOrderScopes, registeredAssetsForWorkOrder, saveWorkOrderScope, scopeStatus, temporaryScopeItems, type BrowserWorkOrderScopeRecord, type WorkOrderScopeItem } from '../../lib/browser-workorder-scope';
import styles from './browser-work-order-scope.module.css';

export function BrowserWorkOrderScope() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [scopes, setScopes] = useState<BrowserWorkOrderScopeRecord[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'registered_assets' | 'temporary_units'>('registered_assets');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    const storedScopes = loadWorkOrderScopes();
    setOrders(storedOrders);
    setScopes(storedScopes);
    setSelectedOrderId(storedOrders[storedOrders.length - 1]?.id ?? '');
  }, []);

  const order = orders.find((item) => item.id === selectedOrderId);
  const existingScope = scopes.find((scope) => scope.workOrderId === selectedOrderId);
  const registeredAssets = useMemo(() => order ? registeredAssetsForWorkOrder(order) : [], [order]);

  useEffect(() => {
    if (!order) return;
    const stored = loadWorkOrderScopes().find((scope) => scope.workOrderId === order.id);
    if (stored) {
      setSelectedAssetIds(stored.items.map((item) => item.assetId));
      setMode(stored.mode);
    } else {
      setSelectedAssetIds([]);
      setMode(registeredAssets.length ? 'registered_assets' : 'temporary_units');
    }
    setNotice(null);
  }, [order?.id, registeredAssets.length]);

  const availableItems: WorkOrderScopeItem[] = mode === 'registered_assets' ? registeredAssets : (order ? temporaryScopeItems(order) : []);
  const currentStatus = order ? scopeStatus(order, existingScope) : { complete: false, reason: 'No Work Order selected.' };
  const selectedCount = mode === 'temporary_units' ? availableItems.length : selectedAssetIds.length;
  const validCount = Boolean(order) && selectedCount === order!.totalQuantity;

  const toggleAsset = (assetId: string) => {
    if (!order || mode !== 'registered_assets') return;
    setNotice(null);
    setSelectedAssetIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      if (current.length >= order.totalQuantity) return current;
      return [...current, assetId];
    });
  };

  const saveScope = () => {
    if (!order) return;
    const items = mode === 'temporary_units'
      ? temporaryScopeItems(order)
      : registeredAssets.filter((asset) => selectedAssetIds.includes(asset.assetId));
    if (items.length !== order.totalQuantity) {
      setNotice(`Select exactly ${order.totalQuantity} equipment unit(s). ${items.length} selected.`);
      return;
    }
    const record: BrowserWorkOrderScopeRecord = {
      workOrderId: order.id,
      customerId: order.customerId,
      siteId: order.siteId,
      expectedQuantity: order.totalQuantity,
      items,
      mode,
      status: 'complete',
      updatedAt: new Date().toISOString(),
    };
    try {
      const nextScopes = saveWorkOrderScope(record);
      applyScopeToFieldExecution(order, record);
      setScopes(nextScopes);
      setSelectedAssetIds(items.map((item) => item.assetId));
      setNotice(`${order.id} scope saved: ${items.length} exact unit(s). The technician execution record now uses this same equipment scope.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to save Work Order scope.');
    }
  };

  if (!orders.length) return (
    <section className={styles.empty}><div><span>WORK ORDER EQUIPMENT SCOPE</span><strong>No Scheduling-created Work Order yet</strong><p>Create and confirm an appointment first. Exact equipment scope becomes available once the Work Order exists.</p></div><a href="/scheduling/">Open Scheduling →</a></section>
  );

  return (
    <section className={styles.workspace}>
      <header><div><span>WORK ORDER SCOPE CONTROL</span><h1>Exact HVAC Equipment Scope</h1><p>Select the exact registered units that belong to today’s Work Order. Quantity no longer means “all equipment at this property.”</p></div><div className={styles.orderPicker}><label>Work Order<select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}>{orders.slice().reverse().map((item) => <option value={item.id} key={item.id}>{item.id} · {item.customer}</option>)}</select></label></div></header>

      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      {order ? <>
        <div className={styles.summary}><article><span>Customer</span><strong>{order.customer}</strong><small>{order.customerId ?? 'Unregistered customer snapshot'}</small></article><article><span>Property</span><strong>{order.site}</strong><small>{order.siteId ?? order.sector}</small></article><article><span>Work Scope</span><strong>{order.customerFacingDescription}</strong><small>Expected quantity: {order.totalQuantity}</small></article><article><span>Current Scope</span><strong className={currentStatus.complete ? styles.good : styles.warn}>{currentStatus.complete ? 'COMPLETE' : 'NEEDS SCOPE'}</strong><small>{currentStatus.reason}</small></article></div>

        <div className={styles.modeBar}><div><strong>Equipment source</strong><span>Registered assets are preferred. Temporary units are a controlled fallback for installations/new equipment not yet registered.</span></div><div><button type="button" className={mode === 'registered_assets' ? styles.active : ''} disabled={!registeredAssets.length} onClick={() => { setMode('registered_assets'); setSelectedAssetIds(existingScope?.mode === 'registered_assets' ? existingScope.items.map((item) => item.assetId) : []); }}>Registered HVAC Assets</button><button type="button" className={mode === 'temporary_units' ? styles.active : ''} onClick={() => { setMode('temporary_units'); setSelectedAssetIds([]); }}>Temporary / Planned Units</button></div></div>

        <div className={styles.content}>
          <main>
            <div className={styles.sectionHead}><div><strong>{mode === 'registered_assets' ? 'Registered equipment at selected property' : 'Temporary planned equipment'}</strong><span>{mode === 'registered_assets' ? `${registeredAssets.length} asset(s) available · choose ${order.totalQuantity}` : `${order.totalQuantity} controlled placeholder(s) will be created for this Work Order`}</span></div><b className={validCount ? styles.goodPill : styles.warnPill}>{selectedCount} / {order.totalQuantity} selected</b></div>
            {mode === 'registered_assets' && !registeredAssets.length ? <div className={styles.noAssets}><strong>No registered equipment found for this property</strong><p>Register the HVAC assets in Customer 360 first, or use Temporary / Planned Units for a legitimate new-equipment installation workflow.</p><a href="/crm/">Open CRM →</a></div> : <div className={styles.assetGrid}>{availableItems.map((asset, index) => {
              const selected = mode === 'temporary_units' || selectedAssetIds.includes(asset.assetId);
              return <button type="button" className={`${styles.assetCard} ${selected ? styles.selected : ''}`} key={asset.assetId} onClick={() => toggleAsset(asset.assetId)} disabled={mode === 'temporary_units'}><div className={styles.assetIcon}>{index + 1}</div><div><span>{asset.assetId}</span><strong>{asset.name}</strong><small>{asset.type}{asset.capacity ? ` · ${asset.capacity}` : ''}{asset.serial && asset.serial !== '—' ? ` · S/N ${asset.serial}` : ''}</small></div><b>{selected ? '✓ Selected' : 'Select'}</b></button>;
            })}</div>}
          </main>

          <aside>
            <section className={styles.ruleCard}><span>SCOPE RULE</span><strong>Exact count must match the Work Order quantity.</strong><p>If a property has 7 registered units and this Work Order is for 2, exactly 2 assets must be selected. The technician will see those two records only.</p></section>
            <section className={styles.ruleCard}><span>FIELD HANDOFF</span><strong>Scope writes directly into the same field-execution record.</strong><p>No equipment list is retyped in the technician portal. Changing scope is blocked after the technician has submitted the Work Order to Office Review.</p></section>
            <section className={styles.ruleCard}><span>FUTURE FIREBASE</span><strong>Asset IDs become canonical references.</strong><p>Display names remain snapshots for usability, but Work Order scope will resolve the durable CRM Asset IDs.</p></section>
          </aside>
        </div>

        <footer><div><span>{validCount ? 'Scope is internally consistent.' : `Select exactly ${order.totalQuantity} unit(s) before saving.`}</span></div><div><a href="/field/">Open Field App</a><button type="button" disabled={!validCount} onClick={saveScope}>Save Exact Scope</button></div></footer>
      </> : null}
    </section>
  );
}
