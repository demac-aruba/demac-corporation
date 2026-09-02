const { fieldError } = require('./fieldOperationsAuthorityCore');

const FIELD_EXECUTION_DEFINITION_VERSION = 1;
const REPORT_SECTION_TYPES = new Set([
  'checklist',
  'measurement_table',
  'findings',
  'photos',
  'free_text',
  'voice_note',
  'customer_acknowledgement',
]);
const REPORT_SECTION_STATUSES = new Set(['pending', 'in_progress', 'completed']);
const REPORT_SECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const REPORT_CHECKLIST_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function optionalNonNegativeSafeInteger(value) {
  if (value === undefined) return undefined;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function templateError(message, details = {}) {
  return fieldError('invalid_field_report_template', message, 409, details);
}

function normalizeChecklistItem(item, index, sectionId) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw templateError('Field report checklist contains an invalid item.', { sectionId, index });
  }
  const id = text(item.id, 120);
  const label = text(item.label, 240);
  if (!id || !REPORT_CHECKLIST_ITEM_ID_PATTERN.test(id) || !label) {
    throw templateError('Field report checklist item id or label is invalid.', { sectionId, index, itemId: id || null });
  }
  return { id, label };
}

function normalizeSection(section, index) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw templateError('Field report template contains an invalid section.', { index });
  }
  const id = text(section.id, 120);
  const title = text(section.title, 240);
  const type = text(section.type, 80);
  if (!id || !REPORT_SECTION_ID_PATTERN.test(id) || !title || !REPORT_SECTION_TYPES.has(type)) {
    throw templateError('Field report template section identity, title, or type is invalid.', { index, id, type });
  }
  if (typeof section.required !== 'boolean') {
    throw templateError('Field report template section required flag is invalid.', { index, id });
  }
  const minEvidenceCount = optionalNonNegativeSafeInteger(section.minEvidenceCount);
  const minMeasurementCount = optionalNonNegativeSafeInteger(section.minMeasurementCount);
  if (minEvidenceCount === null || minMeasurementCount === null) {
    throw templateError('Field report template section minimum counts must be non-negative safe integers.', { index, id });
  }

  let checklistItems;
  if (type === 'checklist') {
    if (!Array.isArray(section.checklistItems) || section.checklistItems.length === 0 || section.checklistItems.length > 100) {
      throw templateError('Checklist report sections must define between 1 and 100 canonical checklist items.', { index, id });
    }
    checklistItems = section.checklistItems.map((item, itemIndex) => normalizeChecklistItem(item, itemIndex, id));
    if (checklistItems.length !== new Set(checklistItems.map((item) => item.id)).size) {
      throw templateError('Checklist item ids must be unique within their report section.', { index, id });
    }
  } else if (section.checklistItems !== undefined) {
    throw templateError('Only checklist report sections may define checklistItems.', { index, id, type });
  }

  return {
    id,
    title,
    type,
    required: section.required,
    ...(minEvidenceCount === undefined ? {} : { minEvidenceCount }),
    ...(minMeasurementCount === undefined ? {} : { minMeasurementCount }),
    ...(checklistItems === undefined ? {} : { checklistItems }),
  };
}

function normalizeTemplate(template, serviceId) {
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw templateError('Field execution reportTemplate must be an object.', { serviceId });
  }
  const id = text(template.id, 180);
  const name = text(template.name, 240);
  const version = positiveSafeInteger(template.version);
  if (!id || !name || !version) {
    throw templateError('Field report template id, name, or version is invalid.', { serviceId, templateId: id });
  }
  if (!Array.isArray(template.sections) || template.sections.length === 0) {
    throw templateError('Field report template must contain at least one section.', { serviceId, templateId: id });
  }
  if (template.sections.length > 50) {
    throw templateError('Field report template exceeds the maximum supported section count.', { serviceId, templateId: id });
  }
  const sections = template.sections.map(normalizeSection);
  if (sections.length !== new Set(sections.map((section) => section.id)).size) {
    throw templateError('Field report template section ids must be unique.', { serviceId, templateId: id });
  }
  return { id, name, serviceId, version, sections };
}

function fieldReportTemplateSnapshotForService(service = {}) {
  const serviceId = text(service.id, 180);
  if (!serviceId) throw templateError('Canonical Service id is required before resolving Field execution metadata.');
  const definition = service.fieldExecutionDefinition;
  if (definition === undefined || definition === null) return undefined;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw templateError('Service fieldExecutionDefinition must be an object.', { serviceId });
  }
  if (definition.version !== FIELD_EXECUTION_DEFINITION_VERSION) {
    throw templateError('Unsupported Service fieldExecutionDefinition version.', {
      serviceId,
      version: definition.version ?? null,
    });
  }
  if (definition.reportTemplate === undefined || definition.reportTemplate === null) return undefined;
  return normalizeTemplate(definition.reportTemplate, serviceId);
}

function projectStoredReportTemplateSnapshot(value, serviceId) {
  if (value === undefined || value === null) return undefined;
  const normalizedServiceId = text(serviceId, 180);
  const snapshot = normalizeTemplate(value, normalizedServiceId);
  if (snapshot.serviceId !== normalizedServiceId || text(value.serviceId, 180) !== normalizedServiceId) {
    throw fieldError(
      'work_intervention_template_identity_conflict',
      'Persisted Work Intervention report template does not match its canonical Service.',
      409,
    );
  }
  return snapshot;
}

function projectStoredReportSectionStatus(value, template) {
  if (!template) {
    if (value !== undefined && value !== null) {
      throw fieldError('work_intervention_report_state_conflict', 'Work Intervention has report section state without a frozen report template.', 409);
    }
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fieldError('invalid_work_intervention_report_state', 'Work Intervention report section state is missing or invalid.', 409);
  }
  const expectedIds = template.sections.map((section) => section.id);
  const actualIds = Object.keys(value);
  if (actualIds.length !== expectedIds.length || expectedIds.some((id) => !Object.prototype.hasOwnProperty.call(value, id))) {
    throw fieldError('invalid_work_intervention_report_state', 'Work Intervention report section state does not match its frozen template.', 409);
  }
  const result = {};
  for (const id of expectedIds) {
    const status = text(value[id], 40);
    if (!REPORT_SECTION_STATUSES.has(status)) {
      throw fieldError('invalid_work_intervention_report_state', 'Work Intervention report section status is invalid.', 409, { sectionId: id, status: status || null });
    }
    result[id] = status;
  }
  return result;
}

function reportTemplateCompletion(template, sectionStatus) {
  if (!template) {
    if (sectionStatus !== undefined && sectionStatus !== null) {
      throw fieldError('work_intervention_report_state_conflict', 'Work Intervention has report section state without a frozen report template.', 409);
    }
    return {
      requiredSectionCount: 0,
      completedRequiredSectionCount: 0,
      incompleteRequiredSections: [],
      complete: true,
    };
  }
  const canonicalStatus = projectStoredReportSectionStatus(sectionStatus, template);
  const requiredSections = template.sections.filter((section) => section.required);
  const incompleteRequiredSections = requiredSections
    .filter((section) => canonicalStatus[section.id] !== 'completed')
    .map((section) => ({
      id: section.id,
      title: section.title,
      type: section.type,
      status: canonicalStatus[section.id],
    }));
  return {
    requiredSectionCount: requiredSections.length,
    completedRequiredSectionCount: requiredSections.length - incompleteRequiredSections.length,
    incompleteRequiredSections,
    complete: incompleteRequiredSections.length === 0,
  };
}

function requireReportTemplateSection(template, sectionId, expectedType) {
  const normalizedSectionId = text(sectionId, 120);
  if (!normalizedSectionId || !REPORT_SECTION_ID_PATTERN.test(normalizedSectionId)) {
    throw fieldError('report_section_not_available', 'The selected report section is invalid.', 409, {
      sectionId: normalizedSectionId || null,
    });
  }
  const section = template?.sections?.find((candidate) => candidate.id === normalizedSectionId);
  if (!section) {
    throw fieldError('report_section_not_available', 'The selected report section is not part of this Work Intervention template.', 409, {
      sectionId: normalizedSectionId,
    });
  }
  const normalizedType = text(expectedType, 80);
  if (normalizedType && section.type !== normalizedType) {
    throw fieldError('report_section_type_mismatch', 'The selected report section does not accept this kind of report data.', 409, {
      sectionId: normalizedSectionId,
      expectedType: normalizedType,
      sectionType: section.type,
    });
  }
  return section;
}

function requireReportChecklistItem(template, sectionId, itemId) {
  const section = requireReportTemplateSection(template, sectionId, 'checklist');
  const normalizedItemId = text(itemId, 120);
  if (!normalizedItemId || !REPORT_CHECKLIST_ITEM_ID_PATTERN.test(normalizedItemId)) {
    throw fieldError('report_checklist_item_not_available', 'The selected checklist item is invalid.', 409, {
      sectionId: section.id,
      itemId: normalizedItemId || null,
    });
  }
  const item = section.checklistItems?.find((candidate) => candidate.id === normalizedItemId);
  if (!item) {
    throw fieldError('report_checklist_item_not_available', 'The selected checklist item is not part of this frozen report template.', 409, {
      sectionId: section.id,
      itemId: normalizedItemId,
    });
  }
  return { section, item };
}

module.exports.FIELD_EXECUTION_DEFINITION_VERSION = FIELD_EXECUTION_DEFINITION_VERSION;
module.exports.REPORT_CHECKLIST_ITEM_ID_PATTERN = REPORT_CHECKLIST_ITEM_ID_PATTERN;
module.exports.REPORT_SECTION_ID_PATTERN = REPORT_SECTION_ID_PATTERN;
module.exports.REPORT_SECTION_STATUSES = REPORT_SECTION_STATUSES;
module.exports.REPORT_SECTION_TYPES = REPORT_SECTION_TYPES;
module.exports.fieldReportTemplateSnapshotForService = fieldReportTemplateSnapshotForService;
module.exports.projectStoredReportSectionStatus = projectStoredReportSectionStatus;
module.exports.projectStoredReportTemplateSnapshot = projectStoredReportTemplateSnapshot;
module.exports.reportTemplateCompletion = reportTemplateCompletion;
module.exports.requireReportChecklistItem = requireReportChecklistItem;
module.exports.requireReportTemplateSection = requireReportTemplateSection;
