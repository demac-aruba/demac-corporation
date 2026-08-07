const fs = require('fs');
const path = require('path');

const marker = 'COMPANY_RULES_V14';
const root = path.join(__dirname, '..');
const settingsHubPath = path.join(root, 'src', 'screens', 'SettingsHubScreen.tsx');
const companyRulesScreenPath = path.join(root, 'src', 'screens', 'CompanyRulesScreen.tsx');
const schedulingPath = path.join(root, 'functions', 'whatsappCopilotScheduling.js');
const knowledgePath = path.join(root, 'functions', 'whatsappCopilotKnowledge.js');
const companyRulesEnginePath = path.join(root, 'functions', 'whatsappCopilotCompanyRules.js');

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`${label} not found.`);
  return source.replace(search, replacement);
}

function patchSettingsHub() {
  let source = fs.readFileSync(settingsHubPath, 'utf8');
  if (source.includes(marker)) return;
  if (!source.includes('WHATSAPP_KNOWLEDGE_V13')) {
    throw new Error('WhatsApp knowledge V13 must be applied before company rules V14.');
  }

  source = replaceRequired(
    source,
    "import { WhatsAppKnowledgeScreen } from './WhatsAppKnowledgeScreen';",
    "import { CompanyRulesScreen } from './CompanyRulesScreen';",
    'WhatsApp knowledge screen import',
  );
  source = replaceRequired(
    source,
    '>Reglas del WhatsApp Copilot</Text>',
    '>Reglas de la compañía</Text>',
    'WhatsApp rules tab label',
  );
  source = replaceRequired(
    source,
    ": <WhatsAppKnowledgeScreen />}",
    ": <CompanyRulesScreen />}",
    'WhatsApp rules render branch',
  );
  source = source.replace(
    '// WHATSAPP_KNOWLEDGE_V13:',
    `// ${marker}: operations, prices, durations and approved answers share one ERP rules area.\n// WHATSAPP_KNOWLEDGE_V13:`,
  );
  fs.writeFileSync(settingsHubPath, source);
}

function patchCompanyRulesScreen() {
  let source = fs.readFileSync(companyRulesScreenPath, 'utf8');
  const screenMarker = `${marker}_SCREEN`;
  if (source.includes(screenMarker)) return;

  const editableFixedCapacity = `          <NumberField label="Cupo diario por van — direcciones distintas" value={draft.differentPropertyDailyCapacity} onChange={(value) => change('differentPropertyDailyCapacity', value, 1, 12)} help="Regla actual: 6 clientes de un aire por día." />\n          <NumberField label="Cupos en la mañana" value={draft.morningDifferentPropertyStops} onChange={(value) => change('morningDifferentPropertyStops', value, 1, 6)} help="Regla actual: 3 citas." />\n          <NumberField label="Cupos en la tarde" value={draft.afternoonDifferentPropertyStops} onChange={(value) => change('afternoonDifferentPropertyStops', value, 1, 6)} help="Regla actual: 3 citas." />`;
  const protectedFixedCapacity = `          <View style={styles.scenarioBox}>\n            <Text style={styles.scenarioTitle}>Capacidad diaria protegida</Text>\n            <Text style={styles.scenarioText}>Una van dispone de 6 cupos de servicio estándar para direcciones distintas: 3 en la mañana y 3 en la tarde. Esta estructura está vinculada a los horarios y a las reglas de ruta, por lo que no se modifica como un precio o una duración.</Text>\n          </View>`;
  source = replaceRequired(source, editableFixedCapacity, protectedFixedCapacity, 'fixed capacity fields');

  const capacityValidation = `    if (normalized.standardService.morningDifferentPropertyStops + normalized.standardService.afternoonDifferentPropertyStops !== normalized.standardService.differentPropertyDailyCapacity) {\n      setError('La suma de los cupos de mañana y tarde debe ser igual al cupo diario por van.');\n      return;\n    }\n`;
  source = replaceRequired(source, capacityValidation, '', 'fixed capacity validation');
  source = source.replace(
    'export function CompanyRulesScreen() {',
    `// ${screenMarker}: fixed route-slot capacity is protected; durations, prices and large-job thresholds remain editable.\nexport function CompanyRulesScreen() {`,
  );
  fs.writeFileSync(companyRulesScreenPath, source);
}

function patchScheduling() {
  let source = fs.readFileSync(schedulingPath, 'utf8');
  if (source.includes(marker)) return;

  source = replaceRequired(
    source,
    `    const availability = candidateAvailability({\n      date: option.date,\n      time: option.time,\n      allocation: { quantity: requested.quantity, slots: requested.slots, fullDay: requested.fullDay },`,
    `    const requestedStartTime = requested.time || option.time;\n    const availability = candidateAvailability({\n      date: option.date,\n      time: requestedStartTime,\n      allocation: { quantity: requested.quantity, slots: requested.slots, fullDay: requested.fullDay },`,
    'support revalidation time',
  );
  source = replaceRequired(
    source,
    '    refreshedAssignments.push(availability);',
    `    refreshedAssignments.push({\n      ...availability,\n      time: requestedStartTime,\n      role: requested.role || (refreshedAssignments.length ? "support" : "primary"),\n      block: requested.block || (requestedStartTime >= "13:00" ? "afternoon" : "morning"),\n    });`,
    'refreshed assignment metadata',
  );
  source = replaceRequired(
    source,
    '      const requestedSlots = occupiedSlots(option.time, assignment.slots, halfDay);',
    '      const requestedSlots = occupiedSlots(assignment.time || option.time, assignment.slots, halfDay);',
    'support conflict time',
  );
  source = replaceRequired(
    source,
    `    date: option.date,\n    time: option.time,\n    status: "Confirmada",`,
    `    date: option.date,\n    // ${marker}: support orders use their own morning or afternoon start time.\n    time: assignment.time || option.time,\n    status: "Confirmada",`,
    'work order assignment time',
  );
  fs.writeFileSync(schedulingPath, source);
}

function patchKnowledge() {
  let source = fs.readFileSync(knowledgePath, 'utf8');
  const knowledgeMarker = `${marker}_KNOWLEDGE`;
  if (source.includes(knowledgeMarker)) return;

  source = replaceRequired(
    source,
    'async function buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount }) {',
    `// ${knowledgeMarker}: duration answers use the same capacity rules as appointment scheduling.\nasync function buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount, operationalRules }) {`,
    'knowledge answer signature',
  );
  source = replaceRequired(
    source,
    '    const allocations = distributeUnits(quantity, preset.durationMinutesPerUnit, activeVanCount);',
    '    const allocations = distributeUnits(quantity, preset.durationMinutesPerUnit, activeVanCount, operationalRules, preset);',
    'knowledge allocation rules',
  );
  source = replaceRequired(
    source,
    '  const [presetSnapshot, servicesSnapshot, vansSnapshot, rulesSnapshot] = await Promise.all([',
    '  const [presetSnapshot, operationalSnapshot, servicesSnapshot, vansSnapshot, rulesSnapshot] = await Promise.all([',
    'knowledge settings snapshots',
  );
  source = replaceRequired(
    source,
    '    db.collection("businessSettings").doc("appointment-work-presets").get(),\n    db.collection("services").get(),',
    '    db.collection("businessSettings").doc("appointment-work-presets").get(),\n    db.collection("businessSettings").doc("company-operational-rules").get(),\n    db.collection("services").get(),',
    'operational rules snapshot',
  );
  source = replaceRequired(
    source,
    '  const presetSettings = presetSnapshot.exists ? presetSnapshot.data() : null;\n  const services = servicesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));',
    '  const presetSettings = presetSnapshot.exists ? presetSnapshot.data() : null;\n  const operationalRules = operationalSnapshot.exists ? operationalSnapshot.data() : null;\n  const services = servicesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));',
    'operational rules data',
  );
  source = replaceRequired(
    source,
    '  const draft = await buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount });',
    '  const draft = await buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount, operationalRules });',
    'knowledge answer call',
  );
  fs.writeFileSync(knowledgePath, source);
}

function patchCompanyRulesEngine() {
  let source = fs.readFileSync(companyRulesEnginePath, 'utf8');
  const engineMarker = `${marker}_ENGINE`;
  if (source.includes(engineMarker)) return;

  source = replaceRequired(
    source,
    '  const capacity = normalized.standardService;\n  capacity.automaticSupportFromUnits = Math.max(',
    `  const capacity = normalized.standardService;\n  // ${engineMarker}: the fixed daily capacity always equals the protected 3+3 route slots.\n  capacity.differentPropertyDailyCapacity = capacity.morningDifferentPropertyStops + capacity.afternoonDifferentPropertyStops;\n  capacity.automaticSupportFromUnits = Math.max(`,
    'normalized daily capacity',
  );
  source = replaceRequired(
    source,
    '    if (quantity <= capacity.singlePropertyMainVanMaxUnits && availableVanCount >= 1) {',
    '    if (quantity <= capacity.singlePropertyMainVanMaxUnits && quantity * duration <= capacity.singlePropertyMainVanMaxUnits * 60 && availableVanCount >= 1) {',
    'full-day duration guard',
  );
  source = replaceRequired(
    source,
    '      && quantity <= capacity.automaticSupportMaxUnits\n      && availableVanCount >= 2',
    '      && quantity <= capacity.automaticSupportMaxUnits\n      && capacity.singlePropertyMainVanMaxUnits * duration <= capacity.singlePropertyMainVanMaxUnits * 60\n      && availableVanCount >= 2',
    'support primary duration guard',
  );
  fs.writeFileSync(companyRulesEnginePath, source);
}

patchSettingsHub();
patchCompanyRulesScreen();
patchScheduling();
patchKnowledge();
patchCompanyRulesEngine();
console.log('Company rules V14 applied.');
