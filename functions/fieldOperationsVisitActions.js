const { allowedWorkVisitTransitions } = require('./fieldOperationsAuthorityTransitions');

const ACTIVE_VISIT_TARGETS = Object.freeze(['en_route', 'on_site', 'in_progress']);
const ACTIVE_VISIT_TARGET_SET = new Set(ACTIVE_VISIT_TARGETS);

function activatedVisitTransitions(status, allowedActions = []) {
  if (!Array.isArray(allowedActions) || !allowedActions.includes('execute')) return [];
  return allowedWorkVisitTransitions(status).filter((target) => ACTIVE_VISIT_TARGET_SET.has(target));
}

module.exports.ACTIVE_VISIT_TARGETS = ACTIVE_VISIT_TARGETS;
module.exports.activatedVisitTransitions = activatedVisitTransitions;
