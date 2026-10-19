'use client';
import { firebaseClientConfig } from './firebase/client-config';
import { existingCredential } from './performance-client-core';
import type { MonitorDashboard,MonitorIncident } from './messaging-monitor-types';

export async function monitorRequest(action:string,data:Record<string,unknown>,uid:string,externalSignal?:AbortSignal) {
  const auth=existingCredential(window.sessionStorage,uid,Date.now());
  if(!auth)throw new Error('No se pudo verificar tu sesión. Actualiza tu acceso para consultar el monitor.');
  if(!firebaseClientConfig.projectId)throw new Error('La conexión del monitor no está configurada.');
  const controller=new AbortController();const abort=()=>controller.abort();
  if(externalSignal?.aborted)abort();externalSignal?.addEventListener('abort',abort,{once:true});
  const timer=window.setTimeout(abort,10000);
  try {
    const response=await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/whatsappMessagingMonitor`,{
      method:'POST',headers:{Authorization:`Bearer ${auth.idToken}`,'Content-Type':'application/json'},body:JSON.stringify({action,data}),signal:controller.signal});
    const body=await response.json().catch(()=>null);
    if(!response.ok||!body?.success)throw new Error(body?.error?.message || 'El monitor no está disponible. Los envíos no se han modificado.');
    return body;
  } finally {window.clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);}
}
export async function getMessagingDashboard(uid:string,signal?:AbortSignal):Promise<MonitorDashboard> {
  const body=await monitorRequest('dashboard',{},uid,signal);
  if(body.version!==1 || typeof body.enabled!=='boolean' || (body.snapshot && (!Array.isArray(body.snapshot.incidents)||!Array.isArray(body.snapshot.coverage)||!body.snapshot.counts||!body.snapshot.flows||!body.snapshot.transport||!body.snapshot.daily||!body.snapshot.notifications)))throw new Error('La respuesta del monitor no permite verificar su estado.');
  return body;
}
export async function getMessagingHistory(uid:string,signal?:AbortSignal):Promise<{items:MonitorIncident[];truncated:boolean}> {
  const body=await monitorRequest('history',{},uid,signal);
  if(body.version!==1||!Array.isArray(body.items))throw new Error('El historial no pudo verificarse.');return body;
}
