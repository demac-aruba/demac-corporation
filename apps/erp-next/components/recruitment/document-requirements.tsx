'use client';
import { CATEGORIES, categoryLabel, type DocumentRequirement, type SupportingCategory } from '../../../../functions/careers/document-contract.js';

/** Same configuration editor in real Recruitment and isolated preview. IDs never change. */
export function DocumentRequirementsEditor({ value, onChange, panelClass, fieldClass, checkClass }: {
  value?: DocumentRequirement[]; onChange:(next:DocumentRequirement[])=>void;
  panelClass:string; fieldClass:string; checkClass:string;
}) {
  // Editing may be incomplete. Never run the server's strict parser during typing.
  const entries=value ?? [{category:'document' as const,required:false,helpEn:'',helpEs:'',reviewedSource:''}];
  const patch=(category:SupportingCategory,part:Partial<DocumentRequirement>)=>onChange(entries.map(entry=>entry.category===category?{...entry,...part}:entry));
  return <section className={panelClass} data-document-requirements>
    <h2>Supporting document requirements</h2>
    <p>Photo and CV keep their existing rules. Up to five supporting files total, 10 MB each; combined application limit 30 MB.</p>
    {CATEGORIES.map(category=>{
      const item=entries.find(entry=>entry.category===category),name=categoryLabel(category);
      return <fieldset key={category} style={{minWidth:0,margin:'16px 0',padding:16,border:'1px solid var(--border, #dce5ef)',borderRadius:12}}>
        <legend>{name}</legend>
        <label className={checkClass}><input type="checkbox" checked={!!item} onChange={e=>onChange(e.target.checked?[...entries,{category,required:false,helpEn:'',helpEs:'',reviewedSource:''}]:entries.filter(entry=>entry.category!==category))}/>Request {name.toLowerCase()}</label>
        {item && <>
          <label className={checkClass}><input type="checkbox" checked={item.required} onChange={e=>patch(category,{required:e.target.checked})}/>Require {name.toLowerCase()} before submission</label>
          <label className={fieldClass}>Purpose / applicant help · {name} · English<textarea maxLength={600} rows={2} value={item.helpEn} onChange={e=>patch(category,{helpEn:e.target.value})}/></label>
          <label className={fieldClass}>Ayuda para el candidato · {name} · Español<textarea maxLength={600} rows={2} value={item.helpEs} onChange={e=>patch(category,{helpEs:e.target.value})}/></label>
          {item.helpEn && <label className={checkClass}><input type="checkbox" disabled={!item.helpEs.trim()} checked={!!item.helpEs.trim()&&item.reviewedSource===item.helpEn.trim()} onChange={e=>patch(category,{reviewedSource:e.target.checked?item.helpEn.trim():''})}/>I reviewed this document help in Spanish.</label>}
          {!item.helpEn && <p>Blank help uses the built-in bilingual category explanation.</p>}
          {category==='id'&&<p role="status">ID uploads remain blocked until DEMAC explicitly approves their purpose, access and retention policy in the server release configuration. A draft can describe that proposed requirement; it does not authorize collecting identification.</p>}
        </>}
      </fieldset>;
    })}
  </section>;
}
