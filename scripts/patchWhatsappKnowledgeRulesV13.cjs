const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'firestore.rules');
const marker = '// WHATSAPP_KNOWLEDGE_RULES_V13';
const anchor = '    match /warehouseInventory/{itemId} {';
const rules = fs.readFileSync(target, 'utf8');

if (rules.includes(marker)) {
  console.log('WhatsApp knowledge rule permissions already applied.');
  process.exit(0);
}
if (!rules.includes(anchor)) throw new Error('Could not find the Firestore insertion anchor.');

const block = `${marker}\n    match /whatsappKnowledgeRules/{ruleId} {\n      allow read: if activeStaff();\n      allow create, update: if operationsRole();\n      allow delete: if adminOrSupervisor();\n    }\n\n`;
fs.writeFileSync(target, rules.replace(anchor, `${block}${anchor}`));
console.log('WhatsApp knowledge rule permissions applied to firestore.rules.');
