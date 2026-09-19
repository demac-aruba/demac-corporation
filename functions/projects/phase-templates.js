'use strict';

// Optional company planning templates live in the existing businessSettings authority.
// Applying a template creates fresh planning IDs; it never copies execution or customer identity.
const d = require('./registry-domain');
const TEMPLATE_SETTINGS_ID = 'projects-phase-templates';
const MAX_TEMPLATES = 30;
const MAX_LIBRARY_BYTES = 256 * 1024;
const portableDetails = ['sequence', 'objective', 'outOfScope', 'technicianInstructions', 'priority'];

function templatePhases(phases) {
  return d.normalizePhases(phases).map(phase => {
    const details = Object.fromEntries(Object.entries(phase.details || {}).filter(([key]) => portableDetails.includes(key)));
    const { details: ignored, ...fields } = phase;
    return { ...fields, ...(Object.keys(details).length ? { details } : {}) };
  });
}
function validateLibrary(raw) {
  if (raw === null) return { schemaVersion: 1, version: 0, templates: [] };
  d.allowedKeys(raw, ['schemaVersion', 'version', 'templates']);
  if (raw.schemaVersion !== 1) throw d.fault('template_library_conflict', 'The template library needs reconciliation.', 409);
  d.integer(raw.version, 'template library version', 1, Number.MAX_SAFE_INTEGER - 1);
  if (!Array.isArray(raw.templates) || raw.templates.length > MAX_TEMPLATES) throw d.fault('template_library_limit', 'Template library scope is invalid.', 409);
  const seen = new Set();
  for (const item of raw.templates) {
    d.allowedKeys(item, ['id', 'name', 'description', 'projectType', 'version', 'active', 'phases', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy']);
    d.id(item.id); d.text(item.name, 'template name', 160); d.text(item.description, 'template description', 1000, true);
    d.text(item.projectType, 'template project type', 100); d.integer(item.version, 'template version', 1, Number.MAX_SAFE_INTEGER - 1);
    if (typeof item.active !== 'boolean' || !Array.isArray(item.phases) || !item.phases.length || seen.has(item.id)) throw d.fault('template_library_conflict', 'Duplicate or malformed company template.', 409);
    seen.add(item.id); d.normalizePhases(item.phases);
    d.stamp(item.createdAt); d.stamp(item.updatedAt); d.id(item.createdBy); d.id(item.updatedBy);
  }
  if (Buffer.byteLength(d.canonical(raw), 'utf8') > MAX_LIBRARY_BYTES) throw d.fault('template_library_limit', 'The template library exceeds its safe document size.', 409);
  return raw;
}
async function readTemplateLibrary({ db, transaction }) {
  const ref = db.collection('businessSettings').doc(TEMPLATE_SETTINGS_ID);
  const snapshot = await transaction.get(ref);
  return { ref, library: validateLibrary(snapshot.exists ? snapshot.data() : null) };
}
function listTemplates(library) {
  return { source: 'company_phase_templates', libraryVersion: library.version,
    templates: library.templates.map(item => ({ id: item.id, name: item.name, description: item.description,
      projectType: item.projectType, active: item.active, version: item.version,
      phaseCount: item.phases.length, plannedVanMinutes: item.phases.reduce((sum, phase) => sum + phase.plannedVanMinutes, 0) })) };
}
function cloneTemplatePhases(template, eventId) {
  const map = new Map(template.phases.map((phase, index) => [phase.id, `PH-${d.digest(`${eventId}:${index}:${phase.id}`).slice(0, 32)}`]));
  return templatePhases(template.phases).map(phase => ({ ...phase, id: map.get(phase.id),
    dependencies: phase.dependencies.map(id => map.get(id)),
    checklist: phase.checklist.map(item => ({ ...item, id: `CL-${d.digest(`${eventId}:${phase.id}:${item.id}`).slice(0, 32)}` })),
  }));
}
function selectedTemplate(library, templateId, expectedVersion) {
  const template = library.templates.find(row => row.id === d.id(templateId, 'templateId'));
  if (!template || !template.active) throw d.fault('template_not_available', 'Select an active company template.', 409);
  if (template.version !== d.integer(expectedVersion, 'template version', 1, Number.MAX_SAFE_INTEGER - 1)) {
    throw d.fault('template_version_conflict', 'The company template changed. Review its current version.', 409);
  }
  return template;
}
async function previewTemplateApplication({ db, transaction, project, data }) {
  d.allowedKeys(data, ['projectId', 'templateId', 'expectedTemplateVersion']);
  const { library } = await readTemplateLibrary({ db, transaction });
  const template = selectedTemplate(library, data.templateId, data.expectedTemplateVersion);
  const total = [...project.phases, ...template.phases].reduce((sum, phase) => sum + phase.plannedVanMinutes, 0);
  const blockers = [];
  if (!d.PROJECT_OPEN_STATES.has(project.planningStatus) && project.planningStatus !== 'On Hold') blockers.push('project_not_open');
  if (project.phases.length + template.phases.length > 100) blockers.push('phase_count_limit');
  if (total > project.budget.currentMinutes) blockers.push('phase_budget_allocation');
  return { mode: 'template_application_preview', projectId: project.id, projectVersion: project.version,
    templateId: template.id, templateVersion: template.version, templateName: template.name,
    phases: template.phases, totalPlannedVanMinutes: total, canApply: !blockers.length, blockers,
    digest: d.digest({ projectId: project.id, projectVersion: project.version, template }),
    semantics: 'append_new_phase_plans_without_execution_or_existing_scope_changes' };
}
async function prepareTemplateCommand({ db, transaction, project, input, principal, occurredAt, eventId }) {
  const data = input.data;
  if (input.action === 'apply_phase_template') {
    d.allowedKeys(data, ['projectId', 'expectedVersion', 'templateId', 'expectedTemplateVersion', 'previewDigest', 'reason']);
    const { library } = await readTemplateLibrary({ db, transaction });
    const template = selectedTemplate(library, data.templateId, data.expectedTemplateVersion);
    const expectedDigest = d.digest({ projectId: project.id, projectVersion: project.version, template });
    if (data.previewDigest !== expectedDigest) throw d.fault('template_preview_changed', 'The Project or template changed after review.', 409);
    const reason = d.text(data.reason, 'template application reason', 1000);
    const phases = d.normalizePhases([...project.phases, ...cloneTemplatePhases(template, eventId)]);
    if (phases.reduce((sum, phase) => sum + phase.plannedVanMinutes, 0) > project.budget.currentMinutes) {
      throw d.fault('phase_budget_allocation', 'Review phase planning allocations against the current estimate. Booking overruns remain advisory.');
    }
    return { next: { ...project, phases }, settingsWrite: null,
      evidence: { action: input.action, templateId: template.id, templateVersion: template.version,
        addedPhaseIds: phases.slice(project.phases.length).map(phase => phase.id), reason } };
  }
  const { ref, library } = await readTemplateLibrary({ db, transaction });
  d.integer(data.expectedLibraryVersion, 'expected template library version', 0, Number.MAX_SAFE_INTEGER - 1);
  if (data.expectedLibraryVersion !== library.version) throw d.fault('template_version_conflict', 'Another operator changed the company templates. Reload before editing.', 409);
  let templates; let beforeTemplate = null; let afterTemplate;
  const reason = d.text(data.reason, 'company template change reason', 1000);
  if (input.action === 'save_phase_template') {
    d.allowedKeys(data, ['projectId', 'expectedVersion', 'expectedLibraryVersion', 'templateId', 'name', 'description', 'reason', 'replacementConfirmed']);
    if (!project.phases.length) throw d.fault('template_empty', 'Define at least one custom phase before saving a reusable template.');
    const id = data.templateId === null ? `PT-${d.digest(eventId).slice(0, 32)}` : d.id(data.templateId, 'templateId');
    beforeTemplate = library.templates.find(row => row.id === id) || null;
    if (typeof data.replacementConfirmed !== 'boolean' || (beforeTemplate && data.replacementConfirmed !== true)) throw d.fault('template_replace_confirmation_required', 'Explicitly confirm replacing the saved template. Existing Projects will not change.');
    if (data.templateId !== null && !beforeTemplate) throw d.fault('template_not_available', 'The selected template no longer exists.', 409);
    if (!beforeTemplate && library.templates.length >= MAX_TEMPLATES) throw d.fault('template_library_limit', 'Review the existing company templates before adding more.', 409);
    afterTemplate = { id, name: d.text(data.name, 'template name', 160), description: d.text(data.description, 'template description', 1000, true),
      projectType: project.type, version: (beforeTemplate?.version || 0) + 1, active: true,
      phases: templatePhases(project.phases), createdAt: beforeTemplate?.createdAt || occurredAt,
      createdBy: beforeTemplate?.createdBy || principal.uid, updatedAt: occurredAt, updatedBy: principal.uid };
    templates = [...library.templates.filter(row => row.id !== id), afterTemplate];
  } else if (input.action === 'set_phase_template_active') {
    d.allowedKeys(data, ['projectId', 'expectedVersion', 'expectedLibraryVersion', 'templateId', 'active', 'reason']);
    if (typeof data.active !== 'boolean') throw d.fault('template_invalid', 'Template activity must be explicitly true or false.');
    beforeTemplate = library.templates.find(row => row.id === d.id(data.templateId, 'templateId'));
    if (!beforeTemplate) throw d.fault('template_not_available', 'The selected template no longer exists.', 409);
    afterTemplate = { ...beforeTemplate, version: beforeTemplate.version + 1, active: data.active, updatedAt: occurredAt, updatedBy: principal.uid };
    templates = library.templates.map(row => row.id === afterTemplate.id ? afterTemplate : row);
  } else throw d.fault('unsupported_action', 'Unsupported template command.');
  const nextLibrary = validateLibrary({ schemaVersion: 1, version: library.version + 1, templates });
  return { next: { ...project }, settingsWrite: { ref, data: nextLibrary },
    evidence: { action: input.action, beforeLibraryVersion: library.version, afterLibraryVersion: nextLibrary.version,
      beforeTemplate, afterTemplate, reason } };
}
module.exports = { TEMPLATE_SETTINGS_ID, MAX_LIBRARY_BYTES, templatePhases, validateLibrary, readTemplateLibrary,
  listTemplates, cloneTemplatePhases, selectedTemplate, previewTemplateApplication, prepareTemplateCommand };
