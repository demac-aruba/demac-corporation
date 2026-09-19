'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { centralProjectsEnabled, legacyImportUiEnabled, newRegistryClient } from '@/lib/projects/registry-client';
import { ProjectsCentralWorkspace } from './projects-central-workspace';
import s from './projects-central.module.css';

export function ProjectsCentralGate(){
  const {principal,status}=useAuth();
  if(!centralProjectsEnabled)return <section className={s.card}><h1>Central Projects</h1><p>Not activated in this deployment. The existing Projects and Scheduling workflows are unchanged.</p></section>;
  if(status!=='ready'||!principal.active||!principal.capabilities.has('projects.view'))return <section className={s.card}><h1>Central Projects</h1><p>An active account with Projects access is required.</p></section>;
  // Remount all response/draft state when the authenticated user or role changes.
  return <ScopedWorkspace key={`${principal.userId}:${principal.role}`} uid={principal.userId} canManage={principal.capabilities.has('projects.manage')} isOwner={principal.role==='super_admin'}/>;
}
function ScopedWorkspace({uid,canManage,isOwner}:{uid:string;canManage:boolean;isOwner:boolean}) {
  const [client,setClient]=useState<ReturnType<typeof newRegistryClient>|null>(null);const [error,setError]=useState('');
  useEffect(()=>{try{const next=newRegistryClient(uid);next.journal.read();setClient(next);}catch(cause){setError(cause instanceof Error?cause.message:'Central Projects could not initialize.');}},[uid]);
  if(error)return <p role="alert" className={s.error}>{error}</p>;
  if(!client)return <p role="status">Connecting to Central Projects…</p>;
  return <ProjectsCentralWorkspace request={client.request} journal={client.journal} canManage={canManage} isOwner={isOwner} importEnabled={legacyImportUiEnabled}/>;
}
