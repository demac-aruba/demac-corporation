'use client';

import { useEffect, useState } from 'react';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import styles from './browser-work-order-handoff.module.css';

function timeRange(order: BrowserWorkOrderRecord) {
  return `${order.scheduledStart}–${order.scheduledEnd}`;
}

export function BrowserWorkOrderHandoff() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setOrders(loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []));
  }, []);

  if (!orders.length) return (
    <section className={styles.empty}>
      <div><span>OPERATIONAL HANDOFF</span><strong>No browser-created work orders yet</strong><p>Create a test appointment in Scheduling, place it on temporary hold, then confirm it. ERP Next will create the Work Order without re-entering the job information.</p></div>
      <a href="/scheduling/">Open Scheduling →</a>
    </section>
  );

  return (
    <section className={styles.panel}>
      <header><div><span>LIVE BROWSER TEST FLOW</span><h2>Appointment → Work Order Handoff</h2><p>These records were created by confirming appointments in Scheduling and survive refresh on this browser.</p></div><b>{orders.length} linked</b></header>
      <div className={styles.list}>{orders.slice().reverse().map((order) => {
        const expanded = expandedId === order.id;
        return <article key={order.id} className={styles.card}>
          <div className={styles.cardHead}><div><span>{order.id} · from {order.appointmentId}</span><strong>{order.customer}</strong><small>{order.site} · {order.sector}</small></div><b className={order.readiness === 'ready' ? styles.ready : order.readiness === 'blocked' ? styles.blocked : styles.risk}>{order.readiness.replace('_', ' ')}</b></div>
          <div className={styles.summary}><div><span>Schedule</span><strong>{order.scheduledDate}</strong><small>{timeRange(order)}</small></div><div><span>Work</span><strong>{order.customerFacingDescription}</strong><small>{order.totalQuantity} unit{order.totalQuantity === 1 ? '' : 's'}</small></div><div><span>Primary</span><strong>{order.primaryVanId}</strong><small>Customer communication owner</small></div><div><span>Support</span><strong>{order.supportVanId ?? 'None'}</strong><small>{order.supportVanId ? 'Linked · no duplicate messages' : 'Single-team job'}</small></div></div>
          {expanded ? <div className={styles.detail}><div><span>Technician instructions</span><p>{order.technicianInstructions || 'No internal instructions captured.'}</p></div><div><span>Assignments</span>{order.assignments.map((assignment) => <p key={`${order.id}-${assignment.vanId}-${assignment.role}`}><strong>{assignment.vanId}</strong> · {assignment.role} · {assignment.quantity} unit{assignment.quantity === 1 ? '' : 's'} {assignment.customerCommunicationOwner ? '· communication owner' : ''}</p>)}</div><div><span>Data handoff</span><p>Customer, site, work type, quantity, schedule, van allocation and technician instructions were inherited from the appointment. No customer form was re-entered.</p></div></div> : null}
          <button type="button" onClick={() => setExpandedId(expanded ? null : order.id)}>{expanded ? 'Hide handoff details' : 'Inspect handoff'}</button>
        </article>;
      })}</div>
    </section>
  );
}
