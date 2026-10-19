'use client';

import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useAuth} from '@/components/auth/auth-provider';
import {getMessagingDashboard} from '@/lib/messaging-monitor-client';
import {monitoringRoles,monitorFreshness,type MonitorDashboard,type MonitorStatus} from '@/lib/messaging-monitor-types';

type Context={data:MonitorDashboard|null;error:string;busy:boolean;clock:number;health:MonitorStatus;available:boolean;refresh:()=>Promise<void>};
export const MessagingMonitorContext=createContext<Context>({data:null,error:'',busy:false,clock:0,health:'unknown',available:false,refresh:async()=>{}});
export const useMessagingMonitor=()=>useContext(MessagingMonitorContext);
export function MessagingMonitorProvider({children}:{children:ReactNode}) {
  const {principal,status}=useAuth();const uid=principal.userId;
  const available=process.env.NEXT_PUBLIC_WHATSAPP_MONITOR_ENABLED==='true'&&status==='ready'&&principal.active&&monitoringRoles.includes(principal.role);
  const [data,setData]=useState<MonitorDashboard|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [clock,setClock]=useState(0);
  const inFlight=useRef<AbortController|null>(null);const sequence=useRef(0);const owner=useRef('');const observedAt=useRef(0);
  const refresh=useCallback(async()=>{
    if(!available||inFlight.current)return;
    const controller=new AbortController();inFlight.current=controller;const run=++sequence.current;setBusy(true);
    try {const next=await getMessagingDashboard(uid,controller.signal);if(!controller.signal.aborted&&run===sequence.current){setData(next);setError('');observedAt.current=Date.now();setClock(Date.now());}}
    catch(cause){if(!controller.signal.aborted&&run===sequence.current)setError(cause instanceof Error?cause.message:'No se pudo comprobar la mensajería.');}
    finally{if(run===sequence.current){inFlight.current=null;setBusy(false);}}
  },[available,uid]);
  useEffect(()=>{
    if(owner.current!==uid||!available){setData(null);setError('');owner.current=uid;}
    setClock(Date.now());void refresh();
    const timer=window.setInterval(()=>{setClock(Date.now());if(document.visibilityState==='visible')void refresh();},60000);
    const visibility=()=>{setClock(Date.now());if(document.visibilityState==='visible'&&Date.now()-observedAt.current>=30000)void refresh();};
    document.addEventListener('visibilitychange',visibility);
    return()=>{sequence.current++;inFlight.current?.abort();inFlight.current=null;window.clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[available,uid,refresh]);
  return <MessagingMonitorContext.Provider value={{data,error,busy,clock,health:monitorFreshness(data,error,clock),available,refresh}}>{children}</MessagingMonitorContext.Provider>;
}
