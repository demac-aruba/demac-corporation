const fs = require('fs');

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required simplified technician home anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

function replaceRange(path, startMarker, endMarker, replacement, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Required simplified technician home range not found in ${path}: ${marker}`);
  text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  fs.writeFileSync(path, text);
}

const technicianFile = 'src/screens/TechnicianScreen.tsx';

insertAfter(
  technicianFile,
  "  const selectedIsClosed = selected?.status === 'Completada' || selectedPortalVisit?.status === 'ready_for_office_review' || selectedPortalVisit?.status === 'completed';",
  `
  const selectedRegisteredUnits = selectedPortalVisit ? registeredUnitsForVisit(selectedPortalVisit.id, portalUnits) : [];
  const selectedInterventions = selectedPortalVisit
    ? portalInterventions.filter((item) => item.visitId === selectedPortalVisit.id && item.status !== 'cancelled')
    : [];
  const selectedNeedsCorrection = selectedInterventions.some((item) => item.status === 'changes_requested');
  const selectedHasStarted = selectedRegisteredUnits.length > 0
    || selectedInterventions.length > 0
    || selected?.status === 'En proceso'
    || selected?.status === 'Pendiente';
  const serviceActionLabel = selectedNeedsCorrection
    ? 'Corregir reporte'
    : selectedIsClosed
      ? 'Ver servicio terminado'
      : selectedHasStarted
        ? 'Continuar servicio'
        : 'Iniciar servicio';
  const serviceActionDescription = selectedNeedsCorrection
    ? 'La oficina solicitó una corrección. Abre el servicio existente, corrige el reporte y vuelve a enviarlo.'
    : selectedIsClosed
      ? 'El trabajo está cerrado. Puedes consultar los aires atendidos y los reportes enviados.'
      : selectedHasStarted
        ? 'Continúa con el aire registrado, el trabajo seleccionado y las secciones pendientes del reporte.'
        : 'Este es el punto de partida: registra o busca el aire, selecciona el trabajo real y completa su reporte.';`,
  'const serviceActionLabel = selectedNeedsCorrection',
);

insertAfter(
  technicianFile,
  "  const displayedPhotos = [\n    ...(selected?.photos ?? []).map((downloadUrl, index) => ({ id: `legacy-${index}`, downloadUrl, label: 'Evidencia anterior' })),\n    ...selectedEvidence,\n  ];",
  `

  async function openServiceFlow() {
    if (!selected) return;
    if (!selectedIsClosed && !selectedNeedsCorrection && !selectedHasStarted && selected.status !== 'En proceso') {
      await statusChange('En proceso', 'Servicio iniciado desde el flujo principal por aire acondicionado.');
    }
    const locationApi = (globalThis as any).location;
    if (!locationApi) return;
    locationApi.assign(\`${'${locationApi.pathname}'}?technicianPortalEquipment=1&workOrderId=${'${encodeURIComponent(selected.id)}'}&returnTo=technician\`);
  }`,
  'Servicio iniciado desde el flujo principal por aire acondicionado.',
);

replaceRange(
  technicianFile,
  '              <View style={styles.equipmentPortalBox}>',
  '          </View>\n        ) : null}\n      </View>\n    </ScrollView>',
  `              <View style={styles.serviceStartBox}>
                <View style={styles.serviceStartHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.serviceStartEyebrow}>SERVICIO EN ESTA VISITA</Text>
                    <Text style={styles.serviceStartTitle}>{serviceActionLabel}</Text>
                  </View>
                  <Pill
                    label={selectedNeedsCorrection ? 'Corrección pendiente' : selectedIsClosed ? 'Terminado' : selectedHasStarted ? 'En proceso' : 'Listo para iniciar'}
                    tone={selectedNeedsCorrection ? 'warning' : selectedIsClosed ? 'success' : selectedHasStarted ? 'info' : 'neutral'}
                  />
                </View>
                <Text style={styles.serviceStartText}>{serviceActionDescription}</Text>
                <Button
                  icon="❄"
                  variant={selectedIsClosed ? 'secondary' : 'success'}
                  label={working ? 'Abriendo servicio…' : serviceActionLabel}
                  disabled={working}
                  onPress={() => void openServiceFlow()}
                />
              </View>
            </Card>

            {formMessage ? <View style={styles.messageBox}><Text style={styles.messageText}>{formMessage}</Text></View> : null}
`,
  'SERVICIO EN ESTA VISITA',
);

insertAfter(
  technicianFile,
  "  equipmentPortalText: { color: colors.text, marginTop: 5, fontSize: 10, lineHeight: 15 },",
  `
  serviceStartBox: { backgroundColor: '#F1F8F2', borderWidth: 1, borderColor: '#B7DDBB', borderRadius: 14, padding: 15, marginTop: 13, gap: 11 },
  serviceStartHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  serviceStartEyebrow: { color: '#2F6A3B', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  serviceStartTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: 4 },
  serviceStartText: { color: colors.text, fontSize: 10, lineHeight: 16 },`,
  'serviceStartBox:',
);

console.log('Simplified technician work home patch applied.');
