const fs = require('fs');
const path = require('path');

const marker = 'COMPANY_RULES_V14';
const root = path.join(__dirname, '..');
const settingsHubPath = path.join(root, 'src', 'screens', 'SettingsHubScreen.tsx');
const schedulingPath = path.join(root, 'functions', 'whatsappCopilotScheduling.js');
const knowledgePath = path.join(root, 'functions', 'whatsappCopilotKnowledge.js');

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

patchSettingsHub();
patchScheduling();
patchKnowledge();
console.log('Company rules V14 applied.');
