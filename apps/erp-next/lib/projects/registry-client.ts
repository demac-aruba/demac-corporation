import { firebaseClientConfig } from '../firebase/client-config';
import { createRegistryTransport, createIntentJournal, type RegistryIdentity } from './registry-client-core';

export const centralProjectsEnabled = process.env.NEXT_PUBLIC_PROJECTS_REGISTRY_ENABLED === 'true';
export const legacyImportUiEnabled = process.env.NEXT_PUBLIC_PROJECTS_LEGACY_IMPORT_ENABLED === 'true';
/** Read existing authentication only. Projects never clears, renews or replaces it. */
function identity(): RegistryIdentity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem('demac.erp-next.firebase.session.v1');
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    return typeof record.uid === 'string' && typeof record.idToken === 'string' && typeof record.expiresAt === 'number'
      ? { uid: record.uid, idToken: record.idToken, expiresAt: record.expiresAt } : null;
  } catch { return null; }
}
export function newRegistryClient(uid:string) {
  if (!centralProjectsEnabled || !firebaseClientConfig.projectId || typeof window==='undefined') throw new Error('Central Projects is not activated in this deployment.');
  const scopedIdentity=()=>{const value=identity();return value?.uid===uid?value:null;};
  return {
    request:createRegistryTransport({endpoint:`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/projectsRegistry`,identity:scopedIdentity}),
    journal:createIntentJournal(window.sessionStorage,uid),
  };
}
