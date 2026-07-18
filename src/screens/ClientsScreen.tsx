import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
import { PhoneField } from '../components/PhoneField';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { Client, ClientLifecycleEntry, PreferredLanguage, Property, PropertyContact, PropertyContactLanguage, PropertyContactRole, PropertyType } from '../types';
import { DEFAULT_PHONE_COUNTRY, formatStoredPhone, normalizePhone, phoneComparisonKey, templateLanguageFor } from '../utils/phone';

const propertyTypes: PropertyType[] = ['Casa', 'Apartamento', 'Oficina', 'Local comercial', 'Otro'];
const propertyContactRoles: PropertyContactRole[] = ['Dueño', 'Encargado', 'Administrador', 'Inquilino', 'Contacto de acceso', 'Contabilidad', 'Otro'];
const languages: PreferredLanguage[] = ['Español', 'English', 'Nederlands', 'Papiamento'];
type ClientFilter = 'Activos' | 'Archivados' | 'Todos';
type DuplicateResolution = 'block' | 'shared' | 'reassign';

const emptyContact = { name: '', role: 'Encargado' as PropertyContactRole, phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY as string, whatsapp: '', whatsappCountry: DEFAULT_PHONE_COUNTRY as string, email: '', preferredLanguage: 'Español' as PropertyContactLanguage, defaultSendConfirmation: false, defaultSendReminder: true, arrivalContact: true };

export function ClientsScreen() {
  const {
    currentUser, clients, properties, equipment, workOrders, invoices,
    addClient, updateClient, deleteTestClient,
    addProperty, updateProperty, removeProperty,
    dataError, dataLoading, refreshOperationalData, clearDataError,
  } = useAppState();

  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<ClientFilter>('Activos');
  const [selectedId, setSelectedId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showEditClient, setShowEditClient] = useState(false);
  const [showProperty, setShowProperty] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactPropertyId, setContactPropertyId] = useState('');
  const [editingContactId, setEditingContactId] = useState('');
  const [contactForm, setContactForm] = useState(emptyContact);
  const [propertyToRemove, setPropertyToRemove] = useState<Property | null>(null);
  const [clientAction, setClientAction] = useState<'archive' | 'delete' | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [duplicateResolution, setDuplicateResolution] = useState<DuplicateResolution>('block');
  const [duplicateReason, setDuplicateReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [screenMessage, setScreenMessage] = useState('');
  const [form, setForm] = useState({ name: '', company: '', phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY as string, whatsapp: '', whatsappCountry: DEFAULT_PHONE_COUNTRY as string, email: '', preferredLanguage: 'Español' as PreferredLanguage, address: '', zone: 'Oranjestad' });
  const [editForm, setEditForm] = useState({ name: '', company: '', phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY as string, whatsapp: '', whatsappCountry: DEFAULT_PHONE_COUNTRY as string, email: '', preferredLanguage: 'Español' as PreferredLanguage });
  const [propertyForm, setPropertyForm] = useState({ name: 'Propiedad principal', type: 'Casa' as PropertyType, address: '', zone: 'Oranjestad', notes: '' });

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return clients.filter((client) => {
      const activeMatch = clientFilter === 'Todos' || (clientFilter === 'Activos' ? client.active !== false : client.active === false);
      if (!activeMatch) return false;
      if (!normalizedQuery) return true;
      const propertyText = properties.filter((property) => property.clientId === client.id).map((property) => `${property.name} ${property.address} ${property.zone}`).join(' ');
      return `${client.name} ${client.company ?? ''} ${client.phone} ${client.whatsapp} ${client.email ?? ''} ${propertyText}`.toLowerCase().includes(normalizedQuery);
    });
  }, [clients, properties, query, clientFilter]);

  useEffect(() => {
    if (!filtered.length) return setSelectedId('');
    if (!filtered.some((client) => client.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = clients.find((client) => client.id === selectedId);
  const selectedProperties = properties.filter((property) => property.clientId === selectedId).sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name));
  const clientEquipment = equipment.filter((item) => item.clientId === selectedId);
  const clientOrders = workOrders.filter((item) => item.clientId === selectedId);
  const clientInvoices = invoices.filter((item) => item.clientId === selectedId);
  const protectedOrders = clientOrders.filter((order) => ['Completada', 'Facturada', 'Pagada'].includes(order.status) || order.reportGenerated || order.diagnosis || order.workPerformed || order.customerSignature || order.paid > 0);
  const appointmentChanges = clientOrders.flatMap((order) => (order.scheduleHistory ?? []).map((entry) => ({ order, entry }))).sort((a, b) => b.entry.recordedAt.localeCompare(a.entry.recordedAt));
  const canHardDelete = ['admin', 'supervisor'].includes(currentUser?.role ?? '');
  const safeToDelete = protectedOrders.length === 0 && clientEquipment.length === 0 && clientInvoices.length === 0 && (selected?.balance ?? 0) <= 0;

  const duplicateClientFor = (phone: string, phoneCountry: string, whatsapp: string, whatsappCountry: string, ignoreId?: string) => {
    const keys = [phoneComparisonKey(phone, phoneCountry), phoneComparisonKey(whatsapp || phone, whatsapp ? whatsappCountry : phoneCountry)].filter(Boolean);
    return clients.find((client) => client.id !== ignoreId && [phoneComparisonKey(client.phone, client.phoneCountry), phoneComparisonKey(client.whatsapp, client.whatsappCountry)].some((key) => keys.includes(key)));
  };

  const phonePreview = form.phone.trim() ? normalizePhone(form.phone, form.phoneCountry) : undefined;
  const whatsappPreview = form.whatsapp.trim() ? normalizePhone(form.whatsapp, form.whatsappCountry) : phonePreview;
  const duplicateMatch = phonePreview?.valid && whatsappPreview?.valid ? duplicateClientFor(phonePreview.e164, phonePreview.country, whatsappPreview.e164, whatsappPreview.country) : undefined;

  useEffect(() => {
    setDuplicateResolution('block');
    setDuplicateReason('');
  }, [duplicateMatch?.id]);

  const lifecycleEntry = (action: ClientLifecycleEntry['action'], reason: string): ClientLifecycleEntry => ({
    id: `lifecycle-${Date.now()}`,
    action,
    reason,
    performedAt: new Date().toISOString(),
    performedById: currentUser?.id,
    performedByName: currentUser?.name ?? 'Usuario DEMAC',
  });

  const resetClientForm = () => {
    setForm({ name: '', company: '', phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY, whatsapp: '', whatsappCountry: DEFAULT_PHONE_COUNTRY, email: '', preferredLanguage: 'Español', address: '', zone: 'Oranjestad' });
    setDuplicateResolution('block');
    setDuplicateReason('');
  };

  const createClient = async () => {
    setScreenMessage('');
    clearDataError();
    if (!form.name.trim()) return setScreenMessage('Escribe el nombre del cliente o de la empresa.');
    if (!form.phone.trim()) return setScreenMessage('Escribe el teléfono del cliente.');
    if (!form.address.trim()) return setScreenMessage('Escribe la dirección de la primera propiedad.');
    const normalizedPhone = normalizePhone(form.phone, form.phoneCountry);
    const normalizedWhatsApp = normalizePhone(form.whatsapp.trim() || form.phone, form.whatsapp.trim() ? form.whatsappCountry : form.phoneCountry);
    if (!normalizedPhone.valid || !normalizedWhatsApp.valid) return setScreenMessage('Revisa el país y el número de teléfono o WhatsApp.');
    const duplicate = duplicateClientFor(normalizedPhone.e164, normalizedPhone.country, normalizedWhatsApp.e164, normalizedWhatsApp.country);
    if (duplicate && duplicateResolution === 'block') return setScreenMessage(`Este número ya pertenece a ${duplicate.name}. Abre ese cliente o selecciona una resolución.`);
    if (duplicate && !duplicateReason.trim()) return setScreenMessage('Escribe el motivo para compartir o reasignar este número.');

    setSaving(true);
    const now = new Date().toISOString();
    if (duplicate && duplicateResolution === 'reassign') {
      const samePhone = phoneComparisonKey(duplicate.phone, duplicate.phoneCountry) === phoneComparisonKey(normalizedPhone.e164, normalizedPhone.country);
      const sameWhatsapp = phoneComparisonKey(duplicate.whatsapp, duplicate.whatsappCountry) === phoneComparisonKey(normalizedWhatsApp.e164, normalizedWhatsApp.country);
      const transferResult = await updateClient(duplicate.id, {
        phone: samePhone ? '' : duplicate.phone,
        whatsapp: sameWhatsapp ? '' : duplicate.whatsapp,
        phoneHistory: [...(duplicate.phoneHistory ?? []), { id: `phone-history-${Date.now()}`, phone: normalizedPhone.e164, whatsapp: normalizedWhatsApp.e164, action: 'Reasignado', reason: duplicateReason.trim(), changedAt: now, changedById: currentUser?.id, changedByName: currentUser?.name ?? 'Usuario DEMAC' }],
        lifecycleHistory: [...(duplicate.lifecycleHistory ?? []), lifecycleEntry('Teléfono reasignado', duplicateReason.trim())],
      });
      if (!transferResult.ok) {
        setSaving(false);
        return setScreenMessage(transferResult.message ?? 'No se pudo liberar el número del cliente anterior.');
      }
    }

    const timestamp = Date.now();
    const client: Client = {
      id: `client-${timestamp}`,
      name: form.name.trim(), company: form.company.trim() || undefined,
      phone: normalizedPhone.e164, phoneCountry: normalizedPhone.country,
      whatsapp: normalizedWhatsApp.e164, whatsappCountry: normalizedWhatsApp.country,
      email: form.email.trim() || undefined,
      preferredLanguage: form.preferredLanguage, templateLanguage: templateLanguageFor(form.preferredLanguage),
      address: form.address.trim(), zone: form.zone.trim() || 'Aruba', balance: 0, equipmentCount: 0,
      active: true,
      phoneSharedWithClientIds: duplicate && duplicateResolution === 'shared' ? [duplicate.id] : undefined,
      phoneSharedReason: duplicate && duplicateResolution === 'shared' ? duplicateReason.trim() : undefined,
      phoneHistory: duplicate ? [{ id: `phone-history-${timestamp}`, phone: normalizedPhone.e164, whatsapp: normalizedWhatsApp.e164, action: duplicateResolution === 'shared' ? 'Compartido' : 'Reasignado', reason: duplicateReason.trim(), changedAt: now, changedById: currentUser?.id, changedByName: currentUser?.name ?? 'Usuario DEMAC' }] : undefined,
      lifecycleHistory: [lifecycleEntry('Creado', duplicate ? duplicateReason.trim() : 'Cliente registrado.')],
      createdAt: now, updatedAt: now,
    };
    const initialProperty: Property = { id: `property-${timestamp}`, clientId: client.id, name: 'Propiedad principal', type: 'Casa', address: client.address, zone: client.zone, active: true, createdAt: now, updatedAt: now };
    const clientResult = await addClient(client);
    if (!clientResult.ok) { setSaving(false); return setScreenMessage(clientResult.message ?? 'No se pudo guardar el cliente.'); }
    const propertyResult = await addProperty(initialProperty);
    setSaving(false);
    setSelectedId(client.id);
    resetClientForm();
    setShowCreate(false);
    if (!propertyResult.ok) setScreenMessage(propertyResult.message ?? 'El cliente se guardó, pero no se pudo crear la propiedad principal.');
  };

  const openExistingDuplicate = () => {
    if (!duplicateMatch) return;
    setSelectedId(duplicateMatch.id);
    setClientFilter(duplicateMatch.active === false ? 'Archivados' : 'Activos');
    setShowCreate(false);
  };

  const openEditClient = (client = selected) => {
    if (!client) return;
    setSelectedId(client.id);
    setEditForm({ name: client.name, company: client.company ?? '', phone: client.phone, phoneCountry: client.phoneCountry ?? DEFAULT_PHONE_COUNTRY, whatsapp: client.whatsapp, whatsappCountry: client.whatsappCountry ?? client.phoneCountry ?? DEFAULT_PHONE_COUNTRY, email: client.email ?? '', preferredLanguage: client.preferredLanguage ?? 'English' });
    setShowCreate(false);
    setShowEditClient(true);
  };

  const saveEditedClient = async () => {
    if (!selected) return;
    const normalizedPhone = normalizePhone(editForm.phone, editForm.phoneCountry);
    const normalizedWhatsApp = normalizePhone(editForm.whatsapp.trim() || editForm.phone, editForm.whatsapp.trim() ? editForm.whatsappCountry : editForm.phoneCountry);
    if (!editForm.name.trim() || !normalizedPhone.valid || !normalizedWhatsApp.valid) return setScreenMessage('Revisa el nombre, teléfono y WhatsApp.');
    const duplicate = duplicateClientFor(normalizedPhone.e164, normalizedPhone.country, normalizedWhatsApp.e164, normalizedWhatsApp.country, selected.id);
    if (duplicate) return setScreenMessage(`Este número ya está vinculado a ${duplicate.name}. Resuelve el número desde “Nuevo cliente”.`);
    setSaving(true);
    const result = await updateClient(selected.id, { name: editForm.name.trim(), company: editForm.company.trim() || undefined, phone: normalizedPhone.e164, phoneCountry: normalizedPhone.country, whatsapp: normalizedWhatsApp.e164, whatsappCountry: normalizedWhatsApp.country, email: editForm.email.trim() || undefined, preferredLanguage: editForm.preferredLanguage, templateLanguage: templateLanguageFor(editForm.preferredLanguage) });
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo actualizar el cliente.');
    setShowEditClient(false);
  };

  const archiveSelected = async () => {
    if (!selected || !actionReason.trim()) return setScreenMessage('Escribe el motivo para archivar el cliente.');
    setSaving(true);
    const now = new Date().toISOString();
    const result = await updateClient(selected.id, { active: false, archivedAt: now, archivedById: currentUser?.id, archivedByName: currentUser?.name ?? 'Usuario DEMAC', archiveReason: actionReason.trim(), lifecycleHistory: [...(selected.lifecycleHistory ?? []), lifecycleEntry('Archivado', actionReason.trim())] });
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo archivar el cliente.');
    setClientAction(null); setActionReason(''); setClientFilter('Activos');
  };

  const restoreSelected = async () => {
    if (!selected) return;
    setSaving(true);
    const result = await updateClient(selected.id, { active: true, archivedAt: undefined, archivedById: undefined, archivedByName: undefined, archiveReason: undefined, lifecycleHistory: [...(selected.lifecycleHistory ?? []), lifecycleEntry('Restaurado', 'Cliente restaurado para nuevas operaciones.')] });
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo restaurar el cliente.');
    setClientFilter('Activos');
  };

  const permanentlyDeleteSelected = async () => {
    if (!selected || deleteConfirmation.trim().toUpperCase() !== 'ELIMINAR') return setScreenMessage('Escribe ELIMINAR para confirmar.');
    setSaving(true);
    const result = await deleteTestClient(selected.id);
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo eliminar el cliente.');
    setClientAction(null); setDeleteConfirmation(''); setSelectedId('');
  };

  const openPropertyModal = () => {
    if (!selected) return;
    setPropertyForm({ name: `Propiedad ${selectedProperties.length + 1}`, type: 'Casa', address: '', zone: selected.zone || 'Oranjestad', notes: '' });
    setShowProperty(true);
  };

  const createProperty = async () => {
    if (!selected || !propertyForm.name.trim() || !propertyForm.address.trim()) return setScreenMessage('Escribe el nombre y la dirección de la propiedad.');
    const now = new Date().toISOString();
    setSaving(true);
    const result = await addProperty({ id: `property-${Date.now()}`, clientId: selected.id, name: propertyForm.name.trim(), type: propertyForm.type, address: propertyForm.address.trim(), zone: propertyForm.zone.trim() || 'Aruba', notes: propertyForm.notes.trim() || undefined, active: true, createdAt: now, updatedAt: now });
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo guardar la propiedad.');
    setShowProperty(false);
  };

  const openContactModal = (property: Property, contact?: PropertyContact) => {
    setContactPropertyId(property.id);
    setEditingContactId(contact?.id ?? '');
    setContactForm(contact ? { name: contact.name, role: contact.role, phone: contact.phone, phoneCountry: contact.phoneCountry ?? DEFAULT_PHONE_COUNTRY, whatsapp: contact.whatsapp, whatsappCountry: contact.whatsappCountry ?? contact.phoneCountry ?? DEFAULT_PHONE_COUNTRY, email: contact.email ?? '', preferredLanguage: contact.preferredLanguage, defaultSendConfirmation: contact.defaultSendConfirmation === true, defaultSendReminder: contact.defaultSendReminder === true, arrivalContact: contact.arrivalContact === true } : emptyContact);
    setShowContact(true);
  };

  const savePropertyContact = async () => {
    const property = properties.find((item) => item.id === contactPropertyId);
    if (!property || !contactForm.name.trim() || (!contactForm.phone.trim() && !contactForm.whatsapp.trim())) return setScreenMessage('Escribe el nombre y al menos un teléfono o WhatsApp.');
    const normalizedPhone = normalizePhone(contactForm.phone.trim() || contactForm.whatsapp, contactForm.phone.trim() ? contactForm.phoneCountry : contactForm.whatsappCountry);
    const normalizedWhatsApp = normalizePhone(contactForm.whatsapp.trim() || contactForm.phone, contactForm.whatsapp.trim() ? contactForm.whatsappCountry : contactForm.phoneCountry);
    if (!normalizedPhone.valid || !normalizedWhatsApp.valid) return setScreenMessage('Revisa el país y el número del contacto.');
    const now = new Date().toISOString();
    const existing = (property.contacts ?? []).find((contact) => contact.id === editingContactId);
    const contact: PropertyContact = { id: existing?.id ?? `contact-${Date.now()}`, name: contactForm.name.trim(), role: contactForm.role, phone: normalizedPhone.e164, phoneCountry: normalizedPhone.country, whatsapp: normalizedWhatsApp.e164, whatsappCountry: normalizedWhatsApp.country, email: contactForm.email.trim() || undefined, preferredLanguage: contactForm.preferredLanguage, defaultSendConfirmation: contactForm.defaultSendConfirmation, defaultSendReminder: contactForm.defaultSendReminder, arrivalContact: contactForm.arrivalContact, active: existing?.active ?? true, createdAt: existing?.createdAt ?? now, updatedAt: now };
    const contacts = existing ? (property.contacts ?? []).map((item) => item.id === existing.id ? contact : item) : [...(property.contacts ?? []), contact];
    setSaving(true);
    const result = await updateProperty(property.id, { contacts, updatedAt: now });
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo guardar el contacto.');
    setShowContact(false); setEditingContactId('');
  };

  const toggleContact = async (property: Property, contact: PropertyContact) => {
    const nextActive = contact.active === false;
    const contacts = (property.contacts ?? []).map((item) => item.id === contact.id ? { ...item, active: nextActive, inactiveReason: nextActive ? undefined : 'Contacto desactivado desde el perfil de la propiedad.', updatedAt: new Date().toISOString() } : item);
    const result = await updateProperty(property.id, { contacts });
    if (!result.ok) setScreenMessage(result.message ?? 'No se pudo actualizar el contacto.');
  };

  const removeContact = async (property: Property, contact: PropertyContact) => {
    const referenced = workOrders.some((order) => (order.notificationRecipients ?? []).some((recipient) => recipient.sourceId === contact.id));
    const contacts = referenced ? (property.contacts ?? []).map((item) => item.id === contact.id ? { ...item, active: false, inactiveReason: 'Conservado porque aparece en notificaciones anteriores.' } : item) : (property.contacts ?? []).filter((item) => item.id !== contact.id);
    const result = await updateProperty(property.id, { contacts });
    if (!result.ok) setScreenMessage(result.message ?? 'No se pudo quitar el contacto.');
    else if (referenced) setScreenMessage('El contacto se desactivó porque aparece en el historial de una cita.');
  };

  const confirmPropertyRemoval = async () => {
    if (!propertyToRemove) return;
    const linked = workOrders.filter((order) => order.propertyId === propertyToRemove.id);
    setSaving(true);
    const result = linked.length ? await updateProperty(propertyToRemove.id, { active: false, archivedAt: new Date().toISOString(), archivedById: currentUser?.id, archivedByName: currentUser?.name ?? 'Usuario DEMAC', archiveReason: 'Propiedad retirada del uso activo; conserva historial.' }) : await removeProperty(propertyToRemove.id);
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo retirar la propiedad.');
    setPropertyToRemove(null);
  };

  const restoreProperty = async (property: Property) => {
    const result = await updateProperty(property.id, { active: true, archivedAt: undefined, archivedById: undefined, archivedByName: undefined, archiveReason: undefined });
    if (!result.ok) setScreenMessage(result.message ?? 'No se pudo restaurar la propiedad.');
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {dataError || screenMessage ? <View style={styles.errorBanner}><View style={{ flex: 1 }}><Text style={styles.errorTitle}>Revisa esta operación</Text><Text style={styles.errorText}>{screenMessage || dataError}</Text></View>{dataError ? <Button compact variant="secondary" label="Reintentar" onPress={() => void refreshOperationalData()} /> : <Button compact variant="ghost" label="Cerrar" onPress={() => setScreenMessage('')} />}</View> : null}
      <SectionTitle title="Clientes y propiedades" subtitle="Administra clientes activos, archivados, propiedades, contactos e historial." action={<Button label="Nuevo cliente" icon="＋" onPress={() => { setScreenMessage(''); clearDataError(); resetClientForm(); setShowCreate(true); }} />} />
      <View style={styles.summaryBar}><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{clients.filter((client) => client.active !== false).length}</Text> activos</Text><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{clients.filter((client) => client.active === false).length}</Text> archivados</Text><Text style={styles.summaryText}><Text style={styles.summaryStrong}>{properties.filter((property) => property.active !== false).length}</Text> propiedades activas</Text><Button compact variant="ghost" label={dataLoading ? 'Sincronizando…' : 'Actualizar'} disabled={dataLoading} onPress={() => void refreshOperationalData()} /></View>
      <View style={styles.filterRow}>{(['Activos', 'Archivados', 'Todos'] as ClientFilter[]).map((item) => <Button key={item} compact variant={clientFilter === item ? 'primary' : 'secondary'} label={item} onPress={() => setClientFilter(item)} />)}</View>

      <View style={styles.columns}>
        <Card style={styles.listCard}>
          <Input placeholder="Buscar cliente, teléfono, empresa o dirección…" value={query} onChangeText={setQuery} />
          {filtered.length ? filtered.map((client) => {
            const propertyCount = properties.filter((property) => property.clientId === client.id && property.active !== false).length;
            return <Pressable key={client.id} onPress={() => setSelectedId(client.id)} style={[styles.clientRow, selectedId === client.id && styles.clientRowActive]}><View style={styles.avatar}><Text style={styles.avatarText}>{initials(client.name)}</Text></View><View style={{ flex: 1 }}><Text style={styles.clientName}>{client.name}</Text><Text style={styles.clientMeta}>{client.company || formatStoredPhone(client.phone, client.phoneCountry)}</Text><Text style={styles.propertyCount}>{propertyCount} propiedad{propertyCount === 1 ? '' : 'es'}</Text></View>{client.active === false ? <Pill label="Archivado" tone="neutral" /> : client.balance > 0 ? <Pill label={formatMoney(client.balance)} tone="warning" /> : <Pill label="Activo" tone="success" />}</Pressable>;
          }) : <EmptyState icon="👥" title="Sin resultados" message="No hay clientes para este filtro o búsqueda." />}
        </Card>

        <View style={styles.detailColumn}>
          {selected ? <>
            <Card>
              <View style={styles.detailHeader}><View style={[styles.avatar, styles.avatarLarge]}><Text style={[styles.avatarText, { fontSize: 18 }]}>{initials(selected.name)}</Text></View><View style={{ flex: 1 }}><Text style={styles.detailName}>{selected.name}</Text><Text style={styles.detailCompany}>{selected.company || 'Cliente residencial'}</Text></View><View style={styles.headerActions}><Button compact variant="secondary" label="Editar" onPress={() => openEditClient()} />{selected.active === false ? <Button compact variant="success" label="Restaurar" onPress={() => void restoreSelected()} /> : <Button compact variant="ghost" label="Archivar" onPress={() => { setActionReason(''); setClientAction('archive'); }} />}{canHardDelete ? <Button compact variant="danger" label="Eliminar prueba" onPress={() => { setDeleteConfirmation(''); setClientAction('delete'); }} /> : null}</View></View>
              <View style={styles.infoGrid}><Info label="Teléfono" value={formatStoredPhone(selected.phone, selected.phoneCountry) || 'Sin teléfono activo'} /><Info label="WhatsApp" value={formatStoredPhone(selected.whatsapp, selected.whatsappCountry) || 'Sin WhatsApp activo'} /><Info label="Idioma preferido" value={selected.preferredLanguage ?? 'English (registro anterior)'} /><Info label="Correo" value={selected.email || 'No registrado'} /><Info label="Estado" value={selected.active === false ? `Archivado · ${selected.archiveReason ?? 'Sin motivo'}` : 'Activo'} /></View>
            </Card>

            <Card>
              <SectionTitle title={`Propiedades / lugares de servicio (${selectedProperties.length})`} subtitle="Las propiedades con historial se archivan; no se eliminan." action={<Button compact label="Agregar propiedad" icon="＋" onPress={openPropertyModal} />} />
              {selectedProperties.length ? selectedProperties.map((property) => {
                const linkedWorkCount = workOrders.filter((order) => order.propertyId === property.id).length;
                return <View key={property.id} style={[styles.propertyRow, property.active === false && styles.inactiveRow]}><View style={styles.propertyIcon}><Text style={styles.propertyIconText}>{property.type === 'Apartamento' ? '▦' : property.type === 'Oficina' || property.type === 'Local comercial' ? '▥' : '⌂'}</Text></View><View style={{ flex: 1 }}><View style={styles.propertyTitleRow}><Text style={styles.propertyName}>{property.name}</Text><Pill label={property.type} tone="neutral" />{property.active === false ? <Pill label="Archivada" tone="warning" /> : null}</View><Text style={styles.propertyAddress}>{property.address}</Text><Text style={styles.propertyMeta}>{property.zone}{property.notes ? ` · ${property.notes}` : ''} · {linkedWorkCount} trabajo(s)</Text>{(property.contacts ?? []).map((contact) => <View key={contact.id} style={[styles.contactRow, contact.active === false && styles.contactInactive]}><View style={{ flex: 1 }}><Text style={styles.contactName}>{contact.name} · {contact.role}</Text><Text style={styles.propertyContactLine}>{formatStoredPhone(contact.whatsapp || contact.phone, contact.whatsappCountry || contact.phoneCountry)} · {contact.preferredLanguage}{contact.arrivalContact ? ' · Contacto de llegada' : ''}{contact.defaultSendConfirmation ? ' · Confirmación' : ''}{contact.defaultSendReminder ? ' · Recordatorio' : ''}{contact.active === false ? ' · Inactivo' : ''}</Text></View><View style={styles.smallActions}><Button compact variant="secondary" label="Editar" onPress={() => openContactModal(property, contact)} /><Button compact variant="ghost" label={contact.active === false ? 'Restaurar' : 'Desactivar'} onPress={() => void toggleContact(property, contact)} /><Button compact variant="ghost" label="Quitar" onPress={() => void removeContact(property, contact)} /></View></View>)}</View><View style={{ gap: 6 }}><Button compact variant="secondary" label="Agregar contacto" onPress={() => openContactModal(property)} />{property.active === false ? <Button compact variant="success" label="Restaurar" onPress={() => void restoreProperty(property)} /> : <Button compact variant="ghost" label={linkedWorkCount ? 'Archivar' : 'Eliminar'} onPress={() => setPropertyToRemove(property)} />}</View></View>;
              }) : <EmptyState icon="⌂" title="Sin propiedades" message="Agrega una casa, apartamento, oficina o local." />}
            </Card>

            <Card><SectionTitle title={`Equipos registrados (${clientEquipment.length})`} />{clientEquipment.length ? clientEquipment.map((item) => <View key={item.id} style={styles.equipmentRow}><View style={styles.equipmentIcon}><Text>❄️</Text></View><View style={{ flex: 1 }}><Text style={styles.equipmentName}>{item.brand} {item.model}</Text><Text style={styles.equipmentMeta}>{item.location} · {item.btu.toLocaleString()} BTU · {item.refrigerant} · {item.voltage}</Text></View><Pill label={item.condition} tone={item.condition === 'Fuera de servicio' ? 'danger' : item.condition === 'Requiere atención' ? 'warning' : 'success'} /></View>) : <EmptyState icon="❄️" title="Sin equipos" message="Este cliente todavía no tiene equipos registrados." />}</Card>

            <Card><SectionTitle title={`Historial de citas canceladas o reprogramadas (${appointmentChanges.length})`} />{appointmentChanges.length ? appointmentChanges.map(({ order, entry }) => <View key={`${order.id}-${entry.id}`} style={styles.changeHistoryRow}><Text style={styles.changeHistoryTitle}>{entry.status} · {entry.date} · {entry.time}</Text><Text style={styles.changeHistoryReason}>Motivo: {entry.reasonCategory ?? 'No registrado'}</Text>{entry.reasonNote ? <Text style={styles.changeHistoryNote}>{entry.reasonNote}</Text> : null}<Text style={styles.changeHistoryMeta}>Origen: {entry.changeOrigin ?? 'No registrado'} · Registrado por: {entry.changedByName ?? 'No registrado'}</Text></View>) : <EmptyState icon="🗓️" title="Sin cambios" message="Las cancelaciones y reprogramaciones aparecerán aquí." />}</Card>
            <Card><SectionTitle title={`Historial de trabajos (${clientOrders.length})`} />{clientOrders.length ? clientOrders.map((order) => <View key={order.id} style={styles.historyRow}><Text style={styles.historyDate}>{order.date}</Text><View style={{ flex: 1 }}><Text style={styles.historyId}>{order.id}</Text><Text style={styles.historyProblem} numberOfLines={1}>{order.problem}</Text></View><Pill label={order.status} tone={order.status === 'Completada' ? 'success' : 'info'} /></View>) : <EmptyState icon="🧰" title="Sin trabajos" message="Las citas y órdenes aparecerán aquí." />}</Card>
          </> : <Card><EmptyState icon="👤" title="Selecciona un cliente" message="Selecciona un cliente del listado." /></Card>}
        </View>
      </View>

      <AppModal visible={showCreate} title="Registrar nuevo cliente" onClose={() => !saving && setShowCreate(false)}><ScrollView>{screenMessage ? <View style={styles.formError}><Text style={styles.formErrorText}>{screenMessage}</Text></View> : null}<Input label="Nombre completo o nombre comercial" value={form.name} onChangeText={(name) => setForm({ ...form, name })} /><Input label="Empresa (opcional)" value={form.company} onChangeText={(company) => setForm({ ...form, company })} /><PhoneField label="Teléfono" value={form.phone} country={form.phoneCountry} onChangeText={(phone) => setForm({ ...form, phone })} onCountryChange={(phoneCountry) => setForm((current) => ({ ...current, phoneCountry }))} /><PhoneField label="WhatsApp" value={form.whatsapp} country={form.whatsappCountry} onChangeText={(whatsapp) => setForm({ ...form, whatsapp })} onCountryChange={(whatsappCountry) => setForm((current) => ({ ...current, whatsappCountry }))} placeholder="Si queda vacío, usaremos el teléfono" />{duplicateMatch ? <View style={styles.duplicateCard}><Text style={styles.duplicateTitle}>POSIBLE CLIENTE EXISTENTE</Text><Text style={styles.duplicateName}>{duplicateMatch.name}</Text><Text style={styles.duplicateMeta}>{formatStoredPhone(duplicateMatch.whatsapp || duplicateMatch.phone, duplicateMatch.whatsappCountry || duplicateMatch.phoneCountry)} · {properties.filter((property) => property.clientId === duplicateMatch.id).length} propiedad(es)</Text><View style={styles.duplicateActions}><Button compact label="Abrir existente" onPress={openExistingDuplicate} /><Button compact variant="secondary" label="Corregir su nombre" onPress={() => openEditClient(duplicateMatch)} /><Button compact variant={duplicateResolution === 'shared' ? 'primary' : 'secondary'} label="Número compartido" onPress={() => setDuplicateResolution('shared')} /><Button compact variant={duplicateResolution === 'reassign' ? 'danger' : 'secondary'} label="Número cambió de persona" onPress={() => setDuplicateResolution('reassign')} /></View>{duplicateResolution !== 'block' ? <Input label="Motivo obligatorio" value={duplicateReason} onChangeText={setDuplicateReason} multiline placeholder="Ej. WhatsApp familiar compartido o número reasignado por la compañía telefónica." /> : null}</View> : null}<Text style={styles.inputLabel}>Idioma preferido</Text><View style={styles.typeWrap}>{languages.map((preferredLanguage) => <Pressable key={preferredLanguage} onPress={() => setForm({ ...form, preferredLanguage })} style={[styles.typeButton, form.preferredLanguage === preferredLanguage && styles.typeButtonActive]}><Text style={[styles.typeText, form.preferredLanguage === preferredLanguage && styles.typeTextActive]}>{preferredLanguage}</Text></Pressable>)}</View><Input label="Correo electrónico (opcional)" value={form.email} onChangeText={(email) => setForm({ ...form, email })} /><Text style={styles.formSection}>PRIMERA PROPIEDAD</Text><Input label="Dirección" value={form.address} onChangeText={(address) => setForm({ ...form, address })} /><Input label="Zona" value={form.zone} onChangeText={(zone) => setForm({ ...form, zone })} /><View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowCreate(false)} /><Button label={saving ? 'Guardando…' : 'Guardar cliente'} disabled={saving || Boolean(duplicateMatch && duplicateResolution === 'block')} onPress={() => void createClient()} /></View></ScrollView></AppModal>

      <AppModal visible={showEditClient} title="Editar cliente" onClose={() => !saving && setShowEditClient(false)}><ScrollView><Input label="Nombre completo o nombre comercial" value={editForm.name} onChangeText={(name) => setEditForm({ ...editForm, name })} /><Input label="Empresa (opcional)" value={editForm.company} onChangeText={(company) => setEditForm({ ...editForm, company })} /><PhoneField label="Teléfono" value={editForm.phone} country={editForm.phoneCountry} onChangeText={(phone) => setEditForm({ ...editForm, phone })} onCountryChange={(phoneCountry) => setEditForm((current) => ({ ...current, phoneCountry }))} /><PhoneField label="WhatsApp" value={editForm.whatsapp} country={editForm.whatsappCountry} onChangeText={(whatsapp) => setEditForm({ ...editForm, whatsapp })} onCountryChange={(whatsappCountry) => setEditForm((current) => ({ ...current, whatsappCountry }))} /><Text style={styles.inputLabel}>Idioma preferido</Text><View style={styles.typeWrap}>{languages.map((preferredLanguage) => <Pressable key={preferredLanguage} onPress={() => setEditForm({ ...editForm, preferredLanguage })} style={[styles.typeButton, editForm.preferredLanguage === preferredLanguage && styles.typeButtonActive]}><Text style={[styles.typeText, editForm.preferredLanguage === preferredLanguage && styles.typeTextActive]}>{preferredLanguage}</Text></Pressable>)}</View><Input label="Correo electrónico (opcional)" value={editForm.email} onChangeText={(email) => setEditForm({ ...editForm, email })} /><View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setShowEditClient(false)} /><Button label={saving ? 'Guardando…' : 'Guardar cambios'} disabled={saving} onPress={() => void saveEditedClient()} /></View></ScrollView></AppModal>

      <AppModal visible={showProperty} title="Agregar propiedad" onClose={() => !saving && setShowProperty(false)}><Input label="Nombre para identificarla" value={propertyForm.name} onChangeText={(name) => setPropertyForm({ ...propertyForm, name })} /><Text style={styles.inputLabel}>Tipo</Text><View style={styles.typeWrap}>{propertyTypes.map((type) => <Pressable key={type} onPress={() => setPropertyForm({ ...propertyForm, type })} style={[styles.typeButton, propertyForm.type === type && styles.typeButtonActive]}><Text style={[styles.typeText, propertyForm.type === type && styles.typeTextActive]}>{type}</Text></Pressable>)}</View><Input label="Dirección" value={propertyForm.address} onChangeText={(address) => setPropertyForm({ ...propertyForm, address })} /><Input label="Zona" value={propertyForm.zone} onChangeText={(zone) => setPropertyForm({ ...propertyForm, zone })} /><Input label="Notas de acceso" value={propertyForm.notes} onChangeText={(notes) => setPropertyForm({ ...propertyForm, notes })} multiline /><View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setShowProperty(false)} /><Button label={saving ? 'Guardando…' : 'Guardar propiedad'} disabled={saving} onPress={() => void createProperty()} /></View></AppModal>

      <AppModal visible={showContact} title={editingContactId ? 'Editar contacto' : 'Agregar contacto'} onClose={() => !saving && setShowContact(false)}><ScrollView><Input label="Nombre completo" value={contactForm.name} onChangeText={(name) => setContactForm({ ...contactForm, name })} /><Text style={styles.inputLabel}>Función</Text><View style={styles.typeWrap}>{propertyContactRoles.map((role) => <Pressable key={role} onPress={() => setContactForm({ ...contactForm, role })} style={[styles.typeButton, contactForm.role === role && styles.typeButtonActive]}><Text style={[styles.typeText, contactForm.role === role && styles.typeTextActive]}>{role}</Text></Pressable>)}</View><PhoneField label="Teléfono" value={contactForm.phone} country={contactForm.phoneCountry} onChangeText={(phone) => setContactForm({ ...contactForm, phone })} onCountryChange={(phoneCountry) => setContactForm((current) => ({ ...current, phoneCountry }))} /><PhoneField label="WhatsApp" value={contactForm.whatsapp} country={contactForm.whatsappCountry} onChangeText={(whatsapp) => setContactForm({ ...contactForm, whatsapp })} onCountryChange={(whatsappCountry) => setContactForm((current) => ({ ...current, whatsappCountry }))} /><Input label="Correo" value={contactForm.email} onChangeText={(email) => setContactForm({ ...contactForm, email })} /><Text style={styles.inputLabel}>Idioma</Text><View style={styles.typeWrap}>{languages.map((preferredLanguage) => <Pressable key={preferredLanguage} onPress={() => setContactForm({ ...contactForm, preferredLanguage })} style={[styles.typeButton, contactForm.preferredLanguage === preferredLanguage && styles.typeButtonActive]}><Text style={[styles.typeText, contactForm.preferredLanguage === preferredLanguage && styles.typeTextActive]}>{preferredLanguage}</Text></Pressable>)}</View><Text style={styles.inputLabel}>Preferencias operativas</Text><View style={styles.typeWrap}><Toggle label="Confirmación por defecto" active={contactForm.defaultSendConfirmation} onPress={() => setContactForm({ ...contactForm, defaultSendConfirmation: !contactForm.defaultSendConfirmation })} /><Toggle label="Recordatorio por defecto" active={contactForm.defaultSendReminder} onPress={() => setContactForm({ ...contactForm, defaultSendReminder: !contactForm.defaultSendReminder })} /><Toggle label="Llamar al llegar" active={contactForm.arrivalContact} onPress={() => setContactForm({ ...contactForm, arrivalContact: !contactForm.arrivalContact })} /></View><View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setShowContact(false)} /><Button label={saving ? 'Guardando…' : 'Guardar contacto'} disabled={saving} onPress={() => void savePropertyContact()} /></View></ScrollView></AppModal>

      <AppModal visible={clientAction === 'archive'} title="Archivar cliente" onClose={() => !saving && setClientAction(null)}><Text style={styles.confirmText}>El cliente dejará de aparecer al crear citas nuevas, pero conservará todo su historial.</Text><Input label="Motivo obligatorio" value={actionReason} onChangeText={setActionReason} multiline /><View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setClientAction(null)} /><Button label={saving ? 'Archivando…' : 'Archivar cliente'} disabled={saving} onPress={() => void archiveSelected()} /></View></AppModal>

      <AppModal visible={clientAction === 'delete'} title="Eliminar datos ficticios" onClose={() => !saving && setClientAction(null)}><ScrollView><Text style={styles.confirmText}>Esta operación elimina definitivamente al cliente y sus datos de prueba relacionados.</Text><View style={styles.dependencyBox}><Dependency label="Propiedades" value={selectedProperties.length} /><Dependency label="Citas / órdenes" value={clientOrders.length} /><Dependency label="Trabajos protegidos" value={protectedOrders.length} danger={protectedOrders.length > 0} /><Dependency label="Equipos" value={clientEquipment.length} danger={clientEquipment.length > 0} /><Dependency label="Facturas" value={clientInvoices.length} danger={clientInvoices.length > 0} /><Dependency label="Balance" value={formatMoney(selected?.balance ?? 0)} danger={(selected?.balance ?? 0) > 0} /></View>{safeToDelete ? <><Text style={styles.safeText}>Este registro parece contener solamente información de prueba. Escribe ELIMINAR para continuar.</Text><Input value={deleteConfirmation} onChangeText={setDeleteConfirmation} autoCapitalize="characters" placeholder="ELIMINAR" /></> : <Text style={styles.blockedText}>La eliminación está bloqueada porque existe historial real. Archiva el cliente.</Text>}<View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setClientAction(null)} /><Button variant="danger" label={saving ? 'Eliminando…' : 'Eliminar definitivamente'} disabled={saving || !safeToDelete || deleteConfirmation.trim().toUpperCase() !== 'ELIMINAR'} onPress={() => void permanentlyDeleteSelected()} /></View></ScrollView></AppModal>

      <AppModal visible={Boolean(propertyToRemove)} title={workOrders.some((order) => order.propertyId === propertyToRemove?.id) ? 'Archivar propiedad' : 'Eliminar propiedad'} onClose={() => !saving && setPropertyToRemove(null)}><Text style={styles.confirmText}>{workOrders.some((order) => order.propertyId === propertyToRemove?.id) ? 'Esta propiedad tiene historial y será archivada, no eliminada.' : 'Esta propiedad no tiene trabajos relacionados y puede eliminarse.'}</Text><View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setPropertyToRemove(null)} /><Button variant="danger" label={saving ? 'Procesando…' : 'Confirmar'} disabled={saving} onPress={() => void confirmPropertyRemoval()} /></View></AppModal>
    </ScrollView>
  );
}

function Toggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.typeButton, active && styles.typeButtonActive]}><Text style={[styles.typeText, active && styles.typeTextActive]}>{label}</Text></Pressable>; }
function Dependency({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) { return <View style={styles.dependencyRow}><Text style={styles.dependencyLabel}>{label}</Text><Text style={[styles.dependencyValue, danger && { color: colors.danger }]}>{value}</Text></View>; }
function initials(name: string) { return name.split(' ').filter(Boolean).map((word) => word[0]).slice(0, 2).join('').toUpperCase(); }
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.infoItem}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#F2B8B5', backgroundColor: colors.dangerLight, borderRadius: 10, padding: 14 },
  errorTitle: { color: colors.danger, fontWeight: '900', fontSize: 13 }, errorText: { color: colors.text, fontSize: 11, marginTop: 3 },
  summaryBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 12 },
  summaryText: { color: colors.muted, fontSize: 12 }, summaryStrong: { color: colors.text, fontWeight: '900', fontSize: 16 }, filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }, listCard: { flex: 1, minWidth: 320, maxWidth: 470 }, detailColumn: { flex: 1.8, minWidth: 340, gap: 18 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, marginBottom: 5, borderWidth: 1, borderColor: 'transparent' }, clientRowActive: { backgroundColor: colors.primaryLight, borderColor: '#B7DEB0' },
  avatar: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F1FF' }, avatarLarge: { width: 58, height: 58, borderRadius: 16 }, avatarText: { color: colors.primary, fontWeight: '900', fontSize: 12 },
  clientName: { color: colors.text, fontWeight: '900', fontSize: 13 }, clientMeta: { color: colors.muted, fontSize: 10, marginTop: 3 }, propertyCount: { color: colors.primaryDark, fontSize: 9, fontWeight: '800', marginTop: 3 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 13 }, detailName: { color: colors.text, fontWeight: '900', fontSize: 20 }, detailCompany: { color: colors.muted, marginTop: 4 }, headerActions: { gap: 7, alignItems: 'flex-end' },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 20, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border }, infoItem: { minWidth: 150, flex: 1 }, infoLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, infoValue: { color: colors.text, fontSize: 13, marginTop: 5, fontWeight: '700' },
  propertyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' }, inactiveRow: { opacity: 0.72, backgroundColor: '#FAFAFA' }, propertyIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, propertyIconText: { color: colors.primaryDark, fontSize: 20, fontWeight: '900' },
  propertyTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, propertyName: { color: colors.text, fontWeight: '900', fontSize: 14 }, propertyAddress: { color: colors.text, fontSize: 12, marginTop: 5 }, propertyMeta: { color: colors.muted, fontSize: 10, marginTop: 3 }, propertyContactLine: { color: colors.primaryDark, fontSize: 9, fontWeight: '700', marginTop: 3 },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 9, padding: 9, borderRadius: 9, backgroundColor: '#F7F9FC' }, contactInactive: { opacity: 0.6 }, contactName: { color: colors.text, fontSize: 10, fontWeight: '900' }, smallActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  equipmentRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' }, equipmentIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, equipmentName: { color: colors.text, fontWeight: '900', fontSize: 13 }, equipmentMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' }, historyDate: { color: colors.primary, fontWeight: '900', fontSize: 11, width: 80 }, historyId: { color: colors.text, fontWeight: '800', fontSize: 11 }, historyProblem: { color: colors.muted, fontSize: 10, marginTop: 3 },
  changeHistoryRow: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' }, changeHistoryTitle: { color: colors.text, fontWeight: '900', fontSize: 12 }, changeHistoryReason: { color: colors.text, fontSize: 11, fontWeight: '800', marginTop: 7 }, changeHistoryNote: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 4 }, changeHistoryMeta: { color: colors.muted, fontSize: 9, marginTop: 7 },
  formError: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10, marginBottom: 12 }, formErrorText: { color: colors.danger, fontSize: 11, fontWeight: '700' }, formSection: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 8, marginBottom: 10 }, inputLabel: { color: colors.text, fontWeight: '700', fontSize: 13, marginBottom: 8 },
  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 }, typeButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#FFFFFF' }, typeButtonActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, typeText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, typeTextActive: { color: colors.primaryDark },
  duplicateCard: { borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningLight, borderRadius: 10, padding: 13, marginBottom: 13 }, duplicateTitle: { color: colors.warning, fontWeight: '900', fontSize: 9, letterSpacing: 1 }, duplicateName: { color: colors.text, fontWeight: '900', fontSize: 16, marginTop: 5 }, duplicateMeta: { color: colors.muted, fontSize: 10, marginTop: 4 }, duplicateActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11, marginBottom: 8 },
  confirmText: { color: colors.text, fontSize: 14, lineHeight: 21 }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 12 }, dependencyBox: { marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 }, dependencyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }, dependencyLabel: { color: colors.muted, fontSize: 11 }, dependencyValue: { color: colors.text, fontSize: 11, fontWeight: '900' }, safeText: { color: colors.success, fontWeight: '800', marginTop: 14, lineHeight: 19 }, blockedText: { color: colors.danger, fontWeight: '800', marginTop: 14, lineHeight: 19 },
});
