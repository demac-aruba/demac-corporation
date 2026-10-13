import { firebaseClientConfig } from './client-config';
import { requireFirebaseWebSession, loadFirebaseWebSession } from './session';
import { connectionAvailable } from './quickbooks-connection';
export type ProductionReportInput = { report: 'ProfitAndLoss' | 'BalanceSheet' | 'AgedReceivables' | 'AgedPayables'; startDate: string; endDate: string; basis: 'Cash' | 'Accrual' };
export type ProductionReport = {
  environment: 'production'; syncEnabled: false; accountingWritesEnabled: false; realmId: string; companyName: string; fetchedAt: string; request: ProductionReportInput;
  report: { name: string; currency: string; basis: string | null; startPeriod: string | null; endPeriod: string; generatedAt: string | null; noData: boolean;
    columns: Array<{ title: string; type: string }>; rows: Array<{ kind: 'heading' | 'data' | 'total'; depth: number; values: string[] }> };
};
const messages: Record<string, string> = {
  'not-configured': 'La consulta de informes reales todavía está pendiente de activación.',
  'owner-required': 'Los informes reales están reservados al propietario designado de DEMAC.',
  'sign-in-required': 'Inicia sesión nuevamente con la cuenta autorizada de DEMAC.',
  'production-not-connected': 'Revisa la conexión de DEMAC antes de consultar sus informes.',
  'authorization-cleanup-required': 'Hay una autorización pendiente. Completa su confirmación o gestiona la desconexión antes de consultar.',
  'reauthorization-required': 'QuickBooks requiere renovar la autorización. Usa «Volver a conectar con QuickBooks» y confirma al regresar.',
  'report-busy': 'Hay otra consulta o autorización en curso. Espera un momento y vuelve a consultar.',
  'report-rate-limited': 'Espera cinco segundos entre consultas.',
  'provider-rate-limited': 'QuickBooks alcanzó su límite temporal de consultas. Inténtalo más tarde.',
  'invalid-report-request': 'Revisa las fechas y la base contable. Consulta períodos de hasta 183 días; las cuentas por cobrar y pagar usan devengado.',
  'invalid-report-response': 'QuickBooks devolvió un formato o período que no podemos verificar. No se muestran cifras incompletas.',
  'report-too-large': 'El informe excede el tamaño permitido. Reduce el período cuando corresponda.',
};
export async function readProductionReport(uid: string, input: ProductionReportInput): Promise<ProductionReport> {
  if (!connectionAvailable() || !firebaseClientConfig.projectId) throw Error(messages['not-configured']);
  const session = await requireFirebaseWebSession();
  if (session.uid !== uid) throw Error(messages['sign-in-required']);
  let response: Response;
  try { response = await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/quickbooksReports`, {
    method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }); } catch { throw Error('No se pudo completar la consulta. Vuelve a intentarlo; no se modificaron movimientos contables.'); }
  const result = await response.json().catch(() => ({}));
  if (loadFirebaseWebSession()?.uid !== uid) throw Error(messages['sign-in-required']);
  if (!response.ok) throw Error(messages[result.error] || 'QuickBooks no pudo entregar el informe. Inténtalo más tarde.');
  if (result.environment !== 'production' || result.realmId !== '9130352327074466' || result.syncEnabled !== false || result.accountingWritesEnabled !== false ||
    result.report?.name !== input.report || result.report?.endPeriod !== input.endDate || !Array.isArray(result.report?.rows) || !Array.isArray(result.report?.columns)) throw Error(messages['invalid-report-response']);
  return result;
}
