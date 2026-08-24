const { fieldError } = require('./fieldOperationsAuthorityCore');

const WORK_VISIT_TRANSITIONS = Object.freeze({
  scheduled: Object.freeze(['en_route', 'no_access', 'cancelled']),
  en_route: Object.freeze(['on_site', 'pending', 'no_access', 'cancelled']),
  on_site: Object.freeze(['in_progress', 'pending', 'requires_return_visit', 'no_access', 'cancelled']),
  in_progress: Object.freeze(['pending', 'requires_return_visit', 'ready_for_office_review', 'cancelled']),
  pending: Object.freeze(['in_progress', 'requires_return_visit', 'ready_for_office_review', 'cancelled']),
  requires_return_visit: Object.freeze(['in_progress', 'ready_for_office_review', 'cancelled']),
  ready_for_office_review: Object.freeze(['in_progress', 'completed']),
  completed: Object.freeze([]),
  no_access: Object.freeze([]),
  cancelled: Object.freeze([]),
});

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function validStatus(value) {
  const status = text(value, 80);
  if (!Object.hasOwn(WORK_VISIT_TRANSITIONS, status)) {
    throw fieldError('invalid_visit_status', `Unknown Work Visit status: ${status || 'missing'}.`, 400);
  }
  return status;
}

function validTimestamp(value) {
  const timestamp = text(value, 80);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw fieldError('transition_time_required', 'A valid transition timestamp is required.', 400);
  }
  return timestamp;
}

function assertWorkVisitTransition(currentValue, nextValue) {
  const current = validStatus(currentValue);
  const next = validStatus(nextValue);
  if (current === next) return { current, next, noop: true };
  if (!WORK_VISIT_TRANSITIONS[current].includes(next)) {
    throw fieldError('invalid_visit_transition', `Invalid Work Visit transition: ${current} -> ${next}.`, 409, { current, next });
  }
  return { current, next, noop: false };
}

function transitionCanonicalWorkVisit({ visit, to, at }) {
  if (!visit || typeof visit !== 'object') throw fieldError('visit_required', 'A canonical Work Visit is required.', 400);
  const id = text(visit.id, 180);
  if (!id) throw fieldError('visit_required', 'Work Visit id is required.', 400);
  const occurredAt = validTimestamp(at);

  const decision = assertWorkVisitTransition(visit.status, to);
  if (decision.noop) return { changed: false, previousStatus: decision.current, next: visit };

  const next = {
    ...visit,
    status: decision.next,
    ...(decision.next === 'en_route' && !visit.departedAt ? { departedAt: occurredAt } : {}),
    ...(decision.next === 'on_site' && !visit.arrivedAt ? { arrivedAt: occurredAt } : {}),
    ...(decision.next === 'in_progress' && !visit.startedAt ? { startedAt: occurredAt } : {}),
    ...(decision.next === 'ready_for_office_review' && !visit.submittedAt ? { submittedAt: occurredAt } : {}),
    ...(decision.next === 'completed' && !visit.completedAt ? { completedAt: occurredAt } : {}),
    ...(decision.next === 'requires_return_visit' ? { requiresSecondVisit: true } : {}),
  };

  return { changed: true, previousStatus: decision.current, next };
}

module.exports = {
  assertWorkVisitTransition,
  transitionCanonicalWorkVisit,
};