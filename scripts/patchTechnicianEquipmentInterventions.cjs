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
  "\n\nconst WORK_TYPES: Array<{ type: InterventionType; label: string; description: string; templateId: string }> = [\n  { type: 'standard_service', label: 'Servicio estándar', description: 'Limpieza y revisión con la unidad instalada.', templateId: 'service_standard' },\n  { type: 'deep_service', label: 'Servicio profundo', description: 'Desmontaje o desinstalación completa para limpieza profunda.', templateId: 'service_deep' },\n  { type: 'repair', label: 'Reparación', description: 'Corrección de una falla o reemplazo de un componente.', templateId: 'repair' },\n  { type: 'installation', label: 'Instalación', description: 'Instalación, puesta en marcha y entrega del equipo.', templateId: 'installation' },\n  { type: 'diagnostic', label: 'Diagnóstico', description: 'Investigación de una falla concreta y su causa.', templateId: 'diagnostic' },\n  { type: 'checkup', label: 'Chequeo', description: 'Inspección general del estado y funcionamiento.', templateId: 'checkup' },\n];\n\nfunction workTypeLabel(type: InterventionType) {\n  return WORK_TYPES.find((item) => item.type === type)?.label ?? type;\n}\n\nfunction interventionStatusLabel(status: string) {\n  const labels: Record<string, string> = {\n    draft: 'Por iniciar',\n    in_progress: 'En proceso',\n    pending_authorization: 'Por autorizar',\n    pending_part: 'Pendiente por pieza',\n    ready_for_review: 'Listo para revisión',\n    completed: 'Completado',\n    cancelled: 'Cancelado',\n  };\n  return labels[status] ?? status.replace(/_/g, ' ');\n}",
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
  "\n  const selectedInterventions = useMemo(() => workInterventions\n    .filter((intervention) => intervention.visitUnitId === selectedUnitId)\n    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.localeCompare(b.createdAt)), [workInterventions, selectedUnitId]);\n  const primaryIntervention = selectedInterventions.find((intervention) => intervention.isPrimary);",
  'const selectedInterventions = useMemo',
);

insertAfter(
  screen,
  "  function openSearch(unitId = '') {\n    setSelectedUnitId(unitId);\n    setSelectedEquipmentId('');\n    setLookupQr('');\n    setMode('search');\n    setMessage('Escanea el sticker QR o busca el aire en la lista del cliente.');\n  }",
  "\n\n  function openEquipmentProfile(unitId: string) {\n    const unit = selectedUnits.find((candidate) => candidate.id === unitId);\n    if (!unit?.equipmentSystemId) {\n      setMessage('Este aire todavía no tiene un equipo registrado.');\n      return;\n    }\n    setSelectedUnitId(unit.id);\n    setSelectedEquipmentId(unit.equipmentSystemId);\n    setMode('profile');\n    setMessage(`${unit.locationLabel}: perfil del aire abierto.`);\n  }\n\n  async function createIntervention(type: InterventionType) {\n    if (!selectedVisit || !selectedUnit || !selectedEquipment) {\n      setMessage('Abre primero el perfil de un aire registrado.');\n      return;\n    }\n    const workType = WORK_TYPES.find((item) => item.type === type);\n    if (!workType) return;\n    if (selectedInterventions.some((intervention) => intervention.type === type && intervention.status !== 'cancelled')) {\n      setMessage(`${workType.label} ya está agregado para este aire.`);\n      return;\n    }\n\n    setWorking(true);\n    const isPrimary = !primaryIntervention;\n    const { result, intervention } = await addWorkIntervention({\n      visitId: selectedVisit.id,\n      visitUnitId: selectedUnit.id,\n      equipmentSystemId: selectedEquipment.id,\n      type,\n      templateId: workType.templateId,\n      templateVersion: 1,\n      isPrimary,\n      requestedBy: 'technician',\n    });\n    setWorking(false);\n    if (!result.ok || !intervention) {\n      setMessage(result.message ?? 'No se pudo agregar el trabajo al aire.');\n      return;\n    }\n    setMessage(isPrimary\n      ? `${workType.label} seleccionado como trabajo principal.`\n      : `${workType.label} agregado como trabajo adicional.`);\n  }",
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
  "                <View style={styles.unitOpenArea}>\n                  <Pill label=\"Registrado\" tone=\"success\" />\n                  <Text style={styles.openProfileText}>Abrir perfil ›</Text>\n                </View>",
  'Abrir perfil ›',
);

insertAfter(
  screen,
  "      ) : null}\n\n      {selectedVisit && mode === 'add' ? (",
  "\n      {selectedVisit && selectedUnit && selectedEquipment && mode === 'profile' ? (\n        <Card>\n          <SectionTitle\n            title={selectedEquipment.locationLabel}\n            subtitle={equipmentSummary(selectedEquipment)}\n            action={<Button compact label=\"Volver\" variant=\"ghost\" onPress={() => setMode('list')} />}\n          />\n\n          <View style={styles.profileIdentity}>\n            <View style={{ flex: 1 }}>\n              <Text style={styles.profileSystem}>{selectedEquipment.systemType}</Text>\n              <Text style={styles.profileMeta}>{selectedEquipment.qrCode ? `QR ${shortEquipmentQrCode(selectedEquipment.qrCode)}` : 'Sin QR vinculado'}</Text>\n              <Text style={styles.profileMeta}>Estado del aire en esta visita: {selectedUnit.status.replace(/_/g, ' ')}</Text>\n            </View>\n            <Pill label=\"Equipo registrado\" tone=\"success\" />\n          </View>\n\n          <View style={styles.scopeComparison}>\n            <View style={styles.scopeBlock}>\n              <Text style={styles.scopeLabel}>PROGRAMADO POR LA OFICINA</Text>\n              <Text style={styles.scopeValue}>{selectedVisit.scheduledScopeSnapshot.serviceName ?? 'Trabajo por confirmar'}</Text>\n              <Text style={styles.scopeMeta}>{selectedVisit.scheduledScopeSnapshot.estimatedUnitCount} aire{selectedVisit.scheduledScopeSnapshot.estimatedUnitCount === 1 ? '' : 's'} estimado{selectedVisit.scheduledScopeSnapshot.estimatedUnitCount === 1 ? '' : 's'}</Text>\n            </View>\n            <View style={styles.scopeBlock}>\n              <Text style={styles.scopeLabel}>TRABAJO REAL EN ESTE AIRE</Text>\n              <Text style={styles.scopeValue}>{primaryIntervention ? workTypeLabel(primaryIntervention.type) : 'Aún no seleccionado'}</Text>\n              <Text style={styles.scopeMeta}>{selectedInterventions.length} intervención{selectedInterventions.length === 1 ? '' : 'es'} registrada{selectedInterventions.length === 1 ? '' : 's'}</Text>\n            </View>\n          </View>\n\n          {selectedInterventions.length ? (\n            <View style={styles.interventionList}>\n              <Text style={styles.profileSectionTitle}>Trabajos registrados</Text>\n              {selectedInterventions.map((intervention) => (\n                <View key={intervention.id} style={[styles.interventionCard, intervention.isPrimary && styles.primaryInterventionCard]}>\n                  <View style={{ flex: 1 }}>\n                    <Text style={styles.interventionRole}>{intervention.isPrimary ? 'TRABAJO PRINCIPAL' : 'TRABAJO ADICIONAL'}</Text>\n                    <Text style={styles.interventionName}>{workTypeLabel(intervention.type)}</Text>\n                    <Text style={styles.interventionMeta}>Plantilla {intervention.templateId} v{intervention.templateVersion}</Text>\n                  </View>\n                  <Pill label={interventionStatusLabel(intervention.status)} tone={intervention.status === 'completed' ? 'success' : 'info'} />\n                </View>\n              ))}\n            </View>\n          ) : (\n            <View style={styles.noInterventionBox}>\n              <Text style={styles.profileSectionTitle}>¿Qué trabajo se realizará en este aire?</Text>\n              <Text style={styles.profileHelp}>La primera opción seleccionada se guardará como trabajo principal.</Text>\n            </View>\n          )}\n\n          <Text style={styles.profileSectionTitle}>{primaryIntervention ? 'Agregar otro trabajo' : 'Seleccionar trabajo principal'}</Text>\n          <View style={styles.workTypeGrid}>\n            {WORK_TYPES.map((workType) => {\n              const alreadyAdded = selectedInterventions.some((intervention) => intervention.type === workType.type && intervention.status !== 'cancelled');\n              return (\n                <Pressable\n                  key={workType.type}\n                  disabled={working || alreadyAdded}\n                  onPress={() => void createIntervention(workType.type)}\n                  style={({ pressed }) => [styles.workTypeCard, alreadyAdded && styles.workTypeCardDisabled, pressed && !alreadyAdded && styles.workTypeCardPressed]}\n                >\n                  <Text style={styles.workTypeName}>{alreadyAdded ? '✓ ' : ''}{workType.label}</Text>\n                  <Text style={styles.workTypeDescription}>{alreadyAdded ? 'Ya agregado a este aire.' : workType.description}</Text>\n                </Pressable>\n              );\n            })}\n          </View>\n\n          {selectedInterventions.length ? (\n            <View style={styles.nextModuleBox}>\n              <Text style={styles.nextModuleTitle}>Siguiente etapa del reporte</Text>\n              <Text style={styles.nextModuleText}>La plantilla técnica correspondiente se abrirá desde este perfil en el próximo módulo: Indoor, Outdoor, mediciones, fotografías, hallazgos y resultado final.</Text>\n            </View>\n          ) : null}\n        </Card>\n      ) : null}\n\n      {selectedVisit && mode === 'add' ? (",
  'Siguiente etapa del reporte',
);

replaceOnce(
  screen,
  "  rowMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },\n  mainActions:",
  "  rowMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },\n  unitOpenArea: { alignItems: 'flex-end', gap: 5 },\n  openProfileText: { color: colors.primary, fontSize: 9, fontWeight: '900' },\n  profileIdentity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, backgroundColor: '#F7F9FC', borderRadius: 13, padding: 14 },\n  profileSystem: { color: colors.text, fontSize: 15, fontWeight: '900' },\n  profileMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },\n  scopeComparison: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 13 },\n  scopeBlock: { flex: 1, minWidth: 220, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, backgroundColor: '#FFFFFF' },\n  scopeLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },\n  scopeValue: { color: colors.text, fontSize: 14, fontWeight: '900', marginTop: 5 },\n  scopeMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },\n  profileSectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 15, marginBottom: 8 },\n  profileHelp: { color: colors.muted, fontSize: 10, lineHeight: 16 },\n  noInterventionBox: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 13, marginTop: 13 },\n  interventionList: { marginTop: 2 },\n  interventionCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, marginBottom: 8, backgroundColor: '#FFFFFF' },\n  primaryInterventionCard: { borderColor: colors.primary, backgroundColor: '#F7FAFF' },\n  interventionRole: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },\n  interventionName: { color: colors.text, fontSize: 14, fontWeight: '900', marginTop: 4 },\n  interventionMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },\n  workTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },\n  workTypeCard: { width: '48%', minWidth: 230, flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 14, backgroundColor: '#FFFFFF' },\n  workTypeCardDisabled: { opacity: 0.52, backgroundColor: '#F4F6F8' },\n  workTypeCardPressed: { borderColor: colors.primary, backgroundColor: colors.primaryLight },\n  workTypeName: { color: colors.text, fontSize: 13, fontWeight: '900' },\n  workTypeDescription: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 5 },\n  nextModuleBox: { backgroundColor: '#F3F7F3', borderRadius: 12, padding: 13, marginTop: 15 },\n  nextModuleTitle: { color: '#30643B', fontWeight: '900' },\n  nextModuleText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },\n  mainActions:",
  'unitOpenArea:',
);

console.log('Technician equipment intervention patch applied.');
