from pathlib import Path
import re

path = Path('src/screens/AgendaScreen.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise RuntimeError(f'No se encontró el bloque: {label}')
    text = text.replace(old, new, 1)


replace_once(
    "import { AppointmentStatus, Client, Property, ServiceType, Van, WorkOrder } from '../types';",
    "import { AppointmentStatus, Client, Property, PropertyType, ServiceType, Van, WorkOrder } from '../types';",
    'import PropertyType',
)

replace_once(
    "const allSlots = [...morningSlots, ...afternoonSlots];\nconst SLOT_HEIGHT = 118;",
    """const allSlots = [...morningSlots, ...afternoonSlots];
const propertyTypes: PropertyType[] = ['Casa', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'];
const SLOT_HEIGHT = 118;""",
    'propertyTypes',
)

replace_once(
    """const SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + allSlots.length * SLOT_HEIGHT + (allSlots.length - 1) * SLOT_GAP + LUNCH_GAP;

function localDateKey""",
    """const SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + allSlots.length * SLOT_HEIGHT + (allSlots.length - 1) * SLOT_GAP + LUNCH_GAP;

type QuickClientForm = {
  name: string;
  company: string;
  phone: string;
  whatsapp: string;
  propertyName: string;
  propertyType: PropertyType;
  address: string;
  zone: string;
};

const emptyQuickClientForm: QuickClientForm = {
  name: '',
  company: '',
  phone: '',
  whatsapp: '',
  propertyName: 'Propiedad principal',
  propertyType: 'Casa',
  address: '',
  zone: '',
};

function localDateKey""",
    'quick client types',
)

replace_once(
    """    vans,
    users,
    addWorkOrder,""",
    """    vans,
    users,
    addClient,
    addProperty,
    addWorkOrder,""",
    'context actions',
)

replace_once(
    """  const [showCreate, setShowCreate] = useState(false);
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [workHours, setWorkHours] = useState(1);""",
    """  const [showCreate, setShowCreate] = useState(false);
  const [showQuickClient, setShowQuickClient] = useState(false);
  const [clientId, setClientId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [quickClient, setQuickClient] = useState<QuickClientForm>(emptyQuickClientForm);
  const [quickClientSaving, setQuickClientSaving] = useState(false);
  const [quickClientMessage, setQuickClientMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [workHours, setWorkHours] = useState(1);""",
    'quick client state',
)

replace_once(
    """  const openCreate = (candidateVanId?: string, candidateTime?: string) => {
    clearDataError();
    setFormMessage('');
    setClientQuery('');
    if (candidateVanId) setVanId(candidateVanId);
    if (candidateTime) setTime(candidateTime);
    setShowCreate(true);
  };

""",
    """  const openCreate = (candidateVanId?: string, candidateTime?: string) => {
    clearDataError();
    setFormMessage('');
    setSuccessMessage('');
    setClientQuery('');
    setShowQuickClient(false);
    if (candidateVanId) setVanId(candidateVanId);
    if (candidateTime) setTime(candidateTime);
    setShowCreate(true);
  };

  const openQuickClient = () => {
    setQuickClient({ ...emptyQuickClientForm, name: clientQuery.trim() });
    setQuickClientMessage('');
    setFormMessage('');
    setSuccessMessage('');
    setShowQuickClient(true);
  };

  const saveQuickClient = async () => {
    const name = quickClient.name.trim();
    const company = quickClient.company.trim();
    const phone = quickClient.phone.trim();
    const whatsapp = quickClient.whatsapp.trim() || phone;
    const address = quickClient.address.trim();
    const zone = quickClient.zone.trim();
    const propertyName = quickClient.propertyName.trim() || 'Propiedad principal';

    if (!name) return setQuickClientMessage('Escribe el nombre completo del cliente o empresa.');
    if (!phone) return setQuickClientMessage('Escribe un número de teléfono.');
    if (!address) return setQuickClientMessage('Escribe la dirección de la propiedad.');
    if (!zone) return setQuickClientMessage('Escribe la zona de la propiedad.');

    const timestamp = Date.now();
    const now = new Date().toISOString();
    const newClient: Client = {
      id: `client-${timestamp}`,
      name,
      company: company || undefined,
      phone,
      whatsapp,
      address,
      zone,
      balance: 0,
      equipmentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const newProperty: Property = {
      id: `property-${timestamp}`,
      clientId: newClient.id,
      name: propertyName,
      type: quickClient.propertyType,
      address,
      zone,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    setQuickClientSaving(true);
    setQuickClientMessage('');
    const clientResult = await addClient(newClient);
    if (!clientResult.ok) {
      setQuickClientSaving(false);
      setQuickClientMessage(clientResult.message ?? 'No se pudo guardar el cliente.');
      return;
    }

    const propertyResult = await addProperty(newProperty);
    setQuickClientSaving(false);
    setClientId(newClient.id);
    setClientQuery('');

    if (!propertyResult.ok) {
      setPropertyId('');
      setShowQuickClient(false);
      setFormMessage(propertyResult.message ?? 'El cliente se creó, pero no se pudo guardar la propiedad. Se usará la dirección principal.');
      return;
    }

    setPropertyId(newProperty.id);
    setQuickClient(emptyQuickClientForm);
    setShowQuickClient(false);
    setSuccessMessage(`${newClient.name} y ${newProperty.name} fueron agregados y seleccionados.`);
  };

""",
    'quick client functions',
)

modal = """      <AppModal
        visible={showCreate}
        title={showQuickClient ? 'Agregar cliente rápido' : 'Confirmar nueva cita'}
        onClose={() => {
          if (showQuickClient) {
            if (!quickClientSaving) setShowQuickClient(false);
            return;
          }
          if (!saving) setShowCreate(false);
        }}
      >
        {showQuickClient ? (
          <ScrollView>
            <Text style={styles.modalIntro}>Registra el cliente y su primera propiedad sin salir de la agenda. Al guardar, quedarán seleccionados automáticamente en la cita.</Text>
            {quickClientMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{quickClientMessage}</Text></View> : null}
            <Input label=\"Nombre completo o empresa\" value={quickClient.name} onChangeText={(name) => setQuickClient({ ...quickClient, name })} placeholder=\"Ej. María Pérez o Empresa ABC\" />
            <Input label=\"Empresa (opcional)\" value={quickClient.company} onChangeText={(company) => setQuickClient({ ...quickClient, company })} placeholder=\"Déjalo vacío si es cliente residencial\" />
            <View style={styles.twoColumnFields}>
              <View style={styles.halfField}><Input label=\"Teléfono\" value={quickClient.phone} onChangeText={(phone) => setQuickClient({ ...quickClient, phone })} keyboardType=\"phone-pad\" /></View>
              <View style={styles.halfField}><Input label=\"WhatsApp\" value={quickClient.whatsapp} onChangeText={(whatsapp) => setQuickClient({ ...quickClient, whatsapp })} keyboardType=\"phone-pad\" placeholder=\"Si es igual, puede quedar vacío\" /></View>
            </View>
            <Text style={styles.quickSectionTitle}>Primera propiedad / lugar de servicio</Text>
            <Input label=\"Nombre de la propiedad\" value={quickClient.propertyName} onChangeText={(propertyName) => setQuickClient({ ...quickClient, propertyName })} placeholder=\"Ej. Casa principal, Apartamento 3B u Oficina\" />
            <Text style={styles.quickFieldLabel}>Tipo de propiedad</Text>
            <View style={styles.optionWrap}>{propertyTypes.map((type) => <Option key={type} label={type} active={quickClient.propertyType === type} onPress={() => setQuickClient({ ...quickClient, propertyType: type })} />)}</View>
            <Input label=\"Dirección\" value={quickClient.address} onChangeText={(address) => setQuickClient({ ...quickClient, address })} placeholder=\"Calle, número y referencia\" />
            <Input label=\"Zona\" value={quickClient.zone} onChangeText={(zone) => setQuickClient({ ...quickClient, zone })} placeholder=\"Ej. Oranjestad, Noord, Santa Cruz…\" />
            <View style={styles.modalActions}>
              <Button variant=\"secondary\" label=\"Volver a la cita\" disabled={quickClientSaving} onPress={() => setShowQuickClient(false)} />
              <Button label={quickClientSaving ? 'Guardando…' : 'Guardar y seleccionar'} disabled={quickClientSaving} onPress={() => void saveQuickClient()} />
            </View>
          </ScrollView>
        ) : (
          <ScrollView>
            <Text style={styles.modalIntro}>Selecciona el cliente y la propiedad, define cuántas horas ocupará el trabajo y escribe toda la descripción necesaria.</Text>
            {!clients.length ? <View style={styles.infoBanner}><Text style={styles.infoBannerText}>Todavía no hay clientes. Usa “Añadir cliente nuevo” para registrar el primero sin salir de esta cita.</Text></View> : null}
            {formMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{formMessage}</Text></View> : null}
            {successMessage ? <View style={styles.successBanner}><Text style={styles.successBannerText}>{successMessage}</Text></View> : null}

            <Text style={styles.stepLabel}>1</Text><Text style={styles.fieldLabel}>Cliente</Text>
            <Input placeholder=\"Buscar por nombre, empresa, teléfono, dirección o zona…\" value={clientQuery} onChangeText={setClientQuery} />
            <View style={styles.searchResults}>
              {filteredClients.map((client) => <SearchRow key={client.id} title={client.name} subtitle={`${client.company ? `${client.company} · ` : ''}${client.phone} · ${client.zone}`} active={clientId === client.id} onPress={() => { setClientId(client.id); setClientQuery(''); setSuccessMessage(''); }} />)}
              {clientQuery.trim() && !filteredClients.length ? <Text style={styles.noResults}>No encontramos clientes con esa búsqueda.</Text> : null}
              <Pressable onPress={openQuickClient} style={styles.addClientRow}>
                <View style={styles.addClientIcon}><Text style={styles.addClientIconText}>＋</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.addClientTitle}>Añadir cliente nuevo</Text><Text style={styles.addClientSubtitle}>{clientQuery.trim() ? `Crear “${clientQuery.trim()}” y registrar su propiedad` : 'Registrar cliente y propiedad rápidamente'}</Text></View>
                <Text style={styles.addClientArrow}>›</Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Propiedad / lugar de servicio</Text>
            {clientProperties.length ? <View style={styles.optionWrap}>{clientProperties.map((property) => <Option key={property.id} label={`${property.name} · ${property.address} · ${property.zone}`} active={propertyId === property.id} onPress={() => setPropertyId(property.id)} />)}</View> : selectedClient ? <Text style={styles.fallbackText}>Se usará la dirección principal del cliente.</Text> : <Text style={styles.fallbackText}>Selecciona o registra un cliente para escoger la propiedad.</Text>}

            <Text style={styles.stepLabel}>2</Text><Text style={styles.fieldLabel}>Cómo calcular la duración</Text>
            <View style={styles.modeTabs}><View style={[styles.modeTab, styles.modeTabActive]}><Text style={[styles.modeTabText, styles.modeTabTextActive]}>Horas de trabajo</Text></View></View>

            <Text style={styles.stepLabel}>3</Text><Text style={styles.fieldLabel}>Cantidad de horas de trabajo</Text>
            <View style={styles.quantityPanel}>
              <View style={{ flex: 1 }}><Text style={styles.quantityTitle}>Tiempo total reservado</Text><Text style={styles.quantityHelp}>Selecciona de 1 a 6 horas. La agenda bloqueará automáticamente todo ese tiempo.</Text></View>
              <View style={styles.stepper}><Pressable disabled={workHours <= 1} onPress={() => setWorkHours((value) => Math.max(1, value - 1))} style={[styles.stepperButton, workHours <= 1 && styles.stepperDisabled]}><Text style={styles.stepperButtonText}>−</Text></Pressable><Text style={styles.stepperValue}>{workHours}</Text><Pressable disabled={workHours >= 6} onPress={() => setWorkHours((value) => Math.min(6, value + 1))} style={[styles.stepperButton, workHours >= 6 && styles.stepperDisabled]}><Text style={styles.stepperButtonText}>＋</Text></Pressable></View>
            </View>
            <View style={styles.durationPreview}><View><Text style={styles.previewLabel}>Duración</Text><Text style={styles.previewValue}>{workHours} hora{workHours !== 1 ? 's' : ''}</Text></View><View><Text style={styles.previewLabel}>Total a reservar</Text><Text style={styles.previewValue}>{workHours} cupo{workHours !== 1 ? 's' : ''}</Text></View><View><Text style={styles.previewLabel}>Modalidad</Text><Text style={styles.previewValue}>Trabajo flexible</Text></View></View>

            <Text style={styles.stepLabel}>4</Text><Text style={styles.fieldLabel}>Asignar a</Text>
            <View style={styles.optionWrap}>{vans.slice(0, 4).map((van) => { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + '); return <Option key={van.id} label={`${van.name} · ${names || 'Sin equipo'}`} active={vanId === van.id} onPress={() => setVanId(van.id)} />; })}</View>

            <Text style={styles.stepLabel}>5</Text><Text style={styles.fieldLabel}>Horario sugerido</Text>
            <View style={styles.optionWrap}>{allSlots.map((slot) => { const available = selectedVan ? isAvailable(selectedVan, slot) : false; return <Option key={slot} label={available ? slotLabel(slot) : `${slotLabel(slot)} · no disponible`} active={time === slot} disabled={!available} onPress={() => setTime(slot)} />; })}</View>

            <Text style={styles.stepLabel}>6</Text>
            <Input label=\"Descripción del trabajo\" value={workDescriptionText} onChangeText={setWorkDescriptionText} multiline placeholder=\"Ej. Dos servicios estándar, diagnóstico de una unidad e instalación de otra. Agrega instrucciones de acceso, contacto, síntomas y cualquier detalle necesario…\" />

            <View style={styles.summaryBox}><Text style={styles.summaryTitle}>Resumen de la cita</Text><Text style={styles.summaryLine}>{selectedClient?.name ?? 'Sin cliente'} · {selectedProperty?.name ?? selectedClient?.address ?? 'Sin dirección'}</Text><Text style={styles.summaryLine}>{workHours} hora{workHours !== 1 ? 's' : ''} · {selectedVan?.name} · {formatDate(selectedDate)} · {time}</Text><Text style={styles.summaryLine} numberOfLines={2}>{workDescriptionText.trim() || 'Falta agregar la descripción del trabajo.'}</Text></View>
            <View style={styles.modalActions}><Button variant=\"secondary\" label=\"Cancelar\" disabled={saving} onPress={() => setShowCreate(false)} /><Button label={saving ? 'Guardando…' : 'Confirmar cita'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void createOrder()} /></View>
          </ScrollView>
        )}
      </AppModal>"""

pattern = re.compile(r'      <AppModal visible=\{showCreate\} title="Confirmar nueva cita" onClose=\{\(\) => !saving && setShowCreate\(false\)\}>.*?      </AppModal>', re.S)
text, count = pattern.subn(modal, text, count=1)
if count != 1:
    raise RuntimeError('No se pudo reemplazar el modal de cita')

replace_once(
    "  noResults: { color: colors.muted, fontSize: 10, padding: 12 },",
    """  noResults: { color: colors.muted, fontSize: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: '#EEF0F2' },
  addClientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, paddingVertical: 11, backgroundColor: '#F5FBF3' },
  addClientIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  addClientIconText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', lineHeight: 20 },
  addClientTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 11 },
  addClientSubtitle: { color: colors.muted, fontSize: 9, marginTop: 2 },
  addClientArrow: { color: colors.primaryDark, fontSize: 22, fontWeight: '700' },""",
    'add client styles',
)

replace_once(
    """  formErrorText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  summaryBox:""",
    """  formErrorText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  infoBanner: { backgroundColor: colors.infoLight, borderRadius: 8, padding: 10, marginBottom: 12 },
  infoBannerText: { color: colors.primaryDark, fontSize: 11, fontWeight: '700' },
  successBanner: { backgroundColor: colors.successLight, borderRadius: 8, padding: 10, marginBottom: 12 },
  successBannerText: { color: colors.success, fontSize: 11, fontWeight: '800' },
  quickSectionTitle: { color: colors.text, fontWeight: '900', fontSize: 13, marginTop: 8, marginBottom: 10 },
  quickFieldLabel: { color: colors.text, fontWeight: '900', fontSize: 11, marginBottom: 8 },
  twoColumnFields: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  halfField: { flex: 1, minWidth: 210 },
  summaryBox:""",
    'quick form styles',
)

replace_once(
    "  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15 },",
    "  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15, flexWrap: 'wrap' },",
    'modal actions wrap',
)

path.write_text(text, encoding='utf-8')
print('AgendaScreen actualizado con alta rápida de cliente y propiedad.')
