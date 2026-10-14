import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession, loadFirebaseWebSession } from './session';
import { connectionAvailable } from './quickbooks-connection';
import { listFirestoreCollection } from './firestore-rest';
import { listCanonicalCatalog, catalogItemType } from '../service-catalog';
import { validateCatalogResult, type CatalogEntity, type CatalogInput, type ErpMatchRow } from '../quickbooks-catalog';
const messages: Record<string, string> = {
  'catalog-not-configured': 'La consulta de catálogos todavía está pendiente de activación.',
  'not-found': 'La consulta de catálogos todavía está pendiente de activación.',
  'not-configured': 'La conexión de QuickBooks no está disponible para esta consulta.',
  'owner-required': 'Esta consulta está reservada al propietario designado de DEMAC.',
  'production-not-connected': 'Revisa la conexión de DEMAC antes de consultar.',
  'reauthorization-required': 'QuickBooks requiere renovar la autorización. Usa «Volver a conectar con QuickBooks».',
  'authorization-cleanup-required': 'Completa la autorización pendiente de DEMAC antes de consultar.',
  'report-busy': 'Hay otra consulta o autorización en curso. Espera un momento y vuelve a consultar.',
  'report-rate-limited': 'Espera cinco segundos entre consultas.',
  'provider-rate-limited': 'QuickBooks alcanzó su límite temporal de consultas. Inténtalo más tarde.',
  'report-too-large': 'QuickBooks devolvió una página demasiado grande para verificarla.',
  'invalid-catalog-response': 'No se pudo verificar el catálogo de QuickBooks. No se muestran datos incompletos.',
  'sign-in-required': 'Inicia sesión nuevamente con la cuenta autorizada de DEMAC.',
};
export function catalogFailureMessage(error: unknown) {
  return error instanceof Error && Object.values(messages).includes(error.message) ? error.message :
    'No se pudo preparar la comparación. Revisa la conexión y vuelve a consultar.';
}
function sameUser(uid: string) { if (loadFirebaseWebSession()?.uid !== uid) throw Error(messages['sign-in-required']); }
export async function readProductionCatalog(uid: string, input: CatalogInput) {
  if (!connectionAvailable() || !firebaseClientConfig.projectId) throw Error(messages['not-configured']);
  const session = await requireFirebaseWebSession();
  if (session.uid !== uid) throw Error(messages['sign-in-required']);
  let response: Response;
  try { response = await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/quickbooksReports/catalog`, {
    method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }); } catch { throw Error('No se pudo completar la consulta del catálogo. Puedes volver a intentarlo.'); }
  const result = await response.json().catch(() => null);
  sameUser(uid);
  if (!response.ok) throw Error(messages[result?.error] || 'No se pudo consultar el catálogo. Inténtalo más tarde.');
  return validateCatalogResult(result, input);
}
export async function readErpComparisonRows(uid: string, entity: CatalogEntity): Promise<ErpMatchRow[]> {
  const session = await requireFirebaseWebSession();
  if (session.uid !== uid) throw Error(messages['sign-in-required']);
  let rows: ErpMatchRow[];
  if (entity === 'Customer') {
    const clients = await listFirestoreCollection<{ id: string; name?: string; company?: string; legalName?: string; email?: string; active?: boolean }>('clients');
    rows = clients.map(row => ({ id: row.id, name: row.name || row.legalName || row.company || row.id, email: row.email, active: row.active !== false }));
  } else if (entity === 'Item') {
    rows = (await listCanonicalCatalog()).map(row => ({ id: row.id, name: row.name, sku: row.sku, type: catalogItemType(row), active: row.active !== false }));
  } else rows = [];
  sameUser(uid);
  return rows;
}
