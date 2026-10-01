'use strict';

const crypto = require('node:crypto');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { MEDIA_LIMITS, MIME } = require('./fieldOperationsProcedureWorkflow');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const invalid = message => { throw fieldError('invalid_procedure_media_content', message, 400); };

/** Container signatures, not a claim of full codec validation or verified playback. */
function validateMediaBytes(bytes, kind, contentType) {
  if (!Buffer.isBuffer(bytes) || !Object.hasOwn(MEDIA_LIMITS, kind) || !MIME[kind].includes(contentType)
      || bytes.length < 4 || bytes.length > MEDIA_LIMITS[kind].bytes) invalid('Formato o tamaño de archivo no admitido.');
  const ascii = (offset, n) => bytes.toString('ascii', offset, offset + n);
  let matches = false;
  if (contentType === 'image/jpeg') matches = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (contentType === 'image/png') matches = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && ascii(12,4) === 'IHDR' && ascii(bytes.length-8,4) === 'IEND';
  if (contentType === 'image/webp') matches = bytes.length >= 20 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP' && bytes.readUInt32LE(4)+8 === bytes.length;
  if (contentType === 'audio/wav') matches = bytes.length >= 44 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WAVE' && bytes.readUInt32LE(4)+8 === bytes.length;
  if (contentType === 'audio/mpeg') matches = bytes.length >= 10 && (ascii(0,3) === 'ID3' || (bytes[0] === 255 && (bytes[1]&224) === 224));
  if (contentType === 'audio/ogg') matches = bytes.length >= 27 && ascii(0,4) === 'OggS';
  if (contentType.endsWith('/webm')) matches = bytes.length >= 16 && bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])) && bytes.subarray(0,Math.min(256,bytes.length)).includes(Buffer.from('webm'));
  if (contentType.endsWith('/mp4')) matches = bytes.length >= 24 && ascii(4,4) === 'ftyp' && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length;
  if (!matches) invalid('El contenido no coincide con el tipo de archivo declarado.');
  return { sha256: digest(bytes), sizeBytes: bytes.length, contentType };
}

function assertPath(path) {
  if (typeof path !== 'string' || path.length > 1000 || path.includes('..') || !/^field-evidence\/[-A-Za-z0-9_.:]+\/procedures\/[-A-Za-z0-9_.:]+\/[-A-Za-z0-9_.:]+\/[-A-Za-z0-9_.:]+$/.test(path)) {
    throw fieldError('invalid_procedure_storage_path', 'Ruta de archivo no autorizada.', 400);
  }
}

function createProcedureMediaStore(bucket) {
  if (!bucket || typeof bucket.file !== 'function') throw new Error('The existing private Field bucket is required.');
  async function readVerified(path, kind, expected) {
    assertPath(path);
    const options = expected?.generation ? { generation: String(expected.generation) } : undefined;
    const file = bucket.file(path, options);
    const [metadata] = await file.getMetadata();
    const sizeBytes = Number(metadata.size), generation = String(metadata.generation);
    if (!Object.hasOwn(MEDIA_LIMITS,kind) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MEDIA_LIMITS[kind].bytes
        || !MIME[kind].includes(metadata.contentType) || !/^\d+$/.test(generation)) invalid('Metadata del objeto privado no admitida.');
    if (expected && (generation !== String(expected.generation) || sizeBytes !== expected.sizeBytes || metadata.contentType !== expected.contentType)) {
      throw fieldError('procedure_object_changed', 'El objeto no coincide con la evidencia guardada.', 409);
    }
    // Pin the generation that was inspected. Never read a newer object after metadata validation.
    const pinned = bucket.file(path, { generation });
    const chunks = []; let received = 0;
    for await (const chunk of pinned.createReadStream({ validation:'crc32c' })) {
      received += chunk.length;
      if (received > sizeBytes || received > MEDIA_LIMITS[kind].bytes) invalid('El archivo supera el tamaño declarado.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== sizeBytes) invalid('El archivo está incompleto.');
    const verified = { ...validateMediaBytes(bytes,kind,metadata.contentType), generation };
    if (expected?.sha256 && expected.sha256 !== verified.sha256) throw fieldError('procedure_object_changed', 'El archivo no coincide con su huella registrada.', 409);
    return { bytes, verified };
  }
  async function verify(path,kind) { return (await readVerified(path,kind)).verified; }
  async function upload(reservation,bytes) {
    const m = reservation.manifest;
    assertPath(reservation.storagePath);
    if (!m || reservation.storagePath !== m.storagePath) invalid('La reserva no tiene una ruta coherente.');
    const actual = validateMediaBytes(bytes,m.kind,m.contentType);
    if (actual.sha256 !== m.sha256 || actual.sizeBytes !== m.sizeBytes) throw fieldError('procedure_upload_mismatch', 'El archivo no coincide con la reserva; no se reemplazó ningún original.', 409);
    const matchesReservation = verified => {
      if (verified.sha256 !== m.sha256 || verified.sizeBytes !== m.sizeBytes || verified.contentType !== m.contentType) {
        throw fieldError('procedure_object_conflict', 'Ya existe otro contenido bajo esta reserva; no se sobrescribió.', 409);
      }
      return verified;
    };
    const response = (verified, replayed) => ({success:true,uploaded:true,linked:false,replayed,captureId:reservation.captureId,...verified});

    // A normal retry is a read, not another upload. Inspect the original before
    // attempting any write, and pin verification to that exact generation.
    // Only a definite metadata 404 permits creation; access/transport/read
    // failures never become permission to replace an uncertain original.
    let existing;
    try {
      [existing] = await bucket.file(m.storagePath).getMetadata();
    } catch (error) {
      if (Number(error.code) !== 404) throw error;
    }
    if (existing) {
      const { verified } = await readVerified(m.storagePath, m.kind, {
        generation:String(existing.generation), sizeBytes:Number(existing.size), contentType:existing.contentType,
      });
      return response(matchesReservation(verified), true);
    }

    let replayed = false;
    try {
      await bucket.file(m.storagePath).save(bytes, {
        resumable:false, validation:'crc32c', preconditionOpts:{ifGenerationMatch:0},
        metadata:{contentType:m.contentType,cacheControl:'private, no-store',metadata:{fieldTarget:'service_procedure',ownerUserId:reservation.ownerUserId,sha256:m.sha256}},
      });
    } catch (error) {
      if (Number(error.code) !== 412) throw error;
      replayed = true;
    }
    // The atomic create-only precondition remains mandatory: another process
    // may win after our initial 404. A 412 is accepted only after byte verification.
    const verified = matchesReservation(await verify(m.storagePath,m.kind));
    return response(verified, replayed);
  }
  async function read(evidence) {return readVerified(evidence.storagePath,evidence.kind,evidence);}
  return {upload,verify,read};
}

function mediaReference(value) {
  if(typeof value!=='string'||!value||value.length>180||value.includes('..')||!/^[-A-Za-z0-9_.:]+$/.test(value))throw fieldError('invalid_procedure_reference','Referencia de archivo inválida.',400);
  return value;
}
/** Uses the same authenticated API and authoritative workflow, with no public download URL. */
async function handleProcedureMedia({request,identity,commands,store}) {
  const query=request.query||{},mode=query.procedureMedia;
  if(!identity?.uid)throw fieldError('unauthenticated','Se requiere autenticación.',401);
  if(!commands||!store)throw fieldError('procedure_media_unavailable','Carga privada no configurada.',503);
  if(!['upload','read'].includes(mode))throw fieldError('invalid_procedure_media_mode','Operación de archivo inválida.',400);
  const accepted=['procedureMedia','visitId','interventionId',mode==='upload'?'captureId':'evidenceId'];
  if(Object.keys(query).some(k=>!accepted.includes(k)))throw fieldError('invalid_procedure_media_query','Parámetros de archivo no admitidos.',400);
  const input={identity,visitId:mediaReference(query.visitId),interventionId:mediaReference(query.interventionId)};
  if(mode==='upload') {
    if(request.method!=='POST')throw fieldError('method_not_allowed','POST es requerido para subir archivos.',405);
    const reservation=await commands.authorizeUpload({...input,captureId:mediaReference(query.captureId)});
    const type=String(request.headers?.['content-type']||'').split(';')[0].trim().toLowerCase();
    if(type!==reservation.manifest.contentType)invalid('El tipo HTTP no coincide con la reserva.');
    const body=await store.upload(reservation,request.rawBody);
    return {status:200,body,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}};
  }
  if(request.method!=='GET')throw fieldError('method_not_allowed','GET es requerido para leer archivos.',405);
  const evidence=await commands.authorizeMediaRead({...input,evidenceId:mediaReference(query.evidenceId)});
  const {bytes}=await store.read(evidence);
  return {status:200,body:bytes,headers:{'Content-Type':evidence.contentType,'Content-Length':String(bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="${evidence.id}"`,'Referrer-Policy':'no-referrer'}};
}
module.exports={validateMediaBytes,createProcedureMediaStore,handleProcedureMedia};
