'use client';

import type { FieldVisitFormTarget } from '../../lib/field-procedure-capture-store';
import { useProcedureForm } from './use-procedure-form';
import { ProcedureFormStatus } from './procedure-form-status';
import { fieldVisitFormTarget } from './field-form-context';
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

type SaleProps={
  job: FieldExecutionJobDetail;
  busy: boolean;
  error: string | null;
  onCreate: (input: FieldSaleCreateInput) => Promise<boolean>;
  onDecide: (input: FieldSaleDecisionInput) => Promise<boolean>;
  onTransition: (input: FieldSaleTransitionInput) => Promise<boolean>;
};
export function FieldSaleControls(props:SaleProps){
  const target=fieldVisitFormTarget(props.job);
  return <SaleControls key={JSON.stringify(target)} {...props} target={target}/>;
}
function SaleControls({job,busy:mutating,error,onCreate,onDecide,onTransition,target}:SaleProps&{target:FieldVisitFormTarget|null}) {
  const draft=useProcedureForm(target,'sales:create',{"catalogItemId": "", "quantity": "1", "assetId": "", "notes": "", "customDescription": "", "customUnit": "ea", "customQuantity": "1", "customAssetId": "", "customNotes": ""});
  const busy=mutating||!draft.ready;
  const blocked=busy||draft.saving||Boolean(draft.error);
  const catalogItemId=draft.value.catalogItemId, setCatalogItemId=(value:string)=>draft.field('catalogItemId',String(value));
  const quantity=Number(draft.value.quantity), setQuantity=(value:number)=>draft.field('quantity',String(value));
  const assetId=draft.value.assetId, setAssetId=(value:string)=>draft.field('assetId',String(value));
  const notes=draft.value.notes, setNotes=(value:string)=>draft.field('notes',String(value));
  const customDescription=draft.value.customDescription, setCustomDescription=(value:string)=>draft.field('customDescription',String(value));
  const customUnit=draft.value.customUnit, setCustomUnit=(value:string)=>draft.field('customUnit',String(value));
  const customQuantity=Number(draft.value.customQuantity), setCustomQuantity=(value:number)=>draft.field('customQuantity',String(value));
  const customAssetId=draft.value.customAssetId, setCustomAssetId=(value:string)=>draft.field('customAssetId',String(value));
  const customNotes=draft.value.customNotes, setCustomNotes=(value:string)=>draft.field('customNotes',String(value));
  const option = job.fieldSaleCatalogOptions.find((item) => item.catalogItemId === catalogItemId);
  const transitionByLine = new Map(job.fieldSaleTransitionOptions.map((item) => [item.saleLineId, item.allowedTargets]));
  const decisionIds = new Set(job.fieldSaleDecisionLineIds);

  const createCatalog = async () => {
    if(!await draft.flush())return;
    if (!option || quantity <= 0) return;
    if (await onCreate({ catalogItemId: option.catalogItemId, quantity, assetId: assetId || undefined, notes })) {
      setCatalogItemId(''); setQuantity(1); setAssetId(''); setNotes('');
    }
  };
  const createCustom = async () => {
    if(!await draft.flush())return;
    if (customDescription.trim().length < 3 || !customUnit.trim() || customQuantity <= 0) return;
    if (await onCreate({ description: customDescription.trim(), quantity: customQuantity, unit: customUnit.trim(), assetId: customAssetId || undefined, notes: customNotes })) {
      setCustomDescription(''); setCustomUnit('ea'); setCustomQuantity(1); setCustomAssetId(''); setCustomNotes('');
    }
  };

  return (
    <section className={styles.section}>
      <h2>VENTAS Y ADD-ONS EN CAMPO</h2>
      <p className={styles.helper}>Los productos y precios vienen del catálogo canónico. Registrar una línea no descuenta inventario ni crea una factura.</p>
      {job.fieldSaleLines.map(line=><SaleLineControls key={line.id} line={line} targets={(transitionByLine.get(line.id)??[]) as FieldSaleExecutionTarget[]} canDecide={decisionIds.has(line.id)} busy={mutating} onDecide={onDecide} onTransition={onTransition} target={target}/>)}
      {job.canAddFieldSaleLine||job.canAddNonCatalogFieldSaleLine?<ProcedureFormStatus draft={draft}/>:null}
      {job.canAddFieldSaleLine ? (
        <div className={styles.interventionForm} style={{ marginTop: 12 }}>
          <label>Producto catalogado<select className={styles.select} disabled={busy} value={catalogItemId} onChange={(event) => setCatalogItemId(event.target.value)}><option value="">Selecciona…</option>{job.fieldSaleCatalogOptions.map((item) => <option key={item.catalogItemId} value={item.catalogItemId}>{item.label} · {presentedFieldPriceLabel(item.priceSnapshot)}</option>)}</select></label>
          <label>Cantidad<input className={styles.select} disabled={busy} min={0.001} max={10000} step={0.001} type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <label>Equipo relacionado (opcional)<select className={styles.select} disabled={busy} value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Work Order general</option>{job.visitAssets.map((item) => <option key={item.id} value={item.assetId}>{item.locationLabel || item.assetId}</option>)}</select></label>
          <label>Nota<textarea className={styles.select} maxLength={1500} disabled={busy} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <button className={`${styles.action} ${styles.primary}`} disabled={blocked || !option || quantity <= 0} type="button" onClick={() => void createCatalog()}>Agregar propuesta catalogada</button>
        </div>
      ) : null}
      {job.canAddNonCatalogFieldSaleLine ? (
        <details style={{ marginTop: 12 }}>
          <summary className={styles.helper}>Agregar borrador no catalogado para revisión de oficina</summary>
          <div className={styles.interventionForm}>
            <label>Descripción<textarea className={styles.select} maxLength={1500} disabled={busy} rows={2} value={customDescription} onChange={(event) => setCustomDescription(event.target.value)} /></label>
            <label>Unidad<input className={styles.select} disabled={busy} value={customUnit} onChange={(event) => setCustomUnit(event.target.value)} /></label>
            <label>Cantidad<input className={styles.select} disabled={busy} min={0.001} max={10000} step={0.001} type="number" value={customQuantity} onChange={(event) => setCustomQuantity(Number(event.target.value))} /></label>
            <label>Equipo relacionado (opcional)<select className={styles.select} disabled={busy} value={customAssetId} onChange={(event) => setCustomAssetId(event.target.value)}><option value="">Work Order general</option>{job.visitAssets.map((item) => <option key={item.id} value={item.assetId}>{item.locationLabel || item.assetId}</option>)}</select></label>
            <label>Nota<textarea className={styles.select} maxLength={1500} disabled={busy} rows={2} value={customNotes} onChange={(event) => setCustomNotes(event.target.value)} /></label>
            <button className={styles.action} disabled={blocked || customDescription.trim().length < 3 || !customUnit.trim() || customQuantity <= 0} type="button" onClick={() => void createCustom()}>Guardar borrador sin precio</button>
          </div>
        </details>
      ) : null}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </section>
  );
}

function SaleLineControls({line,targets,canDecide,busy:mutating,onDecide:decide,onTransition:transition,target}:{
  line:FieldExecutionJobDetail['fieldSaleLines'][number];targets:FieldSaleExecutionTarget[];canDecide:boolean;busy:boolean;
  onDecide:SaleProps['onDecide'];onTransition:SaleProps['onTransition'];target:FieldVisitFormTarget|null;
}) {
  const draft=useProcedureForm(target,'sales:'+line.id,{receiver:'',decisionNote:'',voidNote:''});
  const {receiver,decisionNote,voidNote}=draft.value;
  const busy=mutating||!draft.ready,blocked=busy||draft.saving||Boolean(draft.error);
  async function onDecide(input:FieldSaleDecisionInput){if(!await draft.flush())return false;const saved=await decide(input);if(saved)draft.clear();return saved;}
  async function onTransition(input:FieldSaleTransitionInput){if(!await draft.flush())return false;const saved=await transition(input);if(saved)draft.clear();return saved;}
  return (
          <div className={styles.planned} key={line.id} style={{ marginTop: 12 }}>
            <div className={styles.plannedTitle}>{line.nonCatalog ? 'BORRADOR NO CATALOGADO · OFFICE REVIEW' : statusLabel(line.status)}</div>
            <strong>{line.descriptionSnapshot} · {line.quantity} {line.unit}</strong>
            <p>{line.priceSnapshot ? `${presentedFieldPriceLabel(line.priceSnapshot)} por unidad · total ${line.priceSnapshot.currency} ${line.priceSnapshot.lineTotal?.toFixed(2)}` : 'Sin precio: no puede venderse ni facturarse como artículo catalogado.'}</p>
            {line.notes ? <p>{line.notes}</p> : null}
            {canDecide||targets.length?<ProcedureFormStatus draft={draft}/>:null}
            {canDecide ? (
              <div className={styles.interventionForm}>
                <label>Representante del cliente<input className={styles.select} disabled={busy} value={receiver} onChange={(event) => draft.field('receiver',event.target.value)} /></label>
                <label>Nota de decisión<textarea className={styles.select} disabled={busy} rows={2} value={decisionNote} onChange={(event) => draft.field('decisionNote',event.target.value)} /></label>
                <div className={styles.visitActions}>
                  <button className={styles.action} disabled={blocked || receiver.trim().length < 2} type="button" onClick={() => void onDecide({ saleLineId: line.id, decision: 'rejected', receiverName: receiver.trim(), note: decisionNote.trim(), expectedVersion: line.version })}>Cliente rechazó</button>
                  <button className={`${styles.action} ${styles.primary}`} disabled={blocked || receiver.trim().length < 2} type="button" onClick={() => void onDecide({ saleLineId: line.id, decision: 'approved', receiverName: receiver.trim(), note: decisionNote.trim(), expectedVersion: line.version })}>Cliente aprobó</button>
                </div>
              </div>
            ) : null}
            {targets.length ? (
              <div className={styles.interventionForm}>
                {targets.includes('voided') ? <label>Motivo para anular<textarea className={styles.select} disabled={busy} rows={2} value={voidNote} onChange={(event) => draft.field('voidNote',event.target.value)} /></label> : null}
                <div className={styles.visitActions}>
                  {targets.map((target) => (
                    <button className={`${styles.action} ${target === 'sold' ? styles.primary : ''}`} disabled={blocked || (target === 'voided' && voidNote.trim().length < 3)} key={target} type="button" onClick={() => void onTransition({ saleLineId: line.id, to: target as FieldSaleExecutionTarget, note: target === 'voided' ? voidNote.trim() : '', expectedVersion: line.version })}>
                      {target === 'installed' ? 'Marcar instalada' : target === 'delivered' ? 'Marcar entregada' : target === 'sold' ? 'Confirmar vendida' : 'Anular línea'}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
);
}
