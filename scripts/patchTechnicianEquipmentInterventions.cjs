const fs = require('fs');

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Required intervention patch block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required intervention patch anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

const screen = 'src/screens/TechnicianPortalEquipmentTestScreen.tsx';

replaceOnce(
  screen,
  "import { EquipmentComponent } from '../features/technicianPortal/contracts';",
  "import { EquipmentComponent, InterventionType } from '../features/technicianPortal/contracts';",
  'EquipmentComponent, InterventionType',
);

insertAfter(
  screen,
  "const LOCATION_SUGGESTIONS = [\n  'Cuarto principal',\n  'Sala',\n  'Cocina',\n  'Comedor',\n  'Segundo cuarto',\n  'Tercer cuarto',\n  'Cuarto de huéspedes',\n  'Oficina',\n  'Laundry',\n  'Garage',\n  'Pasillo',\n  'Apartamento',\n];",
  "\n\nconst WORK_TYPES: Array<{ type: InterventionType; label: string; templateId: string }> = [\n  { type: 'standard_service', label: 'Servicio estándar', templateId: 'service_standard' },\n  { type: 'deep_service', label: 'Servicio profundo', templateId: 'service_deep' },\n  { type: 'repair', label: 'Reparación', templateId: 'repair' },\n  { type: 'installation', label: 'Instalación', templateId: 'installation' },\n  { type: 'diagnostic', label: 'Diagnóstico', templateId: 'diagnostic' },\n  { type: 'checkup', label: 'Chequeo', templateId: 'checkup' },\n];\n\nfunction workTypeLabel(type: InterventionType) {\n  return WORK_TYPES.find((item) => item.type === type)?.label ?? type;\n}",
  'const WORK_TYPES:',
);

replaceOnce(
  screen,
  "type PanelMode = 'list' | 'add' | 'search';",
  "type PanelMode = 'list' | 'add' | 'search' | 'profile';",
  "'search' | 'profile'",
);

replaceOnce(
  screen,
  "    workVisits,\n    visitUnits,\n    equipmentSystems,",
  "    workVisits,\n    visitUnits,\n    workInterventions,\n    equipmentSystems,",
  '    workInterventions,\n    equipmentSystems,',
);
replaceOnce(
  screen,
  "    addVisitUnit,\n  } = useTechnicianPortalState();",
  "    addVisitUnit,\n    addWorkIntervention,\n  } = useTechnicianPortalState();",
  '    addWorkIntervention,',
);

insertAfter(
  screen,
  "  const selectedEquipment = equipmentSystems.find((equipment) => equipment.id === selectedEquipmentId);",
  "\n  const selectedInterventions = workInterventions.filter((intervention) => intervention.visitUnitId === selectedUnitId);\n  const primaryIntervention = selectedInterventions.find((intervention) => intervention.isPrimary);",
  'const selectedInterventions = workInterventions.filter',
);

insertAfter(
  screen,
  "  function openSearch(unitId = '') {\n    setSelectedUnitId(unitId);\n    setSelectedEquipmentId('');\n    setLookupQr('');\n    setMode('search');\n    setMessage('Escanea el sticker QR o busca el aire en la lista del cliente.');\n  }",
  "\n\n  function openEquipmentProfile(unitId: string) {\n    const unit = selectedUnits.find((candidate) => candidate.id === unitId);\n    if (!unit?.equipmentSystemId) return;\n    setSelectedUnitId(unit.id);\n    setSelectedEquipmentId(unit.equipmentSystemId);\n    setMode('profile');\n    setMessage(`${unit.locationLabel}: perfil del aire abierto.`);\n  }\n\n  async function createIntervention(type: InterventionType) {\n    if (!selectedVisit || !selectedUnit || !selectedEquipment) return;\n    const definition = WORK_TYPES.find((item) => item.type === type);\n    if (!definition) return;\n    if (selectedInterventions.some((item) => item.type === type && item.status !== 'cancelled')) {\n      setMessage(`${definition.label} ya está agregado para este aire.`);\n      return;\n    }\n    setWorking(true);\n    const isPrimary = !primaryIntervention;\n    const { result } = await addWorkIntervention({\n      visitId: selectedVisit.id,\n      visitUnitId: selectedUnit.id,\n      equipmentSystemId: selectedEquipment.id,\n      type,\n      templateId: definition.templateId,\n      templateVersion: 1,\n      isPrimary,\n      requestedBy: 'technician',\n    });\n    setWorking(false);\n    setMessage(result.ok\n      ? `${definition.label} ${isPrimary ? 'seleccionado como trabajo principal' : 'agregado como trabajo adicional'}.`\n      : result.message ?? 'No se pudo guardar el trabajo.');\n  }",
  'async function createIntervention(type: InterventionType)',
);

replaceOnce(
  screen,
  "      setMode('list');\n      resetForm();\n      setMessage(equipment.qrCode",
  "      setMode('profile');\n      resetForm();\n      setMessage(equipment.qrCode",
  "setMode('profile');\n      resetForm();",
);

replaceOnce(
  screen,
  "                onPress={() => setSelectedUnitId(unit.id)}",
  "                onPress={() => openEquipmentProfile(unit.id)}",
  'onPress={() => openEquipmentProfile(unit.id)}',
);

replaceOnce(
  screen,
  "                <Pill label=\"Registrado\" tone=\"success\" />",
  "                <View style={styles.profileLink}>\n                  <Pill label=\"Registrado\" tone=\"success\" />\n                  <Text style={styles.profileLinkText}>Abrir perfil ›</Text>\n                </View>",
  'Abrir perfil ›',
);

replaceOnce(
  screen,
  "      ) : null}\n\n      {selectedVisit && mode === 'add' ? (",
  "      ) : null}\n\n      {selectedVisit && selectedUnit && selectedEquipment && mode === 'profile' ? (\n        <Card>\n          <SectionTitle\n            title={selectedEquipment.locationLabel}\n            subtitle={equipmentSummary(selectedEquipment)}\n            action={<Button compact label=\"Volver\" variant=\"ghost\" onPress={() => setMode('list')} />}\n          />\n          <View style={styles.profileSummaryBox}>\n            <Text style={styles.profileSummaryLabel}>EQUIPO</Text>\n            <Text style={styles.profileSummaryValue}>{selectedEquipment.systemType} · {selectedEquipment.qrCode ? `QR ${shortEquipmentQrCode(selectedEquipment.qrCode)}` : 'Sin QR vinculado'}</Text>\n            <Text style={styles.profileSummaryLabel}>PROGRAMADO POR LA OFICINA</Text>\n            <Text style={styles.profileSummaryValue}>{selectedVisit.scheduledScopeSnapshot.serviceName ?? 'Trabajo por confirmar'} · {selectedVisit.scheduledScopeSnapshot.estimatedUnitCount} aire(s)</Text>\n            <Text style={styles.profileSummaryLabel}>TRABAJO REAL EN ESTE AIRE</Text>\n            <Text style={styles.profileSummaryValue}>{primaryIntervention ? workTypeLabel(primaryIntervention.type) : 'Aún no seleccionado'}</Text>\n          </View>\n\n          {selectedInterventions.length ? (\n            <View>\n              <Text style={styles.profileSectionTitle}>Trabajos registrados</Text>\n              {selectedInterventions.map((intervention) => (\n                <View key={intervention.id} style={styles.interventionRow}>\n                  <View style={{ flex: 1 }}>\n                    <Text style={styles.interventionType}>{intervention.isPrimary ? 'Trabajo principal' : 'Trabajo adicional'}</Text>\n                    <Text style={styles.interventionName}>{workTypeLabel(intervention.type)}</Text>\n                  </View>\n                  <Pill label={intervention.status === 'draft' ? 'Por iniciar' : intervention.status.replace(/_/g, ' ')} tone=\"info\" />\n                </View>\n              ))}\n            </View>\n          ) : null}\n\n          <Text style={styles.profileSectionTitle}>{primaryIntervention ? 'Agregar otro trabajo' : '¿Qué trabajo se realizará?'}</Text>\n          <View style={styles.suggestionRow}>\n            {WORK_TYPES.map((workType) => {\n              const alreadyAdded = selectedInterventions.some((item) => item.type === workType.type && item.status !== 'cancelled');\n              return <Button key={workType.type} compact label={alreadyAdded ? `✓ ${workType.label}` : workType.label} variant={alreadyAdded ? 'secondary' : 'primary'} disabled={working || alreadyAdded} onPress={() => void createIntervention(workType.type)} />;\n            })}\n          </View>\n          {selectedInterventions.length ? <Text style={styles.profileHelp}>La plantilla del reporte técnico se habilitará desde este perfil en el siguiente módulo.</Text> : null}\n        </Card>\n      ) : null}\n\n      {selectedVisit && mode === 'add' ? (",
  'La plantilla del reporte técnico se habilitará',
);

replaceOnce(
  screen,
  "  rowMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },\n  mainActions:",
  "  rowMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },\n  profileLink: { alignItems: 'flex-end', gap: 5 },\n  profileLinkText: { color: colors.primary, fontSize: 9, fontWeight: '900' },\n  profileSummaryBox: { backgroundColor: '#F7F9FC', borderRadius: 12, padding: 13, gap: 4 },\n  profileSummaryLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7, marginTop: 5 },\n  profileSummaryValue: { color: colors.text, fontSize: 12, fontWeight: '800' },\n  profileSectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 15, marginBottom: 8 },\n  interventionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 8 },\n  interventionType: { color: colors.primary, fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },\n  interventionName: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 4 },\n  profileHelp: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 10 },\n  mainActions:",
  'profileSummaryBox:',
);

console.log('Technician equipment intervention patch applied.');
