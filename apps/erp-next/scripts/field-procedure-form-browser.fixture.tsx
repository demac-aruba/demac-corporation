import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useProcedureForm} from '../components/field/use-procedure-form';
import {ProcedureFormStatus} from '../components/field/procedure-form-status';
import {persistFirebaseWebSession} from '../lib/firebase/session';
import {requestProcedureExit} from '../lib/field-procedure-navigation';
import * as store from '../lib/field-procedure-capture-store';

const target=(uid:string)=>({ownerUserId:uid,visitId:'VISIT-1',interventionId:'WI-1',assetId:'AC-1'});
function account(uid:string){persistFirebaseWebSession({uid,email:uid+'@example.invalid',idToken:uid,refreshToken:'synthetic-unused',expiresAt:Date.now()+3600000});}
account('test-tech');
function Form({uid,scope}:{uid:string;scope:string}) {
  const draft=useProcedureForm(target(uid),scope,{note:'',person:''});
  const [confirmed,setConfirmed]=useState(false);
  return <main><p>DEMO · Borrador sintético, sin servidor ni datos reales.</p><ProcedureFormStatus draft={draft}/>
    <label>Nota<textarea aria-label="Nota" disabled={!draft.ready} value={draft.value.note} onChange={e=>draft.field('note',e.target.value)}/></label>
    <label>Persona<input aria-label="Persona" disabled={!draft.ready} value={draft.value.person} onChange={e=>draft.field('person',e.target.value)}/></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmación física nueva</label>
    <output id="state" data-ready={draft.ready} data-saving={draft.saving} data-error={draft.error}/>
  </main>;
}
function App(){
  const [uid,setUid]=useState('test-tech'),[scope,setScope]=useState('coordination');
  Object.assign(window,{formFixture:{scope:setScope,account:(next:string)=>{account(next);setUid(next);},canExit:requestProcedureExit,store,target:target(uid)}});
  return <Form key={uid+':'+scope} uid={uid} scope={scope}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
