'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { MAX_BACKUP_BYTES, verifyLocalBackup, inspectLocalBackup, projectImportCandidate, type LegacyProjectImportCandidate } from '../../../../../functions/projects/recovery';
import { minutesLabel, type RegistryRequest } from '@/lib/projects/registry-client-core';
import type { ImportPreview } from '@/lib/projects/registry-types';
import s from './projects-central.module.css';

export function ProjectImportPanel({request,enabled,locked,onApply}:{request:RegistryRequest;enabled:boolean;locked:boolean;onApply:(action:string,data:Record<string,unknown>)=>Promise<void>}) {
  const [raw,setRaw]=useState('');const [records,setRecords]=useState<Array<{id:string;name:string}>>([]);const [selected,setSelected]=useState('');const [origin,setOrigin]=useState('');
  const [preview,setPreview]=useState<ImportPreview|null>(null);const [candidate,setCandidate]=useState<LegacyProjectImportCandidate|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [checked,setChecked]=useState<string[]>([]);const [backup,setBackup]=useState(false);const [reason,setReason]=useState('');const generation=useRef(0);const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
  const resetPreview=()=>{generation.current++;controller.current?.abort();setPreview(null);setCandidate(null);setChecked([]);setBackup(false);setReason('');setError('');setBusy(false);};
  const file=async(event:ChangeEvent<HTMLInputElement>)=>{const chosen=event.currentTarget.files?.[0];event.currentTarget.value='';resetPreview();setRaw('');setRecords([]);setSelected('');setOrigin('');if(!chosen)return;const epoch=generation.current;setBusy(true);try{
    if(chosen.size>MAX_BACKUP_BYTES)throw Error('Backup file exceeds 16 MiB.');const text=await chosen.text();const verified=await verifyLocalBackup(text);const inspection=inspectLocalBackup(verified);
    if(inspection.issues.length)throw Error('The backup contains invalid, missing or duplicate source records. Review it before import.');
    const projects=(inspection.projects??[]).map(row=>{if(!row||typeof row!=='object')throw Error('Invalid project record.');const project=row as Record<string,unknown>;if(typeof project.id!=='string')throw Error('Missing project identity.');return {id:project.id,name:typeof project.name==='string'?project.name:project.id};});
    if(epoch===generation.current){setRaw(text);setRecords(projects);setOrigin(inspection.origin);}
  }catch(cause){if(epoch===generation.current)setError(cause instanceof Error?cause.message:'The file could not be verified.');}finally{if(epoch===generation.current)setBusy(false);}};
  const review=async()=>{resetPreview();const epoch=generation.current;setBusy(true);controller.current=new AbortController();try{
    const extracted=await projectImportCandidate(raw,selected);
    if(epoch!==generation.current)return;
    const result=await request<ImportPreview>({action:'preview_legacy_import',data:{candidate:extracted}},controller.current.signal);
    if(result.mode!=='dry_run'||result.writesPerformed!==0||result.projectId!==selected||!Array.isArray(result.warnings)||!Array.isArray(result.conflicts))throw Error('The server did not return a valid read-only preview.');
    if(epoch===generation.current){setCandidate(extracted);setPreview(result);}
  }catch(cause){if(epoch===generation.current)setError(cause instanceof Error?cause.message:'Preview failed.');}finally{if(epoch===generation.current)setBusy(false);}};
  const apply=async()=>{if(!preview||!candidate)return;setError('');try{await onApply('import_legacy_plan',{candidate,previewHash:preview.previewHash,acknowledgedWarnings:checked,backupConfirmed:backup,reason});resetPreview();setRaw('');setRecords([]);}catch(cause){setError(cause instanceof Error?cause.message:'Import could not be verified.');}};
  return <section className={`${s.card} ${s.form}`}><h2>Review an original browser backup</h2><p className={s.notice}>Select the saved Projects backup from the original browser. File verification runs on this device. Only the selected project is sent when you press Review import. Nothing is migrated automatically.</p><p><a className={s.button} href="/projects/recovery/">Backup and file verification</a></p>
    <label>Saved backup file<input type="file" accept=".json,application/json" disabled={busy||locked} onChange={event=>void file(event)}/></label>
    {origin&&<p>Source website: <strong>{origin}</strong></p>}
    {records.length>0&&<label>Select backed-up project<select value={selected} disabled={busy||locked} onChange={event=>{resetPreview();setSelected(event.target.value);}}><option value="">Choose a project</option>{records.map(project=><option key={project.id} value={project.id}>{project.name} · {project.id}</option>)}</select></label>}
    <div><button className={s.button} type="button" disabled={!selected||busy||locked} onClick={()=>void review()}>{busy?'Reviewing…':'Review import — no writes'}</button></div>
    {preview&&<section><div className={s.sectionTitle}><h3>{preview.projectNumber} · {preview.plan.name}</h3><span className={s.badge}>Read-only preview</span></div><dl className={s.detailList}><dt>Preserved project ID</dt><dd>{preview.projectId}</dd><dt>Captured estimate</dt><dd>{minutesLabel(preview.plan.budgetedVanMinutes)}</dd><dt>Phases preserved</dt><dd>{preview.plan.phases.length}</dd><dt>Original declared status</dt><dd>{preview.sourceDeclaredStatus} — execution is not certified by this import</dd></dl>
      {preview.conflicts.length>0&&<div className={s.error} role="alert"><strong>Import blocked</strong>{preview.conflicts.map(code=><p key={code}>{code.replaceAll('_',' ')}</p>)}</div>}
      <p className={s.warning}>Original records are preserved as recovery evidence. Local hours, reservations, costs and completion are not promoted into verified Field or financial data.</p>
      {preview.warnings.map(code=><label className={s.check} key={code}><input type="checkbox" disabled={locked} checked={checked.includes(code)} onChange={event=>setChecked(current=>event.target.checked?[...current,code]:current.filter(item=>item!==code))}/>{code.replaceAll('_',' ')}</label>)}
      <label className={s.check}><input type="checkbox" checked={backup} disabled={locked} onChange={event=>setBackup(event.target.checked)}/>I have retained and verified the original saved backup. This declaration is not a cloud-backup or restore-test certification.</label>
      <label>Reason for approving this import<textarea value={reason} disabled={locked} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label>
      {!enabled&&<p className={s.notice}>Import execution is disabled in this deployment. The original data has not been changed.</p>}
      <button type="button" className={s.primary} disabled={!enabled||locked||!preview.canImport||!backup||!reason.trim()||checked.length!==preview.warnings.length} onClick={()=>void apply()}>Import the reviewed project</button>
    </section>}
    {error&&<p className={s.error} role="alert">{error}</p>}
  </section>;
}
