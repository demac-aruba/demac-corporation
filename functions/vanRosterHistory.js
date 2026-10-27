'use strict';

// Embedded effective versions belong to the canonical Van/rule, never a second roster.
function effectiveRecord(record, historyField, date) {
  const versions = record?.[historyField];
  if (!Array.isArray(versions) || !versions.length) return record;
  const version = versions.filter(item => item.effectiveFrom <= date).reduce((latest, item) =>
    !latest || item.effectiveFrom > latest.effectiveFrom || (item.effectiveFrom === latest.effectiveFrom && String(item.at) >= String(latest.at)) ? item : latest, null);
  return version ? { ...record, ...version.value } : record;
}
function crewForDate(van, date) { return effectiveRecord(van, 'crewHistory', date); }
function crewFields(value = {}) {
  return { responsibleStaffId: value.responsibleStaffId || '', regularHelperId: value.regularHelperId || '',
    additionalHelperId: value.additionalHelperId || '', technicianIds: [value.responsibleStaffId, value.regularHelperId, value.additionalHelperId].filter(Boolean) };
}
function scheduleFields(value = {}) {
  return { active: value.active !== false, weekday: value.weekday ?? null,
    workdayStart: value.workdayStart || '08:00', workdayEnd: value.workdayEnd || '13:00' };
}
function appendVersion(record, field, before, after, date, at, actorId) {
  const history = Array.isArray(record[field]) ? [...record[field]] : [{ effectiveFrom: '0001-01-01', at, actorId, value: before }];
  if (history.length >= 512) throw Object.assign(new Error('El historial de esta van requiere archivado antes de continuar.'), { status: 409, code: 'roster_history_full' });
  // Multiple changes today keep their audit; the last version owns this business day's schedule.
  return [...history, { effectiveFrom: date, at, actorId, value: after }];
}
module.exports = { crewForDate, crewFields, scheduleFields, appendVersion };
