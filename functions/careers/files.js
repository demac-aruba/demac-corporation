'use strict';
const net = require('node:net');
const { once } = require('node:events');
const C = require('./core');
function decode(value) {
  C.requireValue(typeof value==='string' && value.length>0 && value.length<=Math.ceil(C.MAX_FILE/3)*4 && value.length%4===0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),'Select a valid file up to 10 MB.');
  const bytes=Buffer.from(value,'base64');
  C.requireValue(bytes.length>0 && bytes.length<=C.MAX_FILE && bytes.toString('base64')===value,'Select a valid non-empty file up to 10 MB.');
  return bytes;
}
function detectedType(bytes) {
  if(bytes.subarray(0,5).toString()==='%PDF-') return 'application/pdf';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if(bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') return 'image/webp';
  if(bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]))) {
    let end=-1; for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
    if(end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0) return null;
    const count=bytes.readUInt16LE(end+10);let cursor=bytes.readUInt32LE(end+16),total=0;const names=new Set();
    if(!count || count>1024 || cursor>=end) return null;
    for(let i=0;i<count;i++) {
      if(cursor+46>end || bytes.readUInt32LE(cursor)!==0x02014b50) return null;
      const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),length=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32);
      total+=bytes.readUInt32LE(cursor+24);
      if((flags&1) || ![0,8].includes(method) || total>64*1024*1024 || cursor+46+length+extra+comment>end) return null;
      const name=bytes.subarray(cursor+46,cursor+46+length).toString('utf8');
      if(!name || name.includes('..') || name.startsWith('/') || name.includes('\\') || /vbaProject|\.exe$|\.js$/i.test(name) || names.has(name)) return null;
      names.add(name); cursor+=46+length+extra+comment;
    }
    if(names.has('[Content_Types].xml') && names.has('word/document.xml')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return null;
}
function privateScannerAddress(env) {
  if(env.CAREERS_CLAMD_SOCKET) return {path:env.CAREERS_CLAMD_SOCKET};
  const host=env.CAREERS_CLAMD_HOST || '';
  if(net.isIPv4(host) && (/^10\./.test(host)||/^192\.168\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host))) return {host,port:3310};
  return null;
}
async function scan(bytes,address) {
  C.requireValue(address,'Private document scanning is not configured.','scanner-unavailable',503);
  const socket=net.createConnection(address);
  let timer; const completed=new Promise((resolve,reject)=>{
    let reply=''; const fail=()=>reject(C.fault('scanner-unavailable','Document security check is unavailable. Retry later.',503));
    timer=setTimeout(()=>{fail();socket.destroy();},25000);
    socket.on('error',fail);
    socket.on('data',chunk=>{
      reply+=chunk.toString('utf8'); if(reply.length>4096){fail();socket.destroy();return;}
      if(reply.includes('\0')||reply.includes('\n')) {
        if(/^stream: OK(?:\0|\n)/.test(reply)) resolve();
        else if(/ FOUND(?:\0|\n)/.test(reply)) reject(C.fault('unsafe-file','The file did not pass the security check. Choose another file.',422));
        else fail(); socket.end();
      }
    });
    socket.on('end',()=>{if(!reply.includes('\0')&&!reply.includes('\n'))fail();});
  });
  const writing=(async()=>{
    await once(socket,'connect'); socket.write('zINSTREAM\0');
    for(let start=0;start<bytes.length;start+=65536){const part=bytes.subarray(start,start+65536),header=Buffer.alloc(4);header.writeUInt32BE(part.length);if(!socket.write(Buffer.concat([header,part])))await once(socket,'drain');}
    socket.write(Buffer.alloc(4));
  })();
  try {await Promise.all([writing,completed]);}finally{clearTimeout(timer);socket.destroy();}
}
function createFiles({bucket,sharp,scanner}) {
  async function prepare(bytes,name,kind) {
    const mime=detectedType(bytes), extension=name.toLowerCase().split('.').pop();
    const extensions={'application/pdf':['pdf'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/webp':['webp']};
    C.requireValue(mime && extensions[mime].includes(extension),'The file content does not match an accepted format.');
    C.requireValue(kind==='photo'?mime.startsWith('image/'):kind==='cv'?['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mime):mime!=='application/vnd.openxmlformats-officedocument.wordprocessingml.document','This file format is not allowed in this category.');
    await scanner(bytes);
    if(mime.startsWith('image/')) {
      let safe;try {safe=await sharp(bytes,{limitInputPixels:32000000,animated:false}).rotate().resize({width:kind==='photo'?1280:2400,height:kind==='photo'?1280:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();}catch{throw C.fault('invalid-image','This image could not be processed safely. Choose another photo.');}
      return {bytes:safe,mime:'image/jpeg'};
    }
    return {bytes,mime};
  }
  function object(record){C.requireValue(/^careers-private\/[A-Za-z0-9_-]+\/[a-f0-9]{64}-[a-f0-9-]{36}$/.test(record.path),'Invalid document reference.');return bucket.file(record.path,{generation:record.generation});}
  async function store(sessionId,fileId,prepared,lease) {
    const path=`careers-private/${C.id(sessionId)}/${C.id(fileId)}-${C.id(lease)}`,file=bucket.file(path),sha=C.digest(prepared.bytes);
    try {await file.save(prepared.bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:prepared.mime,cacheControl:'private,no-store',metadata:{sha256:sha,securityStatus:'clean'}}});}
    catch(error){if(error.code!==412)throw error;}
    const [meta]=await file.getMetadata();C.requireValue(meta.metadata?.sha256===sha && meta.metadata?.securityStatus==='clean','Conflicting document upload.','upload-conflict',409);
    return {path,generation:String(meta.generation)};
  }
  async function read(record) {
    const file=object(record), [meta]=await file.getMetadata();
    C.requireValue(String(meta.generation)===record.generation && meta.metadata?.securityStatus==='clean' && meta.metadata?.sha256===record.sha256,'Document verification failed.','unavailable',409);
    const [bytes]=await file.download({validation:'crc32c'});C.requireValue(C.digest(bytes)===record.sha256,'Document verification failed.','unavailable',409);
    return {bytes,mime:record.mime,name:record.name};
  }
  async function remove(record) {if(record.path)await object(record).delete({ignoreNotFound:true});}
  return {decode,prepare,store,read,remove,publicFile:record=>({id:record.id,kind:record.kind,name:record.name,size:record.size,status:record.status})};
}
module.exports={decode,detectedType,privateScannerAddress,scan,createFiles};
