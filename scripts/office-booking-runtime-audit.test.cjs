const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {signals,conditions}=require('./office-booking-runtime-audit.cjs');
test('runtime diagnostics extract typed signals without copying surrounding private text',()=>{
  const input='SYNTHETIC_PRIVATE_CLIENT Memory limit of 256 MiB exceeded with 290 MiB used. SYNTHETIC_PRIVATE_TOKEN';
  assert.deepEqual(signals(input),[{type:'memory_limit',limit:256,limitUnit:'MiB',used:290,usedUnit:'MiB'}]);
  assert.deepEqual(signals('SYNTHETIC_PRIVATE_TOKEN Cannot find module secret'),[{type:'missing_module'}]);
  assert.deepEqual(signals('customer appointment exception'),[]);
});
test('condition messages and unexpected reason payloads are excluded',()=>{
  assert.deepEqual(conditions([{type:'Ready',status:'False',reason:'HealthCheckContainerError',message:'SYNTHETIC_PRIVATE_TOKEN'},{type:'Ready',status:'False',reason:'private free text'}]),[
    {type:'Ready',status:'False',reason:'HealthCheckContainerError',severity:undefined},
    {type:'Ready',status:'False',reason:undefined,severity:undefined},
  ]);
});
test('command failures never dump captured stdout, stderr or error objects',async()=>{
  const output=[],mod={exports:{}},proc={};
  const requireStub=()=>({execFileSync:()=>{throw Object.assign(Error('SYNTHETIC_PRIVATE_ERROR'),{stdout:'SYNTHETIC_PRIVATE_CONFIG',stderr:'SYNTHETIC_PRIVATE_TOKEN'});}});
  requireStub.main=mod;
  vm.runInNewContext(fs.readFileSync(require.resolve('./office-booking-runtime-audit.cjs'),'utf8'),{require:requireStub,module:mod,process:proc,console:{log:value=>output.push(value),error:value=>output.push(value)}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(proc.exitCode,1);assert.deepEqual(output,['Read-only runtime audit failed; raw command output intentionally withheld.']);
});
