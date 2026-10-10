const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('helper-scope guard works with the previously deployed Field generation',()=>{
  const baseline='b10ae55898b86fd3e446384c67e57350e32a4d87';
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'demac-field-helper-'));
  try {
    const archive=path.join(directory,'source.tar'),source=path.join(directory,'functions');fs.mkdirSync(source);
    execFileSync('git',['archive','--format=tar','--output='+archive,baseline+':functions']);
    execFileSync('tar',['-xf',archive,'-C',source]);
    fs.copyFileSync('functions/fieldOperationsAuthorityCore.js',path.join(source,'fieldOperationsAuthorityCore.js'));
    fs.symlinkSync(path.resolve('functions/node_modules'),path.join(source,'node_modules'),'dir');
    execFileSync(process.execPath,['--test','fieldOperationsAuthorityCore.test.js','fieldOperationsAuthorityWorkVisit.test.js','fieldOperationsPlannedWorkDispositions.test.js','fieldOperationsProfessionalReport.test.js'],{cwd:source,stdio:'pipe'});
    const {plannedWorkItems}=require(path.join(source,'fieldOperationsAuthorityCore.js'));
    const appointment={workLines:[{id:'work',presetId:'standard',quantity:3}]};
    assert.deepEqual(plannedWorkItems({workloadSupport:true,supportNonBillable:true,appointmentAssignmentRole:'support'},appointment),[]);
    assert.equal(plannedWorkItems({supportNonBillable:true,appointmentAssignmentRole:'support'},appointment)[0].quantity,3);
    assert.equal(plannedWorkItems({workloadSupport:true,appointmentAssignmentRole:'primary'},appointment)[0].quantity,3);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
