import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession, loadFirebaseWebSession } from './session';

export type QuickBooksSandboxStatus = {
  configured: boolean;
  environment: 'sandbox';
  syncEnabled: false;
  expectedRealmId?: string;
  connection: { realmId: string; companyName: string; country: string | null; verifiedAt: string; connectedAt: string } | null;
};

const STORAGE_KEY = 'demac.quickbooks.sandbox.v1';
const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
const messages: Record<string, string> = {
  'not-configured': 'La conexión de prueba todavía necesita configuración del servidor.',
  'sign-in-required': 'Inicia sesión nuevamente en el ERP.',
  'admin-required': 'Solo el propietario o un administrador activo puede conectar QuickBooks.',
  'wrong-company': 'La empresa seleccionada no corresponde al sandbox configurado. Vuelve a conectar y selecciona el sandbox.',
  'authorization-cancelled': 'Cancelaste la autorización. Puedes volver a conectar cuando quieras.',
  'connection-busy': 'Hay una autorización en curso. Espera a que termine o a que venza en diez minutos.',
  'invalid-state': 'La autorización venció o no corresponde a esta sesión. Inicia una conexión nueva en esta pestaña.',
};
export function quickBooksMessage(code: string) {
  return messages[code] || 'No se pudo confirmar la conexión. Reintenta consultar el estado; si persiste, inicia una conexión nueva.';
}
export function quickBooksSandboxAvailable() {
  return process.env.NEXT_PUBLIC_QBO_SANDBOX_ENABLED === 'true' && process.env.NEXT_PUBLIC_ISOLATED_PREVIEW !== 'true';
}
function assertIdentity(uid: string) {
  if (loadFirebaseWebSession()?.uid !== uid) throw new Error(quickBooksMessage('sign-in-required'));
}
async function request<T>(uid: string, body?: Record<string, string>): Promise<T> {
  if (!quickBooksSandboxAvailable() || !firebaseClientConfig.projectId) throw new Error(quickBooksMessage('not-configured'));
  const session = await requireFirebaseWebSession();
  if (session.uid !== uid) throw new Error(quickBooksMessage('sign-in-required'));
  let response: Response;
  try { response = await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/quickbooksSandbox`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${session.idToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }); } catch { throw new Error(quickBooksMessage('connection-failed')); }
  const result = await response.json().catch(() => ({}));
  assertIdentity(uid);
  if (!response.ok) throw new Error(quickBooksMessage(typeof result.error === 'string' ? result.error : 'connection-failed'));
  return result as T;
}

type Pending = { uid: string; proof: string; createdAt: number; ticket?: string };
function readPending(uid: string): Pending {
  let pending: Pending | null;
  try { pending = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { pending = null; }
  if (!pending || pending.uid !== uid || !opaquePattern.test(pending.proof) ||
    !Number.isFinite(pending.createdAt) || Date.now() - pending.createdAt > 10 * 60 * 1000 || pending.createdAt > Date.now()) {
    throw new Error(quickBooksMessage('invalid-state'));
  }
  return pending;
}

export async function startQuickBooksSandbox(uid: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const proof = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof));
  const proofHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  assertIdentity(uid);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ uid, proof, createdAt: Date.now() }));
  const result = await request<{ authorizationUrl: string }>(uid, { action: 'start', proofHash });
  const url = new URL(result.authorizationUrl);
  if (url.origin !== 'https://appcenter.intuit.com' || url.pathname !== '/connect/oauth2') throw new Error(quickBooksMessage('connection-failed'));
  assertIdentity(uid);
  window.location.assign(url.toString());
}

let finishFlight: { uid: string; ticket: string; promise: Promise<QuickBooksSandboxStatus> } | null = null;
export function readQuickBooksSandboxStatus(uid: string): Promise<QuickBooksSandboxStatus> {
  if (!quickBooksSandboxAvailable()) return Promise.resolve({ configured: false, environment: 'sandbox', syncEnabled: false, connection: null });
  return request<QuickBooksSandboxStatus>(uid);
}
export async function loadQuickBooksSandbox(uid: string): Promise<QuickBooksSandboxStatus> {
  if (!quickBooksSandboxAvailable()) return { configured: false, environment: 'sandbox', syncEnabled: false, connection: null };
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const ticket = fragment.get('qbo_ticket');
  const error = fragment.get('qbo_error');
  if (ticket || error) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  if (error) {
    sessionStorage.removeItem(STORAGE_KEY);
    throw new Error(quickBooksMessage(error));
  }
  if (ticket) {
    if (!opaquePattern.test(ticket)) throw new Error(quickBooksMessage('invalid-state'));
    const pending = readPending(uid);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...pending, ticket }));
  }
  // Keep the browser proof on a transient failure so a lost finish response can be retried safely.
  let pending: Pending | null = null;
  try { pending = readPending(uid); } catch { /* No current flow: load the stored verification snapshot. */ }
  if (pending?.ticket && opaquePattern.test(pending.ticket)) {
    if (finishFlight?.uid === uid && finishFlight.ticket === pending.ticket) return finishFlight.promise;
    const promise = request<QuickBooksSandboxStatus>(uid, { action: 'finish', ticket: pending.ticket, proof: pending.proof }).then(result => {
      assertIdentity(uid);
      sessionStorage.removeItem(STORAGE_KEY);
      return result;
    });
    const flight = { uid, ticket: pending.ticket, promise };
    finishFlight = flight;
    const clear = () => { if (finishFlight === flight) finishFlight = null; };
    void promise.then(clear, clear);
    return promise;
  }
  return readQuickBooksSandboxStatus(uid);
}
