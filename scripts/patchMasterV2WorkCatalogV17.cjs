const fs = require('fs');

const marker = 'MASTER_V2_WORK_CATALOG_V17';
const files = {
  calendar: 'src/state/CalendarState.tsx',
  agenda: 'src/screens/AgendaScreen.tsx',
  settings: 'src/screens/SettingsScreen.tsx',
  types: 'src/types.ts',
};

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, source) { fs.writeFileSync(file, source); }
function requiredReplace(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`${label} not found.`);
  return source.replace(search, replacement);
}
function requiredRegex(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`${label} not found.`);
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

const alreadyApplied = Object.values(files).every((file) => read(file).includes(marker));
if (alreadyApplied) {
  console.log('patchMasterV2WorkCatalogV17.cjs already applied.');
  process.exit(0);
}

// Calendar settings remain the source of truth for durations. Values below are
// defaults only; saved administrator values win. Missing presets are merged in
// so existing DEMAC settings gain the new work types without being overwritten.
let calendar = read(files.calendar);
if (!calendar.includes('APPOINTMENT_SETTINGS_V11')) throw new Error('Appointment settings V11 must run before master work catalog V17.');
calendar = requiredRegex(
  calendar,
  /export const DEFAULT_APPOINTMENT_WORK_PRESETS: AppointmentWorkPreset\[] = \[[\s\S]*?\n\];/,
  `// ${marker}: business defaults seed Settings; administrators can change durations without code changes.\nexport const DEFAULT_APPOINTMENT_WORK_PRESETS: AppointmentWorkPreset[] = [\n  { id: 'standard_service', label: 'Servicio estándar', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: 10 },\n  { id: 'deep_cleaning', label: 'Servicio deep cleaning', durationMinutesPerUnit: 120, kind: 'service', active: true, sortOrder: 20 },\n  { id: 'diagnosis', label: 'Diagnóstico / checkup', durationMinutesPerUnit: 45, kind: 'service', active: true, sortOrder: 30 },\n  { id: 'repair', label: 'Reparación', durationMinutesPerUnit: 90, kind: 'service', active: true, sortOrder: 40 },\n  { id: 'standard_installation', label: 'Instalación estándar', durationMinutesPerUnit: 150, kind: 'installation', active: true, sortOrder: 50 },\n  { id: 'extended_installation', label: 'Instalación extendida', durationMinutesPerUnit: 210, kind: 'installation', active: true, sortOrder: 60 },\n  { id: 'rooftop_installation', label: 'Instalación rooftop', durationMinutesPerUnit: 240, kind: 'installation', active: true, sortOrder: 70 },\n  { id: 'second_floor_installation', label: 'Instalación segundo piso', durationMinutesPerUnit: 180, kind: 'installation', active: true, sortOrder: 80 },\n  { id: 'third_floor_installation', label: 'Instalación tercer piso', durationMinutesPerUnit: 210, kind: 'installation', active: true, sortOrder: 90 },\n  { id: 'anti_corrosive', label: 'Tratamiento anti-corrosivo', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: 100 },\n  { id: 'special_installation', label: 'Instalación especial (compatibilidad)', durationMinutesPerUnit: 180, kind: 'installation', active: false, sortOrder: 1000 },\n];`,
  'default appointment work presets',
);
calendar = requiredReplace(
  calendar,
  '  const safeMinutes = Math.max(30, Math.round(minutes / 30) * 30);',
  '  const safeMinutes = Math.max(15, Math.round(minutes / 15) * 15);',
  '15-minute duration formatter',
);
calendar = requiredReplace(
  calendar,
  '  const source = Array.isArray(presets) && presets.length ? presets : DEFAULT_APPOINTMENT_WORK_PRESETS;',
  `  const stored = Array.isArray(presets) ? presets : [];\n  const storedIds = new Set(stored.map((preset) => String(preset?.id ?? '')));\n  const source = stored.length\n    ? [...stored, ...DEFAULT_APPOINTMENT_WORK_PRESETS.filter((preset) => !storedIds.has(preset.id))]\n    : DEFAULT_APPOINTMENT_WORK_PRESETS;`,
  'preset default merge',
);
calendar = requiredReplace(
  calendar,
  '      durationMinutesPerUnit: Math.min(360, Math.max(30, Math.round(Number(preset.durationMinutesPerUnit || 60) / 30) * 30)),',
  '      durationMinutesPerUnit: Math.min(480, Math.max(15, Math.round(Number(preset.durationMinutesPerUnit || 60) / 15) * 15)),',
  '15-minute preset normalization',
);
write(files.calendar, calendar);

// Distinct installation IDs remain distinct. The legacy special ID is retained
// only so old appointments can still be opened safely.
let agenda = read(files.agenda);
agenda = requiredRegex(
  agenda,
  /const LEGACY_SPECIAL_INSTALLATIONS = new Set<AppointmentWorkType>\([^\n]*\);\n\nfunction normalizedAppointmentPresetId\(id\?: string\) \{[\s\S]*?\n\}/,
  `// ${marker}: do not collapse extended/rooftop/floor installations into one generic type.\nfunction normalizedAppointmentPresetId(id?: string) {\n  return id;\n}`,
  'legacy installation normalization',
);
agenda = requiredReplace(
  agenda,
  '  const activeAppointmentWorkPresets = appointmentWorkPresets.filter((preset) => preset.active !== false);',
  "  const activeAppointmentWorkPresets = appointmentWorkPresets.filter((preset) => preset.active !== false && preset.id !== 'special_installation');",
  'active work preset filter',
);
agenda = requiredRegex(
  agenda,
  /function legacyAppointmentWorkType\(presetId: string\): AppointmentWorkType \{\n  const supported: AppointmentWorkType\[] = \[[^\n]*\];/,
  `function legacyAppointmentWorkType(presetId: string): AppointmentWorkType {\n  const supported: AppointmentWorkType[] = ['standard_service', 'deep_cleaning', 'diagnosis', 'repair', 'standard_installation', 'extended_installation', 'rooftop_installation', 'second_floor_installation', 'third_floor_installation', 'anti_corrosive', 'special_installation'];`,
  'appointment work type snapshot support',
);
agenda = agenda.replaceAll('de 30 minutos a 6 horas', 'de 15 minutos a 6 horas');
agenda = agenda.replaceAll('Math.max(0.5, value - 0.5)', 'Math.max(0.25, value - 0.25)');
agenda = agenda.replaceAll('workHours <= 0.5', 'workHours <= 0.25');
agenda = agenda.replaceAll('Math.min(MAX_BOOKABLE_HOURS, value + 0.5)', 'Math.min(MAX_BOOKABLE_HOURS, value + 0.25)');
write(files.agenda, agenda);

// Settings edits in 15-minute steps so values such as a 45-minute diagnostic
// can be represented exactly. This is configuration, not a hard-coded rule.
let settings = read(files.settings);
settings = requiredReplace(
  settings,
  '// APPOINTMENT_SETTINGS_V11: administrators control the appointment work menu and durations.',
  `// APPOINTMENT_SETTINGS_V11: administrators control the appointment work menu and durations.\n// ${marker}: durations support 15-minute increments and business defaults remain editable.`,
  'settings V17 marker',
);
settings = requiredReplace(
  settings,
  'Puedes usar incrementos de 30 minutos.',
  'Puedes usar incrementos de 15 minutos.',
  'settings duration explanation',
);
settings = settings.replaceAll('(workPresetDraft?.durationMinutesPerUnit ?? 30) <= 30', '(workPresetDraft?.durationMinutesPerUnit ?? 15) <= 15');
settings = settings.replaceAll('Math.max(30, current.durationMinutesPerUnit - 30)', 'Math.max(15, current.durationMinutesPerUnit - 15)');
settings = settings.replaceAll('(workPresetDraft?.durationMinutesPerUnit ?? 360) >= 360', '(workPresetDraft?.durationMinutesPerUnit ?? 480) >= 480');
settings = settings.replaceAll('Math.min(360, current.durationMinutesPerUnit + 30)', 'Math.min(480, current.durationMinutesPerUnit + 15)');
settings = settings.replaceAll('Cada toque cambia 30 minutos. El máximo por aire es 6 horas.', 'Cada toque cambia 15 minutos. El máximo configurable por aire es 8 horas.');
write(files.settings, settings);

// Keep typed snapshots useful for reporting and compatibility while dynamic
// presetId remains the extensible identifier for administrator-created work.
let types = read(files.types);
types = requiredReplace(
  types,
  "  | 'deep_cleaning'\n  | 'standard_installation'",
  `  | 'deep_cleaning'\n  // ${marker}: canonical DEMAC work identifiers used by the current business defaults.\n  | 'diagnosis'\n  | 'repair'\n  | 'anti_corrosive'\n  | 'standard_installation'`,
  'appointment work type additions',
);
write(files.types, types);

console.log('patchMasterV2WorkCatalogV17.cjs applied.');
