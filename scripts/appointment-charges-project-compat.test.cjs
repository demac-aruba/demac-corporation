const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('guard-only release preserves the previously deployed Project generation',async()=>{
  const baseline='83862a11db3681e1ae7463d59a6f7cf8da800f7b';
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'demac-project-guard-'));
  try {
    const archive=path.join(directory,'source.tar'),source=path.join(directory,'functions');fs.mkdirSync(source);
    execFileSync('git',['archive','--format=tar','--output='+archive,baseline+':functions']);
    execFileSync('tar',['-xf',archive,'-C',source]);
    fs.copyFileSync('functions/projectCommercialGuard.js',path.join(source,'projectCommercialGuard.js'));
    fs.symlinkSync(path.resolve('functions/node_modules'),path.join(source,'node_modules'),'dir');
    execFileSync(process.execPath,['--test','projectRecords.test.js','projectOperatorBooking.test.js','bookingProjectHistoricalCapacity.test.js'],{cwd:source,stdio:'pipe'});
    const {assertNoLinkedCommercialEvidence}=require(path.join(source,'projectCommercialGuard.js'));
    for(const jobCharges of [{final:{totalCents:100},paymentCount:0,receivedCents:0},{final:null,paymentCount:1,receivedCents:0},{final:null,paymentCount:0,receivedCents:100}]) {
      await assert.rejects(assertNoLinkedCommercialEvidence({appointment:{jobCharges}}),/commercial or payroll evidence/);
    }
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
