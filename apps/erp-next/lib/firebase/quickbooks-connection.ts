import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession, loadFirebaseWebSession } from './session';

export type QuickBooksConnectionStatus = {
  environment: 'production'; configured: boolean; syncEnabled: false; accountingWritesEnabled: false;
  phase: 'not-configured' | 'disconnected' | 'connected' | 'confirmation-pending' | 'disconnect-pending';
  expectedRealmId?: string; disconnectVersion: string | null;
  connection: { realmId: string; companyName: string; country: string | null; verifiedAt: string; connectedAt: string } | null;
};
const STORAGE_KEY = 'demac.quickbooks.production.v1';
const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
export const unconfiguredConnection: QuickBooksConnectionStatus = {
  environment: 'production', configured: false, phase: 'not-configured', connection: null,
  disconnectVersion: null, syncEnabled: false, accountingWritesEnabled: false,
};
const messages: Record<string, string> = {
  'not-configured': 'La conexión de DEMAC está pendiente de activación. Conserva la conexión de prueba por separado.',
  'owner-required': 'Esta conexión está reservada al propietario designado de DEMAC.',
  'sign-in-required': 'Inicia sesión nuevamente con la cuenta autorizada de DEMAC.',
  'wrong-company': 'La empresa seleccionada no corresponde al ID de DEMAC configurado. No se aceptó la conexión.',
  'authorization-cancelled': 'Cancelaste la autorización en QuickBooks.',
  'invalid-state': 'La autorización venció o no corresponde a esta pestaña. Consulta el estado antes de volver a conectar.',
  'authorization-cleanup-required': 'Hay una autorización pendiente. Completa su confirmación o desconéctala antes de iniciar otra.',
  'connection-busy': 'Hay otra operación en curso. Espera un momento y consulta el estado.',
  'stale-connection': 'La conexión cambió. Consulta el estado y confirma nuevamente.',
  'revocation-pending': 'El ERP suspendió el acceso, pero QuickBooks aún no confirmó la revocación. Consulta el estado y reintenta la desconexión.',
  'configuration-changed': 'Cambió la configuración de la conexión. Se necesita una revisión técnica antes de continuar.',
  'credential-recovery-required': 'Se necesita una revisión técnica para completar la desconexión.',
  'rate-limited': 'Espera unos segundos antes de iniciar otra autorización.',
};
export function connectionMessage(code: string) {
  return messages[code] || 'No se pudo confirmar la operación. Consulta el estado antes de reintentar.';
}
export function connectionAvailable() {
  return process.env.NEXT_PUBLIC_QBO_PRODUCTION_ENABLED === 'true' && process.env.NEXT_PUBLIC_ISOLATED_PREVIEW !== 'true';
}
function assertIdentity(uid: string) {
  if (loadFirebaseWebSession()?.uid !== uid) throw new Error(connectionMessage('sign-in-required'));
}
async function request<T>(uid: string, body?: Record<string, string>): Promise<T> {
  if (!connectionAvailable() || !firebaseClientConfig.projectId) throw new Error(connectionMessage('not-configured'));
  const session = await requireFirebaseWebSession();
  if (session.uid !== uid) throw new Error(connectionMessage('sign-in-required'));
  let response: Response;
  try { response = await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/quickbooksConnection`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${session.idToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }); } catch { throw new Error(connectionMessage('connection-failed')); }
  const result = await response.json().catch(() => ({})); assertIdentity(uid);
  if (!response.ok) throw new Error(connectionMessage(typeof result.error === 'string' ? result.error : 'connection-failed'));
  return result as T;
}
export function readConnectionStatus(uid: string): Promise<QuickBooksConnectionStatus> {
  return connectionAvailable() ? request(uid) : Promise.resolve(unconfiguredConnection);
}
type Pending = { uid: string; proof: string; createdAt: number; ticket?: string };
function pendingFor(uid: string): Pending {
  let pending: Pending | null = null;
  try { pending = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* Fail closed below. */ }
  if (!pending || pending.uid !== uid || !opaquePattern.test(pending.proof) || !Number.isFinite(pending.createdAt) ||
    pending.createdAt > Date.now() || Date.now() - pending.createdAt >= 600000) throw new Error(connectionMessage('invalid-state'));
  return pending;
}
export async function startConnection(uid: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const proof = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof));
  const proofHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  assertIdentity(uid);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ uid, proof, createdAt: Date.now() }));
  const result = await request<{ authorizationUrl: string }>(uid, { action: 'start', proofHash });
  const url = new URL(result.authorizationUrl);
  if (url.origin !== 'https://appcenter.intuit.com' || url.pathname !== '/connect/oauth2' || url.username || url.password) throw new Error(connectionMessage('connection-failed'));
  assertIdentity(uid); window.location.assign(url.toString());
}
// Capture only an opaque browser completion ticket before sign-in; never an OAuth code or token.
export function captureConnectionReturn() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const ticket = fragment.get('qbo_production_ticket'); const error = fragment.get('qbo_production_error');
  if (!ticket && !error) return;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  if (error) { sessionStorage.removeItem(STORAGE_KEY); throw new Error(connectionMessage(error)); }
  if (!ticket || !opaquePattern.test(ticket)) throw new Error(connectionMessage('invalid-state'));
  let stored: Pending | null = null;
  try { stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* Reject missing proof. */ }
  if (!stored?.uid) throw new Error(connectionMessage('invalid-state'));
  const pending = pendingFor(stored.uid);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...pending, ticket }));
}
let flight: { uid: string; ticket: string; promise: Promise<QuickBooksConnectionStatus> } | null = null;
export async function loadConnection(uid: string) {
  if (!connectionAvailable()) return unconfiguredConnection;
  let pending: Pending | null = null;
  try { pending = pendingFor(uid); } catch { /* Normal visits have no pending authorization. */ }
  if (!pending?.ticket || !opaquePattern.test(pending.ticket)) return readConnectionStatus(uid);
  if (flight?.uid === uid && flight.ticket === pending.ticket) return flight.promise;
  const promise = request<QuickBooksConnectionStatus>(uid, { action: 'finish', ticket: pending.ticket, proof: pending.proof }).then(result => {
    assertIdentity(uid); sessionStorage.removeItem(STORAGE_KEY); return result;
  });
  const current = { uid, ticket: pending.ticket, promise }; flight = current;
  const clear = () => { if (flight === current) flight = null; }; void promise.then(clear, clear);
  return promise;
}
export async function disconnectConnection(uid: string, version: string) {
  const result = await request<QuickBooksConnectionStatus>(uid, { action: 'disconnect', version });
  assertIdentity(uid); sessionStorage.removeItem(STORAGE_KEY); return result;
}
export function hasPendingConnection(uid: string) {
  try { return opaquePattern.test(pendingFor(uid).ticket || ''); } catch { return false; }
}
