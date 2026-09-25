'use strict';
/**
 * Versioned submission presentation shared by the form and the server.
 * No database, DOM, translator or credentials. Only the server may persist it.
 * Bump PRESENTATION_VERSION when these submission labels/semantics change.
 */
const { availableLocales } = require('./editorial-contract');
const { visibleQuestions, LIMITS } = require('./form-contract');
const PRESENTATION_VERSION = 'careers-v4-submission-1';
const PROFILE_PROMPTS = Object.freeze({
  "givenName": "What is your first name?",
  "familyName": "What is your last name?",
  "email": "What is your email address?",
  "phone": "What is your phone number?",
  "whatsapp": "Is this number also on WhatsApp?",
  "nationality": "What is your nationality?",
  "applyingFrom": "Which country are you applying from?",
  "sameResidence": "Do you also live in that country?",
  "residence": "Which country do you live in?",
  "city": "Which city do you live in?",
  "totalExperience": "How many years of total work experience do you have?",
  "relevantExperience": "How many years of experience are relevant to this role?",
  "languages": "Which languages do you speak?",
  "availability": "When could you start?"
});
const PROFILE_CHOICES = Object.freeze({
  "yesno": [
    "Yes",
    "No"
  ],
  "languages": [
    "English",
    "Spanish",
    "Papiamento",
    "Dutch",
    "Other"
  ],
  "availability": [
    "Immediately",
    "Within 2 weeks",
    "Within 1 month",
    "More than 1 month",
    "To be discussed"
  ]
});
for (const values of Object.values(PROFILE_CHOICES)) Object.freeze(values);
const PROFILE_SPANISH = Object.freeze({
  "Do you also live in that country?": "¿También resides en ese país?",
  "Dutch": "Neerlandés",
  "English": "Inglés",
  "How many years of experience are relevant to this role?": "¿Cuántos años de experiencia tienes en trabajos relacionados con este puesto?",
  "How many years of total work experience do you have?": "¿Cuántos años de experiencia laboral tienes en total?",
  "Immediately": "Inmediatamente",
  "Is this number also on WhatsApp?": "¿Este número también tiene WhatsApp?",
  "More than 1 month": "En más de 1 mes",
  "No": "No",
  "Other": "Otro",
  "Papiamento": "Papiamento",
  "Spanish": "Español",
  "To be discussed": "Por acordar",
  "What is your email address?": "¿Cuál es tu correo electrónico?",
  "What is your first name?": "¿Cuál es tu nombre?",
  "What is your last name?": "¿Cuáles son tus apellidos?",
  "What is your nationality?": "¿Cuál es tu nacionalidad?",
  "What is your phone number?": "¿Cuál es tu número de teléfono?",
  "When could you start?": "¿Cuándo podrías comenzar?",
  "Which city do you live in?": "¿En qué ciudad resides?",
  "Which country are you applying from?": "¿Desde qué país estás aplicando?",
  "Which country do you live in?": "¿En qué país resides?",
  "Which languages do you speak?": "¿Qué idiomas hablas?",
  "Within 1 month": "Dentro de 1 mes",
  "Within 2 weeks": "Dentro de 2 semanas",
  "Yes": "Sí"
});
const own = (value, key) => Object.hasOwn(value, key);
function profileCopy(locale, text) { return locale === 'es' && own(PROFILE_SPANISH, text) ? PROFILE_SPANISH[text] : text; }
function presentedQuestion(job, question, locale) {
  const contentLocale = locale === 'es' && availableLocales(job).includes('es') ? 'es' : 'en';
  const translated = contentLocale === 'es' ? job.translations.es.questions.find(q => q.id === question.id) : undefined;
  const values = question.kind === 'yesno' ? ['Yes', 'No'] : question.options || [];
  return { contentLocale, label: translated?.label || question.label, help: translated?.help || question.help || '',
    options: values.map(value => ({ value, label: translated?.optionLabels[value] || value })) };
}
function invalid(message, code = 'invalid-input', status = 400) {
  throw Object.assign(new Error(message), { code, status });
}
function original(value, limit, optional = false) {
  if (value == null && optional) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid('Check the original answer and its length.');
  return value;
}
/** Call after the canonical profile validator. Never accept client-supplied labels/snapshots. */
function createSubmissionSnapshot(job, raw, canonical, locale, version, privacy) {
  if (locale !== 'en' && locale !== 'es') invalid('Select a supported application language.');
  if (version !== PRESENTATION_VERSION) invalid('The application form changed. Reload and review before submitting.', 'presentation-version', 409);
  const contentLocale = locale === 'es' && availableLocales(job).includes('es') ? 'es' : 'en';
  const fields = Object.entries(PROFILE_PROMPTS).filter(([field]) => field !== 'residence' || !canonical.sameResidence).map(([field, prompt]) => {
    let value, kind = 'text', options = [];
    if (field === 'phone') {
      value = [original(raw.dialCode, 8), original(raw.phone, 30)]; kind = 'phone';
    } else if (field === 'whatsapp' || field === 'sameResidence') {
      value = canonical[field]; kind = 'yesno';
      options = PROFILE_CHOICES.yesno.map(v => ({ value: v === 'Yes', label: profileCopy(locale, v) }));
    } else if (field === 'languages') {
      value = raw.languages.map(v => original(v, 60)); kind = 'multiselect';
      options = PROFILE_CHOICES.languages.map(v => ({ value: v, label: profileCopy(locale, v) }));
    } else if (field === 'availability') {
      value = original(raw[field], 120); kind = 'select';
      options = PROFILE_CHOICES.availability.map(v => ({ value: v, label: profileCopy(locale, v) }));
    } else {
      value = original(raw[field], LIMITS[field] || 240);
      if (['nationality','applyingFrom','residence'].includes(field)) kind = 'country';
      if (['totalExperience','relevantExperience'].includes(field)) kind = 'number';
    }
    return { id: `profile:${field}`, label: profileCopy(locale, prompt), kind, contentLocale: locale, options, value };
  });
  const questions = visibleQuestions(job.questions, canonical.answers).map(q => {
    const presentation = presentedQuestion(job, q, locale), value = own(raw.answers, q.id) ? raw.answers[q.id] : null;
    return { id: `role:${q.id}`, questionId: q.id, kind: q.kind, required: q.required, ...presentation,
      value: Array.isArray(value) ? value.map(v => original(v, 120)) : original(value, q.kind === 'textarea' ? LIMITS.textarea : LIMITS.text, true) };
  });
  // Privacy language is explicitly unknown until the approved settings contract supports it.
  return { schemaVersion: 1, presentationVersion: version, localeAtSubmit: locale, contentLocale,
    vacancyVersion: job.version, editorialVersion: job.editorialVersion || 1,
    title: contentLocale === 'es' ? job.translations.es.title : job.title,
    fields, questions,
    privacy: { version: privacy.version, text: privacy.text, contentLocale: null, acknowledged: true, futureTalent: canonical.futureTalent === true } };
}
/** Render only frozen option labels; never treat a free-text response as a translation key. */
function submittedAnswerText(row) {
  if (row.value == null || row.value === '') return '';
  const label = value => {
    if (!['select','multiselect','yesno'].includes(row.kind)) return String(value);
    return row.options.find(option => option.value === value)?.label || String(value);
  };
  return Array.isArray(row.value) ? row.value.map(label).join(row.kind === 'phone' ? ' ' : ', ') : label(row.value);
}
module.exports = { PRESENTATION_VERSION, PROFILE_PROMPTS, PROFILE_CHOICES, PROFILE_SPANISH, profileCopy, presentedQuestion, createSubmissionSnapshot, submittedAnswerText };
