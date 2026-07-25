import { InterventionType, ReportSectionType } from './contracts';

export type TemplateFieldType = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'photo' | 'measurement';

export interface TemplateFieldDefinition {
  key: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  unit?: string;
  options?: string[];
  helperText?: string;
}

export interface TemplateSectionDefinition {
  sectionType: ReportSectionType;
  title: string;
  ownerSuggestion: 'indoor' | 'outdoor' | 'lead' | 'any';
  required: boolean;
  fields: TemplateFieldDefinition[];
}

export interface ReportTemplateDefinition {
  id: string;
  version: number;
  interventionType: InterventionType;
  name: string;
  description: string;
  sections: TemplateSectionDefinition[];
  completionRules: string[];
}

const identificationFields: TemplateFieldDefinition[] = [
  { key: 'locationLabel', label: 'Nombre o ubicación del aire', type: 'text', required: true },
  { key: 'systemType', label: 'Tipo de sistema', type: 'select', required: true, options: ['Split wall mounted', 'Cassette', 'Floor ceiling', 'Central', 'VRF indoor', 'Otro'] },
  { key: 'indoorNameplate', label: 'Foto de placa indoor', type: 'photo', required: true },
  { key: 'outdoorNameplate', label: 'Foto de placa outdoor', type: 'photo', required: false },
];

const indoorStandardFields: TemplateFieldDefinition[] = [
  { key: 'indoorBefore', label: 'Foto general indoor antes', type: 'photo', required: true },
  { key: 'filtersBefore', label: 'Filtros antes', type: 'photo', required: true },
  { key: 'evaporatorBefore', label: 'Evaporador antes', type: 'photo', required: true },
  { key: 'blowerBefore', label: 'Blower antes', type: 'photo', required: true },
  { key: 'drainBefore', label: 'Bandeja y drenaje antes', type: 'photo', required: true },
  { key: 'cleaningProcess', label: 'Proceso de limpieza indoor', type: 'photo', required: true },
  { key: 'evaporatorAfter', label: 'Evaporador después', type: 'photo', required: true },
  { key: 'blowerAfter', label: 'Blower después', type: 'photo', required: true },
  { key: 'indoorAfter', label: 'Indoor terminado', type: 'photo', required: true },
];

const outdoorStandardFields: TemplateFieldDefinition[] = [
  { key: 'outdoorBefore', label: 'Foto general outdoor antes', type: 'photo', required: true },
  { key: 'outdoorCoilBefore', label: 'Coil outdoor antes', type: 'photo', required: true },
  { key: 'bracketCondition', label: 'Condición de bracket o base', type: 'select', required: true, options: ['Buen estado', 'Corrosión leve', 'Corrosión severa', 'Reemplazo recomendado', 'No aplica'] },
  { key: 'disconnectCondition', label: 'Condición del switch / disconnect', type: 'select', required: true, options: ['Buen estado', 'Requiere mantenimiento', 'Reemplazo recomendado', 'Peligro de seguridad', 'No inspeccionado'] },
  { key: 'outdoorCleaningProcess', label: 'Proceso de limpieza outdoor', type: 'photo', required: true },
  { key: 'outdoorAfter', label: 'Outdoor terminado', type: 'photo', required: true },
  { key: 'outdoorCoilAfter', label: 'Coil outdoor después', type: 'photo', required: true },
];

const measurementFields: TemplateFieldDefinition[] = [
  { key: 'voltage', label: 'Voltaje', type: 'measurement', required: false, unit: 'V' },
  { key: 'amperage', label: 'Amperaje', type: 'measurement', required: false, unit: 'A' },
  { key: 'lowPressure', label: 'Presión baja', type: 'measurement', required: false, unit: 'PSI' },
  { key: 'highPressure', label: 'Presión alta', type: 'measurement', required: false, unit: 'PSI' },
  { key: 'returnTemp', label: 'Temperatura de retorno', type: 'measurement', required: true, unit: '°C' },
  { key: 'supplyTemp', label: 'Temperatura de suministro', type: 'measurement', required: true, unit: '°C' },
  { key: 'ambientTemp', label: 'Temperatura ambiente', type: 'measurement', required: false, unit: '°C' },
];

const findingFields: TemplateFieldDefinition[] = [
  { key: 'findingCategory', label: 'Categoría del hallazgo', type: 'select', required: false, options: ['Suciedad', 'Corrosión', 'Drenaje', 'Eléctrico', 'Refrigerante', 'Instalación', 'Daño físico', 'Otro'] },
  { key: 'findingSeverity', label: 'Severidad', type: 'select', required: false, options: ['Informativo', 'Mantenimiento recomendado', 'Urgente', 'Peligro de seguridad'] },
  { key: 'findingDescription', label: 'Descripción del hallazgo', type: 'textarea', required: false },
  { key: 'findingPhoto', label: 'Fotografía del hallazgo', type: 'photo', required: false },
];

const completionFields: TemplateFieldDefinition[] = [
  { key: 'operationalResult', label: 'Resultado operacional', type: 'select', required: true, options: ['Operando correctamente', 'Operando con observaciones', 'Reparación temporal', 'No operativo', 'Pendiente de pieza', 'Requiere nueva visita', 'Reemplazo recomendado'] },
  { key: 'coolingTestCompleted', label: 'Prueba de enfriamiento completada', type: 'boolean', required: true },
  { key: 'drainTestCompleted', label: 'Prueba de drenaje completada', type: 'boolean', required: true },
  { key: 'electricalTestCompleted', label: 'Prueba eléctrica completada', type: 'boolean', required: true },
  { key: 'completionNotes', label: 'Observaciones finales', type: 'textarea', required: false },
];

function section(sectionType: ReportSectionType, title: string, ownerSuggestion: TemplateSectionDefinition['ownerSuggestion'], fields: TemplateFieldDefinition[], required = true): TemplateSectionDefinition {
  return { sectionType, title, ownerSuggestion, fields, required };
}

export const technicianReportTemplates: ReportTemplateDefinition[] = [
  {
    id: 'service_standard',
    version: 1,
    interventionType: 'standard_service',
    name: 'Servicio estándar',
    description: 'La unidad permanece instalada y se desarma parcialmente para limpieza y revisión.',
    sections: [
      section('identification', 'Identificación', 'lead', identificationFields),
      section('indoor', 'Unidad interior', 'indoor', indoorStandardFields),
      section('outdoor', 'Unidad exterior', 'outdoor', outdoorStandardFields),
      section('initial_measurements', 'Mediciones iniciales', 'any', measurementFields, false),
      section('work_process', 'Trabajo realizado', 'any', [{ key: 'workSummary', label: 'Resumen del trabajo', type: 'textarea', required: true }]),
      section('final_measurements', 'Mediciones finales', 'any', measurementFields),
      section('findings', 'Hallazgos', 'any', findingFields, false),
      section('completion', 'Resultado final', 'lead', completionFields),
    ],
    completionRules: ['Cada foto obligatoria debe existir o tener justificación.', 'Resultado operacional obligatorio.', 'La visita no puede cerrarse con secciones activas.'],
  },
  {
    id: 'service_deep',
    version: 1,
    interventionType: 'deep_service',
    name: 'Servicio profundo',
    description: 'La unidad se desmonta o desinstala completamente para una limpieza profunda.',
    sections: [
      section('identification', 'Identificación', 'lead', identificationFields),
      section('indoor', 'Desmontaje y limpieza profunda indoor', 'indoor', [
        ...indoorStandardFields,
        { key: 'areaProtection', label: 'Protección del área', type: 'photo', required: true },
        { key: 'unitRemoved', label: 'Unidad desmontada', type: 'photo', required: true },
        { key: 'componentsSeparated', label: 'Componentes desmontados', type: 'photo', required: true },
        { key: 'unitReinstalled', label: 'Unidad reinstalada', type: 'photo', required: true },
      ]),
      section('outdoor', 'Unidad exterior', 'outdoor', outdoorStandardFields),
      section('electrical', 'Aislamiento y conexiones', 'lead', [
        { key: 'powerIsolated', label: 'Energía aislada de forma segura', type: 'boolean', required: true },
        { key: 'connectionsInspected', label: 'Conexiones inspeccionadas', type: 'boolean', required: true },
      ]),
      section('work_process', 'Vacuum, fuga y reinstalación', 'lead', [
        { key: 'circuitOpened', label: 'Se abrió el circuito de refrigerante', type: 'boolean', required: true },
        { key: 'vacuumPerformed', label: 'Vacuum realizado cuando aplica', type: 'boolean', required: true },
        { key: 'leakTestPerformed', label: 'Prueba de fuga realizada', type: 'boolean', required: true },
      ]),
      section('final_measurements', 'Mediciones finales', 'any', measurementFields),
      section('findings', 'Hallazgos', 'any', findingFields, false),
      section('completion', 'Resultado final', 'lead', completionFields),
    ],
    completionRules: ['Documentar desmontaje y reinstalación.', 'Confirmar seguridad eléctrica.', 'Registrar vacuum y prueba de fuga cuando el circuito se abra.'],
  },
  {
    id: 'repair',
    version: 1,
    interventionType: 'repair',
    name: 'Reparación',
    description: 'Documenta la falla confirmada, pieza afectada, reparación y prueba operacional.',
    sections: [
      section('identification', 'Identificación', 'lead', identificationFields),
      section('initial_measurements', 'Síntoma y diagnóstico', 'lead', [
        { key: 'reportedProblem', label: 'Problema informado', type: 'textarea', required: true },
        { key: 'confirmedSymptom', label: 'Síntoma confirmado', type: 'textarea', required: true },
        ...measurementFields,
      ]),
      section('work_process', 'Reparación realizada', 'any', [
        { key: 'affectedComponent', label: 'Componente afectado', type: 'text', required: true },
        { key: 'repairPerformed', label: 'Reparación realizada', type: 'textarea', required: true },
        { key: 'damagedPartPhoto', label: 'Foto de pieza dañada', type: 'photo', required: true },
        { key: 'installedPartPhoto', label: 'Foto de pieza instalada', type: 'photo', required: false },
      ]),
      section('materials', 'Piezas y materiales', 'any', [{ key: 'materialsUsed', label: 'Materiales utilizados', type: 'textarea', required: false }], false),
      section('final_measurements', 'Prueba final', 'any', measurementFields),
      section('findings', 'Hallazgos', 'any', findingFields, false),
      section('completion', 'Resultado de reparación', 'lead', completionFields),
    ],
    completionRules: ['Registrar problema y síntoma confirmado.', 'Adjuntar evidencia de la pieza dañada.', 'Seleccionar resultado de reparación.'],
  },
  {
    id: 'installation',
    version: 1,
    interventionType: 'installation',
    name: 'Instalación',
    description: 'Registra equipo, instalación mecánica, eléctrica, drenaje, vacuum y entrega.',
    sections: [
      section('identification', 'Equipo instalado', 'lead', identificationFields),
      section('indoor', 'Instalación indoor', 'indoor', [
        { key: 'locationBefore', label: 'Lugar antes', type: 'photo', required: true },
        { key: 'indoorMounted', label: 'Indoor instalado', type: 'photo', required: true },
        { key: 'drainInstalled', label: 'Drenaje instalado', type: 'photo', required: true },
      ]),
      section('outdoor', 'Instalación outdoor', 'outdoor', [
        { key: 'outdoorMounted', label: 'Outdoor instalado', type: 'photo', required: true },
        { key: 'supportCondition', label: 'Bracket o base', type: 'photo', required: true },
        { key: 'clearanceConfirmed', label: 'Espacio de ventilación confirmado', type: 'boolean', required: true },
      ]),
      section('electrical', 'Instalación eléctrica', 'any', [
        { key: 'breaker', label: 'Breaker', type: 'text', required: true },
        { key: 'wireGauge', label: 'Calibre de cable', type: 'text', required: true },
        { key: 'disconnectPhoto', label: 'Switch / disconnect', type: 'photo', required: true },
      ]),
      section('work_process', 'Tubería, vacuum y fuga', 'lead', [
        { key: 'lineLength', label: 'Metros de tubería', type: 'number', required: true, unit: 'm' },
        { key: 'vacuumPerformed', label: 'Vacuum realizado', type: 'boolean', required: true },
        { key: 'leakTestPerformed', label: 'Prueba de fuga realizada', type: 'boolean', required: true },
        { key: 'additionalRefrigerant', label: 'Refrigerante adicional', type: 'number', required: false, unit: 'g' },
      ]),
      section('final_measurements', 'Puesta en marcha', 'any', measurementFields),
      section('completion', 'Entrega y garantía', 'lead', [
        ...completionFields,
        { key: 'clientOrientation', label: 'Orientación básica al cliente completada', type: 'boolean', required: true },
        { key: 'warrantyExplained', label: 'Garantía explicada', type: 'boolean', required: true },
      ]),
    ],
    completionRules: ['Placas indoor y outdoor registradas.', 'Vacuum y prueba de fuga obligatorios.', 'Registrar instalación eléctrica y puesta en marcha.'],
  },
  {
    id: 'diagnostic',
    version: 1,
    interventionType: 'diagnostic',
    name: 'Diagnóstico',
    description: 'Investiga una falla concreta y documenta pruebas, causa y reparación recomendada.',
    sections: [
      section('identification', 'Identificación', 'lead', identificationFields),
      section('initial_measurements', 'Problema y síntomas', 'lead', [
        { key: 'reportedProblem', label: 'Problema reportado', type: 'textarea', required: true },
        { key: 'confirmedSymptom', label: 'Síntoma confirmado', type: 'textarea', required: true },
        { key: 'problemHistory', label: 'Historial del problema', type: 'textarea', required: false },
        ...measurementFields,
      ]),
      section('electrical', 'Pruebas eléctricas', 'any', [{ key: 'electricalTests', label: 'Pruebas eléctricas realizadas', type: 'textarea', required: false }], false),
      section('work_process', 'Pruebas y conclusión', 'lead', [
        { key: 'testsPerformed', label: 'Pruebas realizadas', type: 'textarea', required: true },
        { key: 'confirmedCause', label: 'Causa confirmada', type: 'textarea', required: false },
        { key: 'probableCause', label: 'Causa probable', type: 'textarea', required: false },
        { key: 'requiredParts', label: 'Piezas necesarias', type: 'textarea', required: false },
        { key: 'recommendedRepair', label: 'Reparación recomendada', type: 'textarea', required: true },
      ]),
      section('findings', 'Hallazgos', 'any', findingFields, false),
      section('completion', 'Resultado del diagnóstico', 'lead', completionFields),
    ],
    completionRules: ['Registrar pruebas realizadas.', 'No declarar causa confirmada sin evidencia.', 'Indicar reparación recomendada o diagnóstico adicional.'],
  },
  {
    id: 'checkup',
    version: 1,
    interventionType: 'checkup',
    name: 'Chequeo',
    description: 'Inspección general del estado y funcionamiento sin investigar necesariamente una falla específica.',
    sections: [
      section('identification', 'Identificación', 'lead', identificationFields),
      section('indoor', 'Inspección indoor', 'indoor', [
        { key: 'indoorCondition', label: 'Condición general indoor', type: 'select', required: true, options: ['Buena', 'Requiere servicio', 'Requiere diagnóstico', 'Requiere reparación', 'Fuera de servicio'] },
        { key: 'indoorPhoto', label: 'Foto indoor', type: 'photo', required: true },
      ]),
      section('outdoor', 'Inspección outdoor', 'outdoor', [
        { key: 'outdoorCondition', label: 'Condición general outdoor', type: 'select', required: true, options: ['Buena', 'Requiere servicio', 'Requiere diagnóstico', 'Requiere reparación', 'Fuera de servicio'] },
        { key: 'outdoorPhoto', label: 'Foto outdoor', type: 'photo', required: true },
      ]),
      section('initial_measurements', 'Mediciones básicas', 'any', measurementFields),
      section('findings', 'Hallazgos', 'any', findingFields, false),
      section('completion', 'Recomendación final', 'lead', completionFields),
    ],
    completionRules: ['Inspección indoor y outdoor obligatoria.', 'Temperaturas de retorno y suministro obligatorias.', 'Seleccionar recomendación final.'],
  },
];

export function getTechnicianReportTemplate(templateId: string, version?: number) {
  return technicianReportTemplates.find((template) => template.id === templateId && (version === undefined || template.version === version));
}
