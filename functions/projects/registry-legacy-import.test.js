'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('./registry-domain');
const { prepareLegacyImport, publicImportPreview } = require('./registry-legacy-import');
const { captureLocalBackup, projectImportCandidate, STORAGE_KEYS } = require('./recovery');
function legacy(overrides = {}) {
  return {
    id:'DEMO-PRJ-1788364800000', projectNumber:'PRJ-1013-TEST', name:'Synthetic legacy Project',
    customerId:'IMPORT-TEST-CUSTOMER', customerName:'Synthetic customer', siteId:'IMPORT-TEST-PROPERTY',
    location:'Synthetic site', contactPerson:'Synthetic contact', type:'VRF Project', description:'Planned scope',
    technicianInstructions:'Synthetic safe-work instructions', status:'Planned', priority:'High', managerId:'', managerName:'Not assigned',
    startsOn:'2026-09-01', estimatedCompletionOn:'2026-10-01', totalUnits:10, completedUnits:0, unitType:'Units',
    estimatedWorkDays:11, slotsPerWorkDay:6, slotDurationMinutes:60, estimatedSlots:66, estimatedLaborHours:66,
    actualLaborHours:0, scheduledFutureHours:0, materialBudget:9000, materialActual:0, assignedVans:[],
    phases:[], assignments:[], materials:[], expenses:[], costEntries:[], ...overrides,
  };
}
function phase(overrides = {}) {
  return { id:'PH-IMPORT-TEST', name:'Synthetic phase', status:'Planned', estimatedLaborHours:6, actualLaborHours:0,
    estimatedMaterialCost:0, actualMaterialCost:0, unitsPlanned:1, unitsCompleted:0, progress:0,
    startsOn:'2026-09-01', endsOn:'2026-09-02', sequence:10, objective:'Specific objective', scopeOfWork:'Specific scope',
    outOfScope:'Excluded work', technicianInstructions:'Phase instructions', completionCriteria:'Test passed',
    dependencies:[], priority:'Critical', responsibleManager:'Synthetic manager', progressMethod:'checklist',
    checklist:[{id:'CHK-1',label:'Required work',required:true,done:false},{id:'CHK-2',label:'Optional work',required:false,done:false}],
    workflowStatus:'Ready to Schedule', fieldReports:[], ...overrides };
}
function candidate(raw = legacy()) {
  const rawProjectJson = JSON.stringify(raw);
  return { source:{storageKey:STORAGE_KEYS[0],origin:'https://erp.example.test',capturedAt:'2026-09-18T12:00:00.000Z',backupDigest:'a'.repeat(64),projectDigest:d.digest(rawProjectJson)},rawProjectJson };
}
test('preserves original project/phase IDs and rich planning fields without posting local actuals',()=>{
  const input=candidate(legacy({phases:[phase()],actualLaborHours:4,scheduledFutureHours:68,completedUnits:2}));
  const before=structuredClone(input);const result=prepareLegacyImport(input);
  assert.equal(result.projectId,'DEMO-PRJ-1788364800000');assert.equal(result.projectNumber,'PRJ-1013-TEST');
  assert.equal(result.plan.budgetedVanMinutes,3960);assert.equal(result.plan.phases[0].id,'PH-IMPORT-TEST');
  assert.equal(result.plan.phases[0].details.objective,'Specific objective');
  assert.equal(result.plan.phases[0].details.technicianInstructions,'Phase instructions');
  assert.equal(result.plan.phases[0].checklist[1].required,false);assert.equal(result.plan.phases[0].checklist[1].done,undefined);
  assert.equal(result.plan.details.materialBudget.amountMinor,900000);assert.equal(result.plan.details.totalUnits,10);
  assert.equal(result.plan.actualLaborHours,undefined);assert.equal(result.plan.scheduledFutureHours,undefined);assert.equal(result.plan.completedUnits,undefined);
  assert.equal(result.rawProjectJson,input.rawProjectJson);assert.deepEqual(input,before);
  assert.ok(result.warnings.includes('execution_requires_canonical_reconciliation'));
  assert.ok(result.warnings.includes('scheduling_links_require_canonical_reconciliation'));
});
test('large local overrun does not rewrite the estimate or block creating a migration plan',()=>{
  const result=prepareLegacyImport(candidate(legacy({actualLaborHours:70,scheduledFutureHours:12})));
  assert.equal(result.plan.budgetedVanMinutes,3960);assert.equal(publicImportPreview(result).actualLabor,null);
});
test('source snapshot does not purport to reconstruct historical original budget revisions',()=>{
  assert.ok(prepareLegacyImport(candidate()).warnings.includes('captured_baseline_not_original_revision_history'));
});
test('cost records, local links, manager references and unknown fields survive raw archive without automatic application',()=>{
  const result=prepareLegacyImport(candidate(legacy({managerId:'STAFF-TEST',unknownFutureField:{retained:'yes'},assignments:[{id:'LOCAL-A',workOrderId:'LOCAL-WO'}],costEntries:[{amount:20}]})));
  assert.ok(result.warnings.includes('unknown_fields_preserved_in_archive'));
  assert.ok(result.warnings.includes('financial_history_archived_not_posted'));
  assert.ok(result.warnings.includes('manager_reference_not_an_authorization'));
  assert.equal(JSON.parse(result.rawProjectJson).unknownFutureField.retained,'yes');
  assert.equal(result.retainedCounts.localAssignments,1);assert.equal(publicImportPreview(result).operationalLinksApplied,0);
});
test('known samples are rejected but user-created timestamp IDs are preserved',()=>{
  assert.throws(()=>prepareLegacyImport(candidate(legacy({id:'DEMO-PRJ-VRF-001'}))),{code:'sample_import_forbidden'});
  assert.equal(prepareLegacyImport(candidate()).projectId,'DEMO-PRJ-1788364800000');
});
test('capture provenance and project integrity are strict and never export authentication keys',()=>{
  const c=candidate();c.rawProjectJson+=' ';assert.throws(()=>prepareLegacyImport(c),{code:'source_checksum_mismatch'});
  for(const storageKey of ['firebase:authUser','other-projects'])assert.throws(()=>prepareLegacyImport({...candidate(),source:{...candidate().source,storageKey}}),{code:'invalid_source_key'});
  for(const value of ['https://user:pass@erp.example.test','https://erp.example.test/path','file:///x'])assert.throws(()=>prepareLegacyImport({...candidate(),source:{...candidate().source,origin:value}}),{code:'invalid_source_origin'});
});
test('inconsistent work-day/slot/hour snapshots stop migration instead of guessing a budget',()=>{
  for(const change of [{estimatedLaborHours:60},{estimatedSlots:60}])assert.throws(()=>prepareLegacyImport(candidate(legacy(change))));
});
test('invalid source numbers, arbitrary lifecycle values and precision loss are not silently normalized',()=>{
  for(const change of [{actualLaborHours:-1},{actualLaborHours:'4'},{status:'mystery'},{materialBudget:10.001},{estimatedLaborHours:66.00001}])assert.throws(()=>prepareLegacyImport(candidate(legacy(change))));
});
test('declared legacy execution state stays separate from authoritative completion',()=>{
  const result=prepareLegacyImport(candidate(legacy({status:'Completed',completedUnits:10})));
  assert.equal(result.planningStatus,'Planned');assert.equal(result.sourceDeclaredStatus,'Completed');assert.equal(publicImportPreview(result).physicalProgress,null);
});
test('manual planning hold/cancelled states are preserved, not reopened',()=>{
  for(const status of ['Draft','On Hold','Cancelled'])assert.equal(prepareLegacyImport(candidate(legacy({status}))).planningStatus,status);
});
test('rich phase prerequisites and completion metadata remain enforceable',()=>{
  const a=phase();const b=phase({id:'PH-2',dependencies:[a.id]});
  const result=prepareLegacyImport(candidate(legacy({phases:[a,b]})));
  assert.deepEqual(result.plan.phases[1].dependencies,[a.id]);assert.equal(result.plan.phases[0].completionCriteria,a.completionCriteria);
  assert.throws(()=>prepareLegacyImport(candidate(legacy({phases:[{...a,dependencies:['PH-2']},b]}))),{code:'dependency_cycle'});
});
test('legacy phases without an explicit progress contract require review, not invented defaults',()=>{
  const p=phase();delete p.progressMethod;assert.throws(()=>prepareLegacyImport(candidate(legacy({phases:[p]}))));
});
test('checklist execution is archived separately and can never be imported as a completed item',()=>{
  const p=phase({checklist:[{id:'CHK-1',label:'Checked',required:true,done:true}]});
  const result=prepareLegacyImport(candidate(legacy({phases:[p]})));
  assert.ok(result.warnings.includes('execution_requires_canonical_reconciliation'));assert.equal(result.plan.phases[0].checklist[0].done,undefined);
});
test('metadata changes preserve untouched details and may not rewrite the planning unit snapshot',()=>{
  const plan=prepareLegacyImport(candidate()).plan;
  const result=d.applyMetadata(plan,{details:{priority:'Normal'}});
  assert.equal(result.details.priority,'Normal');assert.deepEqual(result.details.scheduleEstimate,plan.details.scheduleEstimate);
  assert.deepEqual(result.details.materialBudget,plan.details.materialBudget);
  assert.throws(()=>d.applyMetadata(plan,{details:{scheduleEstimate:plan.details.scheduleEstimate}}),{code:'estimate_revision_required'});
  assert.throws(()=>d.applyMetadata(plan,{details:{actualLaborHours:20}}),{code:'invalid_fields'});
});
test('invalid phase ranges and non-boolean checklist requirements fail validation',()=>{
  assert.throws(()=>prepareLegacyImport(candidate(legacy({phases:[phase({endsOn:'2026-08-01'})]}))),{code:'invalid_date_range'});
  assert.throws(()=>prepareLegacyImport(candidate(legacy({phases:[phase({checklist:[{id:'C',label:'Test',required:'true'}]})]}))),{code:'invalid_checklist'});
});
test('empty material baseline stays absent; a currency assumption cannot become a stock movement',()=>{
  for(const materialBudget of [null,0])assert.equal(prepareLegacyImport(candidate(legacy({materialBudget}))).plan.details.materialBudget,null);
});
test('selector verifies complete saved backup but extracts only the chosen original record',async()=>{
  const selected=legacy();const other=legacy({id:'OTHER-TEST',projectNumber:'PRJ-OTHER'});
  const raw=JSON.stringify({version:1,projects:[selected,other]});const reads=[];
  const storage={getItem(key){reads.push(key);if(key===STORAGE_KEYS[0])return raw;if(key===STORAGE_KEYS[1])return '[]';assert.fail('Token read');}};
  const b=await captureLocalBackup(storage,{capturedAt:'2026-09-18T12:00:00.000Z',origin:'https://erp.example.test'});
  const c=await projectImportCandidate(JSON.stringify(b),selected.id);
  assert.equal(c.source.backupDigest,b.integrity.digest);assert.deepEqual(JSON.parse(c.rawProjectJson),selected);
  assert.equal(prepareLegacyImport(c).projectId,selected.id);assert.ok(reads.every(key=>STORAGE_KEYS.includes(key)));
});
test('selector refuses duplicate IDs/numbers, missing project or corrupted backup',async()=>{
  async function saved(projects){return JSON.stringify(await captureLocalBackup({getItem:key=>key===STORAGE_KEYS[0]?JSON.stringify({version:1,projects}):'[]'},{capturedAt:'2026-09-18T12:00:00.000Z',origin:'https://erp.example.test'}));}
  await assert.rejects(projectImportCandidate(await saved([legacy(),legacy()]),legacy().id),{code:'ambiguous_project_identity'});
  await assert.rejects(projectImportCandidate(await saved([legacy(),legacy({id:'OTHER'})]),legacy().id),{code:'ambiguous_project_number'});
  await assert.rejects(projectImportCandidate(await saved([legacy()]),'MISSING'),{code:'ambiguous_project_identity'});
  const bad=JSON.parse(await saved([legacy()]));bad.body.entries[0].raw='{}';await assert.rejects(projectImportCandidate(JSON.stringify(bad),legacy().id),{code:'checksum_mismatch'});
});
test('candidate size is bounded; oversized records are not truncated to pass import',()=>{
  assert.throws(()=>prepareLegacyImport(candidate(legacy({unknown:'x'.repeat(100*1024)}))),{code:'legacy_payload_too_large'});
});

test('originating slot snapshots cannot disagree with the initial central estimate',()=>{
  const plan=prepareLegacyImport(candidate()).plan;
  assert.throws(()=>d.normalizePlanInput({...plan,budgetedVanMinutes:3900}),{code:'inconsistent_plan_units'});
});
