import { FIELD_AUTHORITY_API_VERSION } from './field-authority-contract';
import type { FieldProcedurePart } from './field-procedure-contract';

export type FieldProcedureExceptionQueueItem = {
  key: string;
  visitId: string;
  interventionId: string;
  assetId: string;
  workOrderId: string;
  part: FieldProcedurePart;
  stepId: string;
  title: string;
  reason: string;
  requestedAt: string;
  requestedByUserId: string;
  requestedByName: string;
  ownerUserId: string | null;
  ownerName: string | null;
  partVersion: number;
  interventionVersion: number;
};
export type FieldProcedureExceptionQueueResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  exceptions: FieldProcedureExceptionQueueItem[];
};

function object(value:unknown):Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Field Operations returned malformed procedure exception data.');
  return value as Record<string,unknown>;
}
function id(value:unknown):string {
  if(typeof value!=='string' || !/^[-A-Za-z0-9_.:]+$/.test(value) || value.includes('..') || value==='.' || value.length>180) {
    throw new Error('Field Operations returned malformed procedure exception identity.');
  }
  return value;
}
function text(value:unknown,limit:number):string {
  if(typeof value!=='string' || value.length>limit) throw new Error('Field Operations returned malformed procedure exception text.');
  return value;
}
function version(value:unknown):number {
  if(!Number.isSafeInteger(value) || (value as number)<0) throw new Error('Field Operations returned malformed procedure exception version.');
  return value as number;
}
function time(value:unknown):string {
  const result=text(value,100);
  if(!Number.isFinite(Date.parse(result))) throw new Error('Field Operations returned malformed procedure exception timestamp.');
  return result;
}
function nullableId(value:unknown):string|null { return value===null ? null : id(value); }
function nullableText(value:unknown,limit:number):string|null { return value===null ? null : text(value,limit); }

export function parseFieldProcedureExceptionQueueResponse(value:unknown):FieldProcedureExceptionQueueResponse {
  const payload=object(value);
  if(payload.success!==true || payload.version!==FIELD_AUTHORITY_API_VERSION || !Array.isArray(payload.exceptions) || payload.exceptions.length>200) {
    throw new Error('Field Operations returned malformed procedure exception queue data.');
  }
  const seen=new Set<string>();
  const exceptions=payload.exceptions.map(raw=>{
    const item=object(raw);
    const part=item.part;
    if(part!=='indoor' && part!=='outdoor') throw new Error('Field Operations returned malformed procedure exception part.');
    const result:FieldProcedureExceptionQueueItem={
      key:id(item.key),visitId:id(item.visitId),interventionId:id(item.interventionId),assetId:id(item.assetId),workOrderId:id(item.workOrderId),
      part,stepId:id(item.stepId),title:text(item.title,240),reason:text(item.reason,1500),requestedAt:time(item.requestedAt),
      requestedByUserId:id(item.requestedByUserId),requestedByName:text(item.requestedByName,180),
      ownerUserId:nullableId(item.ownerUserId),ownerName:nullableText(item.ownerName,180),
      partVersion:version(item.partVersion),interventionVersion:version(item.interventionVersion),
    };
    if(result.stepId && !(result.part==='indoor'?/^I(0[1-9]|1[0-4])$/:/^O0[1-9]$/).test(result.stepId)) {
      throw new Error('Field Operations returned a procedure outside the frozen 14/9 contract.');
    }
    if(result.key!==result.interventionId+':'+result.part+':'+result.stepId || seen.has(result.key)) {
      throw new Error('Field Operations returned contradictory procedure exception identity.');
    }
    seen.add(result.key);
    return result;
  });
  for(let i=1;i<exceptions.length;i++) {
    const a=exceptions[i-1],b=exceptions[i];
    if(a.requestedAt>b.requestedAt || a.requestedAt===b.requestedAt && a.key>b.key) {
      throw new Error('Field Operations returned an unstable procedure exception queue.');
    }
  }
  return {success:true,version:FIELD_AUTHORITY_API_VERSION,exceptions};
}
