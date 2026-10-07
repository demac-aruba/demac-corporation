import type { FieldExecutionJobDetail } from '../../lib/field-authority';
import type { FieldVisitFormTarget } from '../../lib/field-procedure-capture-store';
import { loadFirebaseWebSession } from '../../lib/firebase/session';

export function fieldVisitFormTarget(job:FieldExecutionJobDetail):FieldVisitFormTarget|null {
  const ownerUserId=loadFirebaseWebSession()?.uid;
  return ownerUserId&&job.fieldVisit?{ownerUserId,workOrderId:job.workOrderId,visitId:job.fieldVisit.id}:null;
}
