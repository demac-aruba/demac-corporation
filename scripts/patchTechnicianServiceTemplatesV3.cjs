const { read, write, replaceOnce, insertAfter, replaceRange } = require('./serviceFlowPatchUtils.cjs');

const templatesFile = 'src/features/technicianPortal/templates.ts';
replaceOnce(
  templatesFile,
  "export type TemplateFieldType = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'photo' | 'measurement';",
  "export type TemplateFieldType = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'photo' | 'measurement' | 'recommendation';\n\nexport type TemplateFieldCondition = {\n  key: string;\n  equals?: string | number | boolean;\n  oneOf?: Array<string | number | boolean>;\n};",
  "export type TemplateFieldCondition =",
);
replaceOnce(
  templatesFile,
  "  helperText?: string;\n}",
  "  helperText?: string;\n  showWhen?: TemplateFieldCondition;\n  requiredWhen?: TemplateFieldCondition;\n}",
  "showWhen?: TemplateFieldCondition",
);
insertAfter(
  templatesFile,
  "export interface ReportTemplateDefinition {\n  id: string;\n  version: number;\n  interventionType: InterventionType;\n  name: string;\n  description: string;\n  sections: TemplateSectionDefinition[];\n  completionRules: string[];\n}",
  `

function conditionMatches(condition: TemplateFieldCondition | undefined, fields: Record<string, unknown>) {
  if (!condition) return true;
  const value = fields[condition.key];
  if (condition.oneOf) return condition.oneOf.includes(value as string | number | boolean);
  return value === condition.equals;
}

export function templateFieldIsVisible(field: TemplateFieldDefinition, fields: Record<string, unknown>) {
  return conditionMatches(field.showWhen, fields);
}

export function templateFieldIsRequired(field: TemplateFieldDefinition, fields: Record<string, unknown>) {
  return field.required || Boolean(field.requiredWhen && conditionMatches(field.requiredWhen, fields));
}

const BRACKET_RECOMMENDATION = 'Se recomienda reemplazar el bracket o base de la condensadora. El soporte presenta deterioro y puede comprometer la estabilidad del equipo, provocar su caída y representar un riesgo de lesiones o daños a la propiedad.';
const SWITCH_RECOMMENDATION = 'Se recomienda reemplazar el switch / disconnect. Su condición representa un riesgo eléctrico y puede ocasionar fallas, daños al aire acondicionado o una situación peligrosa.';
const ARMAFLEX_RECOMMENDATION = 'Se recomienda reemplazar el Armaflex de la tubería. El aislamiento deteriorado reduce la eficiencia, favorece la condensación y puede afectar la capacidad de enfriamiento del equipo.';
const LOW_REFRIGERANT_RECOMMENDATION = 'Se detectó falta de refrigerante. Se recomienda revisar posibles fugas y corregir la carga con autorización del cliente.';
const CONTAMINATED_REFRIGERANT_RECOMMENDATION = 'Se detectó posible contaminación del refrigerante. Se recomienda recuperar el gas existente, realizar un vacío profundo y cargar refrigerante nuevo, sujeto a la aprobación del cliente.';

export function applyTechnicianReportDerivedValues(fields: Record<string, string | number | boolean | null | string[]>) {
  const next = { ...fields };
  if (['Reemplazo recomendado', 'Peligro inminente / alto riesgo'].includes(String(next.bracketCondition ?? ''))) next.bracketRecommendation = BRACKET_RECOMMENDATION;
  else delete next.bracketRecommendation;
  if (['Reemplazo recomendado', 'Peligro de seguridad / alto riesgo'].includes(String(next.disconnectCondition ?? ''))) next.disconnectRecommendation = SWITCH_RECOMMENDATION;
  else delete next.disconnectRecommendation;
  if (next.armaflexCondition === 'Reemplazo necesario') next.armaflexRecommendation = ARMAFLEX_RECOMMENDATION;
  else delete next.armaflexRecommendation;
  if (next.refrigerantStatus === 'Le falta gas' && next.refrigerantAdded !== true) next.refrigerantRecommendation = LOW_REFRIGERANT_RECOMMENDATION;
  else if (next.refrigerantStatus === 'Gas contaminado') next.refrigerantRecommendation = CONTAMINATED_REFRIGERANT_RECOMMENDATION;
  else delete next.refrigerantRecommendation;
  return next;
}`,
  'export function applyTechnicianReportDerivedValues',
);
insertAfter(
  templatesFile,
  `const outdoorStandardFields: TemplateFieldDefinition[] = [
  { key: 'outdoorBefore', label: 'Foto general outdoor antes', type: 'photo', required: true },
  { key: 'outdoorCoilBefore', label: 'Coil outdoor antes', type: 'photo', required: true },
  { key: 'bracketCondition', label: 'Condición de bracket o base', type: 'select', required: true, options: ['Buen estado', 'Corrosión leve', 'Corrosión severa', 'Reemplazo recomendado', 'No aplica'] },
  { key: 'disconnectCondition', label: 'Condición del switch / disconnect', type: 'select', required: true, options: ['Buen estado', 'Requiere mantenimiento', 'Reemplazo recomendado', 'Peligro de seguridad', 'No inspeccionado'] },
  { key: 'outdoorCleaningProcess', label: 'Proceso de limpieza outdoor', type: 'photo', required: true },
  { key: 'outdoorAfter', label: 'Outdoor terminado', type: 'photo', required: true },
  { key: 'outdoorCoilAfter', label: 'Coil outdoor después', type: 'photo', required: true },
];`,
  `

const outdoorStandardV2Fields: TemplateFieldDefinition[] = [
  { key: 'outdoorBefore', label: 'Foto general outdoor antes', type: 'photo', required: true },
  { key: 'outdoorCoilBefore', label: 'Coil outdoor antes', type: 'photo', required: true },
  { key: 'outdoorCleaningProcess', label: 'Proceso de limpieza outdoor', type: 'photo', required: true },
  { key: 'outdoorAfter', label: 'Outdoor terminado', type: 'photo', required: true },
  { key: 'outdoorCoilAfter', label: 'Coil outdoor después', type: 'photo', required: true },
  { key: 'bracketPhoto', label: 'Foto del bracket o base', type: 'photo', required: true },
  { key: 'bracketCondition', label: 'Condición del bracket o base', type: 'select', required: true, options: ['Buen estado', 'Corrosión leve', 'Reemplazo recomendado', 'Peligro inminente / alto riesgo'] },
  { key: 'bracketRecommendation', label: 'Recomendación sobre el bracket', type: 'recommendation', required: false, showWhen: { key: 'bracketCondition', oneOf: ['Reemplazo recomendado', 'Peligro inminente / alto riesgo'] } },
  { key: 'disconnectCoverPhoto', label: 'Switch / disconnect con la tapa puesta', type: 'photo', required: true },
  { key: 'disconnectInteriorPhoto', label: 'Switch / disconnect sin tapa - vista interior', type: 'photo', required: true },
  { key: 'disconnectCondition', label: 'Condición del switch / disconnect', type: 'select', required: true, options: ['Buen estado', 'Reemplazo recomendado', 'Peligro de seguridad / alto riesgo'] },
  { key: 'disconnectRecommendation', label: 'Recomendación sobre el switch / disconnect', type: 'recommendation', required: false, showWhen: { key: 'disconnectCondition', oneOf: ['Reemplazo recomendado', 'Peligro de seguridad / alto riesgo'] } },
  { key: 'armaflexPhoto', label: 'Foto del Armaflex', type: 'photo', required: true },
  { key: 'armaflexCondition', label: 'Condición del Armaflex', type: 'select', required: true, options: ['Buen estado', 'Desgaste leve', 'Reemplazo necesario'] },
  { key: 'armaflexRecommendation', label: 'Recomendación sobre el Armaflex', type: 'recommendation', required: false, showWhen: { key: 'armaflexCondition', equals: 'Reemplazo necesario' } },
];

const serviceRefrigerantMeasurementFields: TemplateFieldDefinition[] = [
  { key: 'gaugeBeforePhoto', label: 'Foto del manómetro antes del servicio', type: 'photo', required: true },
  { key: 'refrigerantStatus', label: 'Estado del refrigerante', type: 'select', required: true, options: ['Estable', 'Le falta gas', 'Sobrepresión', 'Gas contaminado'] },
  { key: 'gaugeAfterPhoto', label: 'Foto del manómetro después del servicio', type: 'photo', required: true },
  { key: 'refrigerantAdded', label: '¿Se agregó refrigerante?', type: 'boolean', required: false, showWhen: { key: 'refrigerantStatus', equals: 'Le falta gas' }, requiredWhen: { key: 'refrigerantStatus', equals: 'Le falta gas' } },
  { key: 'psiAdded', label: 'Cantidad de PSI agregados', type: 'number', required: false, unit: 'PSI', showWhen: { key: 'refrigerantAdded', equals: true }, requiredWhen: { key: 'refrigerantAdded', equals: true } },
  { key: 'gaugeAfterRefrigerantPhoto', label: 'Manómetro después de agregar refrigerante', type: 'photo', required: false, showWhen: { key: 'refrigerantAdded', equals: true }, requiredWhen: { key: 'refrigerantAdded', equals: true } },
  { key: 'gaugeAfterPressureCorrectionPhoto', label: 'Manómetro después de corregir la sobrepresión', type: 'photo', required: false, showWhen: { key: 'refrigerantStatus', equals: 'Sobrepresión' }, requiredWhen: { key: 'refrigerantStatus', equals: 'Sobrepresión' } },
  { key: 'refrigerantRecommendation', label: 'Recomendación sobre el refrigerante', type: 'recommendation', required: false, showWhen: { key: 'refrigerantStatus', oneOf: ['Le falta gas', 'Gas contaminado'] } },
];`,
  'const outdoorStandardV2Fields:',
);
replaceOnce(
  templatesFile,
  "  {\n    id: 'service_deep',",
  `  {
    id: 'service_standard',
    version: 2,
    interventionType: 'standard_service',
    name: 'Servicio estándar',
    description: 'Servicio estándar con evidencia fotográfica de outdoor, seguridad, Armaflex y estado del refrigerante.',
    sections: [
      section('identification', 'Identificación', 'lead', identificationFields),
      section('indoor', 'Unidad interior', 'indoor', indoorStandardFields),
      section('outdoor', 'Unidad exterior', 'outdoor', outdoorStandardV2Fields),
      section('initial_measurements', 'Mediciones', 'any', serviceRefrigerantMeasurementFields),
      section('work_process', 'Trabajo realizado', 'any', [{ key: 'workSummary', label: 'Resumen del trabajo', type: 'textarea', required: true }]),
      section('findings', 'Hallazgos', 'any', findingFields, false),
      section('completion', 'Resultado final', 'lead', completionFields),
    ],
    completionRules: ['Documentar las fotografías obligatorias.', 'Registrar el estado del refrigerante.', 'Completar las recomendaciones de seguridad que apliquen.'],
  },
  {
    id: 'service_deep',`,
  "version: 2,\n    interventionType: 'standard_service'",
);

console.log('patchTechnicianServiceTemplatesV3.cjs applied.');
