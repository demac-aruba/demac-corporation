'use client';

import { useState } from 'react';
import type {
  FieldExecutionJobDetail,
  FieldSaleDecision,
  FieldSaleExecutionTarget,
} from '@/lib/field-authority';
import { presentedFieldPriceLabel } from './field-price-display';
import styles from './technician-field-home.module.css';

export type FieldSaleCreateInput = { catalogItemId?: string; description?: string; quantity: number; unit?: string; assetId?: string; notes?: string };
export type FieldSaleDecisionInput = { saleLineId: string; decision: FieldSaleDecision; receiverName: string; note: string; expectedVersion: number };
export type FieldSaleTransitionInput = { saleLineId: string; to: FieldSaleExecutionTarget; note: string; expectedVersion: number };

function statusLabel(status: string) {
  return ({ proposed: 'Propuesta', customer_approved: 'Aprobada por cliente', installed: 'Instalada', delivered: 'Entregada', sold: 'Vendida', declined: 'Rechazada', voided: 'Anulada' } as Record<string, string>)[status] ?? status;
}

export function FieldSaleControls({ job, busy, error, onCreate, onDecide, onTransition }: {
  job: FieldExecutionJobDetail;
  busy: boolean;
  error: string | null;
  onCreate: (input: FieldSaleCreateInput) => Promise<boolean>;
  onDecide: (input: FieldSaleDecisionInput) => Promise<boolean>;
  onTransition: (input: FieldSaleTransitionInput) => Promise<boolean>;
}) {
  const [catalogItemId, setCatalogItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [assetId, setAssetId] = useState('');
  const [notes, setNotes] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customUnit, setCustomUnit] = useState('ea');
  const [customQuantity, setCustomQuantity] = useState(1);
  const [customAssetId, setCustomAssetId] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [receiverByLine, setReceiverByLine] = useState<Record<string, string>>({});
  const [decisionNoteByLine, setDecisionNoteByLine] = useState<Record<string, string>>({});
  const [voidNoteByLine, setVoidNoteByLine] = useState<Record<string, string>>({});
  const option = job.fieldSaleCatalogOptions.find((item) => item.catalogItemId === catalogItemId);
  const transitionByLine = new Map(job.fieldSaleTransitionOptions.map((item) => [item.saleLineId, item.allowedTargets]));
  const decisionIds = new Set(job.fieldSaleDecisionLineIds);

  const createCatalog = async () => {
    if (!option || quantity <= 0) return;
    if (await onCreate({ catalogItemId: option.catalogItemId, quantity, assetId: assetId || undefined, notes })) {
      setCatalogItemId(''); setQuantity(1); setAssetId(''); setNotes('');
    }
  };
  const createCustom = async () => {
    if (customDescription.trim().length < 3 || !customUnit.trim() || customQuantity <= 0) return;
    if (await onCreate({ description: customDescription.trim(), quantity: customQuantity, unit: customUnit.trim(), assetId: customAssetId || undefined, notes: customNotes })) {
      setCustomDescription(''); setCustomUnit('ea'); setCustomQuantity(1); setCustomAssetId(''); setCustomNotes('');
    }
  };

  return (
    <section className={styles.section}>
      <h2>VENTAS Y ADD-ONS EN CAMPO</h2>
      <p className={styles.helper}>Los productos y precios vienen del catálogo canónico. Registrar una línea no descuenta inventario ni crea una factura.</p>
      {job.fieldSaleLines.map((line) => {
        const receiver = receiverByLine[line.id] ?? '';
        const decisionNote = decisionNoteByLine[line.id] ?? '';
        const voidNote = voidNoteByLine[line.id] ?? '';
        const targets = transitionByLine.get(line.id) ?? [];
        return (
          <div className={styles.planned} key={line.id} style={{ marginTop: 12 }}>
            <div className={styles.plannedTitle}>{line.nonCatalog ? 'BORRADOR NO CATALOGADO · OFFICE REVIEW' : statusLabel(line.status)}</div>
            <strong>{line.descriptionSnapshot} · {line.quantity} {line.unit}</strong>
            <p>{line.priceSnapshot ? `${presentedFieldPriceLabel(line.priceSnapshot)} por unidad · total ${line.priceSnapshot.currency} ${line.priceSnapshot.lineTotal?.toFixed(2)}` : 'Sin precio: no puede venderse ni facturarse como artículo catalogado.'}</p>
            {line.notes ? <p>{line.notes}</p> : null}
            {decisionIds.has(line.id) ? (
              <div className={styles.interventionForm}>
                <label>Representante del cliente<input className={styles.select} disabled={busy} value={receiver} onChange={(event) => setReceiverByLine((current) => ({ ...current, [line.id]: event.target.value }))} /></label>
                <label>Nota de decisión<textarea className={styles.select} disabled={busy} rows={2} value={decisionNote} onChange={(event) => setDecisionNoteByLine((current) => ({ ...current, [line.id]: event.target.value }))} /></label>
                <div className={styles.visitActions}>
                  <button className={styles.action} disabled={busy || receiver.trim().length < 2} type="button" onClick={() => void onDecide({ saleLineId: line.id, decision: 'rejected', receiverName: receiver.trim(), note: decisionNote.trim(), expectedVersion: line.version })}>Cliente rechazó</button>
                  <button className={`${styles.action} ${styles.primary}`} disabled={busy || receiver.trim().length < 2} type="button" onClick={() => void onDecide({ saleLineId: line.id, decision: 'approved', receiverName: receiver.trim(), note: decisionNote.trim(), expectedVersion: line.version })}>Cliente aprobó</button>
                </div>
              </div>
            ) : null}
            {targets.length ? (
              <div className={styles.interventionForm}>
                {targets.includes('voided') ? <label>Motivo para anular<textarea className={styles.select} disabled={busy} rows={2} value={voidNote} onChange={(event) => setVoidNoteByLine((current) => ({ ...current, [line.id]: event.target.value }))} /></label> : null}
                <div className={styles.visitActions}>
                  {targets.map((target) => (
                    <button className={`${styles.action} ${target === 'sold' ? styles.primary : ''}`} disabled={busy || (target === 'voided' && voidNote.trim().length < 3)} key={target} type="button" onClick={() => void onTransition({ saleLineId: line.id, to: target as FieldSaleExecutionTarget, note: target === 'voided' ? voidNote.trim() : '', expectedVersion: line.version })}>
                      {target === 'installed' ? 'Marcar instalada' : target === 'delivered' ? 'Marcar entregada' : target === 'sold' ? 'Confirmar vendida' : 'Anular línea'}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {job.canAddFieldSaleLine ? (
        <div className={styles.interventionForm} style={{ marginTop: 12 }}>
          <label>Producto catalogado<select className={styles.select} disabled={busy} value={catalogItemId} onChange={(event) => setCatalogItemId(event.target.value)}><option value="">Selecciona…</option>{job.fieldSaleCatalogOptions.map((item) => <option key={item.catalogItemId} value={item.catalogItemId}>{item.label} · {presentedFieldPriceLabel(item.priceSnapshot)}</option>)}</select></label>
          <label>Cantidad<input className={styles.select} disabled={busy} min={0.001} max={10000} step={0.001} type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <label>Equipo relacionado (opcional)<select className={styles.select} disabled={busy} value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Work Order general</option>{job.visitAssets.map((item) => <option key={item.id} value={item.assetId}>{item.locationLabel || item.assetId}</option>)}</select></label>
          <label>Nota<textarea className={styles.select} disabled={busy} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <button className={`${styles.action} ${styles.primary}`} disabled={busy || !option || quantity <= 0} type="button" onClick={() => void createCatalog()}>Agregar propuesta catalogada</button>
        </div>
      ) : null}
      {job.canAddNonCatalogFieldSaleLine ? (
        <details style={{ marginTop: 12 }}>
          <summary className={styles.helper}>Agregar borrador no catalogado para revisión de oficina</summary>
          <div className={styles.interventionForm}>
            <label>Descripción<textarea className={styles.select} disabled={busy} rows={2} value={customDescription} onChange={(event) => setCustomDescription(event.target.value)} /></label>
            <label>Unidad<input className={styles.select} disabled={busy} value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} /></label>
            <label>Cantidad<input className={styles.select} disabled={busy} min={0.001} max={10000} step={0.001} type="number" value={customQuantity} onChange={(event) => setCustomQuantity(Number(event.target.value))} /></label>
            <label>Equipo relacionado (opcional)<select className={styles.select} disabled={busy} value={customAssetId} onChange={(event) => setCustomAssetId(event.target.value)}><option value="">Work Order general</option>{job.visitAssets.map((item) => <option key={item.id} value={item.assetId}>{item.locationLabel || item.assetId}</option>)}</select></label>
            <label>Nota<textarea className={styles.select} disabled={busy} rows={2} value={customNotes} onChange={(event) => setCustomNotes(event.target.value)} /></label>
            <button className={styles.action} disabled={busy || customDescription.trim().length < 3 || !customUnit.trim() || customQuantity <= 0} type="button" onClick={() => void createCustom()}>Guardar borrador sin precio</button>
          </div>
        </details>
      ) : null}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </section>
  );
}
