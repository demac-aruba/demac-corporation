'use strict';

const path = require('node:path');

const MAX_TASK_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'svg', 'js', 'mjs', 'cjs', 'exe', 'dll', 'bat', 'cmd', 'ps1', 'sh']);
const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif',
  'pdf', 'txt', 'csv',
  'doc', 'docx', 'xls', 'xlsx',
]);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function cleanAttachmentFileName(value) {
  const raw = String(value || '').trim().slice(0, 220);
  if (!raw) return 'evidence';
  const basename = path.basename(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const extension = basename.includes('.') ? `.${basename.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  const stem = basename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150) || 'evidence';
  return `${stem}${extension}`;
}

function attachmentExtension(fileName) {
  const clean = cleanAttachmentFileName(fileName);
  const last = clean.toLowerCase().split('.').pop();
  return clean.includes('.') ? last : '';
}

function normalizeContentType(value) {
  return String(value || '').toLowerCase().split(';')[0].trim();
}

function validateTaskAttachment({ fileName, contentType, size }) {
  const normalizedName = cleanAttachmentFileName(fileName);
  const extension = attachmentExtension(normalizedName);
  const mime = normalizeContentType(contentType);
  const bytes = Number(size);

  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('The selected evidence file is empty.');
  if (bytes > MAX_TASK_ATTACHMENT_BYTES) throw new Error('Task evidence files must be 20 MB or smaller.');
  if (extension && BLOCKED_EXTENSIONS.has(extension)) throw new Error('This file type is not allowed for task evidence.');

  const mimeAllowed = ALLOWED_MIME_TYPES.has(mime);
  const extensionAllowed = ALLOWED_EXTENSIONS.has(extension);
  if (!mimeAllowed && !extensionAllowed) {
    throw new Error('Use an image, PDF, text/CSV, Word, or Excel file for task evidence.');
  }

  return {
    fileName: normalizedName,
    contentType: mime || 'application/octet-stream',
    size: bytes,
  };
}

function taskAttachmentStoragePath(taskId, attachmentId, fileName) {
  const safeTask = String(taskId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180) || 'task';
  const safeAttachment = String(attachmentId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180) || 'attachment';
  const safeFile = cleanAttachmentFileName(fileName).replace(/\s+/g, '-');
  return `task-evidence/${safeTask}/${safeAttachment}-${safeFile}`;
}

function attachmentContentDisposition(fileName) {
  const safe = cleanAttachmentFileName(fileName).replace(/["\\]/g, '_');
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

module.exports = {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_TASK_ATTACHMENT_BYTES,
  attachmentContentDisposition,
  attachmentExtension,
  cleanAttachmentFileName,
  normalizeContentType,
  taskAttachmentStoragePath,
  validateTaskAttachment,
};
