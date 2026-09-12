'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TASK_ATTACHMENT_BYTES,
  attachmentContentDisposition,
  cleanAttachmentFileName,
  taskAttachmentStoragePath,
  validateTaskAttachment,
} = require('./taskAttachmentPolicy');

test('sanitizes task evidence names without losing useful extensions', () => {
  assert.equal(cleanAttachmentFileName('../../report final?.pdf'), 'report final-.pdf');
  assert.equal(cleanAttachmentFileName('photo 01.HEIC'), 'photo 01.heic');
});

test('accepts governed evidence formats and rejects executable or oversized files', () => {
  assert.equal(validateTaskAttachment({ fileName: 'proof.jpg', contentType: 'image/jpeg', size: 1024 }).contentType, 'image/jpeg');
  assert.equal(validateTaskAttachment({ fileName: 'report.xlsx', contentType: 'application/octet-stream', size: 2048 }).fileName, 'report.xlsx');
  assert.throws(() => validateTaskAttachment({ fileName: 'payload.svg', contentType: 'image/svg+xml', size: 50 }), /not allowed/i);
  assert.throws(() => validateTaskAttachment({ fileName: 'payload.exe', contentType: 'application/octet-stream', size: 50 }), /not allowed/i);
  assert.throws(() => validateTaskAttachment({ fileName: 'large.pdf', contentType: 'application/pdf', size: MAX_TASK_ATTACHMENT_BYTES + 1 }), /20 MB/i);
});

test('creates private task-scoped storage paths', () => {
  assert.equal(
    taskAttachmentStoragePath('task/one', 'att:2', 'Proof Photo.jpg'),
    'task-evidence/task_one/att_2-Proof-Photo.jpg',
  );
});

test('creates safe download content disposition', () => {
  const header = attachmentContentDisposition('final report.pdf');
  assert.match(header, /^attachment;/);
  assert.match(header, /final%20report\.pdf/);
});
