const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const marker = 'COPILOT_CONVERSATION_RULES_V15';
const files = {
  companyRules: path.join(root, 'functions', 'whatsappCopilotCompanyRules.js'),
  knowledge: path.join(root, 'functions', 'whatsappCopilotKnowledge.js'),
  router: path.join(root, 'functions', 'whatsappCopilotRouter.js'),
  scheduling: path.join(root, 'functions', 'whatsappCopilotScheduling.js'),
  copilot: path.join(root, 'functions', 'whatsappCopilot.js'),
  knowledgeScreen: path.join(root, 'src', 'screens', 'WhatsAppKnowledgeScreen.tsx'),
};

function writeChanged(file, source, next, label) {
  if (source === next) throw new Error(`${label}: expected source pattern was not changed.`);
  fs.writeFileSync(file, next);
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`${label} not found.`);
  return source.replace(search, replacement);
}

function replaceRegex(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`${label} not found.`);
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

function patchCompanyRulesEngine() {
  let source = fs.readFileSync(files.companyRules, 'utf8');
  if (source.includes(`${marker}_CAPACITY`)) return;
  const original = source;

  source = source.replace('    automaticSupportMaxUnits: 10,', '    automaticSupportMaxUnits: 0,');
  source = replaceRegex(
    source,
    /automaticSupportFromUnits: boundedInteger\([\s\S]*?DEFAULT_COMPANY_OPERATIONAL_RULES\.standardService\.automaticSupportFromUnits,[\s\S]*?2,\s*20,\s*\),/,
    `automaticSupportFromUnits: boundedInteger(\n        standard.automaticSupportFromUnits,\n        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.automaticSupportFromUnits,\n        2,\n        100,\n      ),`,
    'support threshold normalization',
  );
  source = replaceRegex(
    source,
    /automaticSupportMaxUnits: boundedInteger\([\s\S]*?DEFAULT_COMPANY_OPERATIONAL_RULES\.standardService\.automaticSupportMaxUnits,[\s\S]*?2,\s*24,\s*\),/,
    `automaticSupportMaxUnits: boundedInteger(\n        standard.automaticSupportMaxUnits,\n        DEFAULT_COMPANY_OPERATIONAL_RULES.standardService.automaticSupportMaxUnits,\n        0,\n        500,\n      ),`,
    'automatic maximum normalization',
  );

  source = replaceRegex(
    source,
    /capacity\.automaticSupportMaxUnits = Math\.max\([\s\S]*?\n  \);\n  return normalized;/,
    `if (capacity.automaticSupportMaxUnits > 0 && capacity.automaticSupportMaxUnits < capacity.automaticSupportFromUnits) {\n    capacity.automaticSupportMaxUnits = capacity.automaticSupportFromUnits;\n  }\n  return normalized;`,
    'automatic maximum clamping',
  );

  source = replaceRegex(
    source,
    /    if \(quantity <= capacity\.singlePropertyMainVanMaxUnits[\s\S]*?\n    return \[\];\n  }\n\n  const maxUnitsPerVan/,
    `    // ${marker}_CAPACITY: one property can scale across as many staffed vans as are truly available.\n    const fullDayCapacity = Math.max(1, Math.min(\n      capacity.singlePropertyMainVanMaxUnits,\n      Math.floor((capacity.singlePropertyMainVanMaxUnits * 60) / duration),\n    ));\n\n    if (quantity <= fullDayCapacity && availableVanCount >= 1) {\n      return [{\n        quantity,\n        slots: 6,\n        fullDay: true,\n        role: "primary",\n        fixedTime: "08:30",\n        timePolicy: "fixed",\n      }];\n    }\n\n    const withinConfiguredMaximum = capacity.automaticSupportMaxUnits === 0\n      || quantity <= capacity.automaticSupportMaxUnits;\n    if (quantity >= capacity.automaticSupportFromUnits && withinConfiguredMaximum) {\n      const requiredVans = Math.ceil(quantity / fullDayCapacity);\n      if (requiredVans > availableVanCount) return [];\n      const plan = [];\n      let remaining = quantity;\n      for (let index = 0; index < requiredVans; index += 1) {\n        const units = Math.min(fullDayCapacity, remaining);\n        const slots = Math.ceil((units * duration) / 60);\n        const canUseHalfDay = index > 0\n          && units <= capacity.supportHalfDayMaxUnits\n          && slots <= 3;\n        plan.push(canUseHalfDay\n          ? {\n              quantity: units,\n              slots,\n              fullDay: false,\n              role: "support",\n              allowedTimes: ["08:30", "13:30"],\n              timePolicy: "allowed",\n            }\n          : {\n              quantity: units,\n              slots: 6,\n              fullDay: true,\n              role: index === 0 ? "primary" : "support",\n              fixedTime: "08:30",\n              timePolicy: "fixed",\n            });\n        remaining -= units;\n      }\n      return plan;\n    }\n    return [];\n  }\n\n  const maxUnitsPerVan`,
    'single-property scalable allocation block',
  );

  writeChanged(files.companyRules, original, source, 'company rules engine');
}

function patchKnowledge() {
  let source = fs.readFileSync(files.knowledge, 'utf8');
  if (source.includes(`${marker}_KNOWLEDGE`)) return;
  const original = source;

  const coreImport = `const {\n  cleanText,\n  normalizeText,\n} = require("./whatsappCopilotSchedulingCore");`;
  source = replaceRequired(
    source,
    coreImport,
    `${coreImport}\nconst {\n  formatDurationReply,\n  formatPriceReply,\n  resolvePricingContext,\n} = require("./demacServicePricingRules");\nconst {\n  formatNaturalCustomerReply,\n  isAvailabilityTurn,\n} = require("./whatsappCopilotConversationPolicy");`,
    'knowledge imports',
  );

  source = replaceRequired(
    source,
    `function isSchedulingTurn(value) {\n  const text = normalizeText(value);\n  if (!text) return true;`,
    `function isSchedulingTurn(value) {\n  const text = normalizeText(value);\n  if (!text) return true;\n  if (isAvailabilityTurn(value)) return true;`,
    'availability routing',
  );

  source = replaceRegex(
    source,
    /function durationText\(minutes, language, perUnit = false\) \{[\s\S]*?\n\}\n\nfunction tokens/,
    `function durationText(minutes, language, perUnit = false) {\n  const hours = minutes / 60;\n  const display = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".0", "");\n  if (language === "en") return perUnit ? \`A standard service takes approximately \${display} hour\${hours === 1 ? "" : "s"} per AC unit.\` : \`The service takes approximately \${display} hour\${hours === 1 ? "" : "s"}.\`;\n  if (language === "pap-aw") return perUnit ? \`Un servicio standard ta dura aproximadamente \${display} ora pa cada airco.\` : \`E servicio ta dura aproximadamente \${display} ora.\`;\n  return perUnit ? \`Un servicio estándar dura aproximadamente \${display} hora\${hours === 1 ? "" : "s"} por aire.\` : \`El servicio dura aproximadamente \${display} hora\${hours === 1 ? "" : "s"}.\`;\n}\n\nfunction tokens`,
    'natural duration wording',
  );

  source = replaceRegex(
    source,
    /function ruleScore\(rule, latestText, detectedKind\) \{[\s\S]*?\n\}\n\nfunction bestDeterministicRule/,
    `function ruleScore(rule, latestText, detectedKind) {\n  if (rule.active === false) return -1;\n  const text = normalizeText(latestText);\n  const triggers = Array.isArray(rule.triggerPhrases) ? rule.triggerPhrases : [];\n  let relevance = 0;\n  if (detectedKind && normalizeText(rule.intent) === normalizeText(detectedKind)) relevance += 200;\n  for (const phrase of triggers) {\n    const normalizedPhrase = normalizeText(phrase);\n    if (!normalizedPhrase) continue;\n    if (text.includes(normalizedPhrase)) relevance += 160 + normalizedPhrase.length;\n    const phraseTokens = tokens(normalizedPhrase);\n    const textTokens = tokens(text);\n    let overlap = 0;\n    for (const token of phraseTokens) if (textTokens.has(token)) overlap += 1;\n    if (phraseTokens.size && overlap > 0) relevance += Math.round((overlap / phraseTokens.size) * 80);\n  }\n  // ${marker}_KNOWLEDGE: priority only breaks ties after the rule actually matches.\n  if (relevance <= 0) return -1;\n  return relevance + Math.max(0, Math.min(100, Number(rule.priority || 0))) / 10;\n}\n\nfunction bestDeterministicRule`,
    'knowledge rule scoring',
  );

  source = replaceRegex(
    source,
    /async function buildRuleAnswer\(\{ rule, language, preset, facts, services, activeVanCount, operationalRules \}\) \{/,
    `async function buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount, operationalRules, pricingRules, conversation, latestText }) {`,
    'buildRuleAnswer signature',
  );

  source = replaceRegex(
    source,
    /  if \(source === "erp_duration" \|\| cleanText\(rule\?\.intent, 80\) === "duration"\) \{[\s\S]*?\n  \}\n\n  const service = findService/,
    `  if (source === "erp_duration" || cleanText(rule?.intent, 80) === "duration") {\n    const pricingContext = resolvePricingContext({ pricingRules, conversation, latestText, facts });\n    const natural = formatDurationReply(pricingContext, language, parseQuantity(facts.quantity));\n    if (natural) return natural;\n    return durationText(preset.durationMinutesPerUnit, language, true);\n  }\n\n  const service = findService`,
    'ERP duration answer',
  );

  source = replaceRequired(
    source,
    '  if (source === "erp_service_price") return servicePriceText(service, language);',
    `  if (source === "erp_service_price") {\n    const pricingContext = resolvePricingContext({ pricingRules, conversation, latestText, facts });\n    return formatPriceReply(pricingContext, language) || servicePriceText(service, language);\n  }`,
    'ERP price answer',
  );

  source = replaceRequired(
    source,
    '  const [presetSnapshot, operationalSnapshot, servicesSnapshot, vansSnapshot, rulesSnapshot] = await Promise.all([',
    '  const [presetSnapshot, operationalSnapshot, pricingSnapshot, servicesSnapshot, vansSnapshot, rulesSnapshot] = await Promise.all([',
    'pricing snapshot tuple',
  );
  source = replaceRequired(
    source,
    '    db.collection("businessSettings").doc("company-operational-rules").get(),\n    db.collection("services").get(),',
    '    db.collection("businessSettings").doc("company-operational-rules").get(),\n    db.collection("businessSettings").doc("company-service-pricing-rules").get(),\n    db.collection("services").get(),',
    'pricing settings query',
  );
  source = replaceRequired(
    source,
    '  const operationalRules = operationalSnapshot.exists ? operationalSnapshot.data() : null;\n  const services = servicesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));',
    '  const operationalRules = operationalSnapshot.exists ? operationalSnapshot.data() : null;\n  const pricingRules = pricingSnapshot.exists ? pricingSnapshot.data() : null;\n  const services = servicesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));',
    'pricing rules data',
  );
  source = replaceRequired(
    source,
    '  const draft = await buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount, operationalRules });',
    '  const draft = await buildRuleAnswer({ rule, language, preset, facts, services, activeVanCount, operationalRules, pricingRules, conversation, latestText });',
    'pricing build call',
  );
  source = replaceRequired(
    source,
    '      draft,\n      language,',
    '      draft: formatNaturalCustomerReply(draft, language),\n      language,',
    'natural knowledge response',
  );

  writeChanged(files.knowledge, original, source, 'knowledge engine');
}

function patchRouter() {
  let source = fs.readFileSync(files.router, 'utf8');
  if (source.includes(`${marker}_ROUTER`)) return;
  const original = source;

  source = replaceRequired(
    source,
    'const { resolveKnowledgeReply } = require("./whatsappCopilotKnowledge");',
    `const { resolveKnowledgeReply } = require("./whatsappCopilotKnowledge");\nconst { formatNaturalCustomerReply, immediateReply } = require("./whatsappCopilotConversationPolicy");`,
    'router conversation imports',
  );
  source = replaceRequired(
    source,
    '    try {\n      const knowledge = await resolveKnowledgeReply(request.body || {});',
    `    try {\n      // ${marker}_ROUTER: the current customer turn is resolved before old conversation context.\n      const immediate = immediateReply({\n        conversation: request.body?.conversation || {},\n        languageMode: request.body?.languageMode || "auto",\n      });\n      if (immediate) {\n        response.status(200).json(immediate);\n        return;\n      }\n      const knowledge = await resolveKnowledgeReply(request.body || {});`,
    'router immediate policy',
  );
  source = replaceRequired(
    source,
    '      if (knowledge.route === "knowledge") {\n        response.status(200).json(knowledge.payload);',
    '      if (knowledge.route === "knowledge") {\n        knowledge.payload.draft = formatNaturalCustomerReply(knowledge.payload.draft, knowledge.payload?.metadata?.language || "es");\n        response.status(200).json(knowledge.payload);',
    'router natural knowledge output',
  );

  writeChanged(files.router, original, source, 'router');
}

function patchScheduling() {
  let source = fs.readFileSync(files.scheduling, 'utf8');
  if (source.includes(`${marker}_SELECTION`)) return;
  const original = source;

  const coreImportEnd = '} = require("./whatsappCopilotSchedulingCore");';
  source = replaceRequired(
    source,
    coreImportEnd,
    `${coreImportEnd}\nconst { fuzzyTimeOption, looksLikeAffirmativeSelection } = require("./whatsappCopilotConversationPolicy");`,
    'scheduling policy import',
  );

  source = replaceRegex(
    source,
    /function selectedOfferOption\(analysis, offer\) \{[\s\S]*?\n\}\n\nasync function loadSchedulingData/,
    `function selectedOfferOption(analysis, offer, latestCustomerTurn = "") {\n  if (!offer?.options?.length) return null;\n  const ordinal = Number(analysis.selectedOptionOrdinal ?? 0);\n  if (ordinal >= 1 && ordinal <= offer.options.length) return offer.options[ordinal - 1];\n  const requestedDate = cleanText(analysis.collectedInformation?.requestedDate || analysis.collectedInformation?.preferredDate, 20);\n  const requestedTime = normalizeTime(\n    analysis.collectedInformation?.requestedTime\n      || analysis.collectedInformation?.preferredTime\n      || latestCustomerTurn\n  );\n  const dateMatches = offer.options.filter((option) => !requestedDate || option.date === requestedDate);\n  const exact = dateMatches.filter((option) => !requestedTime || option.time === requestedTime);\n  if (exact.length === 1) return exact[0];\n  if (requestedTime) {\n    const fuzzy = fuzzyTimeOption(dateMatches, requestedTime);\n    if (fuzzy) return fuzzy;\n  }\n  return null;\n}\n\nasync function loadSchedulingData`,
    'fuzzy offer selection',
  );

  source = replaceRequired(
    source,
    '  const selected = selectedOfferOption(analysis, offer);\n  if (offer && selected && analysis.customerConfirmedAppointment) {',
    `  const selected = selectedOfferOption(analysis, offer, request.latestCustomerTurn);\n  const customerConfirmedSelection = analysis.customerConfirmedAppointment\n    || (selected && looksLikeAffirmativeSelection(request.latestCustomerTurn));\n  // ${marker}_SELECTION: natural confirmations such as "a las 8 está bien" can resolve 8:30 when it is the only matching option.\n  if (offer && selected && customerConfirmedSelection) {`,
    'natural confirmation condition',
  );
  source = source.replace(
    'module.exports = { orchestrateScheduling };',
    'module.exports = { orchestrateScheduling, selectedOfferOption };',
  );

  writeChanged(files.scheduling, original, source, 'scheduling selection');
}

function patchCopilot() {
  let source = fs.readFileSync(files.copilot, 'utf8');
  if (source.includes(`${marker}_PROMPT`)) return;
  const original = source;

  source = replaceRequired(
    source,
    'const { orchestrateScheduling } = require("./whatsappCopilotScheduling");',
    `const { orchestrateScheduling } = require("./whatsappCopilotScheduling");\nconst { formatNaturalCustomerReply } = require("./whatsappCopilotConversationPolicy");`,
    'copilot conversation formatter import',
  );

  source = replaceRequired(
    source,
    '        "Analiza toda la conversación reciente, no solamente el último mensaje aislado.",',
    `        "Analiza toda la conversación reciente, pero el ÚLTIMO TURNO DEL CLIENTE manda sobre intenciones anteriores.",\n        "${marker}_PROMPT: la memoria responde qué sabemos; nunca decide qué quiere el cliente ahora.",\n        "Responde primero exactamente a lo que el cliente acaba de decir o preguntar y solamente después continúa el proceso comercial.",\n        "Si el último turno es un saludo sin otra solicitud, responde únicamente el saludo y pregunta cómo ayudar.",\n        "Si el cliente pregunta por disponibilidad para un día, reconoce ese día y pide únicamente los datos que falten para poder revisar la agenda.",`,
    'current turn priority prompt',
  );
  source = replaceRequired(
    source,
    '        "Ejemplos de confirmación: \'la primera\', \'opción 2\', \'sí, mañana a las 8:30\', \'ese horario está bien\'.",',
    `        "Ejemplos de confirmación: 'la primera', 'opción 2', 'sí, mañana a las 8:30', 'ese horario está bien', 'a las 8 está bien' cuando la opción ofrecida fue 8:30.",\n        "Interpreta frases incompletas comparándolas con las opciones que DEMAC acaba de ofrecer. Si hay una única interpretación razonable, úsala; pregunta solo si existe ambigüedad real.",`,
    'natural confirmation prompt',
  );
  source = replaceRequired(
    source,
    '        "No menciones inteligencia artificial, prompts, modelos ni procesos internos.",',
    `        "No menciones inteligencia artificial, prompts, modelos, ERP, base de datos, configuración ni procesos internos al cliente.",\n        "Habla como una persona de Operaciones: claro, cordial, breve y natural. Nunca digas 'configurado en nuestro ERP' al explicar duración o precio.",\n        "Cuando necesites hacer más de una pregunta, separa cada pregunta en un párrafo distinto. No amontones varias preguntas en una sola frase.",\n        "Haz como máximo dos preguntas cortas por mensaje; si faltan más datos, continúa en el siguiente turno.",`,
    'natural voice prompt',
  );
  source = replaceRequired(
    source,
    '      const papiamentoValidation = result.language === "pap-aw" ? validatePapiamento(draft) : null;',
    `      draft = formatNaturalCustomerReply(draft, result.language);\n      const papiamentoValidation = result.language === "pap-aw" ? validatePapiamento(draft) : null;`,
    'natural response formatter',
  );

  writeChanged(files.copilot, original, source, 'copilot prompt');
}

function patchKnowledgeScreen() {
  let source = fs.readFileSync(files.knowledgeScreen, 'utf8');
  if (source.includes(`${marker}_SCREEN`)) return;
  const original = source;

  source = source.replace(
    "triggerPhrases: ['cómo puedo pagar', 'aceptan transferencia', 'payment methods', 'con mi por paga'],",
    "triggerPhrases: ['cómo puedo pagar', 'aceptan transferencia', 'puedo pagar en efectivo', 'payment methods', 'can I pay cash', 'con mi por paga', 'boso ta acepta transferencia', 'mi por paga cash'],",
  );
  source = source.replace(
    '<Text style={styles.ruleMeta}>{sourceLabel(rule.source)} · prioridad {rule.priority} · {(rule.triggerPhrases ?? []).length} frases de ejemplo</Text>',
    '<Text style={styles.ruleMeta}>{sourceLabel(rule.source)} · prioridad {rule.priority} (solo desempate) · {(rule.triggerPhrases ?? []).length} frases de ejemplo</Text>',
  );
  source = source.replace(
    '<Input label="Prioridad" value={String(editor.priority)} onChangeText={(value) => setEditor({ ...editor, priority: Number(value.replace(/[^0-9]/g, \'\')) || 0 })} keyboardType="numeric" />',
    `<Input label="Prioridad (0–100, solo desempate)" value={String(editor.priority)} onChangeText={(value) => setEditor({ ...editor, priority: Math.max(0, Math.min(100, Number(value.replace(/[^0-9]/g, '')) || 0)) })} keyboardType="numeric" />\n            <Text style={styles.priorityHelp}>La prioridad no hace que una regla responda fuera de contexto. Solo decide cuál usar cuando dos reglas relevantes coinciden.</Text>`,
  );
  source = replaceRequired(
    source,
    `      <AppModal visible={!!editor} title={editor?.title || 'Nueva regla'} onClose={() => { if (!saving) setEditor(null); }}>\n        {editor ? (\n          <View style={styles.modalContent}>`,
    `      <AppModal visible={!!editor} title={editor?.title || 'Nueva regla'} onClose={() => { if (!saving) setEditor(null); }}>\n        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">\n        {editor ? (\n          <View style={styles.modalContent}>`,
    'knowledge modal scroll start',
  );
  source = replaceRequired(
    source,
    `        ) : null}\n      </AppModal>`,
    `        ) : null}\n        </ScrollView>\n      </AppModal>`,
    'knowledge modal scroll end',
  );
  source = source.replace(
    '  modalContent: { gap: 14 },',
    `  // ${marker}_SCREEN: scroll keeps Spanish, English and Papiamento fields visible on smaller screens.\n  modalScroll: { width: '100%' },\n  modalScrollContent: { paddingBottom: 12 },\n  modalContent: { gap: 14 },\n  priorityHelp: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: -10 },`,
  );

  writeChanged(files.knowledgeScreen, original, source, 'knowledge settings screen');
}

patchCompanyRulesEngine();
patchKnowledge();
patchRouter();
patchScheduling();
patchCopilot();
patchKnowledgeScreen();
console.log('Copilot conversation and company rules V15 applied.');
