'use strict';
const assert = require('node:assert/strict');
module.exports = async function runWorkspaceChecks(parse, fixture, lead, helper, office) {
  let cases = 0;
  const f = fixture(), target = {ownerUserId:lead.uid,visitId:'VISIT-1',interventionId:'WI-1',assetId:'AC-1'};
  const initial = await f.read(), projected = parse(initial,target);
  assert.deepEqual(projected.procedureParts.map(p=>p.steps.length),[14,9]); cases++;
  assert.deepEqual(projected.procedureParts[0].steps[1].missing,['result_not_recorded','result']); cases++;
  for (const mutate of [
    r=>r.assetId='OTHER', r=>r.visitId='OTHER', r=>r.interventionId='OTHER', r=>r.version=2,
    r=>r.interventionVersion=-1, r=>r.mediaLimits.video.bytes=100_000_000, r=>r.readiness.complete='yes',
    r=>r.workflow.safety.revision=-1, r=>r.workflow.safety.phase='safe',
    r=>r.workflow.parts.indoor.steps.I01.evidenceIds=['missing'],
    r=>r.workflow.parts.indoor.steps.I01.status='completed',
    r=>r.stepReadiness.indoor.I01=null, r=>r.workflow.protocol.parts.indoor.steps.pop(),
  ]) {const changed=structuredClone(initial);mutate(changed);assert.throws(()=>parse(changed,target));cases++;}
  await f.claim('indoor');await f.claim('outdoor');
  const withPhoto = await f.photo('indoor','I01','before');
  const photo = parse(withPhoto,target).evidence[0];
  assert.equal(photo.createdBy,lead.uid);assert.equal(photo.part,'indoor');assert.ok(photo.captureId);cases++;
  for (const mutate of [
    r=>r.evidence[0].assetId='OTHER',r=>r.evidence[0].part='outdoor',r=>r.evidence[0].procedureId='I02',
    r=>r.evidence.push({...r.evidence[0]}),r=>r.evidence[0].sha256='x'.repeat(64),
    r=>r.evidence[0].contentType='text/html',r=>r.evidence[0].storagePath='https://public.invalid/file',
    r=>r.evidence[0].generation='unverified',r=>r.evidence[0].storagePath+='/'+'OTHER',
    r=>r.evidence[0].receivedAt='not-a-time',r=>r.evidence[0].sizeBytes=0,
  ]) {const changed=structuredClone(withPhoto);mutate(changed);assert.throws(()=>parse(changed,target));cases++;}
  const saved = await f.save('indoor','I01',{note:'Synthetic documented result'});
  assert.equal(parse(saved,target).procedureParts[0].steps[0].status,'documented');cases++;
  assert.equal(parse(saved,target).readiness.complete,false,'one step is not a completed intervention');cases++;
  const exception=await f.mutate({action:'request_exception',...await f.current('outdoor'),stepId:'O02',reason:'Instrumento no disponible en prueba'},helper);
  assert.equal(parse(exception,target).procedureParts[1].steps[1].exception.reviewStatus,'pending');cases++;
  const approved=await f.mutate({action:'review_exception',part:'outdoor',stepId:'O02',expectedPartVersion:exception.workflow.parts.outdoor.version,decision:'approve',reason:'Revisión sintética de limitación real',disposition:'not_performed'},office);
  assert.equal(parse(approved,target).procedureParts[1].steps[1].exception.disposition,'not_performed');cases++;
  const risk=await f.mutate({action:'report_risk',affectedParts:['indoor','outdoor'],reason:'Riesgo sintético que bloquea actividad'});
  assert.equal(parse(risk,target).risks[0].status,'open');cases++;
  console.log(`PASS ${cases} workspace response/provenance checks against actual backend commands`);
  return cases;
};
