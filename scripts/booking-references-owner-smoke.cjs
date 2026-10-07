'use strict';
// Christian explicitly authorized synthetic WhatsApp media to his own number on
// 2026-10-07. This one-off gate sends through the EXISTING queue/poll/ACK/bridge.
// It does not create/read/edit Appointments, Work Orders, clients or Van mappings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const requireFunction = createRequire(path.resolve('functions/package.json'));
const { initializeApp, applicationDefault } = requireFunction('firebase-admin/app');
const { getFirestore } = requireFunction('firebase-admin/firestore');
const { getStorage } = requireFunction('firebase-admin/storage');
const { referenceMessageParts, validateReferenceFile } = require('../functions/bookingVisitReferences');
const { createWhatsAppTransactionalService, normalizeWacliRecipient } = require('../functions/whatsappTransactionalService');

const TEST = 'pr557-owner-smoke-20261007';
const TO = '2975606772';
const reviewed = '0f7155efa951a7751e0daac6ab25e35799a53868';
const run = (binary, args) => execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = args => run('git', args).trim();
assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
assert.equal(process.env.GITHUB_REF, 'refs/heads/test/booking-references-owner-smoke-20261007');
assert.equal(git(['rev-parse', 'HEAD:functions']), git(['rev-parse', reviewed + ':functions']), 'Only the reviewed implementation may run');
assert.equal(normalizeWacliRecipient('5606772'), TO);
assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''), 'Runner temporary directory required');
const out = path.join(process.env.RUNNER_TEMP, TEST);
fs.mkdirSync(out, { recursive: true });
const report = { test: TEST, reviewed, to: '+2975606772', appointmentsTouched: false,
  scope: 'Candidate formatting + real existing queue/ACK/native media transport; bundle concurrency tested separately in emulator.', messages: [] };
const record = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixtures() {
  const specs = [
    ['prueba-foto-1.jpg', 'image/jpeg', 'PRUEBA: imagen ficticia 1, panel azul de referencia.'],
    ['prueba-foto-2.jpg', 'image/jpeg', 'PRUEBA: imagen ficticia 2, panel verde de referencia.'],
    ['prueba-video.mp4', 'video/mp4', 'PRUEBA: video ficticio de cuatro segundos.'],
    ['prueba-audio.mp3', 'audio/mpeg', 'PRUEBA: explicación ficticia; debe llegar como nota de voz.'],
  ];
  for (const [index, color] of ['0x123c66', '0x19674d'].entries()) {
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=960x540`, '-vf',
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='PRUEBA DEMAC - FOTO ${index + 1}':fontcolor=white:fontsize=44:x=(w-tw)/2:y=(h-th)/2`,
      '-frames:v', '1', '-update', '1', path.join(out, specs[index][0])]);
  }
  run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-vf',
    "drawbox=x=0:y=130:w=640:h=90:color=black@0.8:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='PRUEBA DEMAC - VIDEO':fontcolor=white:fontsize=32:x=(w-tw)/2:y=(h-th)/2",
    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, specs[2][0])]);
  run('espeak-ng', ['-v', 'es', '-s', '145', '-w', path.join(out, 'voice.wav'),
    'Prueba de DEMAC. Este audio es ficticio. Estamos verificando el envío de referencias por WhatsApp. No corresponde a una cita real.']);
  run('ffmpeg', ['-y', '-i', path.join(out, 'voice.wav'), '-c:a', 'libmp3lame', '-b:a', '96k', path.join(out, specs[3][0])]);
  return specs.map(([fileName, mime, description], index) => {
    const bytes = fs.readFileSync(path.join(out, fileName));
    return { ...validateReferenceFile({ fileName, contentType: mime, size: bytes.length }),
      id: `${TEST}-${index}`, storagePath: `communication-test-fixtures/${TEST}/${fileName}`, description,
      bytes, digest: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
}

async function main() {
  const files = fixtures();
  initializeApp({ credential: applicationDefault(), projectId: 'demac-corporation', storageBucket: 'demac-corporation.firebasestorage.app' });
  const db = getFirestore(), bucket = getStorage().bucket();
  const service = createWhatsAppTransactionalService({ db });
  assert.equal((await service.getTransportSettings()).transactionalProvider, 'wacli', 'Existing transport changed');
  const urls = new Map();
  for (const file of files) {
    const target = bucket.file(file.storagePath);
    const [exists] = await target.exists();
    if (!exists) await target.save(file.bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: file.mimeType, cacheControl: 'private, no-store', metadata: { test: TEST, sha256: file.digest } } });
    const [metadata] = await target.getMetadata();
    assert.equal(metadata.metadata?.sha256, file.digest, 'Existing synthetic fixture changed');
    const [url] = await target.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000 });
    urls.set(file.storagePath, url); // Never log or include bearer URLs in artifacts.
  }
  const messages = referenceMessageParts({
    text: '*PRUEBA DEMAC · NO ES UNA CITA REAL*\nChristian: prueba autorizada de referencias.\nOrden: 2 imágenes, video y explicación + nota de voz.\nNo requiere ninguna acción operativa.',
    appointment: { visitReferences: { files } }, order: { time: 'PRUEBA' }, client: { name: 'PRUEBA FICTICIA' }, sequence: 1,
  });
  assert.equal(messages.length, 6);
  for (const [index, part] of messages.entries()) {
    assert.equal((await service.getTransportSettings()).transactionalProvider, 'wacli');
    const queueId = `${TEST}-${String(index).padStart(2, '0')}`;
    const ref = db.collection('whatsappOutboundQueue').doc(queueId);
    const text = part.text || 'PRUEBA DEMAC: nota de voz ficticia.';
    const { storagePath, ...media } = part.media || {};
    const existing = await ref.get();
    if (existing.exists) {
      assert.equal(existing.data().to, TO); assert.equal(existing.data().testRunId, TEST);
      assert.equal(existing.data().text, text); assert.notEqual(existing.data().status, 'failed', 'Failed message needs inspection; never resend blindly');
    } else {
      await service.queueWacliText({ queueId, to: TO, text,
        metadata: { testRunId: TEST, reason: 'owner-authorized-synthetic-media-smoke',
          createdByName: 'DEMAC PRUEBA', createdByUserId: 'pr557-owner-authorized-test',
          ...(part.media ? { media: { ...media, url: urls.get(storagePath) } } : {}) } });
    }
    const deadline = Date.now() + 150000;
    let state;
    do {
      const current = await ref.get(); state = current.data();
      assert.equal(state.to, TO); assert.equal(state.testRunId, TEST);
      if (state.status === 'failed') throw Error(`Synthetic message ${index + 1} failed; inspect queue ${queueId}`);
      if (state.status === 'sent') break;
      await sleep(2500);
    } while (Date.now() < deadline);
    assert.equal(state.status, 'sent', `Synthetic message ${index + 1} not acknowledged; do not enqueue the next`);
    assert.ok(state.messageId, 'Provider message identity missing');
    report.messages.push({ index: index + 1, kind: part.media?.kind || 'text', queueId, status: state.status,
      messageId: state.messageId, attempts: state.attempts, completedAt: state.completedAt?.toDate?.().toISOString() || null });
    record(); console.log(JSON.stringify(report.messages.at(-1)));
  }
  report.complete = true; record();
  console.log('PASS: six ordered messages accepted and acknowledged through the existing bridge; no booking records touched.');
}
main().catch(error => { report.complete = false; report.error = error.code || 'smoke-stopped'; record();
  console.error(error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Synthetic smoke stopped; inspect the last test queue item. No automatic resend.'); process.exitCode = 1; });
