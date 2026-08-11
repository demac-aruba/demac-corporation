'use client';

import { useEffect, useMemo, useState } from 'react';
import { defaultWorkPresets, type WorkPresetId } from '../../lib/scheduling';
import { loadBrowserToolAssets, loadToolRequirementPolicies, saveBrowserToolAssets, saveToolRequirementPolicies, toolClasses, type BrowserToolAsset, type BrowserToolRequirementPolicy, type ToolClass } from '../../lib/browser-tools';
import styles from './browser-tool-registry.module.css';

const locations: BrowserToolAsset['locationId'][] = ['OFFICE', 'VAN-1', 'VAN-2', 'VAN-3', 'VAN-4', 'UNASSIGNED'];
const statuses: BrowserToolAsset['status'][] = ['available', 'checked_out', 'maintenance', 'calibration_due', 'lost'];

function emptyPolicies(existing: BrowserToolRequirementPolicy[]) {
  return defaultWorkPresets.map((preset) => existing.find((policy) => policy.presetId === preset.id) ?? ({ presetId: preset.id, requiredClasses: [], reviewed: false, updatedAt: new Date(0).toISOString(), updatedBy: 'Not reviewed' } satisfies BrowserToolRequirementPolicy));
}

export function BrowserToolRegistry() {
  const [assets, setAssets] = useState<BrowserToolAsset[]>([]);
  const [policies, setPolicies] = useState<BrowserToolRequirementPolicy[]>([]);
  const [ready, setReady] = useState(false);
  const [assetDirty, setAssetDirty] = useState(false);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setAssets(loadBrowserToolAssets());
    setPolicies(emptyPolicies(loadToolRequirementPolicies()));
    setReady(true);
  }, []);

  const metrics = useMemo(() => ({
    total: assets.length,
    usable: assets.filter((asset) => asset.verified && asset.status === 'available').length,
    attention: assets.filter((asset) => asset.status === 'maintenance' || asset.status === 'calibration_due' || asset.status === 'lost').length,
    reviewedPolicies: policies.filter((policy) => policy.reviewed).length,
  }), [assets, policies]);

  const patchAsset = (id: string, patch: Partial<BrowserToolAsset>) => {
    setAssets((current) => current.map((asset) => asset.id === id ? { ...asset, ...patch } : asset));
    setAssetDirty(true);
  };

  const addAsset = () => {
    const id = `TOOL-${Date.now().toString().slice(-8)}`;
    setAssets((current) => [...current, { id, name: 'New Tool Asset', toolClass: 'Service Toolkit', locationId: 'UNASSIGNED', status: 'available', verified: false, updatedAt: new Date().toISOString() }]);
    setAssetDirty(true);
  };

  const togglePolicyClass = (presetId: WorkPresetId, toolClass: ToolClass) => {
    setPolicies((current) => current.map((policy) => {
      if (policy.presetId !== presetId) return policy;
      const requiredClasses = policy.requiredClasses.includes(toolClass) ? policy.requiredClasses.filter((value) => value !== toolClass) : [...policy.requiredClasses, toolClass];
      return { ...policy, requiredClasses, reviewed: false };
    }));
    setPolicyDirty(true);
  };

  const saveAssets = () => {
    setAssets(saveBrowserToolAssets(assets));
    setAssetDirty(false);
    setNotice('Tool Asset Registry saved. Only verified, available assets can satisfy Work Order tool readiness.');
  };

  const savePolicies = () => {
    setPolicies(emptyPolicies(saveToolRequirementPolicies(policies)));
    setPolicyDirty(false);
    setNotice('Tool Requirement Policy saved. Work Orders now recalculate Required Tools from the reviewed policy and assigned van custody.');
  };

  if (!ready) return <section className={styles.loading}>Loading tool registry…</section>;

  return (
    <section className={styles.workspace}>
      <header><div><span>COMPANY TOOL ASSETS · PREVIEW</span><h2>Tools, Custody & Work Requirements</h2><p>Company tools are tracked separately from consumable inventory. A Work Order can only be Tools READY when its reviewed policy is satisfied by verified usable tools on every assigned van.</p></div><div className={styles.actions}><button type="button" onClick={addAsset}>+ Tool Asset</button><button type="button" className={styles.primary} disabled={!assetDirty} onClick={saveAssets}>{assetDirty ? 'Save Tool Assets' : 'Assets Saved'}</button></div></header>
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.metrics}><article><span>Registered Tools</span><strong>{metrics.total}</strong><small>Company-owned tracked assets</small></article><article><span>Verified + Available</span><strong>{metrics.usable}</strong><small>Can satisfy readiness</small></article><article><span>Tool Attention</span><strong>{metrics.attention}</strong><small>Maintenance / calibration / lost</small></article><article><span>Reviewed Work Policies</span><strong>{metrics.reviewedPolicies}/{policies.length}</strong><small>Unreviewed remains AT RISK</small></article></div>

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><strong>Tool Asset Registry</strong><span>Physical custody, condition and verification</span></div><b>{assets.length}</b></div>
        {assets.length ? <div className={styles.assetTable}>
          <div className={`${styles.assetRow} ${styles.head}`}><span>Asset</span><span>Class</span><span>Location</span><span>Status</span><span>QR / Serial</span><span>Verified</span></div>
          {assets.map((asset) => <div className={styles.assetRow} key={asset.id}>
            <div><input value={asset.name} onChange={(event) => patchAsset(asset.id, { name: event.target.value, verified: false })}/><small>{asset.id}</small></div>
            <select value={asset.toolClass} onChange={(event) => patchAsset(asset.id, { toolClass: event.target.value as ToolClass, verified: false })}>{toolClasses.map((toolClass) => <option value={toolClass} key={toolClass}>{toolClass}</option>)}</select>
            <select value={asset.locationId} onChange={(event) => patchAsset(asset.id, { locationId: event.target.value as BrowserToolAsset['locationId'], verified: false })}>{locations.map((location) => <option value={location} key={location}>{location}</option>)}</select>
            <select value={asset.status} onChange={(event) => patchAsset(asset.id, { status: event.target.value as BrowserToolAsset['status'] })}>{statuses.map((status) => <option value={status} key={status}>{status.replaceAll('_', ' ')}</option>)}</select>
            <input value={asset.serialOrQr ?? ''} onChange={(event) => patchAsset(asset.id, { serialOrQr: event.target.value, verified: false })} placeholder="Optional" />
            <label className={styles.check}><input type="checkbox" checked={asset.verified} onChange={(event) => patchAsset(asset.id, { verified: event.target.checked })}/><span>{asset.verified ? 'Verified' : 'Review'}</span></label>
          </div>)}
        </div> : <div className={styles.empty}><strong>No company tools registered yet</strong><p>Add actual tool assets when ready. The ERP intentionally does not create fake vacuum pumps, gauges or drills just to make readiness green.</p></div>}
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHead}><div><strong>Tool Requirement Policy</strong><span>Explicit required tool classes by Work Preset</span></div><button type="button" className={styles.primary} disabled={!policyDirty} onClick={savePolicies}>{policyDirty ? 'Save Policy' : 'Policy Saved'}</button></div>
        <div className={styles.policyList}>{policies.map((policy) => {
          const preset = defaultWorkPresets.find((item) => item.id === policy.presetId);
          return <article key={policy.presetId} className={policy.reviewed ? styles.reviewed : ''}><header><div><strong>{preset?.label ?? policy.presetId}</strong><small>{policy.reviewed ? `Reviewed · ${policy.updatedBy}` : 'Not reviewed — Work Orders remain AT RISK'}</small></div><label className={styles.check}><input type="checkbox" checked={policy.reviewed} onChange={(event) => { setPolicies((current) => current.map((item) => item.presetId === policy.presetId ? { ...item, reviewed: event.target.checked } : item)); setPolicyDirty(true); }}/><span>Reviewed</span></label></header><div className={styles.classPills}>{toolClasses.map((toolClass) => <button type="button" key={toolClass} className={policy.requiredClasses.includes(toolClass) ? styles.selected : ''} onClick={() => togglePolicyClass(policy.presetId, toolClass)}>{policy.requiredClasses.includes(toolClass) ? '✓ ' : ''}{toolClass}</button>)}</div>{policy.reviewed && !policy.requiredClasses.length ? <p>Explicitly reviewed: no tracked company tool required.</p> : null}</article>;
        })}</div>
      </section>

      <footer><span>READINESS RULE</span><strong>Policy not reviewed → AT RISK. Reviewed policy + missing registered tool → BLOCKED. Unverified matching tool → AT RISK. Verified available required tools on every assigned van → READY.</strong></footer>
    </section>
  );
}
