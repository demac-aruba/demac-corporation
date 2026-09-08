'use strict';
/** Portable form contract. No Firebase, Node, DOM, secrets or application state.
 * The browser uses it for feedback; the authority invokes it again on every submit.
 */
const QUESTION_KINDS = Object.freeze(['select', 'multiselect', 'yesno', 'text', 'textarea', 'number', 'date', 'url']);
const COUNTRY_CODES = Object.freeze('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const countries = new Set(COUNTRY_CODES);
const LIMITS = Object.freeze({ givenName: 80, familyName: 100, email: 254, city: 120, text: 240, textarea: 1200, years: 70 });
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function isText(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !controlCharacters.test(value); }
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isWebUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !!url.hostname; } catch { return false; }
}
function validateDetails(input) {
  const raw = record(input), value = {}, errors = {};
  for (const [key, label] of [['givenName', 'first name'], ['familyName', 'last name'], ['city', 'current city']]) {
    if (!isText(raw[key], LIMITS[key])) errors[key] = `Enter your ${label}.`;
    else value[key] = raw[key].trim();
  }
  if (!isText(raw.email, LIMITS.email) || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(raw.email.trim())) errors.email = 'Enter a valid email address.';
  else value.email = raw.email.trim().toLowerCase();
  if (typeof raw.dialCode !== 'string' || !/^\+[1-9]\d{0,3}$/.test(raw.dialCode.trim())) errors.dialCode = 'Enter a country calling code, such as +297.';
  else value.dialCode = raw.dialCode.trim();
  if (typeof raw.phone !== 'string' || raw.phone.length > 30 || !/^[0-9\s().-]+$/.test(raw.phone) || !/^\+[1-9]\d{6,14}$/.test(`${value.dialCode || ''}${raw.phone.replace(/\D/g, '')}`)) errors.phone = 'Check the number and country code.';
  else value.phone = raw.phone.replace(/\D/g, '');
  for (const key of ['whatsapp', 'sameResidence']) {
    if (typeof raw[key] !== 'boolean') errors[key] = 'Select Yes or No.';
    else value[key] = raw[key];
  }
  for (const key of ['nationality', 'applyingFrom', 'residence']) {
    const country = key === 'residence' && raw.sameResidence === true ? raw.applyingFrom : raw[key];
    if (!countries.has(country)) errors[key] = 'Select a country from the list.';
    else value[key] = country;
  }
  return { value, errors };
}
function visibleQuestions(questions, supplied) {
  const answers = record(supplied), visible = new Set();
  return questions.filter(question => {
    const shown = !question.when || (visible.has(question.when.questionId) && answers[question.when.questionId] === question.when.value);
    if (shown) visible.add(question.id);
    return shown;
  });
}
function validateAnswers(questions, supplied) {
  const raw = record(supplied), value = {}, errors = {};
  // Evaluate dependencies against normalized, already-validated preceding answers.
  // A stale hidden parent can never activate one of its descendants.
  for (const question of questions) {
    if (question.when && value[question.when.questionId] !== question.when.value) continue;
    const key = `q-${question.id}`, answer = Object.hasOwn(raw, question.id) ? raw[question.id] : undefined;
    if (!QUESTION_KINDS.includes(question.kind)) { errors[key] = 'This question type is unavailable. Contact recruitment.'; continue; }
    const missing = answer == null || (typeof answer === 'string' && !answer.trim()) || (Array.isArray(answer) && !answer.length);
    if (missing) { if (question.required) errors[key] = `Answer: ${question.label}`; continue; }
    if (question.kind === 'multiselect') {
      if (!Array.isArray(answer) || answer.length > 40 || new Set(answer).size !== answer.length || answer.some(item => !isText(item, 120) || !question.options?.includes(item))) errors[key] = 'Choose valid options from the list.';
      else value[question.id] = [...answer];
      continue;
    }
    const string = question.kind === 'number' && typeof answer === 'number' ? String(answer) : answer;
    if (!isText(string, question.kind === 'textarea' ? LIMITS.textarea : LIMITS.text)) { errors[key] = 'Enter a valid answer within the allowed length.'; continue; }
    const normalized = string.trim();
    if ((question.kind === 'select' && !question.options?.includes(normalized)) || (question.kind === 'yesno' && !['Yes', 'No'].includes(normalized))) errors[key] = 'Choose one of the available options.';
    else if (question.kind === 'number' && (!Number.isFinite(Number(normalized)) || Number(normalized) < 0)) errors[key] = 'Enter a number of zero or more.';
    else if (question.kind === 'date' && !isDate(normalized)) errors[key] = 'Enter a valid calendar date.';
    else if (question.kind === 'url' && !isWebUrl(normalized)) errors[key] = 'Enter a valid http or https web address.';
    else value[question.id] = normalized;
  }
  return { value, errors };
}
function validateExperience(input, questions) {
  const raw = record(input), value = {}, errors = {};
  for (const key of ['totalExperience', 'relevantExperience']) {
    const years = raw[key];
    if (!['string', 'number'].includes(typeof years) || String(years).trim() === '' || !Number.isFinite(Number(years)) || Number(years) < 0 || Number(years) > LIMITS.years) errors[key] = 'Enter years of experience from 0 to 70.';
    else value[key] = String(Number(years));
  }
  if (!errors.totalExperience && !errors.relevantExperience && Number(value.relevantExperience) > Number(value.totalExperience)) errors.relevantExperience = 'Relevant experience cannot exceed your total experience.';
  if (!Array.isArray(raw.languages) || !raw.languages.length || raw.languages.length > 12 || raw.languages.some(language => !isText(language, 60)) || new Set(raw.languages.map(language => typeof language === 'string' ? language.trim() : language)).size !== raw.languages.length) errors.languages = 'Select at least one language without duplicates.';
  else value.languages = raw.languages.map(language => language.trim());
  if (!isText(raw.availability, 120)) errors.availability = 'Select when you could start.';
  else value.availability = raw.availability.trim();
  if (!raw.answers || typeof raw.answers !== 'object' || Array.isArray(raw.answers)) errors.answers = 'Check the role answers.';
  const answers = validateAnswers(questions, raw.answers);
  Object.assign(errors, answers.errors); value.answers = answers.value;
  return { value, errors };
}
module.exports = { QUESTION_KINDS, COUNTRY_CODES, LIMITS, isDate, isWebUrl, visibleQuestions, validateDetails, validateAnswers, validateExperience };
