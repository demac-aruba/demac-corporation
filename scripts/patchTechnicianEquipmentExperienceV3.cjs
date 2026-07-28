const { read, write, replaceOnce, insertAfter, replaceRange } = require('./serviceFlowPatchUtils.cjs');

// ---------------------------------------------------------------------------
// Equipment profile: one explicit work choice at a time, compact grid, and
// add-on panel. Existing reports remain independently accessible.
// ---------------------------------------------------------------------------
const profileFile = 'src/screens/TechnicianEquipmentProfileScreen.tsx';
replaceOnce(
  profileFile,
  "import { ScrollView, StyleSheet, Text, View } from 'react-native';",
  "import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';",
  'Pressable, ScrollView, StyleSheet',
);
insertAfter(
  profileFile,
  "import { Button, Card, EmptyState, Pill, SectionTitle } from '../components/UI';",
  "\nimport { TechnicianAddOnsPanel } from '../components/TechnicianAddOnsPanel';",
  "TechnicianAddOnsPanel } from '../components/TechnicianAddOnsPanel'",
);
replaceOnce(profileFile, "  templateId: string;\n};", "  templateId: string;\n  templateVersion: number;\n  icon: string;\n};", 'templateVersion: number;\n  icon: string;');
replaceOnce(profileFile, "    templateId: 'service_standard',", "    templateId: 'service_standard',\n    templateVersion: 2,\n    icon: '✦',", "templateVersion: 2,\n    icon: '✦'");
for (const [templateId, icon] of [['service_deep', '✧'], ['repair', '🔧'], ['installation', '＋'], ['diagnostic', '⌕'], ['checkup', '✓']]) {
  replaceOnce(profileFile, `    templateId: '${templateId}',`, `    templateId: '${templateId}',\n    templateVersion: 1,\n    icon: '${icon}',`, `templateId: '${templateId}',\n    templateVersion: 1`);
}
replaceOnce(
  profileFile,
  "    workInterventions,\n    equipmentSystems,",
  "    workInterventions,\n    workReportSections,\n    equipmentSystems,",
  '    workReportSections,\n    equipmentSystems,',
);
insertAfter(profileFile, "  const [pendingRemovalId, setPendingRemovalId] = useState('');", "\n  const [addingAnother, setAddingAnother] = useState(false);", 'const [addingAnother, setAddingAnother]');
insertAfter(
  profileFile,
  "  const newWorkLocked = isUnitLockedForNewWork(unit, visit, workInterventions) || workOrder?.status === 'Completada';",
  "\n  const primaryReportStarted = primaryIntervention ? workReportSections.some((section) => section.interventionId === primaryIntervention.id) : false;\n  const canReplacePrimaryDraft = Boolean(primaryIntervention && primaryIntervention.status === 'draft' && !primaryReportStarted);",
  'const canReplacePrimaryDraft =',
);
replaceRange(
  profileFile,
  '  async function createIntervention(definition: WorkTypeDefinition) {',
  '  async function removeIntervention(intervention: WorkIntervention) {',
  `  async function createIntervention(definition: WorkTypeDefinition) {
    if (newWorkLocked) {
      setMessage('Este aire ya fue terminado o enviado a revisión. No se pueden agregar trabajos nuevos a una orden cerrada.');
      return;
    }
    if (!visit || !unit || !equipment || !currentUser) {
      setMessage('No se encontró la visita, el equipo o el usuario activo.');
      return;
    }

    const duplicate = interventions.some((item) => item.type === definition.type && item.id !== primaryIntervention?.id);
    if (duplicate) {
      setMessage(definition.label + ' ya está registrado como una intervención independiente para este aire.');
      return;
    }

    setWorking(true);
    if (canReplacePrimaryDraft && primaryIntervention && !addingAnother) {
      const now = new Date().toISOString();
      const result = await saveWorkIntervention({
        ...primaryIntervention,
        type: definition.type,
        templateId: definition.templateId,
        templateVersion: definition.templateVersion,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? primaryIntervention.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(primaryIntervention.version ?? 1)) + 1,
      });
      setWorking(false);
      setAddingAnother(false);
      setMessage(result.ok ? definition.label + ' reemplazó la selección anterior. La intervención continúa por iniciar.' : result.message ?? 'No se pudo cambiar el trabajo.');
      return;
    }

    const isPrimary = !primaryIntervention;
    const { result } = await addWorkIntervention({
      visitId: visit.id,
      visitUnitId: unit.id,
      equipmentSystemId: equipment.id,
      type: definition.type,
      templateId: definition.templateId,
      templateVersion: definition.templateVersion,
      isPrimary,
      requestedBy: 'technician',
    });
    setWorking(false);
    setAddingAnother(false);
    setMessage(result.ok
      ? definition.label + ' registrado como ' + (isPrimary ? 'trabajo principal' : 'otra intervención independiente') + '.'
      : result.message ?? 'No se pudo guardar el trabajo.');
  }

`,
  'otra intervención independiente',
);
replaceRange(
  profileFile,
  '        {newWorkLocked ? (',
  '      </Card>\n\n      <View style={styles.messageBox}>',
  `        {newWorkLocked ? (
          <View style={styles.closedWorkBox}>
            <Text style={styles.closedWorkTitle}>TRABAJO CERRADO</Text>
            <Text style={styles.closedWorkText}>Este aire ya fue terminado o enviado a revisión. Puedes consultar los reportes existentes, pero el alcance no puede modificarse.</Text>
          </View>
        ) : (!primaryIntervention || addingAnother || canReplacePrimaryDraft) ? (
          <>
            <View style={styles.selectionHeading}>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectionTitle}>{addingAnother ? 'Registrar otro trabajo' : canReplacePrimaryDraft ? 'Confirmar o cambiar trabajo' : 'Seleccionar trabajo principal'}</Text>
                <Text style={styles.selectionHelp}>Una intervención contiene un solo tipo de trabajo. Al tocar una opción se guarda y se cierra esta selección.</Text>
              </View>
              {addingAnother ? <Button compact variant="ghost" label="Cancelar" onPress={() => setAddingAnother(false)} /> : null}
            </View>
            <View style={styles.workTypeGrid}>
              {WORK_TYPES.map((definition) => {
                const selected = primaryIntervention?.type === definition.type && canReplacePrimaryDraft && !addingAnother;
                const alreadyRegistered = addingAnother && interventions.some((item) => item.type === definition.type);
                return (
                  <Pressable
                    key={definition.type}
                    disabled={working || alreadyRegistered}
                    onPress={() => void createIntervention(definition)}
                    style={[styles.workTypeCard, selected && styles.workTypeSelected, alreadyRegistered && styles.workTypeDisabled]}
                  >
                    <Text style={styles.workTypeIcon}>{selected ? '✓' : definition.icon}</Text>
                    <Text style={[styles.workTypeName, selected && styles.workTypeNameSelected]}>{definition.label}</Text>
                    <Text style={styles.workTypeAction}>{alreadyRegistered ? 'Ya registrado' : selected ? 'Seleccionado · tocar para confirmar' : working ? 'Guardando…' : 'Seleccionar'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.addAnotherBox}>
            <Text style={styles.addAnotherTitle}>¿Se realizará otro trabajo diferente?</Text>
            <Text style={styles.addAnotherText}>El trabajo adicional se registrará como una intervención independiente con su propio reporte, estado y fotografías.</Text>
            <Button compact variant="secondary" label="Agregar otro trabajo" onPress={() => setAddingAnother(true)} />
          </View>
        )}
`,
  'addAnotherBox:',
);
replaceOnce(
  profileFile,
  "      </Card>\n\n      <View style={styles.messageBox}>",
  "      </Card>\n\n      <TechnicianAddOnsPanel visit={visit} unit={unit} interventions={interventions} disabled={newWorkLocked} />\n\n      <View style={styles.messageBox}>",
  '<TechnicianAddOnsPanel visit={visit}',
);
replaceOnce(
  profileFile,
  "  selectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 12, marginBottom: 9 },\n  workTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },\n  workTypeCard: { width: '48%', minWidth: 230, flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 13, gap: 8, backgroundColor: '#FFFFFF' },\n  workTypeDisabled: { opacity: 0.55, backgroundColor: '#F4F6F8' },\n  workTypeName: { color: colors.text, fontSize: 13, fontWeight: '900' },\n  workTypeDescription: { color: colors.muted, fontSize: 9, lineHeight: 14, minHeight: 28 },",
  "  selectionHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, marginBottom: 9 },\n  selectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },\n  selectionHelp: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 4 },\n  workTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },\n  workTypeCard: { width: '47%', minWidth: 135, flexGrow: 1, minHeight: 122, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },\n  workTypeSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },\n  workTypeDisabled: { opacity: 0.48, backgroundColor: '#F4F6F8' },\n  workTypeIcon: { fontSize: 23, marginBottom: 8 },\n  workTypeName: { color: colors.text, fontSize: 11, fontWeight: '900', textAlign: 'center' },\n  workTypeNameSelected: { color: colors.primaryDark },\n  workTypeAction: { color: colors.muted, fontSize: 8, fontWeight: '800', textAlign: 'center', marginTop: 6 },\n  addAnotherBox: { backgroundColor: '#F6F8FA', borderRadius: 12, padding: 12, marginTop: 11, gap: 7 },\n  addAnotherTitle: { color: colors.text, fontSize: 11, fontWeight: '900' },\n  addAnotherText: { color: colors.muted, fontSize: 9, lineHeight: 15 },",
  'workTypeSelected:',
);

// ---------------------------------------------------------------------------
// Remove the duplicate Manage equipment entry point from the technician home.
// ---------------------------------------------------------------------------
const technicianHomeFile = 'src/screens/TechnicianScreen.tsx';
{
  let text = read(technicianHomeFile);
  if (!text.includes('TECHNICIAN_REDUNDANT_EQUIPMENT_ENTRY_REMOVED')) {
    const startMarker = '              <View style={styles.equipmentPortalBox}>';
    const endMarker = '              <View style={styles.serviceStartBox}>';
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start);
    if (start >= 0 && end > start) {
      text = `${text.slice(0, start)}              {/* TECHNICIAN_REDUNDANT_EQUIPMENT_ENTRY_REMOVED */}\n${text.slice(end)}`;
      write(technicianHomeFile, text);
    } else if (!text.includes('SERVICIO EN ESTA VISITA')) {
      throw new Error('The technician service entry blocks could not be located.');
    }
  }
}

console.log('patchTechnicianEquipmentExperienceV3.cjs applied.');
