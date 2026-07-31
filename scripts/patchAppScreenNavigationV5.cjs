const fs = require('fs');

const marker = 'APP_SCREEN_NAVIGATION_V5';
const targetFiles = [
  'src/components/UI.tsx',
  'src/screens/TechnicianPortalEquipmentTestScreen.tsx',
  'src/screens/TechnicianEquipmentProfileScreen.tsx',
  'src/screens/ClientsScreen.tsx',
  'src/screens/WorkOrdersScreen.tsx',
  'src/screens/AgendaScreen.tsx',
  'src/screens/TeamScreen.tsx',
];

const marked = targetFiles.filter((file) => fs.readFileSync(file, 'utf8').includes(marker));
if (marked.length === targetFiles.length) {
  console.log('patchAppScreenNavigationV5.cjs already applied.');
  process.exit(0);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Could not find ${label}.`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`Found more than one ${label}.`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function update(file, transform) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) return;
  const next = transform(source);
  if (next === source) throw new Error(`No changes produced for ${file}.`);
  fs.writeFileSync(file, next);
}

update('src/components/UI.tsx', (source) => {
  source = replaceOnce(
    source,
    `    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>`,
    `    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screenLayer}>
        <View style={styles.screenHeader}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.screenBackButton}>
            <Text style={styles.screenBackText}>‹ Volver</Text>
          </Pressable>
          <Text numberOfLines={2} style={styles.screenTitle}>{title}</Text>
          <View style={styles.screenHeaderSpacer} />
        </View>
        <View style={styles.screenBody}>{children}</View>
      </View>
    </Modal>`,
    'centered AppModal',
  );
  return replaceOnce(
    source,
    `  modalBackdrop: { flex: 1, backgroundColor: 'rgba(32,33,36,0.46)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { width: '100%', maxWidth: 620, maxHeight: '92%', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 19 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  modalTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '800' },
  closeButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0F2F4', alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { fontSize: 23, lineHeight: 24, color: colors.text },`,
    `  // ${marker}: action forms are dedicated app screens, never centered popups.
  screenLayer: { flex: 1, backgroundColor: colors.background },
  screenHeader: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  screenBackButton: { minWidth: 82, minHeight: 42, alignItems: 'flex-start', justifyContent: 'center' },
  screenBackText: { color: colors.info, fontSize: 14, fontWeight: '800' },
  screenTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  screenHeaderSpacer: { width: 82 },
  screenBody: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: 16, overflow: 'hidden' },`,
    'AppModal styles',
  );
});

update('src/screens/TechnicianPortalEquipmentTestScreen.tsx', (source) => {
  source = replaceOnce(
    source,
    `          <Text style={styles.title}>Equipos del cliente</Text>
          <Text style={styles.copy}>Escanea un sticker QR existente, busca un aire registrado o añade un equipo nuevo sin modificar el booking original.</Text>`,
    `          <Text style={styles.title}>{qrScannerTarget ? 'Escanear QR' : mode === 'add' ? 'Registrar aire nuevo' : mode === 'search' ? 'Buscar aire' : 'Equipos del cliente'}</Text>
          <Text style={styles.copy}>{qrScannerTarget ? 'Mantén el sticker dentro del recuadro para leerlo automáticamente.' : mode === 'add' ? 'Completa únicamente los datos y fotografías del aire nuevo.' : mode === 'search' ? 'Localiza un aire existente y agrégalo a esta visita.' : 'Selecciona un aire registrado o inicia una acción en su propia pantalla.'}</Text>`,
    'equipment hero',
  );
  source = replaceOnce(source, 'action={<Button compact label="Cerrar cámara" variant="ghost" onPress={() => setQrScannerTarget(\'\')} />}', 'action={<Button compact label="Volver" variant="ghost" onPress={() => setQrScannerTarget(\'\')} />}', 'scanner close action');
  source = replaceOnce(
    source,
    `      <Card>
        <SectionTitle title="1. Seleccionar visita preparada" subtitle="Selecciona el cliente que el equipo está atendiendo" />`,
    `      {/* ${marker}: list, search, scanner and registration are separate views. */}
      {!qrScannerTarget && mode === 'list' ? (
      <>
      <Card>
        <SectionTitle title="1. Seleccionar visita preparada" subtitle="Selecciona el cliente que el equipo está atendiendo" />`,
    'equipment list start',
  );
  source = replaceOnce(
    source,
    `        </Card>
      ) : null}

      {selectedVisit && mode === 'add' ? (`,
    `        </Card>
      ) : null}
      </>
      ) : null}

      {!qrScannerTarget && selectedVisit && mode === 'add' ? (`,
    'equipment list end',
  );
  source = replaceOnce(
    source,
    `            title="Registrar aire nuevo"
            subtitle={selectedUnit ? \`Se vinculará con \${selectedUnit.locationLabel}\` : 'Se añadirá como un aire nuevo a esta visita'}
            action={<Button compact label="Cerrar" variant="ghost" onPress={() => setMode('list')} />}`,
    `            title="Registrar aire nuevo"
            subtitle={selectedUnit ? \`Se vinculará con \${selectedUnit.locationLabel}\` : 'Se añadirá como un aire nuevo a esta visita'}
            action={<Button compact label="Volver" variant="ghost" onPress={() => setMode('list')} />}`,
    'add close action',
  );
  source = replaceOnce(source, `{selectedVisit && mode === 'search' ? (`, `{!qrScannerTarget && selectedVisit && mode === 'search' ? (`, 'search visibility');
  return replaceOnce(
    source,
    `            title="Buscar aire registrado"
            subtitle={targetPendingUnit ? \`Se asociará con \${targetPendingUnit.locationLabel}\` : 'El aire seleccionado se agregará a la visita'}
            action={<Button compact label="Cerrar" variant="ghost" onPress={() => setMode('list')} />}`,
    `            title="Buscar aire registrado"
            subtitle={targetPendingUnit ? \`Se asociará con \${targetPendingUnit.locationLabel}\` : 'El aire seleccionado se agregará a la visita'}
            action={<Button compact label="Volver" variant="ghost" onPress={() => setMode('list')} />}`,
    'search close action',
  );
});

update('src/screens/TechnicianEquipmentProfileScreen.tsx', (source) => {
  source = replaceOnce(
    source,
    `  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>`,
    `  if (addingAnother) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PORTAL DEL TÉCNICO V2</Text>
            <Text style={styles.title}>Agregar otro trabajo</Text>
            <Text style={styles.copy}>{equipment.locationLabel} · {client?.name ?? 'Cliente'}</Text>
          </View>
          <Pill label="Trabajo adicional" tone="info" />
        </View>
        {/* ${marker}: additional work is selected on its own screen. */}
        <Card>
          <SectionTitle
            title="Selecciona el trabajo"
            subtitle="Se registrará como una intervención independiente con su propio reporte."
            action={<Button compact variant="ghost" label="Volver" onPress={() => setAddingAnother(false)} />}
          />
          <View style={styles.workTypeGrid}>
            {WORK_TYPES.map((definition) => {
              const alreadyRegistered = interventions.some((item) => item.type === definition.type);
              return (
                <Pressable
                  key={definition.type}
                  disabled={working || alreadyRegistered}
                  onPress={() => void createIntervention(definition)}
                  style={[styles.workTypeCard, alreadyRegistered && styles.workTypeDisabled]}
                >
                  <Text style={styles.workTypeIcon}>{definition.icon}</Text>
                  <Text style={styles.workTypeName}>{definition.label}</Text>
                  <Text style={styles.workTypeAction}>{alreadyRegistered ? 'Ya registrado' : working ? 'Guardando…' : 'Seleccionar'}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
        <View style={styles.messageBox}>
          <Text style={styles.messageTitle}>Estado</Text>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>`,
    'additional work screen',
  );
  return replaceOnce(source, ') : (!primaryIntervention || addingAnother || canReplacePrimaryDraft) ? (', ') : (!primaryIntervention || canReplacePrimaryDraft) ? (', 'inline additional work condition');
});

update('src/screens/ClientsScreen.tsx', (source) => {
  source = replaceOnce(source, `import { applyAddressSuggestion, locationCoordinates, mapsMeUrl, parseLocationInput, phoneDigits, suggestArubaAddresses } from '../utils/location';`, `import { applyAddressSuggestion, locationCoordinates, mapsMeUrl, parseLocationInput, phoneDigits, suggestArubaAddresses } from '../utils/location';\nimport { useWebHistoryState } from '../navigation/appHistory';`, 'Clients history import');
  source = replaceOnce(source, `  const [selectedId, setSelectedId] = useState('');`, `  const [selectedId, setSelectedId] = useState('');\n  const clientProfileHistory = useWebHistoryState('clients-profile', selectedId, setSelectedId);`, 'Clients profile history');
  source = replaceOnce(
    source,
    `  useEffect(() => {
    if (!filtered.length) return setSelectedId('');
    if (!filtered.some((client) => client.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);`,
    `  useEffect(() => {
    if (selectedId && !clients.some((client) => client.id === selectedId)) {
      clientProfileHistory.replace('');
      setSelectedId('');
    }
  }, [clients, selectedId]);`,
    'Clients automatic selection',
  );
  source = replaceOnce(
    source,
    `      <SectionTitle title="Clientes y propiedades" subtitle="Administra clientes activos, archivados, propiedades, contactos e historial." action={<Button label="Nuevo cliente" icon="＋" onPress={() => { setScreenMessage(''); clearDataError(); resetClientForm(); setShowCreate(true); }} />} />
      <View style={styles.summaryBar}><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{clients.filter((client) => client.active !== false).length}</Text> activos</Text><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{clients.filter((client) => client.active === false).length}</Text> archivados</Text><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{properties.filter((property) => property.active !== false).length}</Text> propiedades activas</Text><Button compact variant="ghost" label={dataLoading ? 'Sincronizando…' : 'Actualizar'} disabled={dataLoading} onPress={() => void refreshOperationalData()} /></View>
      <View style={styles.filterRow}>{(['Activos', 'Archivados', 'Todos'] as ClientFilter[]).map((item) => <Button key={item} compact variant={clientFilter === item ? 'primary' : 'secondary'} label={item} onPress={() => setClientFilter(item)} />)}</View>`,
    `      {/* ${marker}: client directory and client profile are separate screens. */}
      {!selected ? <>
        <SectionTitle title="Clientes y propiedades" subtitle="Administra clientes activos, archivados, propiedades, contactos e historial." action={<Button label="Nuevo cliente" icon="＋" onPress={() => { setScreenMessage(''); clearDataError(); resetClientForm(); setShowCreate(true); }} />} />
        <View style={styles.summaryBar}><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{clients.filter((client) => client.active !== false).length}</Text> activos</Text><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{clients.filter((client) => client.active === false).length}</Text> archivados</Text><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{properties.filter((property) => property.active !== false).length}</Text> propiedades activas</Text><Button compact variant="ghost" label={dataLoading ? 'Sincronizando…' : 'Actualizar'} disabled={dataLoading} onPress={() => void refreshOperationalData()} /></View>
        <View style={styles.filterRow}>{(['Activos', 'Archivados', 'Todos'] as ClientFilter[]).map((item) => <Button key={item} compact variant={clientFilter === item ? 'primary' : 'secondary'} label={item} onPress={() => setClientFilter(item)} />)}</View>
      </> : <SectionTitle title="Perfil del cliente" subtitle={selected.name} action={<Button compact variant="ghost" label="Volver a clientes" onPress={() => clientProfileHistory.back(() => setSelectedId(''))} />} />}`,
    'Clients list header',
  );
  source = replaceOnce(source, `        <Card style={styles.listCard}>\n          <Input placeholder="Buscar cliente, teléfono, empresa o dirección…"`, `        {!selected ? <Card style={styles.listCard}>\n          <Input placeholder="Buscar cliente, teléfono, empresa o dirección…"`, 'Clients list visibility start');
  source = replaceOnce(source, `        </Card>\n\n        <View style={styles.detailColumn}>`, `        </Card> : null}\n\n        {selected ? <View style={styles.detailColumn}>`, 'Clients list visibility end');
  source = replaceOnce(source, `          </> : <Card><EmptyState icon="👤" title="Selecciona un cliente" message="Selecciona un cliente del listado." /></Card>}\n        </View>`, `          </> : null}\n        </View> : null}`, 'Clients detail visibility');
  return replaceOnce(source, `  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }, listCard: { flex: 1, minWidth: 320, maxWidth: 470 }, detailColumn: { flex: 1.8, minWidth: 340, gap: 18 },`, `  columns: { width: '100%', alignItems: 'center' }, listCard: { width: '100%', maxWidth: 760 }, detailColumn: { width: '100%', maxWidth: 980, gap: 18 },`, 'Clients screen layout');
});

update('src/screens/WorkOrdersScreen.tsx', (source) => {
  source = replaceOnce(source, `import { colors } from '../theme';`, `import { colors } from '../theme';\nimport { useWebHistoryState } from '../navigation/appHistory';`, 'WorkOrders history import');
  source = replaceOnce(source, `  const [selectedId, setSelectedId] = useState(workOrders[0]?.id ?? '');`, `  const [selectedId, setSelectedId] = useState('');\n  const orderProfileHistory = useWebHistoryState('work-orders-profile', selectedId, setSelectedId);`, 'WorkOrders profile history');
  source = replaceOnce(source, `      <SectionTitle title="Órdenes de trabajo" subtitle="Supervisa asignación, alcance y reportes enviados por el Portal del Técnico." />\n      <View style={styles.toolbar}>`, `      {/* ${marker}: the order list and each order profile are separate screens. */}\n      {!selected ? <SectionTitle title="Órdenes de trabajo" subtitle="Supervisa asignación, alcance y reportes enviados por el Portal del Técnico." /> : <SectionTitle title="Detalle de la orden" subtitle={selected.id} action={<Button compact variant="ghost" label="Volver a órdenes" onPress={() => orderProfileHistory.back(() => setSelectedId(''))} />} />}\n      {!selected ? <View style={styles.toolbar}>`, 'WorkOrders header');
  source = replaceOnce(source, `      </View>\n\n      <View style={styles.columns}>\n        <Card style={styles.listCard}>`, `      </View> : null}\n\n      <View style={styles.columns}>\n        {!selected ? <Card style={styles.listCard}>`, 'WorkOrders list start');
  source = replaceOnce(source, `        </Card>\n\n        <View style={styles.detailColumn}>`, `        </Card> : null}\n\n        {selected ? <View style={styles.detailColumn}>`, 'WorkOrders list end');
  source = replaceOnce(source, `        </View>\n      </View>\n    </ScrollView>`, `        </View> : null}\n      </View>\n    </ScrollView>`, 'WorkOrders detail end');
  return replaceOnce(
    source,
    `  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  listCard: { flex: 1, minWidth: 330, maxWidth: 470 },
  detailColumn: { flex: 1.7, minWidth: 350, gap: 18 },`,
    `  columns: { width: '100%', alignItems: 'center' },
  listCard: { width: '100%', maxWidth: 760 },
  detailColumn: { width: '100%', maxWidth: 980, gap: 18 },`,
    'WorkOrders screen layout',
  );
});

update('src/screens/AgendaScreen.tsx', (source) => {
  source = replaceOnce(source, `  const selectedOrder = activeOrders.find((order) => order.id === selectedOrderId) ?? activeOrders[0];`, `  const selectedOrder = activeOrders.find((order) => order.id === selectedOrderId);`, 'Agenda automatic appointment detail');
  return replaceOnce(
    source,
    `        <Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} halfDay={selectedOrder ? isHalfDay(selectedOrder.vanId, selectedOrder.date) : false} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} onConfirm={confirmTemporaryAppointment} onEdit={startEdit} onCancel={cancelAppointment} onReschedule={startReschedule} /></Card>
      </View>

      <AppModal`,
    `      </View>

      {/* ${marker}: appointment details open as a dedicated screen. */}
      <AppModal
        visible={Boolean(selectedOrderId && selectedOrder)}
        title="Detalles de la cita"
        onClose={() => setSelectedOrderId(null)}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <AppointmentDetails order={selectedOrder} halfDay={selectedOrder ? isHalfDay(selectedOrder.vanId, selectedOrder.date) : false} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} onConfirm={confirmTemporaryAppointment} onEdit={startEdit} onCancel={cancelAppointment} onReschedule={startReschedule} />
        </ScrollView>
      </AppModal>

      <AppModal`,
    'Agenda appointment detail',
  );
});

update('src/screens/TeamScreen.tsx', (source) => {
  source = replaceOnce(source, `  const [selectedVanId, setSelectedVanId] = useState(vans[0]?.id ?? '');`, `  const [selectedVanId, setSelectedVanId] = useState('');\n  const vanProfileHistory = useWebHistoryState('team-van-profile', selectedVanId, setSelectedVanId);`, 'Team van profile history');
  source = replaceOnce(source, `  const selectedVan = vans.find((van) => van.id === selectedVanId) ?? vans[0];`, `  const selectedVan = vans.find((van) => van.id === selectedVanId);`, 'Team automatic van detail');
  source = replaceOnce(
    source,
    `      {tab === 'vans' ? <View style={[styles.vanLayout, compact && styles.vanLayoutCompact]}>
        <View style={styles.vanList}>{vans.map((van) => <Pressable key={van.id} onPress={() => setSelectedVanId(van.id)} style={[styles.vanItem, selectedVan?.id === van.id && styles.vanItemActive]}><View><Text style={styles.vanItemTitle}>{van.name}</Text><Text style={styles.muted}>{van.plate}</Text></View><Pill label={van.status} tone={tone(van.status)} /></Pressable>)}</View>
        {selectedVan ? <View style={styles.details}>`,
    `      {/* ${marker}: the van list and van profile are separate screens. */}
      {tab === 'vans' ? <View style={[styles.vanLayout, compact && styles.vanLayoutCompact]}>
        {!selectedVan ? <View style={styles.vanList}>{vans.map((van) => <Pressable key={van.id} onPress={() => setSelectedVanId(van.id)} style={styles.vanItem}><View><Text style={styles.vanItemTitle}>{van.name}</Text><Text style={styles.muted}>{van.plate}</Text></View><Pill label={van.status} tone={tone(van.status)} /></Pressable>)}</View> : null}
        {selectedVan ? <View style={styles.details}>
          <SectionTitle title="Perfil de la van" subtitle={\`\${selectedVan.name} · \${selectedVan.plate}\`} action={<Button compact variant="ghost" label="Volver a vans" onPress={() => vanProfileHistory.back(() => setSelectedVanId(''))} />} />`,
    'Team van screen',
  );
  return replaceOnce(
    source,
    `  vanLayout: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' }, vanLayoutCompact: { flexDirection: 'column' }, vanList: { width: 270, gap: 8 }, vanItem: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, vanItemActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, vanItemTitle: { color: colors.text, fontSize: 13, fontWeight: '900' }, details: { flex: 1, gap: 14, minWidth: 0 }, detailTitle: { color: colors.text, fontSize: 20, fontWeight: '900' }, subtitle: { color: colors.text, fontSize: 15, fontWeight: '900' },`,
    `  vanLayout: { width: '100%', gap: 16, alignItems: 'center' }, vanLayoutCompact: { width: '100%' }, vanList: { width: '100%', maxWidth: 760, gap: 8 }, vanItem: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, vanItemActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, vanItemTitle: { color: colors.text, fontSize: 13, fontWeight: '900' }, details: { width: '100%', maxWidth: 980, gap: 14, minWidth: 0 }, detailTitle: { color: colors.text, fontSize: 20, fontWeight: '900' }, subtitle: { color: colors.text, fontSize: 15, fontWeight: '900' },`,
    'Team van layout',
  );
});

console.log('patchAppScreenNavigationV5.cjs applied.');
