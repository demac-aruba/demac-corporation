'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const F=require('./files');
test('file decoder rejects empty, invalid, oversized or masquerading payloads',()=>{
  for(const v of ['', 'not-base64!', 'data:application/pdf;base64,eA=='])assert.throws(()=>F.decode(v));
  assert.equal(F.detectedType(Buffer.from('<script>bad</script>')),null);
  assert.equal(F.detectedType(Buffer.from('%PDF-1.4\n%%EOF')),'application/pdf');
  assert.equal(F.detectedType(Buffer.from([80,75,3,4,0,0,0,0])),null);
});
test('scanner fails closed and only private addresses are configured',()=>{
  assert.equal(F.privateScannerAddress({}),null);assert.equal(F.privateScannerAddress({CAREERS_CLAMD_HOST:'example.com'}),null);
  assert.deepEqual(F.privateScannerAddress({CAREERS_CLAMD_HOST:'10.1.2.3'}),{host:'10.1.2.3',port:3310});
});
test('INSTREAM sends bytes and rejects infected replies, not just a successful connection',async()=>{
  let reply='stream: OK\0',data;
  const server=net.createServer(socket=>{let buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>=10+4 && buffer.subarray(-4).equals(Buffer.alloc(4))){data=buffer;socket.end(reply);}});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const address={host:'127.0.0.1',port:server.address().port};await F.scan(Buffer.from('Test-only bytes'),address);assert.equal(data.subarray(0,10).toString(),'zINSTREAM\0');reply='stream: Test.Signature FOUND\0';await assert.rejects(F.scan(Buffer.from('Test-only bytes'),address),{code:'unsafe-file'});}finally{await new Promise(resolve=>server.close(resolve));}
});
