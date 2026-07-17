import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { Client, Property, PropertyContact, PropertyContactLanguage, PropertyContactRole, PropertyType } from '../types';

const propertyTypes: PropertyType[] = ['Casa', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'];
const propertyContactRoles: PropertyContactRole[] = ['Dueño', 'Encargado', 'Administrador', 'Inquilino', 'Contacto de acceso', 'Contabilidad', 'Otro'];
const propertyContactLanguages: PropertyContactLanguage[] = ['Español', 'English', 'Nederlands', 'Papiamento'];

export function ClientsScreen() {
  const {
    clients,
    properties,
    equipment,
    workOrders,
    addClient,
    addProperty,
    updateProperty,
    removeProperty,
    dataError,
    dataLoading,
    refreshOperationalData,
    clearDataError,
  } = useAppState();

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showProperty, setShowProperty] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactPropertyId, setContactPropertyId] = useState('');
  const [contactForm, setContactForm] = useState({ name: '', role: 'Encargado' as PropertyContactRole, phone: '', whatsapp: '', email: '', preferredLanguage: 'Español' as PropertyContactLanguage });
  const [propertyToDelete, setPropertyToDelete] = useState<Property | null>(null);
  const [saving, setSaving] = useState(false);
  const [screenMessage, setScreenMessage] = useState('');
  const [form, setForm] = useState({
    name: '',
    company: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    zone: 'Oranjestad',
  });
  const [propertyForm, setPropertyForm] = useState({
    name: 'Propiedad principal',
    type: 'Casa' as PropertyType,
    address: '',
    zone: 'Oranjestad',
    notes: '',
  });

  useEffect(() => {
    if (!clients.length) {
      setSelectedId('');
      return;
    }
    if (!clients.some((client) => client.id === selectedId)) setSelectedId(clients[0].id);
  }, [clients, selectedId]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return clients;
    return clients.filter((client) => {
      const clientProperties = properties.filter((property) => property.clientId === client.id);
      const propertyText = clientProperties.map((property) => `${property.name} ${property.address} ${property.zone}`).join(' ');
      return `${client.name} ${client.company ?? ''} ${client.phone} ${client.whatsapp} ${client.email ?? ''} ${propertyText}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [clients, properties, query]);

  const selected = clients.find((client) => client.id === selectedId);
  const selectedProperties = properties
    .filter((property) => property.clientId === selectedId && property.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
  const clientEquipment = equipment.filter((item) => item.clientId === selectedId);
  const clientOrders = workOrders.filter((item) => item.clientId === selectedId);
  const appointmentChanges = clientOrders
    .flatMap((order) => (order.scheduleHistory ?? []).map((entry) => ({ order, entry })))
    .sort((a, b) => b.entry.recordedAt.localeCompare(a.entry.recordedAt));

  const resetClientForm = () => setForm({ name: '', company: '', phone: '', whatsapp: '', email: '', address: '', zone: 'Oranjestad' });

  const createClient = async () => {
    setScreenMessage('');
    clearDataError();
    if (!form.name.trim()) return setScreenMessage('Escribe el nombre del cliente o de la empresa.');
    if (!form.phone.trim()) return setScreenMessage('Escribe el teléfono del cliente.');
    if (!form.address.trim()) return setScreenMessage('Escribe la dirección de la primera propiedad.');

    const timestamp = Date.now();
    const now = new Date().toISOString();
    const client: Client = {
      id: `client-${timestamp}`,
      name: form.name.trim(),
      company: form.company.trim() || undefined,
      phone: form.phone.trim(),
      whatsapp: form.whatsapp.trim() || form.phone.trim(),
      email: form.email.trim() || undefined,
      address: form.address.trim(),
      zone: form.zone.trim() || 'Aruba',
      balance: 0,
      equipmentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const initialProperty: Property = {
      id: `property-${timestamp}`,
      clientId: client.id,
      name: 'Propiedad principal',
      type: 'Casa',
      address: client.address,
      zone: client.zone,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    setSaving(true);
    const clientResult = await addClient(client);
    if (!clientResult.ok) {
      setSaving(false);
      setScreenMessage(clientResult.message ?? 'No se pudo guardar el cliente.');
      return;
    }

    const propertyResult = await addProperty(initialProperty);
    setSaving(false);
    setSelectedId(client.id);
    resetClientForm();
    setShowCreate(false);
    if (!propertyResult.ok) setScreenMessage(propertyResult.message ?? 'El cliente se guardó, pero no se pudo crear la propiedad principal.');
  };

  const openPropertyModal = () => {
    if (!selected) return;
    setScreenMessage('');
    clearDataError();
    setPropertyForm({ name: `Propiedad ${selectedProperties.length + 1}`, type: 'Casa', address: '', zone: selected.zone || 'Oranjestad', notes: '' });
    setShowProperty(true);
  };

  const createProperty = async () => {
    if (!selected) return;
    setScreenMessage('');
    if (!propertyForm.name.trim()) return setScreenMessage('Escribe un nombre para identificar la propiedad.');
    if (!propertyForm.address.trim()) return setScreenMessage('Escribe la dirección de la propiedad.');

    const now = new Date().toISOString();
    const property: Property = {
      id: `property-${Date.now()}`,
      clientId: selected.id,
      name: propertyForm.name.trim(),
      type: propertyForm.type,
      address: propertyForm.address.trim(),
      zone: propertyForm.zone.trim() || 'Aruba',
      notes: propertyForm.notes.trim() || undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    setSaving(true);
    const result = await addProperty(property);
    setSaving(false);
    if (!result.ok) {
      setScreenMessage(result.message ?? 'No se pudo guardar la propiedad.');
      return;
    }
    setShowProperty(false);
  };


  const openContactModal = (property: Property) => {
    setScreenMessage('');
    clearDataError();
    setContactPropertyId(property.id);
    setContactForm({ name: '', role: 'Encargado', phone: '', whatsapp: '', email: '', preferredLanguage: 'Español' });
    setShowContact(true);
  };

  const createPropertyContact = async () => {
    const property = properties.find((item) => item.id === contactPropertyId);
    if (!property) return setScreenMessage('La propiedad seleccionada ya no existe.');
    if (!contactForm.name.trim()) return setScreenMessage('Escribe el nombre de la persona.');
    if (!contactForm.phone.trim() && !contactForm.whatsapp.trim()) return setScreenMessage('Escribe al menos un teléfono o WhatsApp.');
    const now = new Date().toISOString();
    const contact: PropertyContact = {
      id: `contact-${Date.now()}`,
      name: contactForm.name.trim(),
      role: contactForm.role,
      phone: contactForm.phone.trim() || contactForm.whatsapp.trim(),
      whatsapp: contactForm.whatsapp.trim() || contactForm.phone.trim(),
      email: contactForm.email.trim() || undefined,
      preferredLanguage: contactForm.preferredLanguage,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    setSaving(true);
    const result = await updateProperty(property.id, { contacts: [...(property.contacts ?? []), contact], updatedAt: now });
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo guardar la persona.');
    setShowContact(false);
    setContactPropertyId('');
  };

  const confirmRemoveProperty = async () => {
    if (!propertyToDelete) return;
    setSaving(true);
    const result = await removeProperty(propertyToDelete.id);
    setSaving(false);
    if (!result.ok) {
      setScreenMessage(result.message ?? 'No se pudo eliminar la propiedad.');
      return;
    }
    setPropertyToDelete(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {dataError || screenMessage ? (
        <View style={styles.errorBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.errorTitle}>Revisa esta operación</Text>
            <Text style={styles.errorText}>{screenMessage || dataError}</Text>
          </View>
          {dataError ? <Button compact variant="secondary" label="Reintentar" onPress={() => void refreshOperationalData()} /> : null}
        </View>
      ) : null}

      <SectionTitle
        title="Clientes y propiedades"
        subtitle="Consulta clientes, casas, apartamentos, oficinas, equipos e historial de trabajos."
        action={<Button label="Nuevo cliente" icon="＋" onPress={() => { setScreenMessage(''); clearDataError(); setShowCreate(true); }} />}
      />

      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}><Text style={styles.summaryStrong}>{clients.length}</Text> clientes registrados</Text>
        <Text style={styles.summaryText}><Text style={styles.summaryStrong}>{properties.filter((property) => property.active !== false).length}</Text> propiedades activas</Text>
        <Button compact variant="ghost" label={dataLoading ? 'Sincronizando…' : 'Actualizar'} disabled={dataLoading} onPress={() => void refreshOperationalData()} />
      </View>

      <View style={styles.columns}>
        <Card style={styles.listCard}>
          <Input placeholder="Buscar cliente, teléfono, empresa o dirección…" value={query} onChangeText={setQuery} />
          {filtered.length ? filtered.map((client) => {
            const propertyCount = properties.filter((property) => property.clientId === client.id && property.active !== false).length;
            return (
              <Pressable key={client.id} onPress={() => setSelectedId(client.id)} style={[styles.clientRow, selectedId === client.id && styles.clientRowActive]}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials(client.name)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>{client.name}</Text>
                  <Text style={styles.clientMeta}>{client.company || client.phone}</Text>
                  <Text style={styles.propertyCount}>{propertyCount} propiedad{propertyCount === 1 ? '' : 'es'}</Text>
                </View>
                {client.balance > 0 ? <Pill label={formatMoney(client.balance)} tone="warning" /> : <Pill label="Al día" tone="success" />}
              </Pressable>
            );
          }) : (
            <EmptyState
              icon="👥"
              title={clients.length ? 'Sin resultados' : 'Todavía no hay clientes'}
              message={clients.length ? 'No encontramos clientes con ese criterio.' : 'Presiona “Nuevo cliente” para registrar el primero.'}
            />
          )}
        </Card>

        <View style={styles.detailColumn}>
          {selected ? (
            <>
              <Card>
                <View style={styles.detailHeader}>
                  <View style={[styles.avatar, styles.avatarLarge]}><Text style={[styles.avatarText, { fontSize: 18 }]}>{initials(selected.name)}</Text></View>
                  <View style={{ flex: 1 }}><Text style={styles.detailName}>{selected.name}</Text><Text style={styles.detailCompany}>{selected.company || 'Cliente residencial'}</Text></View>
                  <Pill label={selected.balance > 0 ? `Balance ${formatMoney(selected.balance)}` : 'Cuenta al día'} tone={selected.balance > 0 ? 'warning' : 'success'} />
                </View>
                <View style={styles.infoGrid}>
                  <Info label="Teléfono" value={selected.phone} />
                  <Info label="WhatsApp" value={selected.whatsapp} />
                  <Info label="Correo" value={selected.email || 'No registrado'} />
                  <Info label="Zona principal" value={selected.zone} />
                </View>
              </Card>

              <Card>
                <SectionTitle
                  title={`Propiedades / lugares de servicio (${selectedProperties.length})`}
                  subtitle="Casas, apartamentos, oficinas o locales donde DEMAC realiza trabajos."
                  action={<Button compact label="Agregar propiedad" icon="＋" onPress={openPropertyModal} />}
                />
                {selectedProperties.length ? selectedProperties.map((property) => (
                  <View key={property.id} style={styles.propertyRow}>
                    <View style={styles.propertyIcon}><Text style={styles.propertyIconText}>{property.type === 'Apartamento' ? '▦' : property.type === 'Oficina' || property.type === 'Local comercial' ? '▥' : '⌂'}</Text></View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.propertyTitleRow}><Text style={styles.propertyName}>{property.name}</Text><Pill label={property.type} tone="neutral" /></View>
                      <Text style={styles.propertyAddress}>{property.address}</Text>
                                            <Text style={styles.propertyMeta}>{property.zone}{property.notes ? ` · ${property.notes}` : ''}</Text>
            {(property.contacts ?? []).filter((contact) => contact.active !== false).map((contact) => <Text key={contact.id} style={styles.propertyContactLine}>{contact.name} · {contact.role} · {contact.whatsapp || contact.phone} · {contact.preferredLanguage}</Text>)}
          </View>
          <View style={{ gap: 6 }}><Button compact variant="secondary" label="Agregar contacto" onPress={() => openContactModal(property)} /><Button compact variant="ghost" label="Quitar" onPress={() => setPropertyToDelete(property)} /></View>
                  </View>
                )) : <EmptyState icon="⌂" title="Sin propiedades" message="Agrega la primera casa, apartamento, oficina o local de este cliente." />}
              </Card>

              <Card>
                <SectionTitle title={`Equipos registrados (${clientEquipment.length})`} />
                {clientEquipment.length ? clientEquipment.map((item) => (
                  <View key={item.id} style={styles.equipmentRow}>
                    <View style={styles.equipmentIcon}><Text>❄️</Text></View>
                    <View style={{ flex: 1 }}><Text style={styles.equipmentName}>{item.brand} {item.model}</Text><Text style={styles.equipmentMeta}>{item.location} · {item.btu.toLocaleString()} BTU · {item.refrigerant} · {item.voltage}</Text><Text style={styles.equipmentSerial}>S/N {item.serial}</Text></View>
                    <Pill label={item.condition} tone={item.condition === 'Fuera de servicio' ? 'danger' : item.condition === 'Requiere atención' ? 'warning' : 'success'} />
                  </View>
                )) : <EmptyState icon="❄️" title="Sin equipos" message="Este cliente todavía no tiene equipos registrados." />}
              </Card>

              <Card>
                <SectionTitle
                  title={`Historial de citas canceladas o reprogramadas (${appointmentChanges.length})`}
                  subtitle="Incluye motivo, explicación, responsable y anticipación del cambio."
                />
                {appointmentChanges.length ? appointmentChanges.map(({ order, entry }) => {
                  const property = properties.find((item) => item.id === entry.propertyId);
                  const notice = typeof entry.noticeHours === 'number'
                    ? entry.noticeHours >= 0 ? `${entry.noticeHours} h de anticipación` : `${Math.abs(entry.noticeHours)} h después de la hora programada`
                    : 'Anticipación no registrada';
                  return (
                    <View key={`${order.id}-${entry.id}`} style={styles.changeHistoryRow}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.changeHistoryHeader}>
                          <Text style={styles.changeHistoryTitle}>{entry.status} · {entry.date} · {entry.time}</Text>
                          <Pill label={entry.status} tone="danger" />
                        </View>
                        <Text style={styles.changeHistoryProperty}>{property?.name ?? entry.address} · {order.id}</Text>
                        <Text style={styles.changeHistoryReason}>Motivo: {entry.reasonCategory ?? 'Motivo no registrado (evento anterior)'}</Text>
                        {entry.reasonNote ? <Text style={styles.changeHistoryNote}>{entry.reasonNote}</Text> : null}
                        <Text style={styles.changeHistoryMeta}>Origen: {entry.changeOrigin ?? 'No registrado'} · Registrado por: {entry.changedByName ?? 'No registrado'} · {notice}</Text>
                        {entry.status === 'Reprogramada' && entry.newDate ? <Text style={styles.changeHistoryNewDate}>Nueva cita: {entry.newDate} · {entry.newTime ?? ''}</Text> : null}
                      </View>
                    </View>
                  );
                }) : <EmptyState icon="🗓️" title="Sin cancelaciones ni reprogramaciones" message="Los cambios futuros aparecerán aquí con su motivo y responsable." />}
              </Card>

              <Card>
                <SectionTitle title={`Historial de trabajos (${clientOrders.length})`} />
                {clientOrders.length ? clientOrders.map((order) => <View key={order.id} style={styles.historyRow}><Text style={styles.historyDate}>{order.date}</Text><View style={{ flex: 1 }}><Text style={styles.historyId}>{order.id}</Text><Text style={styles.historyProblem} numberOfLines={1}>{order.problem}</Text></View><Pill label={order.status} tone={order.status === 'Completada' ? 'success' : 'info'} /></View>) : <EmptyState icon="🧰" title="Sin trabajos" message="Las citas y órdenes de este cliente aparecerán aquí." />}
              </Card>
            </>
          ) : (
            <Card><EmptyState icon="👤" title="Selecciona un cliente" message="El listado de clientes aparece a la izquierda. Selecciona uno para ver sus propiedades e historial." /></Card>
          )}
        </View>
      </View>

      <AppModal visible={showCreate} title="Registrar nuevo cliente" onClose={() => !saving && setShowCreate(false)}>
        {screenMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{screenMessage}</Text></View> : null}
        <Input label="Nombre completo o nombre comercial" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <Input label="Empresa (opcional)" value={form.company} onChangeText={(company) => setForm({ ...form, company })} />
        <Input label="Teléfono" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} keyboardType="phone-pad" />
        <Input label="WhatsApp" value={form.whatsapp} onChangeText={(whatsapp) => setForm({ ...form, whatsapp })} keyboardType="phone-pad" placeholder="Si se deja vacío, usaremos el teléfono" />
        <Input label="Correo electrónico (opcional)" value={form.email} onChangeText={(email) => setForm({ ...form, email })} keyboardType="email-address" />
        <Text style={styles.formSection}>PRIMERA PROPIEDAD</Text>
        <Input label="Dirección" value={form.address} onChangeText={(address) => setForm({ ...form, address })} />
        <Input label="Zona" value={form.zone} onChangeText={(zone) => setForm({ ...form, zone })} />
        <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowCreate(false)} /><Button label={saving ? 'Guardando…' : 'Guardar cliente'} disabled={saving} onPress={() => void createClient()} /></View>
      </AppModal>

      <AppModal visible={showProperty} title="Agregar propiedad" onClose={() => !saving && setShowProperty(false)}>
        {screenMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{screenMessage}</Text></View> : null}
        <Input label="Nombre para identificarla" value={propertyForm.name} onChangeText={(name) => setPropertyForm({ ...propertyForm, name })} placeholder="Ej. Casa principal, Apartamento 4B, Oficina" />
        <Text style={styles.inputLabel}>Tipo de propiedad</Text>
        <View style={styles.typeWrap}>{propertyTypes.map((type) => <Pressable key={type} onPress={() => setPropertyForm({ ...propertyForm, type })} style={[styles.typeButton, propertyForm.type === type && styles.typeButtonActive]}><Text style={[styles.typeText, propertyForm.type === type && styles.typeTextActive]}>{type}</Text></Pressable>)}</View>
        <Input label="Dirección" value={propertyForm.address} onChangeText={(address) => setPropertyForm({ ...propertyForm, address })} />
        <Input label="Zona" value={propertyForm.zone} onChangeText={(zone) => setPropertyForm({ ...propertyForm, zone })} />
        <Input label="Notas de acceso (opcional)" value={propertyForm.notes} onChangeText={(notes) => setPropertyForm({ ...propertyForm, notes })} multiline placeholder="Ej. Portón lateral, llamar al llegar, apartamento en segundo piso…" />
        <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowProperty(false)} /><Button label={saving ? 'Guardando…' : 'Guardar propiedad'} disabled={saving} onPress={() => void createProperty()} /></View>
      </AppModal>

      <AppModal visible={showContact} title="Agregar contacto de propiedad" onClose={() => !saving && setShowContact(false)}>
        {screenMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{screenMessage}</Text></View> : null}
        <Input label="Nombre completo" value={contactForm.name} onChangeText={(name) => setContactForm({ ...contactForm, name })} />
        <Text style={styles.inputLabel}>Función en la propiedad</Text>
        <View style={styles.typeWrap}>{propertyContactRoles.map((role) => <Pressable key={role} onPress={() => setContactForm({ ...contactForm, role })} style={[styles.typeButton, contactForm.role === role && styles.typeButtonActive]}><Text style={[styles.typeText, contactForm.role === role && styles.typeTextActive]}>{role}</Text></Pressable>)}</View>
        <Input label="Teléfono" value={contactForm.phone} onChangeText={(phone) => setContactForm({ ...contactForm, phone })} keyboardType="phone-pad" />
        <Input label="WhatsApp" value={contactForm.whatsapp} onChangeText={(whatsapp) => setContactForm({ ...contactForm, whatsapp })} keyboardType="phone-pad" placeholder="Si es igual, puede quedar vacío" />
        <Input label="Correo electrónico (opcional)" value={contactForm.email} onChangeText={(email) => setContactForm({ ...contactForm, email })} keyboardType="email-address" />
        <Text style={styles.inputLabel}>Idioma preferido</Text>
        <View style={styles.typeWrap}>{propertyContactLanguages.map((preferredLanguage) => <Pressable key={preferredLanguage} onPress={() => setContactForm({ ...contactForm, preferredLanguage })} style={[styles.typeButton, contactForm.preferredLanguage === preferredLanguage && styles.typeButtonActive]}><Text style={[styles.typeText, contactForm.preferredLanguage === preferredLanguage && styles.typeTextActive]}>{preferredLanguage}</Text></Pressable>)}</View>
        <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowContact(false)} /><Button label={saving ? 'Guardando…' : 'Guardar contacto'} disabled={saving} onPress={() => void createPropertyContact()} /></View>
      </AppModal>

      <AppModal visible={Boolean(propertyToDelete)} title="Quitar propiedad" onClose={() => !saving && setPropertyToDelete(null)}>
        <Text style={styles.confirmText}>¿Seguro que deseas quitar <Text style={styles.confirmStrong}>{propertyToDelete?.name}</Text>? Los trabajos anteriores conservarán la dirección que tenían.</Text>
        <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setPropertyToDelete(null)} /><Button variant="danger" label={saving ? 'Quitando…' : 'Quitar propiedad'} disabled={saving} onPress={() => void confirmRemoveProperty()} /></View>
      </AppModal>
    </ScrollView>
  );
}

function initials(name: string) { return name.split(' ').filter(Boolean).map((word) => word[0]).slice(0, 2).join('').toUpperCase(); }
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoItem}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#F2B8B5', backgroundColor: colors.dangerLight, borderRadius: 10, padding: 14 },
  errorTitle: { color: colors.danger, fontWeight: '900', fontSize: 13 },
  errorText: { color: colors.text, fontSize: 11, marginTop: 3 },
  summaryBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 12 },
  summaryText: { color: colors.muted, fontSize: 12 },
  summaryStrong: { color: colors.text, fontWeight: '900', fontSize: 16 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  listCard: { flex: 1, minWidth: 320, maxWidth: 470 },
  detailColumn: { flex: 1.8, minWidth: 340, gap: 18 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, marginBottom: 5, borderWidth: 1, borderColor: 'transparent' },
  clientRowActive: { backgroundColor: colors.primaryLight, borderColor: '#B7DEB0' },
  avatar: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F1FF' },
  avatarLarge: { width: 58, height: 58, borderRadius: 16 },
  avatarText: { color: colors.primary, fontWeight: '900', fontSize: 12 },
  clientName: { color: colors.text, fontWeight: '900', fontSize: 13 },
  clientMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  propertyCount: { color: colors.primaryDark, fontSize: 9, fontWeight: '800', marginTop: 3 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  detailName: { color: colors.text, fontWeight: '900', fontSize: 20 },
  detailCompany: { color: colors.muted, marginTop: 4 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 20, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border },
  infoItem: { minWidth: 150, flex: 1 },
  infoLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  infoValue: { color: colors.text, fontSize: 13, marginTop: 5, fontWeight: '700' },
  propertyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  propertyIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  propertyIconText: { color: colors.primaryDark, fontSize: 20, fontWeight: '900' },
  propertyTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  propertyName: { color: colors.text, fontWeight: '900', fontSize: 14 },
  propertyAddress: { color: colors.text, fontSize: 12, marginTop: 5 },
  propertyMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  propertyContactLine: { color: colors.primaryDark, fontSize: 9, fontWeight: '700', marginTop: 5 },
  equipmentRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  equipmentIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  equipmentName: { color: colors.text, fontWeight: '900', fontSize: 13 },
  equipmentMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  equipmentSerial: { color: colors.muted, fontSize: 9, marginTop: 3 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  historyDate: { color: colors.primary, fontWeight: '900', fontSize: 11, width: 80 },
  historyId: { color: colors.text, fontWeight: '800', fontSize: 11 },
  historyProblem: { color: colors.muted, fontSize: 10, marginTop: 3 },
  changeHistoryRow: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  changeHistoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  changeHistoryTitle: { color: colors.text, fontWeight: '900', fontSize: 12 },
  changeHistoryProperty: { color: colors.primaryDark, fontSize: 10, fontWeight: '800', marginTop: 5 },
  changeHistoryReason: { color: colors.text, fontSize: 11, fontWeight: '800', marginTop: 7 },
  changeHistoryNote: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 4 },
  changeHistoryMeta: { color: colors.muted, fontSize: 9, marginTop: 7 },
  changeHistoryNewDate: { color: colors.primaryDark, fontWeight: '800', fontSize: 10, marginTop: 5 },
  formError: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10, marginBottom: 12 },
  formErrorText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  formSection: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 8, marginBottom: 10 },
  inputLabel: { color: colors.text, fontWeight: '700', fontSize: 13, marginBottom: 8 },
  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  typeButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#FFFFFF' },
  typeButtonActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  typeTextActive: { color: colors.primaryDark },
  confirmText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  confirmStrong: { fontWeight: '900' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 12 },
});
