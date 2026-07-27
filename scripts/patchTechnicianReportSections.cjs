const fs = require('fs');

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Required technician report patch block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required technician report patch anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

const stateFile = 'src/state/TechnicianPortalState.tsx';

replaceOnce(
  stateFile,
  "import { EquipmentSystem, WorkIntervention, WorkVisit, VisitUnit } from '../features/technicianPortal/contracts';",
  "import { EquipmentSystem, ReportSection, ReportSectionStatus, WorkIntervention, WorkVisit, VisitUnit } from '../features/technicianPortal/contracts';",
  'ReportSection, ReportSectionStatus, WorkIntervention',
);

insertAfter(
  stateFile,
  "import { equipmentDocumentIdFromQr, equipmentDocumentIdWithoutQr, equipmentQrCodesMatch, isValidEquipmentQrCode, normalizeEquipmentQrCode } from '../features/technicianPortal/equipmentQr';",
  "\nimport { getTechnicianReportTemplate } from '../features/technicianPortal/templates';",
  "getTechnicianReportTemplate } from '../features/technicianPortal/templates'",
);

insertAfter(
  stateFile,
  "type AddInterventionInput = {\n  visitId: string;\n  visitUnitId: string;\n  equipmentSystemId?: string;\n  type: WorkIntervention['type'];\n  templateId: string;\n  templateVersion: number;\n  isPrimary: boolean;\n  requestedBy?: WorkIntervention['requestedBy'];\n  scopeChangeId?: string;\n};",
  "\n\ntype UpdateReportSectionInput = {\n  fields?: ReportSection['fields'];\n  evidenceIds?: string[];\n  status?: ReportSectionStatus;\n};",
  'type UpdateReportSectionInput =',
);

replaceOnce(
  stateFile,
  "  workInterventions: WorkIntervention[];\n  equipmentSystems: RegisteredEquipmentSystem[];",
  "  workInterventions: WorkIntervention[];\n  workReportSections: ReportSection[];\n  equipmentSystems: RegisteredEquipmentSystem[];",
  'workReportSections: ReportSection[];',
);

replaceOnce(
  stateFile,
  "  saveWorkIntervention: (intervention: WorkIntervention) => Promise<TechnicianPortalOperationResult>;\n  saveEquipmentSystem:",
  "  saveWorkIntervention: (intervention: WorkIntervention) => Promise<TechnicianPortalOperationResult>;\n  saveReportSection: (section: ReportSection) => Promise<TechnicianPortalOperationResult>;\n  initializeReportSections: (intervention: WorkIntervention, equipment?: RegisteredEquipmentSystem) => Promise<TechnicianPortalOperationResult>;\n  updateReportSection: (section: ReportSection, input: UpdateReportSectionInput) => Promise<TechnicianPortalOperationResult>;\n  saveEquipmentSystem:",
  'initializeReportSections: (intervention:',
);

insertAfter(
  stateFile,
  "function sortInterventions(items: WorkIntervention[]) {\n  return [...items].sort((a, b) => `${a.visitUnitId}-${a.createdAt}`.localeCompare(`${b.visitUnitId}-${b.createdAt}`));\n}",
  "\n\nfunction sortReportSections(items: ReportSection[]) {\n  return [...items].sort((a, b) => `${a.interventionId}-${a.createdAt}-${a.sectionType}`.localeCompare(`${b.interventionId}-${b.createdAt}-${b.sectionType}`));\n}\n\nfunction fieldHasValue(value: ReportSection['fields'][string]) {\n  if (value === null || value === undefined) return false;\n  if (typeof value === 'string') return value.trim().length > 0;\n  if (Array.isArray(value)) return value.length > 0;\n  return true;\n}",
  'function sortReportSections(items: ReportSection[])',
);

replaceOnce(
  stateFile,
  "  const [workInterventions, setWorkInterventions] = useState<WorkIntervention[]>([]);\n  const [equipmentSystems, setEquipmentSystems]",
  "  const [workInterventions, setWorkInterventions] = useState<WorkIntervention[]>([]);\n  const [workReportSections, setWorkReportSections] = useState<ReportSection[]>([]);\n  const [equipmentSystems, setEquipmentSystems]",
  'setWorkReportSections] = useState<ReportSection[]>',
);

replaceOnce(
  stateFile,
  "      const [remoteVisits, remoteUnits, remoteInterventions, remoteEquipment] = await Promise.all([\n        listFirestoreCollection<WorkVisit>('workVisits'),\n        listFirestoreCollection<VisitUnit>('visitUnits'),\n        listFirestoreCollection<WorkIntervention>('workInterventions'),\n        listFirestoreCollection<RegisteredEquipmentSystem>('equipmentSystems'),\n      ]);",
  "      const [remoteVisits, remoteUnits, remoteInterventions, remoteReportSections, remoteEquipment] = await Promise.all([\n        listFirestoreCollection<WorkVisit>('workVisits'),\n        listFirestoreCollection<VisitUnit>('visitUnits'),\n        listFirestoreCollection<WorkIntervention>('workInterventions'),\n        listFirestoreCollection<ReportSection>('workReportSections'),\n        listFirestoreCollection<RegisteredEquipmentSystem>('equipmentSystems'),\n      ]);",
  'remoteReportSections, remoteEquipment',
);

replaceOnce(
  stateFile,
  "      setWorkInterventions(sortInterventions(remoteInterventions));\n      setEquipmentSystems(sortEquipment(remoteEquipment));",
  "      setWorkInterventions(sortInterventions(remoteInterventions));\n      setWorkReportSections(sortReportSections(remoteReportSections));\n      setEquipmentSystems(sortEquipment(remoteEquipment));",
  'setWorkReportSections(sortReportSections',
);

replaceOnce(
  stateFile,
  "  const saveWorkIntervention = (intervention: WorkIntervention) => saveDocument('workInterventions', intervention, setWorkInterventions, sortInterventions);\n  const saveEquipmentSystem",
  "  const saveWorkIntervention = (intervention: WorkIntervention) => saveDocument('workInterventions', intervention, setWorkInterventions, sortInterventions);\n  const saveReportSection = (section: ReportSection) => saveDocument('workReportSections', section, setWorkReportSections, sortReportSections);\n  const saveEquipmentSystem",
  "saveDocument('workReportSections'",
);

insertAfter(
  stateFile,
  "  const addWorkIntervention = async (input: AddInterventionInput) => {\n    const now = new Date().toISOString();\n    const currentActor = actor();\n    const intervention: WorkIntervention = {\n      id: `intervention-${idPart(input.visitUnitId)}-${Date.now().toString(36)}`,\n      visitId: input.visitId,\n      visitUnitId: input.visitUnitId,\n      equipmentSystemId: input.equipmentSystemId,\n      type: input.type,\n      templateId: input.templateId,\n      templateVersion: input.templateVersion,\n      isPrimary: input.isPrimary,\n      status: 'draft',\n      requestedBy: input.requestedBy,\n      scopeChangeId: input.scopeChangeId,\n      createdAt: now,\n      createdByUserId: currentActor.userId,\n      createdByStaffId: currentActor.staffId,\n      createdByName: currentActor.name,\n      updatedAt: now,\n      updatedByUserId: currentActor.userId,\n      updatedByStaffId: currentActor.staffId,\n      updatedByName: currentActor.name,\n      version: 1,\n    };\n    const result = await saveWorkIntervention(intervention);\n    return { result, intervention: result.ok ? intervention : undefined };\n  };",
  "\n\n  const initializeReportSections = async (intervention: WorkIntervention, equipment?: RegisteredEquipmentSystem) => {\n    const template = getTechnicianReportTemplate(intervention.templateId, intervention.templateVersion);\n    if (!template) return { ok: false, message: `No existe la plantilla ${intervention.templateId} v${intervention.templateVersion}.` };\n\n    const existingSections = workReportSections.filter((section) => section.interventionId === intervention.id);\n    const now = new Date().toISOString();\n    const currentActor = actor();\n\n    for (const definition of template.sections) {\n      if (existingSections.some((section) => section.sectionType === definition.sectionType)) continue;\n      const initialFields: ReportSection['fields'] = {};\n      if (definition.sectionType === 'identification' && equipment) {\n        initialFields.locationLabel = equipment.locationLabel;\n        initialFields.systemType = equipment.systemType;\n        const indoor = equipment.components.find((component) => component.componentType === 'indoor');\n        const outdoor = equipment.components.find((component) => component.componentType === 'outdoor');\n        if (indoor?.nameplateEvidenceId) initialFields.indoorNameplate = indoor.nameplateEvidenceId;\n        if (outdoor?.nameplateEvidenceId) initialFields.outdoorNameplate = outdoor.nameplateEvidenceId;\n      }\n      const missingRequiredFieldKeys = definition.fields\n        .filter((field) => field.required && !fieldHasValue(initialFields[field.key]))\n        .map((field) => field.key);\n      const section: ReportSection = {\n        id: `report-section-${idPart(intervention.id)}-${definition.sectionType}`,\n        visitId: intervention.visitId,\n        visitUnitId: intervention.visitUnitId,\n        interventionId: intervention.id,\n        sectionType: definition.sectionType,\n        status: 'not_started',\n        fields: initialFields,\n        missingRequiredFieldKeys,\n        evidenceIds: Object.values(initialFields).filter((value): value is string => typeof value === 'string' && value.startsWith('equipment-nameplate-')),\n        createdAt: now,\n        createdByUserId: currentActor.userId,\n        createdByStaffId: currentActor.staffId,\n        createdByName: currentActor.name,\n        updatedAt: now,\n        updatedByUserId: currentActor.userId,\n        updatedByStaffId: currentActor.staffId,\n        updatedByName: currentActor.name,\n        version: 1,\n      };\n      const sectionResult = await saveReportSection(section);\n      if (!sectionResult.ok) return sectionResult;\n    }\n\n    if (intervention.status === 'draft') {\n      const started: WorkIntervention = {\n        ...intervention,\n        status: 'in_progress',\n        updatedAt: now,\n        updatedByUserId: currentActor.userId,\n        updatedByStaffId: currentActor.staffId,\n        updatedByName: currentActor.name,\n        version: Math.max(1, Number(intervention.version ?? 1)) + 1,\n      };\n      const interventionResult = await saveWorkIntervention(started);\n      if (!interventionResult.ok) return interventionResult;\n    }\n\n    return { ok: true };\n  };\n\n  const updateReportSection = async (section: ReportSection, input: UpdateReportSectionInput) => {\n    const intervention = workInterventions.find((item) => item.id === section.interventionId);\n    const template = intervention ? getTechnicianReportTemplate(intervention.templateId, intervention.templateVersion) : undefined;\n    const definition = template?.sections.find((item) => item.sectionType === section.sectionType);\n    if (!intervention || !definition) return { ok: false, message: 'No se encontró la definición de esta sección.' };\n\n    const mergedFields = { ...section.fields, ...(input.fields ?? {}) };\n    const missingRequiredFieldKeys = definition.fields\n      .filter((field) => field.required && !fieldHasValue(mergedFields[field.key]))\n      .map((field) => field.key);\n    if (input.status === 'completed' && missingRequiredFieldKeys.length) {\n      return { ok: false, message: `Faltan ${missingRequiredFieldKeys.length} campo(s) obligatorio(s) antes de completar la sección.` };\n    }\n\n    const now = new Date().toISOString();\n    const currentActor = actor();\n    const nextStatus = input.status ?? (section.status === 'not_started' ? 'in_progress' : section.status);\n    return saveReportSection({\n      ...section,\n      fields: mergedFields,\n      evidenceIds: Array.from(new Set([...(section.evidenceIds ?? []), ...(input.evidenceIds ?? [])])),\n      status: nextStatus,\n      assignedToStaffId: section.assignedToStaffId ?? currentActor.staffId,\n      assignedToName: section.assignedToName ?? currentActor.name,\n      missingRequiredFieldKeys,\n      completedAt: nextStatus === 'completed' ? now : section.completedAt,\n      updatedAt: now,\n      updatedByUserId: currentActor.userId,\n      updatedByStaffId: currentActor.staffId,\n      updatedByName: currentActor.name,\n      version: Math.max(1, Number(section.version ?? 1)) + 1,\n    });\n  };",
  'const initializeReportSections = async',
);

replaceOnce(
  stateFile,
  "    workInterventions,\n    equipmentSystems,",
  "    workInterventions,\n    workReportSections,\n    equipmentSystems,",
  '    workReportSections,\n    equipmentSystems,',
);

replaceOnce(
  stateFile,
  "    saveWorkIntervention,\n    saveEquipmentSystem,",
  "    saveWorkIntervention,\n    saveReportSection,\n    initializeReportSections,\n    updateReportSection,\n    saveEquipmentSystem,",
  '    initializeReportSections,\n    updateReportSection,',
);

replaceOnce(
  stateFile,
  "  }), [workVisits, visitUnits, workInterventions, equipmentSystems, loading, dataError, lastSyncedAt, refreshTechnicianPortalData]);",
  "  }), [workVisits, visitUnits, workInterventions, workReportSections, equipmentSystems, loading, dataError, lastSyncedAt, refreshTechnicianPortalData]);",
  '[workVisits, visitUnits, workInterventions, workReportSections, equipmentSystems',
);

const profileScreen = 'src/screens/TechnicianEquipmentProfileScreen.tsx';
replaceOnce(
  profileScreen,
  "            <Pill label={interventionStatusLabel(intervention.status)} tone=\"info\" />",
  "            <View style={{ alignItems: 'flex-end', gap: 7 }}>\n              <Pill label={interventionStatusLabel(intervention.status)} tone={intervention.status === 'completed' ? 'success' : 'info'} />\n              <Button\n                compact\n                label={intervention.status === 'draft' ? 'Iniciar reporte' : 'Abrir reporte'}\n                onPress={() => {\n                  if (typeof window === 'undefined') return;\n                  const returnParameter = returnToTechnician ? '&returnTo=technician' : '';\n                  window.location.assign(`${window.location.pathname}?technicianPortalReport=1&visitId=${encodeURIComponent(visit.id)}&unitId=${encodeURIComponent(unit.id)}&interventionId=${encodeURIComponent(intervention.id)}${returnParameter}`);\n                }}\n              />\n            </View>",
  'technicianPortalReport=1&visitId=',
);

replaceOnce(
  profileScreen,
  "          <Text style={styles.nextTitle}>Próximo módulo</Text>\n          <Text style={styles.nextText}>Desde cada trabajo se abrirá la plantilla técnica correspondiente: Indoor, Outdoor, mediciones, fotografías, hallazgos y resultado final.</Text>",
  "          <Text style={styles.nextTitle}>Reporte técnico disponible</Text>\n          <Text style={styles.nextText}>Abre cada trabajo para completar sus secciones, mediciones, fotografías, hallazgos y resultado final.</Text>",
  'Reporte técnico disponible',
);

console.log('Technician collaborative report sections patch applied.');
