const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const marker = 'COPILOT_CONVERSATION_RULES_V15';
const files = {
  packageJson: path.join(root, 'package.json'),
  companyRulesEngine: path.join(root, 'src', 'lib', 'companyRulesEngine.ts'),
  knowledge: path.join(root, 'functions', 'whatsappCopilotKnowledge.js'),
  router: path.join(root, 'functions', 'whatsappCopilotRouter.js'),
  scheduling: path.join(root, 'functions', 'whatsappCopilotScheduling.js'),
  copilot: path.join(root, 'functions', 'whatsappCopilot.js'),
  knowledgeScreen: path.join(root, 'src', 'screens', 'WhatsAppKnowledgeScreen.tsx'),
};

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Required V15 patch block not found (${label}).`);
  return source.replace(before, after);
}

function writeChanged(file, original, next, label) {
  if (next === original) return;
  fs.writeFileSync(file, next);
  console.log(`${label} patched.`);
}

function patchCompanyRulesEngine() {
  let source = fs.readFileSync(files.companyRulesEngine, 'utf8');
  if (source.includes(`${marker}_ENGINE`)) return;
  const original = source;
  source = source.replace(
    /export const DEFAULT_COMPANY_OPERATIONAL_RULES = \{/,
    `// ${marker}_ENGINE\nexport const DEFAULT_COMPANY_OPERATIONAL_RULES = {`,
  );
  writeChanged(files.companyRulesEngine, original, source, 'company rules engine');
}

function patchKnowledge() {
  let source = fs.readFileSync(files.knowledge, 'utf8');
  // The V18+ knowledge engine already contains these fixes plus stricter current-turn routing.
  if (source.includes(`${marker}_KNOWLEDGE`) || source.includes('erp-knowledge-rules-v18')) return;
  const original = source;

  const coreImport = `const {\n  cleanText,\n  normalizeText,\n} = require("./whatsappCopilotSchedulingCore");`;
  if (source.includes(coreImport) && !source.includes('demacServicePricingRules')) {
    source = source.replace(
      coreImport,
      `${coreImport}\nconst { formatDurationReply, formatPriceReply, resolvePricingContext } = require("./demacServicePricingRules");`,
    );
  }
  source = source.replace(
    /const app = getApps\(\)\.length \? getApp\(\) : initializeApp\(\);/,
    `// ${marker}_KNOWLEDGE\nconst app = getApps().length ? getApp() : initializeApp();`,
  );
  writeChanged(files.knowledge, original, source, 'knowledge engine');
}

function patchRouter() {
  let source = fs.readFileSync(files.router, 'utf8');
  // V18 and the AI-first V30 router are authoritative and must never be rewritten by V15.
  if (
    source.includes(`${marker}_ROUTER`)
    || source.includes('openai+erp-conversation-orchestrator-v18')
    || source.includes('openai-native-conversation-agent-v30')
    || source.includes('whatsappCopilotAgentV30')
  ) return;
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
  if (source.includes(`${marker}_SCHEDULING`)) return;
  const original = source;
  source = source.replace(
    /async function orchestrateScheduling\(\{ db, request, analysis, commitAppointment = false \}\) \{/,
    `// ${marker}_SCHEDULING\nasync function orchestrateScheduling({ db, request, analysis, commitAppointment = false }) {`,
  );
  writeChanged(files.scheduling, original, source, 'scheduling');
}

function patchCopilot() {
  let source = fs.readFileSync(files.copilot, 'utf8');
  if (source.includes(`${marker}_COPILOT`)) return;
  const original = source;
  source = source.replace(
    /const COPILOT_MODEL = "gpt-5-mini";/,
    `// ${marker}_COPILOT\nconst COPILOT_MODEL = "gpt-5-mini";`,
  );
  writeChanged(files.copilot, original, source, 'copilot');
}

function patchKnowledgeScreen() {
  let source = fs.readFileSync(files.knowledgeScreen, 'utf8');
  if (source.includes(`${marker}_SCREEN`)) return;
  const original = source;
  source = source.replace(
    /export default function WhatsAppKnowledgeScreen/,
    `// ${marker}_SCREEN\nexport default function WhatsAppKnowledgeScreen`,
  );
  writeChanged(files.knowledgeScreen, original, source, 'knowledge screen');
}

patchCompanyRulesEngine();
patchKnowledge();
patchRouter();
patchScheduling();
patchCopilot();
patchKnowledgeScreen();
console.log('Copilot conversation and company rules V15 applied.');
