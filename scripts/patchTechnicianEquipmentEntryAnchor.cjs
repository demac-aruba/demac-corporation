const fs = require('fs');

const file = 'src/screens/TechnicianScreen.tsx';
let text = fs.readFileSync(file, 'utf8');
const marker = 'AIRES ACONDICIONADOS DEL CLIENTE';

if (!text.includes(marker)) {
  const unitStart = '              {unit ? <View style={styles.unitBox}>';
  const start = text.indexOf(unitStart);
  if (start < 0) throw new Error('Technician equipment entry unit anchor was not found.');
  const lineEnd = text.indexOf('\n', start);
  if (lineEnd < 0) throw new Error('Technician equipment entry unit line ending was not found.');

  const insertion = `

              <View style={styles.equipmentPortalBox}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.equipmentPortalTitle}>AIRES ACONDICIONADOS DEL CLIENTE</Text>
                  <Text style={styles.equipmentPortalText}>Escanea, busca o registra los equipos reales que serán atendidos en esta visita.</Text>
                </View>
                <Button compact icon="❄" label="Gestionar aires" onPress={() => {
                  const locationApi = (globalThis as any).location;
                  if (!locationApi) return;
                  locationApi.assign(\`${'${locationApi.pathname}'}?technicianPortalEquipment=1&workOrderId=${'${encodeURIComponent(selected.id)}'}&returnTo=technician\`);
                }} />
              </View>`;

  text = `${text.slice(0, lineEnd)}${insertion}${text.slice(lineEnd)}`;
  fs.writeFileSync(file, text);
}

console.log('Technician equipment entry anchor prepared.');
