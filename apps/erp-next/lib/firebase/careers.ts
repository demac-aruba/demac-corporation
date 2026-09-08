import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession } from './session';
import type { Vacancy, ApplicationDraft, Question, Stage } from '../careers-preview';
export type RecruitmentVacancy = Omit<Vacancy, 'status'> & {
  status: Vacancy['status'] | 'Archived'; desired: string[]; internalNotes: string; openings: number;
  publishFrom: string | null; publishUntil: string | null; photoRequired: boolean;
};
export type CareersSettings = { intakeEnabled: boolean; privacyText: string; privacyVersion: string; retentionDays: number; talentRetentionDays: number; from: string; replyTo: string; senderName: string; version: number; verification?: { at: number; signature: string } | null };
export type DocumentRecord = { id: string; kind: 'photo' | 'cv' | 'document'; name: string; size: number; mime: string; status: string };
export type ApplicantSummary = { id: string; title: string; name: string; stage: Stage; version: number; experience: string; country: string; createdAt: string };
export type ApplicantRecord = { id: string; reference: string; jobSnapshot: RecruitmentVacancy; profile: Omit<ApplicationDraft, 'photo' | 'cv' | 'documents'>; documents: DocumentRecord[]; stage: Stage; version: number; createdAt: string; emailStatus: string; notes: { id: string; text: string; actorName: string; at: string }[]; events: { id: string; action: string; at: string }[] };
export type ApplicantSession = { sessionId: string; token: string; expiresAt: number };
export type Receipt = { id: string; reference: string; emailStatus: string };
export type PublicJobs = { available: boolean; jobs: RecruitmentVacancy[]; privacy?: { text: string; version: string } };
export type Page<T> = { items: T[]; nextCursor: string | null };
export class CareersError extends Error { constructor(message: string, public readonly code: string, public readonly status: number) { super(message); } }
function base() {
  const explicit = process.env.NEXT_PUBLIC_CAREERS_FUNCTIONS_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (!firebaseClientConfig.projectId) throw new CareersError('Careers has not been configured for this deployment.', 'not-configured', 503);
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net`;
}
async function request<T>(isAdmin: boolean, action: string, payload: unknown = {}, binary = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isAdmin) headers.Authorization = `Bearer ${(await requireFirebaseWebSession()).idToken}`;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 100000);
  try {
    const response = await fetch(`${base()}/${isAdmin ? 'careersAdmin' : 'careersPublic'}`, { method: 'POST', headers, body: JSON.stringify({ action, payload }), signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (response.ok && binary) return await response.blob() as T;
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new CareersError(result.message || 'Careers could not complete this request. Please retry.', result.code || 'request-failed', response.status);
    return result.result as T;
  } catch (error) {
    if (error instanceof CareersError) throw error;
    throw new CareersError('Connection interrupted. Please retry; a previous submission will not be duplicated.', 'connection-error', 0);
  } finally { clearTimeout(timer); }
}
export const careersAdmin = <T>(action: string, payload: unknown = {}) => request<T>(true, action, payload);
export const careersPublic = <T>(action: string, payload: unknown = {}) => request<T>(false, action, payload);
export function newRequestId() { return crypto.randomUUID(); }
export function newVacancy(): RecruitmentVacancy { return { id: newRequestId(), version: 0, title: '', department: '', location: 'Aruba', contract: '', summary: '', responsibilities: [], requirements: [], desired: [], internalNotes: '', openings: 1, publishFrom: null, publishUntil: null, photoRequired: true, cvRequired: true, status: 'Draft', questions: [] }; }
export function newQuestion(): Question { return { id: newRequestId(), label: '', kind: 'text', required: true }; }
export async function downloadApplicantDocument(applicationId: string, file: DocumentRecord): Promise<Blob> { return request<Blob>(true, 'documents.get', { applicationId, fileId: file.id }, true); }
function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('The selected file cannot be read.')); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file); });
}
export async function uploadApplicantDocument(session: ApplicantSession, file: File, kind: DocumentRecord['kind']) {
  return careersPublic<DocumentRecord>('file.upload', { ...session, name: file.name, kind, base64: await fileBase64(file) });
}
