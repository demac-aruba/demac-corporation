const fs = require('fs');

function replaceOptional(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) {
    console.warn(`Optional equipment profile patch block not found in ${path}: ${marker}`);
    return;
  }
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

const screen = 'src/screens/TechnicianPortalEquipmentTestScreen.tsx';

replaceOptional(
  screen,
  "                onPress={() => setSelectedUnitId(unit.id)}",
  "                onPress={() => {\n                  const locationApi = (globalThis as any).location;\n                  if (!locationApi || !selectedVisit) return;\n                  const returnParameter = returnToTechnician ? '&returnTo=technician' : '';\n                  locationApi.assign(`${locationApi.pathname}?technicianPortalIntervention=1&visitId=${encodeURIComponent(selectedVisit.id)}&unitId=${encodeURIComponent(unit.id)}${returnParameter}`);\n                }}",
  'technicianPortalIntervention=1&visitId=',
);

replaceOptional(
  screen,
  "                <Pill label=\"Registrado\" tone=\"success\" />",
  "                <View style={{ alignItems: 'flex-end', gap: 5 }}>\n                  <Pill label=\"Registrado\" tone=\"success\" />\n                  <Text style={{ color: colors.primary, fontSize: 9, fontWeight: '900' }}>Abrir perfil ›</Text>\n                </View>",
  'Abrir perfil ›',
);

console.log('Technician equipment profile links applied.');
