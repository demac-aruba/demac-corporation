const { read, write, replaceOnce, insertAfter, replaceRange } = require('./serviceFlowPatchUtils.cjs');

// ---------------------------------------------------------------------------
// Office review and customer PDF: hide inactive conditional fields and append
// independently recorded add-ons with their before/after evidence.
// ---------------------------------------------------------------------------
const officeFile = 'src/screens/OfficeReportReviewScreen.tsx';
replaceOnce(
  officeFile,
  "import { getTechnicianReportTemplate, TemplateFieldDefinition } from '../features/technicianPortal/templates';",
  "import { getTechnicianReportTemplate, templateFieldIsVisible, TemplateFieldDefinition } from '../features/technicianPortal/templates';\nimport { workVisitAddOnDefinition } from '../features/technicianPortal/addOns';",
  'workVisitAddOnDefinition } from',
);
replaceOnce(
  officeFile,
  "    workReportSections,\n    equipmentSystems,",
  "    workReportSections,\n    workVisitAddOns,\n    equipmentSystems,",
  '    workVisitAddOns,\n    equipmentSystems,',
);
insertAfter(
  officeFile,
  "  const selectedSections = selectedTemplate\n    ? selectedTemplate.sections.map((definition) => ({\n        definition,\n        section: workReportSections.find((item) => item.interventionId === selected?.id && item.sectionType === definition.sectionType),\n      }))\n    : [];",
  "\n  const selectedAddOns = workVisitAddOns.filter((item) => item.interventionId === selected?.id && item.status !== 'cancelled');",
  'const selectedAddOns = workVisitAddOns.filter',
);
replaceOnce(
  officeFile,
  "    () => unique(selectedSections.flatMap(({ section }) => section?.evidenceIds ?? [])),",
  "    () => unique([\n      ...selectedSections.flatMap(({ section }) => section?.evidenceIds ?? []),\n      ...selectedAddOns.flatMap((addOn) => [addOn.beforeEvidenceId, addOn.afterEvidenceId]),\n    ]),",
  '...selectedAddOns.flatMap',
);
replaceOnce(
  officeFile,
  "        fields: definition.fields.map((field) => {",
  "        fields: definition.fields.filter((field) => templateFieldIsVisible(field, section?.fields ?? {})).map((field) => {",
  'templateFieldIsVisible(field, section?.fields ?? {})',
);
replaceOnce(
  officeFile,
  "      sections: selectedSections.map(({ definition, section }) => ({\n        title: definition.title,\n        status: section?.status === 'completed' ? 'Completada' : section?.status === 'not_applicable' ? 'No aplica' : 'Incompleta',\n        fields: definition.fields.filter((field) => templateFieldIsVisible(field, section?.fields ?? {})).map((field) => {\n          const value = section?.fields[field.key];\n          const evidence = evidenceFor(value);\n          return field.type === 'photo'\n            ? {\n                label: field.label,\n                value: evidence?.label ?? 'Fotografía no disponible',\n                photoUrl: evidence?.downloadUrl,\n                photoCaption: evidence?.label,\n              }\n            : { label: field.label, value: fieldValue(value, field) };\n        }),\n      })),",
  `      sections: [
        ...selectedSections.map(({ definition, section }) => ({
          title: definition.title,
          status: section?.status === 'completed' ? 'Completada' : section?.status === 'not_applicable' ? 'No aplica' : 'Incompleta',
          fields: definition.fields.filter((field) => templateFieldIsVisible(field, section?.fields ?? {})).map((field) => {
            const value = section?.fields[field.key];
            const evidence = evidenceFor(value);
            return field.type === 'photo'
              ? {
                  label: field.label,
                  value: evidence?.label ?? 'Fotografía no disponible',
                  photoUrl: evidence?.downloadUrl,
                  photoCaption: evidence?.label,
                }
              : { label: field.label, value: fieldValue(value, field) };
          }),
        })),
        ...(selectedAddOns.length ? [{
          title: 'Add-ons instalados en esta visita',
          status: 'Registrados',
          fields: selectedAddOns.flatMap((addOn) => {
            const definition = workVisitAddOnDefinition(addOn.type);
            const before = evidenceFor(addOn.beforeEvidenceId);
            const after = evidenceFor(addOn.afterEvidenceId);
            return [
              { label: definition?.label ?? addOn.type, value: (addOn.status === 'installed' ? 'Instalado' : 'Seleccionado') + (addOn.notes ? ' · ' + addOn.notes : '') },
              { label: definition?.beforeLabel ?? 'Antes', value: before?.label ?? 'Fotografía no disponible', photoUrl: before?.downloadUrl, photoCaption: before?.label },
              { label: definition?.afterLabel ?? 'Después', value: after?.label ?? 'Fotografía no disponible', photoUrl: after?.downloadUrl, photoCaption: after?.label },
            ];
          }),
        }] : []),
      ],`,
  "title: 'Add-ons instalados en esta visita'",
);
replaceOnce(
  officeFile,
  "                {definition.fields.map((field) => {",
  "                {definition.fields.filter((field) => templateFieldIsVisible(field, section?.fields ?? {})).map((field) => {",
  'templateFieldIsVisible(field, section?.fields ?? {})).map',
);
replaceOnce(
  officeFile,
  "        </Card>\n\n        {selected.status === 'ready_for_review' ? (",
  `        </Card>

        {selectedAddOns.length ? (
          <Card>
            <SectionTitle title="Add-ons registrados" subtitle="Productos o mejoras documentados durante esta intervención" />
            <View style={styles.sectionList}>
              {selectedAddOns.map((addOn) => {
                const definition = workVisitAddOnDefinition(addOn.type);
                const before = evidenceFor(addOn.beforeEvidenceId);
                const after = evidenceFor(addOn.afterEvidenceId);
                return (
                  <View key={addOn.id} style={styles.reviewSection}>
                    <View style={styles.reviewSectionHeader}>
                      <View style={{ flex: 1 }}><Text style={styles.reviewSectionTitle}>{definition?.label ?? addOn.type}</Text><Text style={styles.reviewSectionMeta}>{addOn.notes || 'Sin observación adicional'}</Text></View>
                      <Pill label={addOn.status === 'installed' ? 'Instalado' : 'Seleccionado'} tone={addOn.status === 'installed' ? 'success' : 'info'} />
                    </View>
                    <View style={styles.addOnEvidenceRow}>
                      {before ? <EvidencePreview evidence={before} onOpen={() => setLightboxEvidence(before)} /> : <Text style={styles.missingValue}>Falta fotografía anterior</Text>}
                      {after ? <EvidencePreview evidence={after} onOpen={() => setLightboxEvidence(after)} /> : <Text style={styles.missingValue}>Falta fotografía final</Text>}
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        {selected.status === 'ready_for_review' ? (`,
  'title="Add-ons registrados"',
);
insertAfter(
  officeFile,
  "  sectionList: { gap: 12 },",
  "\n  addOnEvidenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },",
  'addOnEvidenceRow:',
);

console.log('patchTechnicianOfficeAddOnsV3.cjs applied.');
