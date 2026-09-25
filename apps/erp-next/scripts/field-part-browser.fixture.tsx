import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FieldPartSelector } from '../components/field/field-part-selector';
import { FieldPortalHeader, FieldPortalNavigation, FieldPortalIdentity, FieldJobContext, fieldPortalStyles } from '../components/field/field-portal-chrome';
import { persistFirebaseWebSession } from '../lib/firebase/session';
import type { FieldScheduleJob } from '../lib/field-authority-contract';
import { getFieldProcedureSummary } from '../lib/field-authority';
// Component/transport fixture ONLY. Synthetic tokens are accepted only by this loopback test server.
const demoJob = {
 id:'WO-1',workOrderId:'WO-1',appointmentId:'APT-1',date:'2026-09-24',time:'10:30',endTime:'11:30',status:'En proceso',customerId:'CLIENT-1',customerName:'DEMO · Cliente de prueba',propertyId:'PROPERTY-1',propertyName:'DEMO · Casa de prueba',address:'Dirección sintética',plannedWork:[{id:'line-1',label:'Standard Service',quantity:1}],estimatedQuantity:1,vanId:'VAN-1',responsibility:'lead',assignmentSource:'direct_staff',allowedActions:['read'],fieldVisit:null,canPrepareVisit:false,canCreateReturnVisit:false,
 crew:{vanId:'VAN-1',vanName:'DEMO · Van 1',members:[{staffId:'staff-tech',name:'DEMO Technician',responsibility:'lead'},{staffId:'staff-helper',name:'DEMO Helper',responsibility:'helper'}]},
} as FieldScheduleJob;
function setSession(uid:string) {
 // Explicit synthetic account metadata; this fixture does not verify a real email or grant server authority.
 const syntheticSession={uid,email:`${uid}@example.invalid`,emailVerified:true,idToken:uid,refreshToken:'synthetic-unused-refresh',expiresAt:Date.now()+3_600_000,displayName:uid==='test-tech'?'DEMO Technician':'DEMO Helper'};
 persistFirebaseWebSession(syntheticSession);
}
function App() {
 const [uid,setUid]=useState(new URLSearchParams(location.search).get('actor')||'test-tech');
 const [assetId,setAssetId]=useState('AC-1');
 (window as any).changePartActor=(next:string)=>{setSession(next);setUid(next);};
 (window as any).changePartTarget=(next:string)=>setAssetId(next);
 (window as any).directPartRead=()=>getFieldProcedureSummary({ownerUserId:uid,visitId:'VISIT-1',interventionId:'WI-1',assetId});
 const job={...demoJob,responsibility:uid==='test-tech'?'lead':'helper'} as FieldScheduleJob;
 return <div className={fieldPortalStyles.portal}>
  <FieldPortalHeader title="Seleccionar parte" subtitle="Un aire · un servicio · dos partes" />
  <main className={fieldPortalStyles.surface}>
   <div role="note">DEMO · Prueba de componente con backend sintético local. No es un preview publicado.</div>
   <FieldJobContext job={job}/><FieldPortalIdentity name={uid==='test-tech'?'DEMO Technician':'DEMO Helper'} staffId={uid==='test-tech'?'staff-tech':'staff-helper'} date={job.date} job={job} compact />
   <FieldPartSelector target={{ownerUserId:uid,visitId:'VISIT-1',interventionId:'WI-1',assetId}} equipmentLabel="DEMO · Sala" equipmentDescription="Equipo sintético · Standard Service" onBack={()=>{(window as any).backCount=((window as any).backCount||0)+1;}}/>
  </main><FieldPortalNavigation active="jobs" onNavigate={()=>{}}/>
 </div>;
}
setSession(new URLSearchParams(location.search).get('actor')||'test-tech');
createRoot(document.getElementById('root')!).render(<App/>);
