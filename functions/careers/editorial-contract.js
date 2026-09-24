'use strict';
/** Shared editorial contract. No network, storage, AI, or candidate answers.
 * English stays on the canonical vacancy; Spanish only supplies display labels.
 */
const TEXT_FIELDS = Object.freeze({ title: 100, department: 80, location: 100, contract: 80, summary: 1500 });
const LIST_FIELDS = Object.freeze(['responsibilities', 'requirements', 'desired']);
const own = (value, key) => Object.hasOwn(value, key);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = message => { throw Object.assign(new Error(message), { code: 'invalid-translation', status: 400 }); };
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : object(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
function text(value, limit, field) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(`Check Spanish ${field}.`);
  return value.trim();
}
function keysFor(question) { return question.kind === 'yesno' ? ['Yes', 'No'] : question.options || []; }
function sourceContent(job) {
  const result = Object.fromEntries(Object.keys(TEXT_FIELDS).map(key => [key, String(job[key] || '').trim()]));
  for (const key of LIST_FIELDS) result[key] = (job[key] || []).map(line => line.trim()).filter(Boolean);
  result.questions = (job.questions || []).map(q => ({ id: q.id, label: q.label.trim(), help: (q.help || '').trim(), kind: q.kind, required: q.required,
    options: keysFor(q).map(value => value.trim()).filter(Boolean), when: q.when || null }));
  result.cvRequired = job.cvRequired;
  result.photoRequired = job.photoRequired !== false;
  return result;
}
function nextEditorialVersion(job, previous) {
  if (!previous) return 1;
  return (previous.editorialVersion || 1) + (stable(sourceContent(job)) === stable(sourceContent(previous)) ? 0 : 1);
}
function parseTranslations(value) {
  if (!object(value) || Object.keys(value).some(key => key !== 'es')) invalid('Use the supported Spanish editorial version.');
  if (!own(value, 'es')) return {};
  const raw = value.es;
  if (!object(raw) || !['Draft', 'Approved'].includes(raw.status) || !Number.isSafeInteger(raw.sourceVersion) || raw.sourceVersion < 1) invalid('Check Spanish review status and source version.');
  const result = { status: raw.status, sourceVersion: raw.sourceVersion };
  for (const [key, limit] of Object.entries(TEXT_FIELDS)) result[key] = text(raw[key], limit, key);
  for (const key of LIST_FIELDS) {
    const list = raw[key] === undefined ? [] : raw[key];
    if (!Array.isArray(list) || list.length > 30) invalid(`Use up to 30 Spanish ${key}.`);
    result[key] = list.map(line => text(line, 300, key));
  }
  if (raw.questions !== undefined && (!Array.isArray(raw.questions) || raw.questions.length > 30)) invalid('Use up to 30 translated questions.');
  const ids = new Set();
  result.questions = (raw.questions || []).map(q => {
    if (!object(q) || typeof q.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(q.id) || ['__proto__','constructor','prototype'].includes(q.id) || ids.has(q.id)) invalid('Spanish questions need unique existing identifiers.');
    ids.add(q.id);
    const labels = q.optionLabels === undefined ? {} : q.optionLabels;
    if (!object(labels) || Object.keys(labels).length > 40 || Object.keys(labels).some(key => !key.trim() || key.length > 120 || /[\u0000-\u001f]/.test(key))) invalid('Check Spanish option labels.');
    return { id: q.id, label: text(q.label, 240, 'question'), help: text(q.help, 600, 'question help'),
      optionLabels: Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, text(label, 120, 'option')])) };
  });
  return { es: result };
}
function translationIssues(job, translation = job.translations?.es) {
  if (!translation) return ['Add the Spanish translation.'];
  const issues = [];
  if (translation.status !== 'Approved') issues.push('Review and approve the Spanish translation.');
  if (translation.sourceVersion !== (job.editorialVersion || 1)) issues.push('The English content changed. Review Spanish against the current version.');
  for (const key of Object.keys(TEXT_FIELDS)) if (!translation[key]?.trim()) issues.push(`Translate ${key}.`);
  for (const key of LIST_FIELDS) if (translation[key]?.length !== (job[key] || []).filter(line => line.trim()).length || translation[key]?.some(line => !line.trim())) issues.push(`Translate every ${key} item.`);
  const translations = translation.questions || [], source = job.questions || [];
  if (translations.length !== source.length || translations.some(q => !source.some(original => original.id === q.id))) issues.push('Align translated questions with the current English questions.');
  source.forEach((q, index) => {
    const t = translations.find(item => item.id === q.id);
    if (!t?.label.trim()) issues.push(`Translate question ${index + 1}.`);
    if (q.help?.trim() && !t?.help?.trim()) issues.push(`Translate help for question ${index + 1}.`);
    const keys = keysFor(q), labels = t?.optionLabels || {};
    if (Object.keys(labels).some(key => !keys.includes(key)) || keys.some(key => !own(labels, key) || !labels[key]?.trim())) issues.push(`Translate the current options for question ${index + 1}.`);
  });
  return issues;
}
function reconcileEditorial(job, previous) {
  const editorialVersion = nextEditorialVersion(job, previous);
  // Old clients omitting the extension must not erase manually authored translations.
  const translations = parseTranslations(own(job, 'translations') ? job.translations : previous?.translations || {});
  return { ...job, editorialVersion, translations };
}
function availableLocales(job) { return translationIssues(job).length ? ['en'] : ['en', 'es']; }
function publicTranslations(job) { return availableLocales(job).includes('es') ? parseTranslations({ es: job.translations.es }) : {}; }
function emptyTranslation(job, version = job.editorialVersion || 1) {
  return { status: 'Draft', sourceVersion: version, ...Object.fromEntries(Object.keys(TEXT_FIELDS).map(key => [key, ''])),
    ...Object.fromEntries(LIST_FIELDS.map(key => [key, (job[key] || []).filter(line => line.trim()).map(() => '')])),
    questions: (job.questions || []).map(q => ({ id: q.id, label: '', help: '', optionLabels: Object.fromEntries(keysFor(q).map(key => [key, ''])) })) };
}
function alignTranslation(job, translation) {
  const next = emptyTranslation(job);
  for (const key of [...Object.keys(TEXT_FIELDS), ...LIST_FIELDS]) next[key] = translation[key] ?? next[key];
  next.questions = next.questions.map(q => {
    const old = translation.questions.find(item => item.id === q.id);
    return { ...q, label: old?.label || '', help: old?.help || '', optionLabels: Object.fromEntries(Object.keys(q.optionLabels).map(key => [key, old?.optionLabels?.[key] || ''])) };
  });
  return next;
}
module.exports = { TEXT_FIELDS, LIST_FIELDS, nextEditorialVersion, parseTranslations, translationIssues, reconcileEditorial, availableLocales, publicTranslations, emptyTranslation, alignTranslation };
