const { read, write, replaceOnce, insertAfter, replaceRange } = require('./serviceFlowPatchUtils.cjs');

// ---------------------------------------------------------------------------
// Technician portal state: persist independent add-on records and enforce
// conditional required fields in report sections.
// ---------------------------------------------------------------------------
const stateFile = 'src/state/TechnicianPortalState.tsx';
insertAfter(
  stateFile,
  "import { getTechnicianReportTemplate } from '../features/technicianPortal/templates';",
  "\nimport { templateFieldIsRequired, templateFieldIsVisible } from '../features/technicianPortal/templates';\nimport { WorkVisitAddOn } from '../features/technicianPortal/addOns';",
  "WorkVisitAddOn } from '../features/technicianPortal/addOns'",
);
replaceOnce(
  stateFile,
  "  workReportSections: ReportSection[];\n  equipmentSystems:",
  "  workReportSections: ReportSection[];\n  workVisitAddOns: WorkVisitAddOn[];\n  equipmentSystems:",
  'workVisitAddOns: WorkVisitAddOn[];',
);
replaceOnce(
  stateFile,
  "  saveReportSection: (section: ReportSection) => Promise<TechnicianPortalOperationResult>;\n  initializeReportSections:",
  "  saveReportSection: (section: ReportSection) => Promise<TechnicianPortalOperationResult>;\n  saveWorkVisitAddOn: (addOn: WorkVisitAddOn) => Promise<TechnicianPortalOperationResult>;\n  initializeReportSections:",
  'saveWorkVisitAddOn: (addOn:',
);
insertAfter(
  stateFile,
  "function sortReportSections(items: ReportSection[]) {\n  return [...items].sort((a, b) => `${a.interventionId}-${a.createdAt}-${a.sectionType}`.localeCompare(`${b.interventionId}-${b.createdAt}-${b.sectionType}`));\n}",
  "\n\nfunction sortWorkVisitAddOns(items: WorkVisitAddOn[]) {\n  return [...items].sort((a, b) => `${a.interventionId}-${a.createdAt}`.localeCompare(`${b.interventionId}-${b.createdAt}`));\n}",
  'function sortWorkVisitAddOns',
);
replaceOnce(
  stateFile,
  "  const [workReportSections, setWorkReportSections] = useState<ReportSection[]>([]);\n  const [equipmentSystems",
  "  const [workReportSections, setWorkReportSections] = useState<ReportSection[]>([]);\n  const [workVisitAddOns, setWorkVisitAddOns] = useState<WorkVisitAddOn[]>([]);\n  const [equipmentSystems",
  'setWorkVisitAddOns] = useState',
);
replaceOnce(
  stateFile,
  "      const [remoteVisits, remoteUnits, remoteInterventions, remoteReportSections, remoteEquipment] = await Promise.all([\n        listFirestoreCollection<WorkVisit>('workVisits'),\n        listFirestoreCollection<VisitUnit>('visitUnits'),\n        listFirestoreCollection<WorkIntervention>('workInterventions'),\n        listFirestoreCollection<ReportSection>('workReportSections'),\n        listFirestoreCollection<RegisteredEquipmentSystem>('equipmentSystems'),\n      ]);",
  "      const [remoteVisits, remoteUnits, remoteInterventions, remoteReportSections, remoteAddOns, remoteEquipment] = await Promise.all([\n        listFirestoreCollection<WorkVisit>('workVisits'),\n        listFirestoreCollection<VisitUnit>('visitUnits'),\n        listFirestoreCollection<WorkIntervention>('workInterventions'),\n        listFirestoreCollection<ReportSection>('workReportSections'),\n        listFirestoreCollection<WorkVisitAddOn>('workVisitAddOns'),\n        listFirestoreCollection<RegisteredEquipmentSystem>('equipmentSystems'),\n      ]);",
  'remoteAddOns, remoteEquipment',
);
replaceOnce(
  stateFile,
  "      setWorkReportSections(sortReportSections(remoteReportSections));\n      setEquipmentSystems",
  "      setWorkReportSections(sortReportSections(remoteReportSections));\n      setWorkVisitAddOns(sortWorkVisitAddOns(remoteAddOns));\n      setEquipmentSystems",
  'setWorkVisitAddOns(sortWorkVisitAddOns',
);
replaceOnce(
  stateFile,
  "  const saveReportSection = (section: ReportSection) => saveDocument('workReportSections', section, setWorkReportSections, sortReportSections);\n  const saveEquipmentSystem",
  "  const saveReportSection = (section: ReportSection) => saveDocument('workReportSections', section, setWorkReportSections, sortReportSections);\n  const saveWorkVisitAddOn = (addOn: WorkVisitAddOn) => saveDocument('workVisitAddOns', addOn, setWorkVisitAddOns, sortWorkVisitAddOns);\n  const saveEquipmentSystem",
  "saveDocument('workVisitAddOns'",
);
replaceOnce(
  stateFile,
  "      const missingRequiredFieldKeys = definition.fields\n        .filter((field) => field.required && !fieldHasValue(initialFields[field.key]))\n        .map((field) => field.key);",
  "      const missingRequiredFieldKeys = definition.fields\n        .filter((field) => templateFieldIsVisible(field, initialFields) && templateFieldIsRequired(field, initialFields) && !fieldHasValue(initialFields[field.key]))\n        .map((field) => field.key);",
  'templateFieldIsVisible(field, initialFields)',
);
replaceOnce(
  stateFile,
  "    const missingRequiredFieldKeys = definition.fields\n      .filter((field) => field.required && !fieldHasValue(mergedFields[field.key]))\n      .map((field) => field.key);",
  "    const missingRequiredFieldKeys = definition.fields\n      .filter((field) => templateFieldIsVisible(field, mergedFields) && templateFieldIsRequired(field, mergedFields) && !fieldHasValue(mergedFields[field.key]))\n      .map((field) => field.key);",
  'templateFieldIsVisible(field, mergedFields)',
);
replaceOnce(
  stateFile,
  "    workReportSections,\n    equipmentSystems,",
  "    workReportSections,\n    workVisitAddOns,\n    equipmentSystems,",
  '    workVisitAddOns,\n    equipmentSystems,',
);
replaceOnce(
  stateFile,
  "    saveReportSection,\n    initializeReportSections,",
  "    saveReportSection,\n    saveWorkVisitAddOn,\n    initializeReportSections,",
  '    saveWorkVisitAddOn,\n    initializeReportSections,',
);
replaceOnce(
  stateFile,
  "  }), [workVisits, visitUnits, workInterventions, workReportSections, equipmentSystems, loading, dataError, lastSyncedAt, refreshTechnicianPortalData]);",
  "  }), [workVisits, visitUnits, workInterventions, workReportSections, workVisitAddOns, equipmentSystems, loading, dataError, lastSyncedAt, refreshTechnicianPortalData]);",
  'workReportSections, workVisitAddOns, equipmentSystems',
);

console.log('patchTechnicianAddOnStateV3.cjs applied.');
