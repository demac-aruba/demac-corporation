const fs = require('fs');
const path = require('path');

const marker = 'WHATSAPP_KNOWLEDGE_V13';
const settingsHubPath = path.join(__dirname, '..', 'src', 'screens', 'SettingsHubScreen.tsx');
const firestoreRulesPath = path.join(__dirname, '..', 'firestore.rules');

function patchSettingsHub() {
  let source = fs.readFileSync(settingsHubPath, 'utf8');
  if (source.includes(marker)) return;
  if (!source.includes('APPOINTMENT_SETTINGS_V11')) {
    throw new Error('Appointment settings V11 must be applied before WhatsApp knowledge V13.');
  }

  const settingsImport = "import { SettingsScreen } from './SettingsScreen';";
  if (!source.includes(settingsImport)) throw new Error('SettingsScreen import not found.');
  source = source.replace(
    settingsImport,
    `${settingsImport}\nimport { WhatsAppKnowledgeScreen } from './WhatsAppKnowledgeScreen';`,
  );

  const tabType = "type SettingsTab = 'users' | 'calendar';";
  if (!source.includes(tabType)) throw new Error('Settings tab type not found.');
  source = source.replace(
    tabType,
    `// ${marker}: approved customer answers and ERP-backed rules live in one administration screen.\ntype SettingsTab = 'users' | 'calendar' | 'whatsapp-knowledge';`,
  );

  const calendarTabPattern = /(\s*<Pressable onPress=\{\(\) => setTab\('calendar'\)\}[\s\S]*?<\/Pressable>)/;
  const calendarMatch = source.match(calendarTabPattern);
  if (!calendarMatch) throw new Error('Calendar settings tab block not found.');
  const knowledgeTab = `\n        <Pressable onPress={() => setTab('whatsapp-knowledge')} style={[styles.tab, tab === 'whatsapp-knowledge' && styles.tabActive]}>\n          <Text style={[styles.tabText, tab === 'whatsapp-knowledge' && styles.tabTextActive]}>Reglas del WhatsApp Copilot</Text>\n        </Pressable>`;
  source = source.replace(calendarTabPattern, `${calendarMatch[1]}${knowledgeTab}`);

  const renderPattern = /\)\s*:\s*<SettingsScreen\s*\/>\}/;
  if (!renderPattern.test(source)) throw new Error('Settings screen render branch not found.');
  source = source.replace(
    renderPattern,
    `) : tab === 'calendar' ? <SettingsScreen /> : <WhatsAppKnowledgeScreen />}`,
  );

  fs.writeFileSync(settingsHubPath, source);
}

function patchFirestoreRules() {
  let rules = fs.readFileSync(firestoreRulesPath, 'utf8');
  const rulesMarker = '// WHATSAPP_KNOWLEDGE_RULES_V13';
  if (rules.includes(rulesMarker)) return;
  const anchor = '    match /warehouseInventory/{itemId} {';
  if (!rules.includes(anchor)) throw new Error('Firestore rule insertion anchor not found.');
  const block = `${rulesMarker}\n    match /whatsappKnowledgeRules/{ruleId} {\n      allow read: if activeStaff();\n      allow create, update: if operationsRole();\n      allow delete: if adminOrSupervisor();\n    }\n\n`;
  rules = rules.replace(anchor, `${block}${anchor}`);
  fs.writeFileSync(firestoreRulesPath, rules);
}

patchSettingsHub();
patchFirestoreRules();
console.log('WhatsApp knowledge V13 settings and Firestore rules applied.');
