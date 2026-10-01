import { parseFieldProcedureExceptionQueueResponse } from '../lib/field-procedure-exception-contract';

function assert(condition:unknown,message:string):asserts condition {
  if(!condition) throw new Error('FIELD PROCEDURE EXCEPTION CONTRACT ACCEPTANCE FAILED: '+message);
}
function assertThrows(action:()=>unknown,message:string) {
  let threw=false;try{action();}catch{threw=true;}assert(threw,message);
}
const item={
  key:'WI-1:indoor:I01',visitId:'VISIT-1',interventionId:'WI-1',assetId:'AC-1',workOrderId:'WO-1',
  part:'indoor',stepId:'I01',title:'Vista amplia inicial',reason:'Foto inicial no disponible',
  requestedAt:'2026-09-25T18:00:00.000Z',requestedByUserId:'tech-1',requestedByName:'Technician',
  ownerUserId:'tech-1',ownerName:'Technician',partVersion:2,interventionVersion:4,
} as const;
const parsed=parseFieldProcedureExceptionQueueResponse({success:true,version:1,exceptions:[item]});
assert(parsed.exceptions[0].key===item.key,'valid queue item should parse');
assertThrows(()=>parseFieldProcedureExceptionQueueResponse({success:true,version:1,exceptions:[{...item,stepId:'I15',key:'WI-1:indoor:I15'}]}),'indoor procedure outside 14-step contract must fail');
assertThrows(()=>parseFieldProcedureExceptionQueueResponse({success:true,version:1,exceptions:[{...item,key:'WI-2:indoor:I01'}]}),'contradictory key must fail');
assertThrows(()=>parseFieldProcedureExceptionQueueResponse({success:true,version:1,exceptions:[
  {...item,requestedAt:'2026-09-25T19:00:00.000Z'},
  {...item,key:'WI-2:outdoor:O01',interventionId:'WI-2',part:'outdoor',stepId:'O01',requestedAt:'2026-09-25T18:00:00.000Z'},
]}),'unstable queue ordering must fail');
assertThrows(()=>parseFieldProcedureExceptionQueueResponse({success:true,version:1,exceptions:[{...item,reason:'x'.repeat(1501)}]}),'oversized reason must fail');
console.log('Field procedure exception contract acceptance passed');
