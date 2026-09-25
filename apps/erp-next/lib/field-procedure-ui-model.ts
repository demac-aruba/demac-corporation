import type { ProcedureStep, ProcedureStepState } from './field-procedure-workspace';

export const procedureStatusLabel: Record<ProcedureStepState, string> = {
  not_started:'Pendiente', in_progress:'En proceso', needs_information:'Falta información', documented:'Documentado',
  exception_requested:'Excepción en revisión', exception_approved:'Excepción aprobada', exception_rejected:'Excepción devuelta',
};
export const procedureValueLabel: Record<string, string> = {
  before:'ANTES', after:'DESPUÉS', during:'Durante el servicio', condition:'Condición observada',
  exterior:'Vista exterior', interior:'Vista interior', instrument:'Instrumento legible', supplemental:'Complemento opcional',
  funciona:'Funciona', presenta_falla:'Presenta falla', enfria:'Enfría', no_enfria:'No enfría', inconcluso:'Inconcluso', no_se_pudo_verificar:'No se pudo verificar',
  buen_estado:'Buen estado', desgaste_medio:'Desgaste medio', desgaste_avanzado:'Desgaste avanzado', alto_riesgo:'Alto riesgo',
  deteriorado:'Deteriorado', totalmente_deteriorado:'Totalmente deteriorado', accepted:'Aceptó', declined:'No aceptó', pending:'Pendiente',
  initial:'Verificaciones iniciales', isolated:'Aislamiento documentado', final_test:'Prueba final documentada',
  result_not_recorded:'Resultado por guardar', result:'Seleccionar resultado', explanation:'Explicar la limitación',
  competence_confirmation:'Confirmación de persona competente', measured_pressure:'Presión realmente medida', evidence_link:'Vínculo de evidencia',
  customer_decision:'Respuesta del cliente', decision_person:'Persona que decidió', exception_review:'Revisión de excepción pendiente',
  procedure_not_performed:'Trabajo no realizado', part_not_finished_or_safe:'Finalización de parte pendiente', files_pending:'Archivos por vincular',
  high_risk_unresolved:'Riesgo alto sin resolver', coordinated_final_test:'Prueba final coordinada pendiente',
};
export const procedureLabel = (value: string) => value.startsWith('photo:')
  ? `Foto: ${procedureValueLabel[value.slice(6)] || value.slice(6)}` : procedureValueLabel[value] || value.replaceAll('_',' ');

export type ProcedureStepDraft = {
  schemaVersion: 1; baseline: string; result: string; note: string; measurementValue: string; measurementUnit: string;
  competenceConfirmed: boolean; customerDecision: '' | 'accepted' | 'declined' | 'pending'; decisionPerson: string;
};
/** Appending media alone does not overwrite a textual result. Actual result/author changes require review. */
export function procedureStepFingerprint(step: ProcedureStep): string {
  return JSON.stringify([step.status,step.result,step.note,step.recordedMeasurement,step.author,step.receivedAt,step.customerDecision,step.decisionPerson,step.exception]);
}
export function procedureDraftFromStep(step: ProcedureStep): ProcedureStepDraft {
  return {schemaVersion:1,baseline:procedureStepFingerprint(step),result:step.result || '',note:step.note,
    measurementValue:step.recordedMeasurement ? String(step.recordedMeasurement.value) : '',measurementUnit:step.recordedMeasurement?.unit || (step.id==='O02'?'psi':'°C'),
    // A previous visit/action cannot silently attest today's physical competence.
    competenceConfirmed:false,customerDecision:step.customerDecision || '',decisionPerson:step.decisionPerson};
}
export function parseProcedureStepDraft(value: string): ProcedureStepDraft {
  const d: unknown = JSON.parse(value);
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Borrador local no válido; se conserva para revisión.');
  const v = d as Record<string,unknown>;
  if (v.schemaVersion !== 1 || typeof v.baseline !== 'string' || v.baseline.length > 9000
      || typeof v.result !== 'string' || v.result.length > 100 || typeof v.note !== 'string' || v.note.length > 2000
      || typeof v.measurementValue !== 'string' || v.measurementValue.length > 50 || typeof v.measurementUnit !== 'string' || v.measurementUnit.length > 20
      || typeof v.competenceConfirmed !== 'boolean' || !['','accepted','declined','pending'].includes(String(v.customerDecision))
      || typeof v.decisionPerson !== 'string' || v.decisionPerson.length > 180) throw new Error('Borrador local no válido; se conserva para revisión.');
  return v as ProcedureStepDraft;
}
