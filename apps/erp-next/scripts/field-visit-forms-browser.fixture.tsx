// Synthetic projection for real form components; no application route or backend.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import type {FieldExecutionJobDetail} from '../lib/field-authority';
import {persistFirebaseWebSession} from '../lib/firebase/session';
import {FieldSaleControls} from '../components/field/field-sale-controls';
import {AdditionalApprovalControls} from '../components/field/additional-approval-controls';
import {InterventionExecutionControls} from '../components/field/intervention-execution-controls';
import {InterventionReportControls} from '../components/field/intervention-report-controls';
import {FreeTextReportControls} from '../components/field/free-text-report-controls';
import {CustomerAcknowledgementControls} from '../components/field/customer-acknowledgement-controls';
import {VisitOfficeReviewControls} from '../components/field/visit-office-review-controls';
import {EquipmentRegistrationControls} from '../components/field/equipment-registration-controls';
import {VisitPendingControls} from '../components/field/visit-pending-controls';
import {VisitReturnControls} from '../components/field/visit-return-controls';
import {VisitNoAccessControls} from '../components/field/visit-no-access-controls';
import {VisitCancellationControls} from '../components/field/visit-cancellation-controls';
import {requestProcedureExit} from '../lib/field-procedure-navigation';
import {saveFieldOfflineDraft} from '../lib/field-offline';
function account(uid:string){persistFirebaseWebSession({uid,email:uid+'@example.invalid',idToken:'synthetic',refreshToken:'unused',expiresAt:Date.now()+3600000});}
account('test-tech');
const sections=[['photo','photos'],['measurement','measurement_table'],['finding','findings'],['text','free_text'],['ack','customer_acknowledgement']].map(([id,type])=>({id,type,title:'DEMO '+id,required:false}));
const price={currency:'AWG',unitPrice:100,lineTotal:100};
const initial={workOrderId:'WO-1',fieldVisit:{id:'VISIT-1'},visitAssets:[{id:'VA-1',assetId:'AC-1',locationLabel:'Sala sintética'}],knownEquipment:[],scopeChanges:[],fieldApprovals:[],
 workInterventions:[{id:'WI-1',visitAssetId:'VA-1',interventionType:'Servicio sintético',priceSnapshot:price,version:1}],
 additionalApprovalInterventionIds:['WI-1'],canRecordAdditionalApproval:true,
 interventionExecutionOptions:[{interventionId:'WI-1',allowedTargets:['pending_part','completed']}],
 fieldSaleLines:[{id:'LINE-1',descriptionSnapshot:'Producto sintético',quantity:1,unit:'ea',priceSnapshot:price,status:'proposed',version:1}],
 fieldSaleCatalogOptions:[{catalogItemId:'CAT-1',label:'Producto de catálogo sintético',priceSnapshot:price}],fieldSaleTransitionOptions:[],fieldSaleDecisionLineIds:['LINE-1'],canAddFieldSaleLine:true,canAddNonCatalogFieldSaleLine:true,
 interventionReports:[{interventionId:'WI-1',template:{name:'DEMO',version:1,sections},sectionStatus:{},evidence:[],measurements:[],findings:[],checklistResponses:[],freeTextResponses:[],customerAcknowledgements:[]}],
 reportPhotoOptions:[{interventionId:'WI-1',sectionIds:['photo']}],reportMeasurementOptions:[{interventionId:'WI-1',sectionIds:['measurement']}],reportFindingOptions:[{interventionId:'WI-1',sectionIds:['finding']}],reportChecklistOptions:[],reportFreeTextOptions:[{interventionId:'WI-1',sectionIds:['text']}],reportCustomerAcknowledgementOptions:[{interventionId:'WI-1',sectionIds:['ack']}],
 officeReviewSubmission:{allowed:true,status:'returned',correctionRequired:true,revisionNumber:1,reviewerNote:'Aclara la medición sintética',blockers:[]},canAddExistingAsset:true,areas:[],
} as unknown as FieldExecutionJobDetail;
const events:unknown[]=[];
function App(){
 const [job,setJob]=useState(initial),[uid,setUid]=useState('test-tech');
 const mode=location.hash.slice(1)||'sale';
 const record=async(input:unknown)=>{events.push(input);return false;};
 Object.assign(window,{visitFixture:{events,canExit:requestProcedureExit,account:(next:string)=>flushSync(()=>{account(next);setUid(next);}),otherJob:()=>flushSync(()=>setJob({...initial,workOrderId:'WO-2'})),serverNote:()=>flushSync(()=>setJob({...job,interventionReports:job.interventionReports.map(r=>({...r,freeTextResponses:[{sectionId:'text',value:'Texto del otro técnico',version:2}]}))} as FieldExecutionJobDetail)),legacy:()=>saveFieldOfflineDraft({ownerUserId:uid,workOrderId:'WO-1',interventionId:'WI-1',sectionId:'text',baseVersion:0,value:'Original anterior de 5000 caracteres: '+ 'x'.repeat(4965)})}});
 const props={job,mutationBusy:false,error:null};
 return <main key={uid} data-work-order={job.workOrderId} data-owner={uid}><p>DEMO · Formularios sintéticos, sin acciones reales.</p>
 {mode==='sale'?<FieldSaleControls {...props} busy={false} onCreate={record} onDecide={record} onTransition={record}/>:null}
 {mode==='approval'?<AdditionalApprovalControls {...props} decidingInterventionId={null} onDecide={record}/>:null}
 {mode==='execution'?<InterventionExecutionControls {...props} transitioningInterventionId={null} onTransition={record}/>:null}
 {mode==='report'?<InterventionReportControls {...props} uploadingPhotoKey={null} savingMeasurementKey={null} savingFindingKey={null} savingChecklistKey={null} onAddPhoto={record} onAddMeasurement={record} onAddFinding={record} onSetChecklistItem={record}/>:null}
 {mode==='text'?<FreeTextReportControls {...props} savingKey={null} draftOwnerUserId={uid} allowDraftWhileOffline={true} onSave={record}/>:null}
 {mode==='ack'?<CustomerAcknowledgementControls {...props} savingKey={null} onRecord={record}/>:null}
 {mode==='office'?<VisitOfficeReviewControls job={job} disabled={false} saving={false} error={null} correctionNote="" onCorrectionNoteChange={()=>{}} onSubmit={record}/>:null}
 {mode==='equipment'?<EquipmentRegistrationControls {...props} registering={false} onRegister={record}/>:null}
 {mode==='pending'?<VisitPendingControls job={job} disabled={false} saving={false} onSubmit={record}/>:null}
 {mode==='return'?<VisitReturnControls job={job} disabled={false} saving={false} onSubmit={record}/>:null}
 {mode==='no-access'?<VisitNoAccessControls job={job} disabled={false} saving={false} onSubmit={record}/>:null}
 {mode==='cancel'?<VisitCancellationControls job={job} disabled={false} saving={false} onSubmit={record}/>:null}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
