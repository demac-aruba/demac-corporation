const { allowedWorkVisitTransitions } = require('./fieldOperationsAuthorityTransitions');

const ACTIVE_VISIT_TARGETS = Object.freeze(['en_route', 'on_site', 'in_progress', 'pending']);
const ACTIVE_VISIT_TARGET_SET = new Set(ACTIVE_VISIT_TARGETS);

function activatedVisitTransitions(status, allowedActions = []) {
  if (!Array.isArray(allowedActions) || !allowedActions.includes('execute')) return [];
  return allowedWorkVisitTransitions(status).filter((target) => ACTIVE_VISIT_TARGET_SET.has(target));
}

function projectActivatedVisit(visit, allowedActions = []) {
  if (!visit || typeof visit !== 'object') return visit;
  return {
    ...visit,
    availableTransitions: activatedVisitTransitions(visit.status, allowedActions),
  };
}

module.exports.ACTIVE_VISIT_TARGETS = ACTIVE_VISIT_TARGETS;
module.exports.activatedVisitTransitions = activatedVisitTransitions;
module.exports.projectActivatedVisit = projectActivatedVisit;
