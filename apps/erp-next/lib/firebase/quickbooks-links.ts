import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession, loadFirebaseWebSession } from './session';
import { connectionAvailable } from './quickbooks-connection';
import { validateCatalogResult, type ErpMatchRow, type QuickBooksCatalogRow } from '../quickbooks-catalog';
import { erpLinkHash, qboLinkHash, validCatalogLink, type CatalogLink, type LinkEntity, type PreparedLink } from '../quickbooks-links';
const messages: Record<string, string> = {
  'owner-required': 'Esta función requiere la cuenta de propietario autorizada de DEMAC.',
  'sign-in-required': 'Inicia sesión nuevamente con la cuenta autorizada.',
  'production-not-connected': 'Revisa la conexión de DEMAC con QuickBooks.',
  'authorization-cleanup-required': 'Completa la autorización pendiente de DEMAC.',
  'reauthorization-required': 'Renueva la autorización de QuickBooks antes de continuar.',
  'catalog-not-configured': 'La confirmación de vínculos todavía no está disponible.',
  'not-configured': 'La confirmación de vínculos todavía no está disponible.',
  'not-found': 'La confirmación de vínculos todavía está pendiente de publicación.',
  'report-busy': 'Hay otra consulta en curso. Espera un momento y vuelve a verificar.',
  'report-rate-limited': 'Espera cinco segundos después de la última consulta y vuelve a verificar.',
  'provider-rate-limited': 'QuickBooks alcanzó su límite temporal. Inténtalo más tarde.',
  'provider-unavailable': 'No se pudo verificar QuickBooks. Vuelve a consultar antes de confirmar.',
  'link-source-changed': 'El registro del ERP cambió. Actualiza los catálogos y revisa de nuevo.',
  'link-source-missing': 'El registro del ERP ya no está disponible. Actualiza los catálogos.',
  'link-source-invalid': 'El registro del ERP tiene datos que requieren revisión.',
  'link-target-changed': 'El registro de QuickBooks cambió o se movió de página. Actualiza los catálogos.',
  'link-version-conflict': 'El vínculo cambió en otra operación. Consulta su estado antes de continuar.',
  'link-target-conflict': 'Ese registro de QuickBooks ya está vinculado o tiene un conflicto. Revisa los vínculos existentes.',
  'link-revoke-first': 'Desvincula primero el registro actual antes de elegir otro.',
  'link-observation-stale': 'La verificación venció o la conexión cambió. Verifica la selección nuevamente.',
  'link-inactive': 'Ambos registros deben estar activos para confirmar el vínculo.',
  'link-item-type': 'Los tipos de artículo no son compatibles. Un servicio requiere un servicio de QuickBooks.',
  'link-customer-hierarchy': 'Este registro es un subcliente o proyecto. Su relación requiere una revisión específica.',
  'link-record-invalid': 'El vínculo guardado requiere revisión técnica. No se ha sobrescrito.',
};
class LinkFailure extends Error { constructor(public code: string) { super(messages[code] || 'No se pudo confirmar el resultado. Consulta el estado del vínculo antes de reintentar.'); } }
export const linkFailureMessage = (error: unknown) => error instanceof LinkFailure ? error.message : 'No se pudo confirmar el resultado. Consulta el estado del vínculo antes de reintentar.';
export const linkAccessLost = (error: unknown) => error instanceof LinkFailure && ['owner-required', 'sign-in-required', 'production-not-connected', 'authorization-cleanup-required', 'reauthorization-required'].includes(error.code);
function current(uid: string) { if (loadFirebaseWebSession()?.uid !== uid) throw new LinkFailure('sign-in-required'); }
async function request(uid: string, body: object): Promise<Record<string, unknown>> {
  if (!connectionAvailable() || !firebaseClientConfig.projectId) throw new LinkFailure('not-configured');
  const session = await requireFirebaseWebSession(); if (session.uid !== uid) throw new LinkFailure('sign-in-required');
  let response: Response;
  try { response = await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/quickbooksLinks`, {
    method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }); } catch { current(uid); throw new LinkFailure('result-unknown'); }
  const data = await response.json().catch(() => null); current(uid);
  if (!response.ok) throw new LinkFailure(data?.error || (response.status === 404 ? 'not-found' : 'result-unknown'));
  if (!data || data.environment !== 'production' || data.realmId !== '9130352327074466' || data.accountingWritesEnabled !== false || data.syncEnabled !== false) throw new LinkFailure('invalid-response');
  return data;
}
export async function readCatalogLinks(uid: string, entity: LinkEntity, erpIds: string[]) {
  const data = await request(uid, { action: 'list', entity, erpIds });
  if (!Array.isArray(data.records) || data.records.length !== erpIds.length || data.records.some((row, index) => !validCatalogLink(row, entity, erpIds[index]))) throw new LinkFailure('invalid-response');
  return data.records as CatalogLink[];
}
export async function prepareCatalogLink(uid: string, entity: LinkEntity, source: ErpMatchRow, target: QuickBooksCatalogRow, startPosition: number, expectedVersion: number) {
  const [sourceHash, targetHash] = await Promise.all([erpLinkHash(source), qboLinkHash(target)]); current(uid);
  const data = await request(uid, { action: 'prepare', entity, erpId: source.id, qboId: target.id, startPosition, sourceHash, targetHash, expectedVersion });
  const prepared = data as unknown as PreparedLink;
  if (!/^[a-f0-9]{48}$/.test(prepared.intentId) || prepared.entity !== entity || prepared.expectedVersion !== expectedVersion || prepared.source?.id !== source.id || prepared.target?.id !== target.id ||
    !Number.isFinite(Date.parse(prepared.expiresAt)) || !Number.isFinite(Date.parse(prepared.verifiedAt))) throw new LinkFailure('invalid-response');
  validateCatalogResult({ ...data, fetchedAt: prepared.verifiedAt, companyName: 'DEMAC', request: { entity, startPosition: 1 },
    catalog: { records: [prepared.target], pageSize: 100, nextStartPosition: null, atLimit: false, endOfCurrentQuery: true } }, { entity, startPosition: 1 });
  if (await erpLinkHash(prepared.source) !== sourceHash || await qboLinkHash(prepared.target) !== targetHash) throw new LinkFailure('invalid-response');
  current(uid); return prepared;
}
export async function confirmCatalogLink(uid: string, prepared: PreparedLink) {
  const data = await request(uid, { action: 'confirm', intentId: prepared.intentId, acknowledgeIdentity: true });
  if (!validCatalogLink(data.link, prepared.entity, prepared.source.id) || data.link.status !== 'confirmed' || data.link.qboId !== prepared.target.id ||
    data.link.version !== prepared.expectedVersion + 1 || typeof data.replayed !== 'boolean') throw new LinkFailure('invalid-response');
  return data.link;
}
export async function revokeCatalogLink(uid: string, entity: LinkEntity, link: CatalogLink, requestId: string) {
  const data = await request(uid, { action: 'revoke', entity, erpId: link.erpId, expectedVersion: link.version, requestId });
  if (!validCatalogLink(data.link, entity, link.erpId) || data.link.status !== 'revoked' || data.link.qboId !== link.qboId || data.link.version !== link.version + 1 || typeof data.replayed !== 'boolean') throw new LinkFailure('invalid-response');
  return data.link;
}
