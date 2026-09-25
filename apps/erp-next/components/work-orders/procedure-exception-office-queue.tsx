'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFieldProcedureExceptionQueue, type FieldProcedureExceptionQueueItem } from '@/lib/field-authority';
import { FieldProcedureWorkspace } from '@/components/field/field-procedure-workspace';
import styles from '@/components/field/field-procedure-workspace.module.css';

export function ProcedureExceptionOfficeQueue({ userId }: { userId:string }) {
  const [items,setItems]=useState<FieldProcedureExceptionQueueItem[]>([]);
  const [selected,setSelected]=useState<FieldProcedureExceptionQueueItem|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try {
      const response=await getFieldProcedureExceptionQueue();
      setItems(response.exceptions);
    } catch(e) {
      setItems([]);
      setError(e instanceof Error?e.message:'No se pudieron cargar las excepciones de procedimientos.');
    } finally { setLoading(false); }
  },[]);

  useEffect(()=>{void load();},[load]);

  if(selected) {
    return <section className={styles.workspace} aria-label="Revisión de excepción de procedimiento">
      <div className={styles.notice}>
        <strong>Revisión de oficina · excepción previa al cierre</strong>
        <p>{selected.workOrderId} · {selected.part==='indoor'?'Evaporadora':'Condensadora'} · {selected.stepId}</p>
        <p>La decisión queda en el expediente del procedimiento. No aprueba el reporte final ni crea una ejecución ficticia.</p>
      </div>
      <FieldProcedureWorkspace
        target={{ownerUserId:userId,visitId:selected.visitId,interventionId:selected.interventionId,assetId:selected.assetId}}
        initialPart={selected.part}
        initialStepId={selected.stepId}
        equipmentLabel={'A/C '+selected.assetId}
        equipmentDescription={selected.workOrderId+' · '+selected.title}
        onBack={()=>{setSelected(null);void load();}}
      />
    </section>;
  }

  if(!loading && !items.length && !error) return null;
  return <section className={styles.workspace} aria-label="Excepciones de procedimientos pendientes">
    <div className={styles.toolbar}>
      <div><h2>Excepciones de procedimientos</h2><small>Revisión previa a la finalización de cada parte. Separada de Office Review del reporte final.</small></div>
      <button type="button" onClick={()=>void load()} disabled={loading}>Actualizar</button>
    </div>
    {loading?<div className={styles.notice}>Buscando excepciones pendientes autorizadas…</div>:null}
    {error?<div className={styles.error} role="alert">{error}</div>:null}
    {!loading && items.length?<div className={styles.steps}>
      {items.map(item=><button type="button" className={styles.step} key={item.key} onClick={()=>setSelected(item)}>
        <span className={styles.number}>!</span>
        <span className={styles.stepCopy}>
          <strong>{item.workOrderId} · {item.title}</strong>
          <small>{item.part==='indoor'?'Evaporadora':'Condensadora'} · {item.stepId} · solicitada por {item.requestedByName}</small>
          <small>{item.reason}</small>
        </span>
      </button>)}
    </div>:null}
  </section>;
}
