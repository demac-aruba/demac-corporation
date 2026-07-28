const { read, write, replaceOnce, insertAfter, replaceRange } = require('./serviceFlowPatchUtils.cjs');

// ---------------------------------------------------------------------------
// Conditional report fields, derived recommendations and photo moments.
// ---------------------------------------------------------------------------
const reportFile = 'src/screens/TechnicianInterventionReportScreen.tsx';
replaceOnce(
  reportFile,
  "import { getTechnicianReportTemplate, TemplateFieldDefinition, TemplateSectionDefinition } from '../features/technicianPortal/templates';",
  "import { applyTechnicianReportDerivedValues, getTechnicianReportTemplate, templateFieldIsRequired, templateFieldIsVisible, TemplateFieldDefinition, TemplateSectionDefinition } from '../features/technicianPortal/templates';",
  'applyTechnicianReportDerivedValues, getTechnicianReportTemplate',
);
insertAfter(
  reportFile,
  "function evidenceMoment(section: ReportSection['sectionType']) {\n  if (section === 'identification' || section === 'initial_measurements') return 'before' as const;\n  if (section === 'completion' || section === 'final_measurements') return 'after' as const;\n  return 'during' as const;\n}",
  `

function evidenceMomentForField(section: ReportSection['sectionType'], fieldKey: string) {
  const normalized = fieldKey.toLowerCase();
  if (normalized.includes('after') || normalized.includes('correction') || normalized.includes('installed')) return 'after' as const;
  if (normalized.includes('before')) return 'before' as const;
  return evidenceMoment(section);
}`,
  'function evidenceMomentForField',
);
replaceOnce(reportFile, "    setDraft({ ...activeItem.section.fields });", "    setDraft(applyTechnicianReportDerivedValues({ ...activeItem.section.fields }));", 'setDraft(applyTechnicianReportDerivedValues');
replaceOnce(
  reportFile,
  "  function setDraftValue(key: string, value: DraftValue) {\n    setDraft((previous) => ({ ...previous, [key]: value }));\n  }",
  "  function setDraftValue(key: string, value: DraftValue) {\n    setDraft((previous) => applyTechnicianReportDerivedValues({ ...previous, [key]: value }));\n  }",
  'applyTechnicianReportDerivedValues({ ...previous, [key]: value })',
);
replaceOnce(
  reportFile,
  "  async function saveSection(status?: ReportSection['status']) {\n    if (!activeItem) return;\n    setWorking(true);",
  "  async function saveSection(status?: ReportSection['status']) {\n    if (!activeItem) return;\n    const derivedDraft = applyTechnicianReportDerivedValues(draft);\n    if (status === 'completed') {\n      const missing = activeItem.definition.fields.filter((field) => templateFieldIsVisible(field, derivedDraft) && templateFieldIsRequired(field, derivedDraft) && !fieldHasValue(derivedDraft[field.key]));\n      if (missing.length) {\n        setMessage(`Faltan ${missing.length} campo(s) obligatorio(s): ${missing.map((field) => field.label).join(', ')}.`);\n        return;\n      }\n    }\n    setDraft(derivedDraft);\n    setWorking(true);",
  'const derivedDraft = applyTechnicianReportDerivedValues(draft);',
);
replaceOnce(reportFile, "    const result = await updateReportSection(activeItem.section, { fields: draft, status });", "    const result = await updateReportSection(activeItem.section, { fields: derivedDraft, status });", 'fields: derivedDraft, status');
replaceOnce(reportFile, "        moment: evidenceMoment(activeItem.section.sectionType),", "        moment: evidenceMomentForField(activeItem.section.sectionType, field.key),", 'evidenceMomentForField(activeItem.section.sectionType, field.key)');
replaceOnce(
  reportFile,
  "              {activeItem.definition.fields.map((field) => (",
  "              {activeItem.definition.fields.filter((field) => templateFieldIsVisible(field, draft)).map((field) => (",
  'templateFieldIsVisible(field, draft)).map',
);
replaceOnce(
  reportFile,
  "                const requiredCount = definition.fields.filter((field) => field.required).length;\n                const completedCount = definition.fields.filter((field) => field.required && fieldHasValue(section.fields[field.key])).length;",
  "                const visibleFields = definition.fields.filter((field) => templateFieldIsVisible(field, section.fields));\n                const requiredFields = visibleFields.filter((field) => templateFieldIsRequired(field, section.fields));\n                const requiredCount = requiredFields.length;\n                const completedCount = requiredFields.filter((field) => fieldHasValue(section.fields[field.key])).length;",
  'const visibleFields = definition.fields.filter',
);
insertAfter(
  reportFile,
  "  const label = `${field.label}${field.required ? ' *' : ''}${field.unit ? ` (${field.unit})` : ''}`;",
  `

  if (field.type === 'recommendation') {
    if (!fieldHasValue(value)) return null;
    return (
      <View style={styles.recommendationBox}>
        <Text style={styles.recommendationTitle}>{field.label}</Text>
        <Text style={styles.recommendationText}>{String(value)}</Text>
      </View>
    );
  }`,
  "field.type === 'recommendation'",
);
insertAfter(
  reportFile,
  "  photoPreview: { width: 150, height: 110, borderRadius: 10, marginTop: 9, backgroundColor: '#EEF1F5' },",
  "\n  recommendationBox: { backgroundColor: '#FFF7E8', borderWidth: 1, borderColor: '#E8C987', borderRadius: 11, padding: 12 },\n  recommendationTitle: { color: '#8A5200', fontSize: 10, fontWeight: '900' },\n  recommendationText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },",
  'recommendationBox:',
);

console.log('patchTechnicianReportExperienceV3.cjs applied.');
