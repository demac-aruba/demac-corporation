import { getFieldProcedureWorkspace, recordFieldProcedureAction } from './field-authority';
import type { FieldProcedureTarget } from './field-procedure-contract';
import {
  advanceProcedureCapture, assertProcedureOwner, hashProcedureBlob, readProcedureCapture,
  type ProcedureCapture,
} from './field-procedure-capture-store';
import { uploadProcedureCapture } from './field-procedure-media-client';
import type { FieldProcedureWorkspace, ProcedureEvidence } from './field-procedure-workspace';

function linkedEvidence(workspace: FieldProcedureWorkspace, capture: ProcedureCapture): ProcedureEvidence | null {
  const linked = workspace.evidence.find(e => e.captureId === capture.id && e.createdBy === capture.target.ownerUserId);
  if (!linked) return null;
  if (linked.sha256 !== capture.sha256 || linked.part !== capture.part || linked.procedureId !== capture.stepId
      || linked.view !== capture.view || linked.kind !== capture.kind || linked.contentType !== capture.contentType || linked.sizeBytes !== capture.sizeBytes) {
    throw new Error('El vínculo del servidor no coincide con el archivo original. Se conserva para recuperación.');
  }
  return linked;
}

/** Explicit foreground synchronization; no hidden background work or automatic safety transitions. */
export async function synchronizeProcedureCapture(target: FieldProcedureTarget, captureId: string): Promise<ProcedureCapture> {
  assertProcedureOwner(target);
  let capture = await readProcedureCapture(target,captureId);
  if (!capture) throw new Error('No se encontró la captura de esta cuenta.');
  if (capture.stage === 'confirmed') return capture;
  if (!capture.blob || capture.blob.size !== capture.sizeBytes || await hashProcedureBlob(capture.blob) !== capture.sha256) {
    throw new Error('El archivo local no coincide con su huella. No se enviará ni se borrará.');
  }
  assertProcedureOwner(target);
  let workspace = await getFieldProcedureWorkspace(target);
  // Recover a lost link response using the exact authenticated capture identity, never just a matching hash.
  const linked = linkedEvidence(workspace,capture);
  if (linked) return advanceProcedureCapture(target,capture,{stage:'confirmed',evidenceId:linked.id,blob:null});
  if (capture.stage === 'local') {
    if (!capture.prepare) {
      const part = workspace.procedureParts.find(p => p.id === capture!.part), step = part?.steps.find(s => s.id === capture!.stepId);
      if (!workspace.allowedActions.includes('evidence.add') || workspace.interventionStatus !== 'in_progress'
          || part?.ownerUserId !== target.ownerUserId || part.completedAt || !step || !workspace.safety) throw new Error('La asignación no permite enviar este archivo. Se conserva en la cuenta original.');
      if (workspace.safety.revision !== capture.capturedSafetyRevision || workspace.safety.phase !== step.stage) {
        throw new Error('La coordinación cambió desde la captura. No se reinterpretará como ANTES ni como permiso de trabajo. Conserva el archivo para recuperación con oficina.');
      }
      // Capture upload is an append, not a text overwrite. Take the current part version once,
      // then freeze the exact request before its first transmission. Never rebase a sent command.
      capture = await advanceProcedureCapture(target,capture,{prepare:{requestId:`procedure-reserve-${capture.id}`,command:{
        action:'prepare_media',captureId:capture.id,part:capture.part,stepId:capture.stepId,view:capture.view,kind:capture.kind,
        contentType:capture.contentType,sizeBytes:capture.sizeBytes,sha256:capture.sha256,source:capture.source,
        declaredCapturedAt:capture.declaredCapturedAt,expectedPartVersion:part.version,expectedSafetyRevision:capture.capturedSafetyRevision,
      }}});
    }
    const request = capture.prepare!;
    workspace = await recordFieldProcedureAction(target,request.command,request.requestId);
    const alreadyLinked = linkedEvidence(workspace,capture);
    if (alreadyLinked) return advanceProcedureCapture(target,capture,{stage:'confirmed',evidenceId:alreadyLinked.id,blob:null});
    const reservation = workspace.pendingCaptures.find(r => r.captureId === capture!.id);
    if (!reservation || reservation.ownerUserId !== target.ownerUserId || reservation.sha256 !== capture.sha256
        || reservation.part !== capture.part || reservation.stepId !== capture.stepId) throw new Error('El servidor no confirmó la reserva de este archivo. Se conserva la solicitud original.');
    capture = await advanceProcedureCapture(target,capture,{stage:'reserved',evidenceId:workspace.mutationResult?.evidenceId || null});
  }
  if (capture.stage === 'reserved') {
    await uploadProcedureCapture(target,capture);
    capture = await advanceProcedureCapture(target,capture,{stage:'uploaded'});
  }
  if (capture.stage === 'uploaded') {
    workspace = await recordFieldProcedureAction(target,capture.commit.command,capture.commit.requestId);
    const confirmed = linkedEvidence(workspace,capture);
    if (!confirmed) throw new Error('La subida terminó, pero falta confirmar el vínculo autorizado. El archivo sigue guardado en este dispositivo.');
    capture = await advanceProcedureCapture(target,capture,{stage:'confirmed',evidenceId:confirmed.id,blob:null});
  }
  return capture;
}
