'use strict';
// Pure, shared text composition. Operational details never come from editor input.
const CATALOG = require('./data/message-copy-catalog.json');
const FIELDS = ['greeting', 'introduction', 'closing'];
const LIMITS = { greeting: 300, introduction: 1200, closing: 1600 };
const definition = id => CATALOG.find(item => item.id === id);
function fault(code) { return Object.assign(new Error(code), { code, status: 400 }); }
function defaultsFor(id, language) {
  const item = definition(id);
  if (!item || !item.languages.includes(language)) throw fault('unsupported-template');
  return { ...item.defaults[language] };
}
function validateFields(id, language, fields) {
  defaultsFor(id, language);
  const item = definition(id);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).sort().join() !== [...FIELDS].sort().join()) throw fault('invalid-fields');
  const normalized = {};
  for (const field of FIELDS) {
    const value = fields[field];
    if (typeof value !== 'string' || value.length > LIMITS[field] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|<[^>]*>/.test(value)) throw fault('invalid-text');
    const withoutTokens = value.replace(/\{([a-z_]+)\}/g, (whole, key) => {
      if (!item.variables.includes(key)) throw fault('invalid-variable');
      return '';
    });
    if (/[{}]/.test(withoutTokens)) throw fault('invalid-variable');
    normalized[field] = value.replace(/\r\n?/g, '\n').trim();
  }
  if (!item.sampleDetails[language] && !FIELDS.some(field => normalized[field])) throw fault('empty-message');
  return normalized;
}
function renderMessageCopy(id, language, variables, details, override) {
  const fields = override ? validateFields(id, language, override) : defaultsFor(id, language);
  const substitute = value => value.replace(/\{([a-z_]+)\}/g, (_, key) => String(variables?.[key] ?? ''));
  const parts = [substitute(fields.greeting), substitute(fields.introduction), String(details || ''), substitute(fields.closing)];
  // Deadline reminders keep their existing inline salutation, but it is editable.
  if (definition(id).inlineGreeting) {
    const body = parts.slice(1).filter(value => value.trim()).join('\n\n');
    return [parts[0], body].filter(value => value.trim()).join(' ');
  }
  return parts.filter(value => value.trim()).join('\n\n');
}
function previewMessage(id, language, fields) {
  return renderMessageCopy(id, language, { name: 'Example customer', company: 'DEMAC Professional Cooling Solutions', time_greeting: 'Bon dia', van: 'Van 2' }, definition(id)?.sampleDetails[language], fields);
}
module.exports = { CATALOG, FIELDS, LIMITS, definition, defaultsFor, validateFields, renderMessageCopy, previewMessage };
