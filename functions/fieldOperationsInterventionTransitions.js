const WORK_INTERVENTION_EXECUTION_GRAPH = Object.freeze({
  confirmed: Object.freeze(['in_progress', 'not_performed']),
  in_progress: Object.freeze(['completed', 'pending_part']),
});

const WORK_INTERVENTION_EXECUTION_TARGETS = Object.freeze([
  ...new Set(Object.values(WORK_INTERVENTION_EXECUTION_GRAPH).flat()),
]);
const WORK_INTERVENTION_EXECUTION_TARGET_SET = new Set(WORK_INTERVENTION_EXECUTION_TARGETS);
const ACTIVE_EXECUTION_VISIT_STATUSES = new Set(['on_site', 'in_progress']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function allowedWorkInterventionTransitions(status) {
  return [...(WORK_INTERVENTION_EXECUTION_GRAPH[text(status, 80)] || [])];
}

function requiredFieldActionForInterventionTarget(target) {
  const normalizedTarget = text(target, 80);
  if (normalizedTarget === 'in_progress') return 'execute';
  if (WORK_INTERVENTION_EXECUTION_TARGET_SET.has(normalizedTarget)) return 'intervention.complete';
  return '';
}

function activatedWorkInterventionTransitions({ status, visitStatus, allowedActions = [] } = {}) {
  const normalizedVisitStatus = text(visitStatus, 80);
  if (!ACTIVE_EXECUTION_VISIT_STATUSES.has(normalizedVisitStatus) || !Array.isArray(allowedActions)) return [];
  return allowedWorkInterventionTransitions(status).filter((target) => {
    const action = requiredFieldActionForInterventionTarget(target);
    if (!action || !allowedActions.includes(action)) return false;
    if (target === 'not_performed') return normalizedVisitStatus === 'on_site' || normalizedVisitStatus === 'in_progress';
    return normalizedVisitStatus === 'in_progress';
  });
}

function interventionExecutionOptions({ interventions = [], visitStatus, allowedActions = [] } = {}) {
  if (!Array.isArray(interventions)) return [];
  return interventions.map((intervention) => ({
    interventionId: text(intervention?.id, 180),
    allowedTargets: activatedWorkInterventionTransitions({
      status: intervention?.status,
      visitStatus,
      allowedActions,
    }),
  })).filter((option) => option.interventionId && option.allowedTargets.length > 0);
}

module.exports.WORK_INTERVENTION_EXECUTION_GRAPH = WORK_INTERVENTION_EXECUTION_GRAPH;
module.exports.WORK_INTERVENTION_EXECUTION_TARGETS = WORK_INTERVENTION_EXECUTION_TARGETS;
module.exports.activatedWorkInterventionTransitions = activatedWorkInterventionTransitions;
module.exports.allowedWorkInterventionTransitions = allowedWorkInterventionTransitions;
module.exports.interventionExecutionOptions = interventionExecutionOptions;
module.exports.requiredFieldActionForInterventionTarget = requiredFieldActionForInterventionTarget;