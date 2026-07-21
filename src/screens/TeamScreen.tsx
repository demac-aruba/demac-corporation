import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, formatMoney } from '../components/UI';
import { useAppState } from '../state/AppState';
import { useTeamState } from '../state/TeamState';
import { colors } from '../theme';
import {
  DailyVanAssignment,
  StaffAbsence,
  StaffAvailability,
  StaffProfile,
  StaffRole,
  Van,
  VanMaintenanceLog,
  VanOperationalStatus,
  VanToolCondition,
} from '../types';

type TabKey = 'dispatch' | 'staff' | 'vans';
const staffRoles: StaffRole[] = ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'];
const availabilityOptions: StaffAvailability[] = ['Disponible', 'Enfermo', 'Vacaciones', 'Libre', 'Inactivo'];
const vanStatuses: VanOperationalStatus[] = ['Disponible', 'En ruta', 'Mantenimiento', 'Fuera de servicio', 'Sin personal'];
const dispatchStatuses: DailyVanAssignment['status'][] = ['Disponible', 'Trabajo liviano', 'Sin personal', 'Mantenimiento', 'Fuera de servicio'];
const toolConditions: VanToolCondition[] = ['Buena', 'Requiere atención', 'Fuera de servicio'];

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function prettyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function unavailable(profile: StaffProfile | undefined, date: string, absences: StaffAbsence[]) {
  if (!profile || !profile.active || profile.availability === 'Inactivo') return true;
  const generalAbsence = profile.availability !== 'Disponible' && (!profile.unavailableFrom || date >= profile.unavailableFrom) && (!profile.unavailableUntil || date <= profile.unavailableUntil);
  return generalAbsence || absences.some((absence) => absence.active && absence.staffId === profile.id && date >= absence.fromDate && date <= absence.toDate);
}

function resolvedAssignment(van: Van, date: string, profiles: StaffProfile[], assignments: DailyVanAssignment[], absences: StaffAbsence[]) {
  const saved = assignments.find((item) => item.vanId === van.id && item.date === date);
  if (saved) return saved;
  const driver = profiles.find((item) => item.id === van.responsibleStaffId);
  const helper = profiles.find((item) => item.id === van.regularHelperId);
  const driverId = unavailable(driver, date, absences) ? undefined : driver?.id;
  const helperId = unavailable(helper, date, absences) ? undefined : helper?.id;
  const status: DailyVanAssignment['status'] = van.status === 'Mantenimiento'
    ? 'Mantenimiento'
    : van.status === 'Fuera de servicio'
      ? 'Fuera de servicio'
      : driverId
        ? helperId ? 'Disponible' : 'Trabajo liviano'
        : 'Sin personal';
  return { id: `${date}-${van.id}`, date, vanId: van.id, driverStaffId: driverId, helperStaffId: helperId, status };
}

function tone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple' {
  if (status === 'Disponible' || status === 'Buena') return 'success';
  if (status === 'Trabajo liviano' || status === 'En ruta' || status === 'Requiere atención') return 'warning';
  if (['Sin personal', 'Fuera de servicio', 'Inactivo'].includes(status)) return 'danger';
  if (['Mantenimiento', 'Enfermo', 'Vacaciones'].includes(status)) return 'purple';
  return 'neutral';
}

export function TeamScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 1050;
  const { workOrders } = useAppState();
  const {
    staffProfiles,
    vans,
    dailyVanAssignments,
    staffAbsences,
    vanMaintenanceLogs,
    teamDataError,
    saveStaffProfile,
    saveVanProfile,
    saveDailyVanAssignment,
    saveStaffAbsence,
    removeStaffAbsence,
    saveVanMaintenanceLog,
  } = useTeamState();

  const [tab, setTab] = useState<TabKey>('dispatch');
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [selectedVanId, setSelectedVanId] = useState(vans[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [assignmentForm, setAssignmentForm] = useState<DailyVanAssignment | null>(null);
  const [staffForm, setStaffForm] = useState<StaffProfile | null>(null);
  const [absenceForm, setAbsenceForm] = useState<StaffAbsence | null>(null);
  const [vanForm, setVanForm] = useState<Van | null>(null);
  const [maintenanceForm, setMaintenanceForm] = useState<VanMaintenanceLog | null>(null);
  const [toolForm, setToolForm] = useState<{ name: string; category: string; quantity: string; condition: VanToolCondition; notes: string } | null>(null);

  const selectedVan = vans.find((van) => van.id === selectedVanId) ?? vans[0];
  const selectedLogs = useMemo(
    () => vanMaintenanceLogs.filter((log) => log.vanId === selectedVan?.id).sort((a, b) => b.date.localeCompare(a.date)),
    [vanMaintenanceLogs, selectedVan?.id],
  );

  function openAssignment(van: Van) {
    setMessage('');
    setAssignmentForm({ ...resolvedAssignment(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences) });
  }

  async function saveAssignment() {
    if (!assignmentForm) return;
    const driver = staffProfiles.find((item) => item.id === assignmentForm.driverStaffId);
    if (!['Sin personal', 'Mantenimiento', 'Fuera de servicio'].includes(assignmentForm.status) && (!driver || !driver.canDriveVan)) {
      return setMessage('Selecciona un conductor autorizado para habilitar la van.');
    }
    if (assignmentForm.driverStaffId && assignmentForm.driverStaffId === assignmentForm.helperStaffId) return setMessage('El conductor y el ayudante deben ser personas diferentes.');

    setSaving(true);
    const people = [assignmentForm.driverStaffId, assignmentForm.helperStaffId].filter(Boolean) as string[];
    for (const otherVan of vans.filter((van) => van.id !== assignmentForm.vanId)) {
      const other = resolvedAssignment(otherVan, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences);
      const removeDriver = !!other.driverStaffId && people.includes(other.driverStaffId);
      const removeHelper = !!other.helperStaffId && people.includes(other.helperStaffId);
      if (!removeDriver && !removeHelper) continue;
      const driverStaffId = removeDriver ? undefined : other.driverStaffId;
      const helperStaffId = removeHelper ? undefined : other.helperStaffId;
      await saveDailyVanAssignment({ ...other, driverStaffId, helperStaffId, status: driverStaffId ? helperStaffId ? 'Disponible' : 'Trabajo liviano' : 'Sin personal', notes: 'Personal movido a otra van.', updatedAt: new Date().toISOString() });
    }
    const result = await saveDailyVanAssignment({ ...assignmentForm, updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar el despacho.');
    setAssignmentForm(null);
  }

  function openStaff(profile?: StaffProfile) {
    setMessage('');
    setStaffForm(profile ? { ...profile, skills: [...profile.skills] } : {
      id: `staff-${Date.now()}`,
      name: '', phone: '', email: '', role: 'Ayudante', canDriveVan: false,
      skills: [], availability: 'Disponible', active: true, notes: '', createdAt: new Date().toISOString(),
    });
  }

  async function saveStaff() {
    if (!staffForm?.name.trim() || !staffForm.phone.trim()) return setMessage('Nombre y teléfono son obligatorios.');
    setSaving(true);
    const result = await saveStaffProfile({ ...staffForm, name: staffForm.name.trim(), phone: staffForm.phone.trim(), updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar el trabajador.');
    setStaffForm(null);
  }

  function openAbsence(profile: StaffProfile) {
    const today = dateKey();
    setMessage('');
    setAbsenceForm({ id: `absence-${Date.now()}`, staffId: profile.id, fromDate: today, toDate: today, reason: 'Enfermo', active: true, notes: '', createdAt: new Date().toISOString() });
  }

  async function saveAbsence() {
    if (!absenceForm) return;
    if (absenceForm.toDate < absenceForm.fromDate) return setMessage('La fecha final no puede ser anterior a la inicial.');
    setSaving(true);
    const result = await saveStaffAbsence({ ...absenceForm, updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar la ausencia.');
    setAbsenceForm(null);
  }

  function openVan(van?: Van) {
    setMessage('');
    setVanForm(van ? { ...van, inventory: [...(van.inventory ?? [])] } : {
      id: `van-${Date.now()}`, name: `Van ${vans.length + 1}`, plate: '', technicianIds: [], status: 'Disponible', odometerKm: 0, inventory: [], active: true,
    });
  }

  async function saveVan() {
    if (!vanForm?.name.trim() || !vanForm.plate.trim()) return setMessage('Nombre y matrícula son obligatorios.');
    setSaving(true);
    const technicianIds = [vanForm.responsibleStaffId, vanForm.regularHelperId].filter(Boolean) as string[];
    const result = await saveVanProfile({ ...vanForm, technicianIds, updatedAt: new Date().toISOString() });
    const responsible = staffProfiles.find((profile) => profile.id === vanForm.responsibleStaffId);
    if (result.ok && responsible && !responsible.canDriveVan) {
      await saveStaffProfile({ ...responsible, canDriveVan: true, updatedAt: new Date().toISOString() });
    }
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar la van.');
    setSelectedVanId(vanForm.id);
    setVanForm(null);
  }

  function openMaintenance(van: Van) {
    setMessage('');
    setMaintenanceForm({
      id: `maint-${Date.now()}`, vanId: van.id, date: dateKey(), odometerKm: van.odometerKm ?? 0,
      type: 'Mantenimiento preventivo', description: '', cost: 0, nextDueKm: van.nextServiceKm, nextDueDate: van.nextServiceDate, createdAt: new Date().toISOString(),
    });
  }

  async function saveMaintenance() {
    if (!maintenanceForm?.description.trim()) return setMessage('Describe el mantenimiento realizado.');
    setSaving(true);
    const result = await saveVanMaintenanceLog({ ...maintenanceForm, updatedAt: new Date().toISOString() });
    if (result.ok && selectedVan) {
      await saveVanProfile({ ...selectedVan, odometerKm: Math.max(selectedVan.odometerKm ?? 0, maintenanceForm.odometerKm), nextServiceKm: maintenanceForm.nextDueKm, nextServiceDate: maintenanceForm.nextDueDate, updatedAt: new Date().toISOString() });
    }
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo registrar el mantenimiento.');
    setMaintenanceForm(null);
  }

  async function saveTool() {
    if (!selectedVan || !toolForm?.name.trim()) return setMessage('Escribe el nombre del artículo.');
    const inventory = [...(selectedVan.inventory ?? []), {
      id: `tool-${Date.now()}`, name: toolForm.name.trim(), category: toolForm.category.trim() || 'Herramienta',
      quantity: Math.max(1, Number(toolForm.quantity) || 1), condition: toolForm.condition, notes: toolForm.notes.trim() || undefined,
    }];
    setSaving(true);
    const result = await saveVanProfile({ ...selectedVan, inventory, updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar el artículo.');
    setToolForm(null);
  }

  const headerAction = tab === 'vans'
      ? <Button label="Nueva van" icon="＋" onPress={() => openVan()} />
      : undefined;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle title="Equipo y flota" subtitle="Asigna empleados existentes a las vans, administra responsables, ayudantes, ausencias, despacho y flota. Los perfiles maestros se crean en Empleados." action={headerAction} />
      {teamDataError ? <View style={styles.errorBox}><Text style={styles.errorText}>{teamDataError}</Text></View> : null}

      <Card style={styles.tabs}><TabButton label="Despacho diario" active={tab === 'dispatch'} onPress={() => setTab('dispatch')} /><TabButton label="Personal" active={tab === 'staff'} onPress={() => setTab('staff')} /><TabButton label="Vans" active={tab === 'vans'} onPress={() => setTab('vans')} /></Card>

      {tab === 'dispatch' ? <>
        <Card style={styles.dateBar}><Button compact variant="secondary" label="← Día anterior" onPress={() => setSelectedDate(shiftDate(selectedDate, -1))} /><View style={styles.dateCenter}><Text style={styles.smallLabel}>Despacho del día</Text><Text style={styles.dateTitle}>{prettyDate(selectedDate)}</Text></View><Button compact variant="secondary" label="Día siguiente →" onPress={() => setSelectedDate(shiftDate(selectedDate, 1))} /></Card>
        <View style={[styles.grid, compact && styles.gridCompact]}>{vans.map((van) => {
          const assignment = resolvedAssignment(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences);
          const driver = staffProfiles.find((item) => item.id === assignment.driverStaffId);
          const helper = staffProfiles.find((item) => item.id === assignment.helperStaffId);
          const responsible = staffProfiles.find((item) => item.id === van.responsibleStaffId);
          const jobs = workOrders.filter((order) => order.date === selectedDate && order.vanId === van.id && order.status !== 'Cancelada');
          const hours = jobs.reduce((sum, order) => sum + Math.max(1, Number(order.scheduledSlots ?? 1)), 0);
          const blocked = ['Sin personal', 'Mantenimiento', 'Fuera de servicio'].includes(assignment.status);
          return <Card key={van.id} style={[styles.dispatchCard, blocked && jobs.length > 0 && styles.alertCard]}>
            <View style={styles.rowBetween}><View><Text style={styles.title}>{van.name}</Text><Text style={styles.muted}>{van.plate}</Text></View><Pill label={assignment.status} tone={tone(assignment.status)} /></View>
            <InfoRow label="Responsable permanente" value={responsible?.name ?? 'Sin asignar'} />
            <InfoRow label="Conductor del día" value={driver?.name ?? 'Sin conductor'} alert={!driver} />
            <InfoRow label="Ayudante del día" value={helper?.name ?? 'Trabajando solo'} />
            <View style={styles.workload}><Text style={styles.workloadNumber}>{jobs.length}</Text><Text style={styles.workloadText}>trabajos · {hours} horas programadas</Text></View>
            {blocked && jobs.length > 0 ? <View style={styles.warning}><Text style={styles.warningText}>Esta van tiene trabajos programados, pero no está habilitada. Reasigna personal o mueve las citas.</Text></View> : null}
            {assignment.notes ? <Text style={styles.note}>{assignment.notes}</Text> : null}
            <Button variant="secondary" label="Editar despacho" onPress={() => openAssignment(van)} />
          </Card>;
        })}</View>
      </> : null}

      {tab === 'staff' ? <View style={[styles.grid, compact && styles.gridCompact]}>{staffProfiles.map((profile) => {
        const assignedVans = vans.filter((item) => item.responsibleStaffId === profile.id || item.regularHelperId === profile.id);
        const futureAbsences = staffAbsences.filter((absence) => absence.staffId === profile.id && absence.active && absence.toDate >= dateKey());
        return <Card key={profile.id} style={styles.personCard}>
          <View style={styles.rowBetween}><View><Text style={styles.title}>{profile.name}</Text><Text style={styles.muted}>{profile.role}</Text></View><Pill label={profile.availability} tone={tone(profile.availability)} /></View>
          <InfoRow label="Asignación de van" value={assignedVans.length ? assignedVans.map((van) => `${van.name} (${van.responsibleStaffId === profile.id ? 'responsable' : 'ayudante'})`).join(' · ') : 'Sin van'} /><InfoRow label="Puede manejar" value={profile.canDriveVan ? 'Sí' : 'No'} /><InfoRow label="Teléfono" value={profile.phone} />
          <Text style={styles.skills}>{profile.skills.length ? profile.skills.join(' · ') : 'Sin especialidades registradas'}</Text>
          {futureAbsences.map((absence) => <View key={absence.id} style={styles.absence}><Text style={styles.absenceText}>{absence.reason}: {absence.fromDate} → {absence.toDate}</Text><Pressable onPress={() => void removeStaffAbsence(absence.id)}><Text style={styles.remove}>Quitar</Text></Pressable></View>)}
          <View style={styles.actions}><Button compact variant="secondary" label="Registrar ausencia" onPress={() => openAbsence(profile)} /></View>
        </Card>;
      })}</View> : null}

      {tab === 'vans' ? <View style={[styles.vanLayout, compact && styles.vanLayoutCompact]}>
        <View style={styles.vanList}>{vans.map((van) => <Pressable key={van.id} onPress={() => setSelectedVanId(van.id)} style={[styles.vanItem, selectedVan?.id === van.id && styles.vanItemActive]}><View><Text style={styles.vanItemTitle}>{van.name}</Text><Text style={styles.muted}>{van.plate}</Text></View><Pill label={van.status} tone={tone(van.status)} /></Pressable>)}</View>
        {selectedVan ? <View style={styles.details}>
          <Card><View style={styles.rowBetween}><View><Text style={styles.detailTitle}>{selectedVan.name}</Text><Text style={styles.muted}>{selectedVan.plate}</Text></View><View style={styles.actions}><Button compact variant="secondary" label="Editar perfil" onPress={() => openVan(selectedVan)} /><Button compact label="Registrar mantenimiento" onPress={() => openMaintenance(selectedVan)} /></View></View>
            <View style={styles.metrics}><Metric label="Kilometraje" value={`${(selectedVan.odometerKm ?? 0).toLocaleString()} km`} /><Metric label="Próximo servicio" value={selectedVan.nextServiceKm ? `${selectedVan.nextServiceKm.toLocaleString()} km` : 'Sin definir'} /><Metric label="Fecha prevista" value={selectedVan.nextServiceDate ?? 'Sin definir'} /></View>
            <InfoRow label="Técnico responsable" value={staffProfiles.find((item) => item.id === selectedVan.responsibleStaffId)?.name ?? 'Sin asignar'} /><InfoRow label="Ayudante habitual" value={staffProfiles.find((item) => item.id === selectedVan.regularHelperId)?.name ?? 'Sin asignar'} /><InfoRow label="Seguro vence" value={selectedVan.insuranceExpiresAt ?? 'Sin registrar'} /><InfoRow label="Matrícula vence" value={selectedVan.registrationExpiresAt ?? 'Sin registrar'} />
            {selectedVan.notes ? <Text style={styles.note}>{selectedVan.notes}</Text> : null}
          </Card>
          <Card><View style={styles.rowBetween}><View><Text style={styles.subtitle}>Inventario de la van</Text><Text style={styles.muted}>Herramientas, equipos y consumibles asignados.</Text></View><Button compact label="Añadir artículo" icon="＋" onPress={() => setToolForm({ name: '', category: 'Herramienta', quantity: '1', condition: 'Buena', notes: '' })} /></View>
            {(selectedVan.inventory ?? []).length ? (selectedVan.inventory ?? []).map((item) => <View key={item.id} style={styles.listRow}><View style={{ flex: 1 }}><Text style={styles.listTitle}>{item.name}</Text><Text style={styles.muted}>{item.category} · Cantidad: {item.quantity}</Text></View><Pill label={item.condition} tone={tone(item.condition)} /></View>) : <Text style={styles.empty}>No hay artículos registrados.</Text>}
          </Card>
          <Card><Text style={styles.subtitle}>Historial de mantenimiento</Text>{selectedLogs.length ? selectedLogs.map((log) => <View key={log.id} style={styles.listRow}><View style={{ flex: 1 }}><Text style={styles.listTitle}>{log.type}</Text><Text style={styles.muted}>{log.date} · {log.odometerKm.toLocaleString()} km</Text><Text style={styles.note}>{log.description}</Text></View><Text style={styles.cost}>{log.cost ? formatMoney(log.cost) : '—'}</Text></View>) : <Text style={styles.empty}>No hay mantenimientos registrados.</Text>}</Card>
        </View> : null}
      </View> : null}

      <AppModal visible={!!assignmentForm} title="Editar despacho diario" onClose={() => !saving && setAssignmentForm(null)}><ScrollView>{message ? <FormError text={message} /> : null}<Text style={styles.help}>Esta asignación aplica solamente al {selectedDate}. Si mueves una persona, se elimina automáticamente de la otra van para ese día.</Text><FieldTitle text="Estado" /><Choices options={dispatchStatuses} value={assignmentForm?.status} onChange={(value) => setAssignmentForm((current) => current ? { ...current, status: value as DailyVanAssignment['status'] } : current)} /><FieldTitle text="Conductor autorizado" /><Choices options={['Sin conductor', ...staffProfiles.filter((item) => item.active && item.canDriveVan && !unavailable(item, selectedDate, staffAbsences)).map((item) => item.name)]} value={staffProfiles.find((item) => item.id === assignmentForm?.driverStaffId)?.name ?? 'Sin conductor'} onChange={(value) => setAssignmentForm((current) => current ? { ...current, driverStaffId: staffProfiles.find((item) => item.name === value)?.id } : current)} /><FieldTitle text="Ayudante" /><Choices options={['Sin ayudante', ...staffProfiles.filter((item) => item.active && item.id !== assignmentForm?.driverStaffId && !unavailable(item, selectedDate, staffAbsences) && (item.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(item.role))).map((item) => item.name)]} value={staffProfiles.find((item) => item.id === assignmentForm?.helperStaffId)?.name ?? 'Sin ayudante'} onChange={(value) => setAssignmentForm((current) => current ? { ...current, helperStaffId: staffProfiles.find((item) => item.name === value)?.id } : current)} /><Input label="Notas" multiline value={assignmentForm?.notes ?? ''} onChangeText={(notes) => setAssignmentForm((current) => current ? { ...current, notes } : current)} /><ModalButtons saving={saving} cancel={() => setAssignmentForm(null)} save={() => void saveAssignment()} /></ScrollView></AppModal>

      <AppModal visible={!!staffForm} title="Perfil del trabajador" onClose={() => !saving && setStaffForm(null)}><ScrollView>{message ? <FormError text={message} /> : null}<Input label="Nombre completo" value={staffForm?.name ?? ''} onChangeText={(name) => setStaffForm((current) => current ? { ...current, name } : current)} /><View style={styles.twoCols}><Input style={styles.flexField} label="Teléfono" value={staffForm?.phone ?? ''} onChangeText={(phone) => setStaffForm((current) => current ? { ...current, phone } : current)} /><Input style={styles.flexField} label="Correo" value={staffForm?.email ?? ''} onChangeText={(email) => setStaffForm((current) => current ? { ...current, email } : current)} /></View><FieldTitle text="Cargo" /><Choices options={staffRoles} value={staffForm?.role} onChange={(value) => setStaffForm((current) => current ? { ...current, role: value as StaffRole, canDriveVan: value === 'Técnico responsable' ? true : current.canDriveVan } : current)} /><FieldTitle text="Puede manejar van" /><Choices options={['Sí', 'No']} value={staffForm?.canDriveVan ? 'Sí' : 'No'} onChange={(value) => setStaffForm((current) => current ? { ...current, canDriveVan: value === 'Sí' } : current)} /><FieldTitle text="Van principal" /><Choices options={['Sin van', ...vans.map((van) => van.name)]} value={vans.find((van) => van.id === staffForm?.primaryVanId)?.name ?? 'Sin van'} onChange={(value) => setStaffForm((current) => current ? { ...current, primaryVanId: vans.find((van) => van.name === value)?.id } : current)} /><FieldTitle text="Disponibilidad" /><Choices options={availabilityOptions} value={staffForm?.availability} onChange={(value) => setStaffForm((current) => current ? { ...current, availability: value as StaffAvailability } : current)} /><Input label="Especialidades" value={staffForm?.skills.join(', ') ?? ''} onChangeText={(value) => setStaffForm((current) => current ? { ...current, skills: value.split(',').map((item) => item.trim()).filter(Boolean) } : current)} placeholder="Servicio, instalación, VRF, electricidad…" /><Input label="Notas internas" multiline value={staffForm?.notes ?? ''} onChangeText={(notes) => setStaffForm((current) => current ? { ...current, notes } : current)} /><ModalButtons saving={saving} cancel={() => setStaffForm(null)} save={() => void saveStaff()} /></ScrollView></AppModal>

      <AppModal visible={!!absenceForm} title="Registrar ausencia" onClose={() => !saving && setAbsenceForm(null)}><ScrollView>{message ? <FormError text={message} /> : null}<FieldTitle text="Motivo" /><Choices options={['Enfermo', 'Vacaciones', 'Libre', 'Otro']} value={absenceForm?.reason} onChange={(value) => setAbsenceForm((current) => current ? { ...current, reason: value as StaffAbsence['reason'] } : current)} /><View style={styles.twoCols}><Input style={styles.flexField} label="Desde" value={absenceForm?.fromDate ?? ''} onChangeText={(fromDate) => setAbsenceForm((current) => current ? { ...current, fromDate } : current)} /><Input style={styles.flexField} label="Hasta" value={absenceForm?.toDate ?? ''} onChangeText={(toDate) => setAbsenceForm((current) => current ? { ...current, toDate } : current)} /></View><Input label="Notas" multiline value={absenceForm?.notes ?? ''} onChangeText={(notes) => setAbsenceForm((current) => current ? { ...current, notes } : current)} /><ModalButtons saving={saving} cancel={() => setAbsenceForm(null)} save={() => void saveAbsence()} /></ScrollView></AppModal>

      <AppModal visible={!!vanForm} title="Perfil de la van" onClose={() => !saving && setVanForm(null)}><ScrollView>{message ? <FormError text={message} /> : null}<View style={styles.twoCols}><Input style={styles.flexField} label="Nombre" value={vanForm?.name ?? ''} onChangeText={(name) => setVanForm((current) => current ? { ...current, name } : current)} /><Input style={styles.flexField} label="Matrícula" value={vanForm?.plate ?? ''} onChangeText={(plate) => setVanForm((current) => current ? { ...current, plate } : current)} /></View><FieldTitle text="Estado operativo" /><Choices options={vanStatuses} value={vanForm?.status} onChange={(value) => setVanForm((current) => current ? { ...current, status: value as VanOperationalStatus } : current)} /><FieldTitle text="Técnico responsable" /><Choices options={['Sin responsable', ...staffProfiles.filter((item) => item.active && (item.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(item.role))).map((item) => item.name)]} value={staffProfiles.find((item) => item.id === vanForm?.responsibleStaffId)?.name ?? 'Sin responsable'} onChange={(value) => setVanForm((current) => current ? { ...current, responsibleStaffId: staffProfiles.find((item) => item.name === value)?.id } : current)} /><FieldTitle text="Ayudante habitual" /><Choices options={['Sin ayudante', ...staffProfiles.filter((item) => item.active && item.id !== vanForm?.responsibleStaffId && (item.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(item.role))).map((item) => item.name)]} value={staffProfiles.find((item) => item.id === vanForm?.regularHelperId)?.name ?? 'Sin ayudante'} onChange={(value) => setVanForm((current) => current ? { ...current, regularHelperId: staffProfiles.find((item) => item.name === value)?.id } : current)} /><View style={styles.twoCols}><Input style={styles.flexField} label="Kilometraje" keyboardType="numeric" value={String(vanForm?.odometerKm ?? 0)} onChangeText={(value) => setVanForm((current) => current ? { ...current, odometerKm: Number(value) || 0 } : current)} /><Input style={styles.flexField} label="Próximo servicio (km)" keyboardType="numeric" value={String(vanForm?.nextServiceKm ?? '')} onChangeText={(value) => setVanForm((current) => current ? { ...current, nextServiceKm: Number(value) || undefined } : current)} /></View><View style={styles.twoCols}><Input style={styles.flexField} label="Próxima fecha" value={vanForm?.nextServiceDate ?? ''} onChangeText={(nextServiceDate) => setVanForm((current) => current ? { ...current, nextServiceDate } : current)} /><Input style={styles.flexField} label="Seguro vence" value={vanForm?.insuranceExpiresAt ?? ''} onChangeText={(insuranceExpiresAt) => setVanForm((current) => current ? { ...current, insuranceExpiresAt } : current)} /></View><Input label="Matrícula vence" value={vanForm?.registrationExpiresAt ?? ''} onChangeText={(registrationExpiresAt) => setVanForm((current) => current ? { ...current, registrationExpiresAt } : current)} /><Input label="Notas" multiline value={vanForm?.notes ?? ''} onChangeText={(notes) => setVanForm((current) => current ? { ...current, notes } : current)} /><ModalButtons saving={saving} cancel={() => setVanForm(null)} save={() => void saveVan()} /></ScrollView></AppModal>

      <AppModal visible={!!maintenanceForm} title="Registrar mantenimiento" onClose={() => !saving && setMaintenanceForm(null)}><ScrollView>{message ? <FormError text={message} /> : null}<View style={styles.twoCols}><Input style={styles.flexField} label="Fecha" value={maintenanceForm?.date ?? ''} onChangeText={(date) => setMaintenanceForm((current) => current ? { ...current, date } : current)} /><Input style={styles.flexField} label="Kilometraje" keyboardType="numeric" value={String(maintenanceForm?.odometerKm ?? 0)} onChangeText={(value) => setMaintenanceForm((current) => current ? { ...current, odometerKm: Number(value) || 0 } : current)} /></View><Input label="Tipo de servicio" value={maintenanceForm?.type ?? ''} onChangeText={(type) => setMaintenanceForm((current) => current ? { ...current, type } : current)} /><Input label="Descripción" multiline value={maintenanceForm?.description ?? ''} onChangeText={(description) => setMaintenanceForm((current) => current ? { ...current, description } : current)} /><View style={styles.twoCols}><Input style={styles.flexField} label="Costo Afl." keyboardType="numeric" value={String(maintenanceForm?.cost ?? '')} onChangeText={(value) => setMaintenanceForm((current) => current ? { ...current, cost: Number(value) || 0 } : current)} /><Input style={styles.flexField} label="Próximo servicio (km)" keyboardType="numeric" value={String(maintenanceForm?.nextDueKm ?? '')} onChangeText={(value) => setMaintenanceForm((current) => current ? { ...current, nextDueKm: Number(value) || undefined } : current)} /></View><Input label="Próxima fecha" value={maintenanceForm?.nextDueDate ?? ''} onChangeText={(nextDueDate) => setMaintenanceForm((current) => current ? { ...current, nextDueDate } : current)} /><ModalButtons saving={saving} cancel={() => setMaintenanceForm(null)} save={() => void saveMaintenance()} /></ScrollView></AppModal>

      <AppModal visible={!!toolForm} title="Añadir artículo a la van" onClose={() => !saving && setToolForm(null)}><ScrollView>{message ? <FormError text={message} /> : null}<Input label="Herramienta, equipo o material" value={toolForm?.name ?? ''} onChangeText={(name) => setToolForm((current) => current ? { ...current, name } : current)} /><View style={styles.twoCols}><Input style={styles.flexField} label="Categoría" value={toolForm?.category ?? ''} onChangeText={(category) => setToolForm((current) => current ? { ...current, category } : current)} /><Input style={styles.flexField} label="Cantidad" keyboardType="numeric" value={toolForm?.quantity ?? '1'} onChangeText={(quantity) => setToolForm((current) => current ? { ...current, quantity } : current)} /></View><FieldTitle text="Condición" /><Choices options={toolConditions} value={toolForm?.condition} onChange={(value) => setToolForm((current) => current ? { ...current, condition: value as VanToolCondition } : current)} /><Input label="Notas" multiline value={toolForm?.notes ?? ''} onChangeText={(notes) => setToolForm((current) => current ? { ...current, notes } : current)} /><ModalButtons saving={saving} cancel={() => setToolForm(null)} save={() => void saveTool()} /></ScrollView></AppModal>
    </ScrollView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>; }
function InfoRow({ label, value, alert }: { label: string; value: string; alert?: boolean }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={[styles.infoValue, alert && { color: colors.danger }]}>{value}</Text></View>; }
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.smallLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function FieldTitle({ text }: { text: string }) { return <Text style={styles.fieldTitle}>{text}</Text>; }
function Choices({ options, value, onChange }: { options: readonly string[]; value?: string; onChange: (value: string) => void }) { return <View style={styles.choices}>{options.map((option) => <Pressable key={option} onPress={() => onChange(option)} style={[styles.choice, value === option && styles.choiceActive]}><Text style={[styles.choiceText, value === option && styles.choiceTextActive]}>{option}</Text></Pressable>)}</View>; }
function ModalButtons({ saving, cancel, save }: { saving: boolean; cancel: () => void; save: () => void }) { return <View style={styles.modalButtons}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={cancel} /><Button label={saving ? 'Guardando…' : 'Guardar'} disabled={saving} onPress={save} /></View>; }
function FormError({ text }: { text: string }) { return <View style={styles.formError}><Text style={styles.formErrorText}>{text}</Text></View>; }

const styles = StyleSheet.create({
  page: { padding: 26, gap: 16, paddingBottom: 96 },
  errorBox: { backgroundColor: colors.dangerLight, padding: 12, borderRadius: 8 }, errorText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 4, padding: 5, alignSelf: 'flex-start' }, tab: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 7 }, tabActive: { backgroundColor: colors.primaryLight }, tabText: { color: colors.muted, fontWeight: '800', fontSize: 12 }, tabTextActive: { color: colors.primaryDark },
  dateBar: { flexDirection: 'row', alignItems: 'center', gap: 12 }, dateCenter: { flex: 1, alignItems: 'center' }, smallLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' }, dateTitle: { color: colors.text, fontSize: 16, fontWeight: '900', textTransform: 'capitalize', marginTop: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, gridCompact: { flexDirection: 'column' }, dispatchCard: { width: '48.8%', minWidth: 350, gap: 11 }, alertCard: { borderColor: '#F2B8B5' }, personCard: { width: '32%', minWidth: 300, gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, title: { color: colors.text, fontSize: 17, fontWeight: '900' }, muted: { color: colors.muted, fontSize: 10, marginTop: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderBottomColor: '#EEF0F2', paddingBottom: 8 }, infoLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' }, infoValue: { color: colors.text, fontSize: 11, fontWeight: '800', flex: 1, textAlign: 'right' },
  workload: { flexDirection: 'row', alignItems: 'baseline', gap: 7, backgroundColor: '#F4F5F7', padding: 10, borderRadius: 8 }, workloadNumber: { color: colors.text, fontSize: 20, fontWeight: '900' }, workloadText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, warning: { backgroundColor: colors.dangerLight, padding: 9, borderRadius: 7 }, warningText: { color: colors.danger, fontSize: 10, lineHeight: 14, fontWeight: '700' }, note: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  skills: { color: colors.primaryDark, fontSize: 10, fontWeight: '700', lineHeight: 15 }, absence: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.warningLight, borderRadius: 7, padding: 8 }, absenceText: { color: colors.warning, flex: 1, fontSize: 9, fontWeight: '700' }, remove: { color: colors.danger, fontSize: 9, fontWeight: '900' }, actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  vanLayout: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' }, vanLayoutCompact: { flexDirection: 'column' }, vanList: { width: 270, gap: 8 }, vanItem: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, vanItemActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, vanItemTitle: { color: colors.text, fontSize: 13, fontWeight: '900' }, details: { flex: 1, gap: 14, minWidth: 0 }, detailTitle: { color: colors.text, fontSize: 20, fontWeight: '900' }, subtitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 14 }, metric: { flex: 1, minWidth: 140, backgroundColor: '#F4F5F7', borderRadius: 8, padding: 11 }, metricValue: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 5 }, listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderBottomWidth: 1, borderBottomColor: '#EEF0F2', paddingVertical: 11 }, listTitle: { color: colors.text, fontSize: 12, fontWeight: '900' }, cost: { color: colors.text, fontSize: 11, fontWeight: '900' }, empty: { color: colors.muted, fontSize: 11, paddingVertical: 17 },
  help: { color: colors.muted, fontSize: 11, lineHeight: 16, marginBottom: 12 }, fieldTitle: { color: colors.text, fontSize: 11, fontWeight: '900', marginBottom: 8, marginTop: 3 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 }, choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingVertical: 8, paddingHorizontal: 10 }, choiceActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, choiceText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, choiceTextActive: { color: colors.primaryDark, fontWeight: '900' }, twoCols: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, flexField: { flex: 1, minWidth: 210 }, modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 10 }, formError: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10, marginBottom: 12 }, formErrorText: { color: colors.danger, fontSize: 10, fontWeight: '700' },
});
