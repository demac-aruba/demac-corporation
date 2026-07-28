const fs = require('fs');

const path = 'src/screens/TechnicianPortalEquipmentTestScreen.tsx';
let text = fs.readFileSync(path, 'utf8');
const expandedAnchor = `  async function attachExistingEquipment(equipment: RegisteredEquipmentSystem) {
    if (!selectedVisit || !selectedOrder) {
      setMessage('Selecciona una visita preparada.');
      return;
    }`;
const normalizedAnchor = `  async function attachExistingEquipment(equipment: RegisteredEquipmentSystem) {
    if (!selectedVisit || !selectedOrder) return;`;
if (text.includes(expandedAnchor)) {
  text = text.replace(expandedAnchor, normalizedAnchor);
}
text = text.replace(
  "  mainActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 13 },",
  "  mainActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },",
);
fs.writeFileSync(path, text);

console.log('Technician closure anchors normalized.');
