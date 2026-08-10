'use client';

import { useMemo, useState } from 'react';
import styles from './relationship-detail.module.css';

export type SiteDetail = {
  id: string;
  name: string;
  address: string;
  sector: string;
  gac: string;
  access: string;
};

export type AssetDetail = {
  id: string;
  site: string;
  type: string;
  name: string;
  brand: string;
  capacity: string;
  serial: string;
  status: string;
};

export type MergeCustomerIdentity = {
  id: string;
  name: string;
  phone: string;
  email: string;
  type: string;
};

function DrawerShell({ title, eyebrow, subtitle, onClose, children, footer }: { title: string; eyebrow: string; subtitle: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true">
        <header className={styles.header}>
          <div><span>{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </aside>
    </div>
  );
}

export function SiteDetailDrawer({ site, assets, onClose }: { site: SiteDetail; assets: AssetDetail[]; onClose: () => void }) {
  const siteAssets = assets.filter((asset) => asset.site === site.name);
  return (
    <DrawerShell eyebrow="Property 360" title={site.name} subtitle="Operational location profile, service access, equipment and work context." onClose={onClose} footer={<><button type="button" className={styles.secondary}>Edit property</button><button type="button" className={styles.primary}>+ Create work order</button></>}>
      <section className={styles.heroCard}>
        <div className={styles.heroIcon}>⌂</div>
        <div><span className={styles.status}>ACTIVE SITE</span><strong>{site.address}</strong><p>{site.sector}</p></div>
      </section>

      <section className={styles.kpiGrid}>
        <article><span>HVAC Assets</span><strong>{siteAssets.length}</strong><small>Registered at this property</small></article>
        <article><span>Open Work</span><strong>1</strong><small>Scheduled / active</small></article>
        <article><span>Readiness</span><strong className={styles.good}>Ready</strong><small>Current operational check</small></article>
        <article><span>Last Service</span><strong>18 days</strong><small>Since latest completed visit</small></article>
      </section>

      <section className={styles.panel}>
        <header><div><strong>Location & Routing Profile</strong><span>Address intelligence used by scheduling and dispatch</span></div><button type="button">Edit</button></header>
        <div className={styles.infoGrid}>
          <div><span>Full address</span><strong>{site.address}</strong></div>
          <div><span>GAC classification</span><strong>{site.gac}</strong></div>
          <div><span>DEMAC sector</span><strong>{site.sector}</strong></div>
          <div><span>Geocode</span><strong>Pending verified coordinates</strong></div>
          <div className={styles.wide}><span>Access / parking / gate notes</span><strong>{site.access}</strong></div>
        </div>
      </section>

      <section className={styles.panel}>
        <header><div><strong>Equipment at this property</strong><span>Assets retain independent technical and service history</span></div><button type="button">Register equipment</button></header>
        <div className={styles.compactList}>
          {siteAssets.length ? siteAssets.map((asset) => <div key={asset.id}><span className={styles.miniIcon}>AC</span><div><strong>{asset.name}</strong><small>{asset.type} · {asset.brand} · {asset.capacity}</small></div><b>{asset.status}</b></div>) : <div className={styles.empty}>No equipment has been registered at this property yet.</div>}
        </div>
      </section>

      <section className={styles.panel}>
        <header><div><strong>Recent property activity</strong><span>Site-specific work without mixing other customer locations</span></div><button type="button">Full history</button></header>
        <div className={styles.timeline}>
          <div><time>Aug 8</time><span /><p><strong>Standard service completed</strong><small>Technician report approved by office.</small></p></div>
          <div><time>Jul 12</time><span /><p><strong>Diagnostic visit</strong><small>Drain condition reviewed and recommendation created.</small></p></div>
          <div><time>Jun 04</time><span /><p><strong>Equipment added</strong><small>New HVAC asset registered to this property.</small></p></div>
        </div>
      </section>
    </DrawerShell>
  );
}

export function AssetDetailDrawer({ asset, onClose }: { asset: AssetDetail; onClose: () => void }) {
  return (
    <DrawerShell eyebrow="Equipment 360" title={asset.name} subtitle={`${asset.type} · ${asset.site} · durable HVAC asset record`} onClose={onClose} footer={<><button type="button" className={styles.secondary}>Edit technical profile</button><button type="button" className={styles.primary}>Schedule service</button></>}>
      <section className={styles.heroCard}>
        <div className={styles.heroIcon}>❄</div>
        <div><span className={styles.status}>{asset.status.toUpperCase()}</span><strong>{asset.brand} · {asset.capacity}</strong><p>{asset.site}</p></div>
      </section>

      <section className={styles.kpiGrid}>
        <article><span>Service Health</span><strong className={styles.good}>92/100</strong><small>No active critical findings</small></article>
        <article><span>Last Service</span><strong>Aug 8</strong><small>Standard maintenance</small></article>
        <article><span>Open Findings</span><strong>1</strong><small>Non-critical recommendation</small></article>
        <article><span>Warranty</span><strong>Active</strong><small>Verification at source later</small></article>
      </section>

      <section className={styles.panel}>
        <header><div><strong>Technical identity</strong><span>Stable information reused on every technician visit</span></div><button type="button">Edit</button></header>
        <div className={styles.infoGrid}>
          <div><span>System type</span><strong>{asset.type}</strong></div>
          <div><span>Capacity</span><strong>{asset.capacity}</strong></div>
          <div><span>Brand</span><strong>{asset.brand}</strong></div>
          <div><span>Serial number</span><strong>{asset.serial}</strong></div>
          <div><span>Refrigerant</span><strong>{asset.brand.toLowerCase().includes('adina') ? 'R32' : 'To be verified'}</strong></div>
          <div><span>Voltage</span><strong>220 V · verify field plate</strong></div>
          <div><span>QR identity</span><strong>Ready for QR assignment</strong></div>
          <div><span>Asset ID</span><strong>{asset.id}</strong></div>
        </div>
      </section>

      <section className={styles.panel}>
        <header><div><strong>Service history</strong><span>Technical history follows the equipment, not the appointment</span></div><button type="button">Open full history</button></header>
        <div className={styles.timeline}>
          <div><time>Aug 8</time><span /><p><strong>Standard service</strong><small>Measurements, photos and customer report retained.</small></p></div>
          <div><time>Apr 17</time><span /><p><strong>Deep cleaning</strong><small>Evaporator and drain system serviced.</small></p></div>
          <div><time>Jan 09</time><span /><p><strong>Diagnostic</strong><small>Refrigerant condition and electrical components checked.</small></p></div>
        </div>
      </section>

      <section className={styles.aiCard}><span>AI</span><div><strong>Equipment intelligence</strong><p>This asset has regular maintenance history. A future intelligence layer can use real measurements, findings and failure patterns to recommend preventive action without inventing technical facts.</p></div></section>
    </DrawerShell>
  );
}

export function DuplicateReviewDrawer({ customers, onClose }: { customers: MergeCustomerIdentity[]; onClose: () => void }) {
  const [merged, setMerged] = useState(false);
  const primary = customers[0];
  const incoming = useMemo(() => primary ? { id: 'IMPORT-221', name: primary.name.replace(/N\.V\./i, '').trim() || primary.name, phone: primary.phone, email: primary.email, source: 'Legacy import / WhatsApp identity' } : null, [primary]);

  if (!primary || !incoming) return null;

  return (
    <DrawerShell eyebrow="Data Quality" title="Duplicate Review & Merge" subtitle="Consolidate identities without losing jobs, payments, properties, equipment or communication history." onClose={onClose} footer={merged ? <button type="button" className={styles.primary} onClick={onClose}>Done</button> : <><button type="button" className={styles.secondary} onClick={onClose}>Cancel</button><button type="button" className={styles.primary} onClick={() => setMerged(true)}>Confirm preview merge</button></>}>
      {merged ? (
        <section className={styles.mergeSuccess}><span>✓</span><div><strong>Preview merge completed</strong><p>The incoming identity is now treated as an alias of <b>{primary.name}</b>. No history was deleted. Firebase has not been changed.</p></div></section>
      ) : (
        <>
          <section className={styles.matchScore}><div><span>Match confidence</span><strong>98%</strong></div><div className={styles.scoreTrack}><i /></div><p>Exact phone + exact email + highly similar display name. Human approval is still required.</p></section>

          <div className={styles.mergeColumns}>
            <section className={styles.mergeCard}><span>KEEP AS PRIMARY</span><h3>{primary.name}</h3><p>{primary.id} · {primary.type}</p><dl><div><dt>Phone</dt><dd>{primary.phone}</dd></div><div><dt>Email</dt><dd>{primary.email}</dd></div><div><dt>Source</dt><dd>Canonical ERP customer</dd></div></dl></section>
            <div className={styles.mergeArrow}>→</div>
            <section className={styles.mergeCard}><span>MERGE / ALIAS</span><h3>{incoming.name}</h3><p>{incoming.id}</p><dl><div><dt>Phone</dt><dd>{incoming.phone}</dd></div><div><dt>Email</dt><dd>{incoming.email}</dd></div><div><dt>Source</dt><dd>{incoming.source}</dd></div></dl></section>
          </div>

          <section className={styles.preserveCard}><strong>What will be preserved</strong><div className={styles.preserveGrid}><span>✓ Properties & sites</span><span>✓ HVAC equipment</span><span>✓ Work orders</span><span>✓ Appointments</span><span>✓ Invoices & payments</span><span>✓ WhatsApp / call history</span><span>✓ Documents</span><span>✓ Audit trail</span></div><p>The duplicate record becomes a historical alias/reference. Transactions are relinked to the canonical customer instead of being deleted.</p></section>
        </>
      )}
    </DrawerShell>
  );
}
