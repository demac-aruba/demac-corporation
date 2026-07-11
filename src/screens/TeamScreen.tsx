import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle, formatMoney } from '../components/UI';
import { useAppState } from '../state/AppState';
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

type TeamTab = 'dispatch' | 'staff' | 'vans';

const staffRoles: StaffRole[] = ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'];
const availabilityOptions: StaffAvailability[] = ['Disponible', 'Enfermo', 'Vacaciones', 'Libre', 'Inactivo'];
const vanStatuses: VanOperationalStatus[] = ['Disponible', 'En ruta', 'Mantenimiento', 'Fuera de servicio', 'Sin personal'];
const assignmentStatuses: DailyVanAssignment['status'][] = ['Disponible', 'Trabajo liviano', 'Sin personal', 'Mantenimiento', 'Fuera de servicio'];
const toolConditions: VanToolCondition[] = ['Buena', 'Requiere atención', 'Fuera de servicio'];

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: string, amount: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + amount);
  return localDateKey(next);
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function isAbsent(staff: StaffProfile | undefined, date: string, absences: StaffAbsence[]) {
  if (!staff || !staff.active || staff.availability === 'Inactivo') return true;
  const fixedUnavailable = staff.availability !== 'Disponible' && (!staff.unavailableFrom || date >= staff.unavailableFrom) && (!staff.unavailableUntil || date <= staff.unavailableUntil);
  if (fixedUnavailable) return true;
  return absences.some((absence) => absence.active && absence.staffId === staff.id && date >= absence.fromDate && date <= absence.toDate);
}

function defaultAssignment(van: Van, date: string, staff: StaffProfile[], absences: StaffAbsence[]): DailyVanAssignment {
  const driver = staff.find((item) => item.id === van.responsibleStaffId);
  const helper = staff.find((item) => item.id === van.regularHelperId);
  const driverAvailable = !isAbsent(driver, date, absences);
  const helperAvailable = !isAbsent(helper, date, absences);
  let status: DailyVanAssignment['status'] = 'Disponible';
  if (van.status === 'Mantenimiento') status = 'Mantenimiento';
  else if (van.status === 'Fuera de servicio') status = 'Fuera de servicio';
  else if (!driverAvailable) status = 'Sin personal';
  else if (!helperAvailable) status = 'Trabajo liviano';
  return {
    id: `${date}-${van.id}`,
    date,
    vanId: van.id,
    driverStaffId: driverAvailable ? driver?.id : undefined,
    helperStaffId: helperAvailable ? helper?.id : undefined,
    status,
  };
}

function assignmentFor(van: Van, date: string, staff: StaffProfile[], assignments: DailyVanAssignment[], absences: StaffAbsence[]) {
  return assignments.find((item) => item.vanId === van.id && item.date === date) ?? defaultAssignment(van, date, staff, absences);
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple' {
  if (status === 'Disponible') return 'success';
  if (status === 'Trabajo liviano' || status === 'En ruta') return 'warning';
  if (status === 'Sin personal' || status === 'Fuera de servicio' || status === 'Inactivo') return 'danger';
  if (status === 'Mantenimiento' || status === 'Vacaciones' || status === 'Enfermo') return 'purple';
  return 'neutral';
}

export function TeamScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 1050;
  const {
    staffProfiles,
    vans,
    dailyVanAssignments,
    staffAbsences,
    vanMaintenanceLogs,
    workOrders,
    saveStaffProfile,
    saveVanProfile,
    saveDailyVanAssignment,
    saveStaffAbsence,
    removeStaffAbsence,
    saveVanMaintenanceLog,
    dataError,
  } = useAppState();

  const [tab, setTab] = useState<TeamTab>('dispatch');
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [selectedVanId, setSelectedVanId] = useState(vans[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [assignmentModal, setAssignmentModal] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState<DailyVanAssignment | null>(null);

  const [staffModal, setStaffModal] = useState(false);
  const [staffForm, setStaffForm] = useState<StaffProfile | null>(null);

  const [absenceModal, setAbsenceModal] = useState(false);
  const [absenceForm, setAbsenceForm] = useState<StaffAbsence | null>(null);

  const [vanModal, setVanModal] = useState(false);
  const [vanForm, setVanForm] = useState<Van | null>(null);

  const [maintenanceModal, setMaintenanceModal] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState<VanMaintenanceLog | null>(null);

  const [toolModal, setToolModal] = useState(false);
  const [toolForm, setToolForm] = useState({ name: '', category: 'Herramienta', quantity: '1', condition: 'Buena' as VanToolCondition, notes: '' });

  const selectedVan = vans.find((van) => van.id === selectedVanId) ?? vans[0];
  const selectedVanLogs = useMemo(
    () => vanMaintenanceLogs.filter((log) => log.vanId === selectedVan?.id).sort((a, b) => b.date.localeCompare(a.date)),
    [vanMaintenanceLogs, selectedVan?.id],
  );

  const assignmentsForDay = useMemo(
    () => vans.map((van) => assignmentFor(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences)),
    [vans, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences],
  );

  const action = tab === 'staff'
    ? <Button label="Nuevo trabajador" icon="＋" onPress={() => openStaff()} />
    : tab === 'vans'
      ? <Button label="Nueva van" icon="＋" onPress={() => openVan()} />
      : undefined;

  function openAssignment(van: Van) {
    setMessage('');
    setAssignmentForm({ ...assignmentFor(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences) });
    setAssignmentModal(true);
  }

  async function submitAssignment() {
    if (!assignmentForm) return;
    const driver = staffProfiles.find((item) => item.id === assignmentForm.driverStaffId);
    if (!['Sin personal', 'Mantenimiento', 'Fuera de servicio'].includes(assignmentForm.status) && (!driver || !driver.canDriveVan)) {
      setMessage('Selecciona un conductor autorizado para habilitar esta van.');
      return;
    }
    if (assignmentForm.driverStaffId && assignmentForm.driverStaffId === assignmentForm.helperStaffId) {
      setMessage('El conductor y el ayudante deben ser personas diferentes.');
      return;
    }

    setSaving(true);
    setMessage('');
    const selectedPeople = [assignmentForm.driverStaffId, assignmentForm.helperStaffId].filter(Boolean) as string[];
    for (const otherVan of vans.filter((van) => van.id !== assignmentForm.vanId)) {
      const other = assignmentFor(otherVan, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences);
      const driverConflict = other.driverStaffId && selectedPeople.includes(other.driverStaffId);
      const helperConflict = other.helperStaffId && selectedPeople.includes(other.helperStaffId);
      if (!driverConflict && !helperConflict) continue;
      const nextDriver = driverConflict ? undefined : other.driverStaffId;
      const nextHelper = helperConflict ? undefined : other.helperStaffId;
      await saveDailyVanAssignment({
        ...other,
        driverStaffId: nextDriver,
        helperStaffId: nextHelper,
        status: nextDriver ? (nextHelper ? 'Disponible' : 'Trabajo liviano') : 'Sin personal',
        notes: `${other.notes ?? ''}${other.notes ? ' · ' : ''}Personal movido a otra van.`,
        updatedAt: new Date().toISOString(),
      });
    }
    const result = await saveDailyVanAssignment({ ...assignmentForm, updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar el despacho.');
    setAssignmentModal(false);
  }

  function openStaff(profile?: StaffProfile) {
    const now = Date.now();
    setMessage('');
    setStaffForm(profile ? { ...profile, skills: [...profile.skills] } : {
      id: `staff-${now}`,
      name: '',
      phone: '',
      email: '',
      role: 'Ayudante',
      canDriveVan: false,
      primaryVanId: undefined,
      skills: [],
      availability: 'Disponible',
      active: true,
      notes: '',
      createdAt: new Date().toISOString(),
    });
    setStaffModal(true);
  }

  async function submitStaff() {
    if (!staffForm?.name.trim()) return setMessage('Escribe el nombre del trabajador.');
    if (!staffForm.phone.trim()) return setMessage('Escribe el teléfono del trabajador.');
    setSaving(true);
    const result = await saveStaffProfile({ ...staffForm, name: staffForm.name.trim(), phone: staffForm.phone.trim(), updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar el trabajador.');
    setStaffModal(false);
  }

  function openAbsence(profile: StaffProfile) {
    const today = localDateKey();
    setMessage('');
    setAbsenceForm({ id: `absence-${Date.now()}`, staffId: profile.id, fromDate: today, toDate: today, reason: 'Enfermo', notes: '', active: true, createdAt: new Date().toISOString() });
    setAbsenceModal(true);
  }

  async function submitAbsence() {
    if (!absenceForm) return;
    if (absenceForm.toDate < absenceForm.fromDate) return setMessage('La fecha final no puede ser anterior a la fecha inicial.');
    setSaving(true);
    const result = await saveStaffAbsence({ ...absenceForm, updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar la ausencia.');
    setAbsenceModal(false);
  }

  function openVan(van?: Van) {
    setMessage('');
    setVanForm(van ? { ...van, inventory: [...(van.inventory ?? [])] } : {
      id: `v${Date.now()}`,
      name: `Van ${vans.length + 1}`,
      plate: '',
      technicianIds: [],
      status: 'Disponible',
      responsibleStaffId: undefined,
      regularHelperId: undefined,
      odometerKm: 0,
      inventory: [],
      active: true,
    });
    setVanModal(true);
  }

  async function submitVan() {
    if (!vanForm?.name.trim()) return setMessage('Escribe el nombre de la van.');
    if (!vanForm.plate.trim()) return setMessage('Escribe la matrícula de la van.');
    const technicianIds = [vanForm.responsibleStaffId, vanForm.regularHelperId].filter(Boolean) as string[];
    setSaving(true);
    const result = await saveVanProfile({ ...vanForm, technicianIds, updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar la van.');
    setSelectedVanId(vanForm.id);
    setVanModal(false);
  }

  function openMaintenance(van: Van) {
    setMessage('');
    setMaintenanceForm({
      id: `maint-${Date.now()}`,
      vanId: van.id,
      date: localDateKey(),
      odometerKm: van.odometerKm ?? 0,
      type: 'Mantenimiento preventivo',
      description: '',
      cost: 0,
      nextDueKm: van.nextServiceKm,
      nextDueDate: van.nextServiceDate,
      createdAt: new Date().toISOString(),
    });
    setMaintenanceModal(true);
  }

  async function submitMaintenance() {
    if (!maintenanceForm?.description.trim()) return setMessage('Describe el trabajo realizado a la van.');
    setSaving(true);
    const result = await saveVanMaintenanceLog({ ...maintenanceForm, updatedAt: new Date().toISOString() });
    if (result.ok && selectedVan) {
      await saveVanProfile({
        ...selectedVan,
        odometerKm: Math.max(selectedVan.odometerKm ?? 0, maintenanceForm.odometerKm),
        nextServiceKm: maintenanceForm.nextDueKm,
        nextServiceDate: maintenanceForm.nextDueDate,
        updatedAt: new Date().toISOString(),
      });
    }
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo registrar el mantenimiento.');
    setMaintenanceModal(false);
  }

  function openTool() {
    setMessage('');
    setToolForm({ name: '', category: 'Herramienta', quantity: '1', condition: 'Buena', notes: '' });
    setToolModal(true);
  }

  async function submitTool() {
    if (!selectedVan || !toolForm.name.trim()) return setMessage('Escribe el nombre de la herramienta o material.');
    const inventory = [
      ...(selectedVan.inventory ?? []),
      { id: `tool-${Date.now()}`, name: toolForm.name.trim(), category: toolForm.category.trim() || 'Herramienta', quantity: Math.max(1, Number(toolForm.quantity) || 1), condition: toolForm.condition, notes: toolForm.notes.trim() || undefined },
    ];
    setSaving(true);
    const result = await saveVanProfile({ ...selectedVan, inventory, updatedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar el artículo.');
    setToolModal(false);
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle
        title="Equipo y flota"
        subtitle="Administra responsables, ayudantes, ausencias, despacho diario, kilometraje, mantenimiento e inventario de cada van."
        action={action}
      />

      {dataError ? <View style={styles.errorBox}><Text style={styles.errorText}>{dataError}</Text></View> : null}

      <Card style={styles.tabsCard}>
        <Tab label="Despacho diario" active={tab === 'dispatch'} onPress={() => setTab('dispatch')} />
        <Tab label="Personal" active={tab === 'staff'} onPress={() => setTab('staff')} />
        <Tab label="Vans" active={tab === 'vans'} onPress={() => setTab('vans')} />
      </Card>

      {tab === 'dispatch' ? (
        <>
          <Card style={styles.dateCard}>
            <Button compact variant="secondary" label="← Día anterior" onPress={() => setSelectedDate(addDays(selectedDate, -1))} />
            <View style={styles.dateCenter}><Text style={styles.dateLabel}>Despacho del día</Text><Text style={styles.dateValue}>{formatDate(selectedDate)}</Text></View>
            <Button compact variant="secondary" label="Día siguiente →" onPress={() => setSelectedDate(addDays(selectedDate, 1))} />
          </Card>

          <View style={[styles.grid, compact && styles.gridCompact]}>
            {vans.map((van) => {
              const assignment = assignmentsForDay.find((item) => item.vanId === van.id)!;
              const driver = staffProfiles.find((item) => item.id === assignment.driverStaffId);
              const helper = staffProfiles.find((item) => item.id === assignment.helperStaffId);
              const permanent = staffProfiles.find((item) => item.id === van.responsibleStaffId);
              const jobs = workOrders.filter((order) => order.date === selectedDate && order.vanId === van.id && order.status !== 'Cancelada');
              const hours = jobs.reduce((sum, order) => sum + Math.max(1, Number(order.scheduledSlots ?? 1)), 0);
              const disabledWithJobs = ['Sin personal', 'Mantenimiento', 'Fuera de servicio'].includes(assignment.status) && jobs.length > 0;
              return (
                <Card key={van.id} style={[styles.dispatchCard, disabledWithJobs && styles.dispatchCardAlert]}>
                  <View style={styles.cardTop}><View><Text style={styles.vanName}>{van.name}</Text><Text style={styles.muted}>{van.plate}</Text></View><Pill label={assignment.status} tone={statusTone(assignment.status)} /></View>
                  <CrewRow label="Responsable permanente" value={permanent?.name ?? 'Sin asignar'} />
                  <CrewRow label="Conductor del día" value={driver?.name ?? 'Sin conductor'} strong={!driver} />
                  <CrewRow label="Ayudante del día" value={helper?.name ?? 'Trabajando solo'} />
                  <View style={styles.workload}><Text style={styles.workloadNumber}>{jobs.length}</Text><Text style={styles.workloadText}>trabajos · {hours} horas programadas</Text></View>
                  {disabledWithJobs ? <View style={styles.warningBox}><Text style={styles.warningText}>Esta van no está habilitada y tiene trabajo programado. Reasigna personal o mueve las citas.</Text></View> : null}
                  {assignment.notes ? <Text style={styles.notesText}>{assignment.notes}</Text> : null}
                  <Button label="Editar despacho" variant="secondary" onPress={() => openAssignment(van)} />
                </Card>
              );
            })}
          </View>
        </>
      ) : null}

      {tab === 'staff' ? (
        <View style={[styles.grid, compact && styles.gridCompact]}>
          {staffProfiles.map((profile) => {
            const van = vans.find((item) => item.id === profile.primaryVanId);
            const activeAbsences = staffAbsences.filter((absence) => absence.staffId === profile.id && absence.active && absence.toDate >= localDateKey());
            return (
              <Card key={profile.id} style={styles.personCard}>
                <View style={styles.cardTop}><View style={styles.personHeader}><View style={styles.avatar}><Text style={styles.avatarText}>{profile.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</Text></View><View><Text style={styles.personName}>{profile.name}</Text><Text style={styles.muted}>{profile.role}</Text></View></View><Pill label={profile.availability} tone={statusTone(profile.availability)} /></View>
                <CrewRow label="Van principal" value={van?.name ?? 'Sin van'} />
                <CrewRow label="Puede manejar" value={profile.canDriveVan ? 'Sí' : 'No'} />
                <CrewRow label="Teléfono" value={profile.phone} />
                <Text style={styles.skills}>{profile.skills.length ? profile.skills.join(' · ') : 'Sin especialidades registradas'}</Text>
                {activeAbsences.map((absence) => <View key={absence.id} style={styles.absenceRow}><Text style={styles.absenceText}>{absence.reason}: {absence.fromDate} → {absence.toDate}</Text><Pressable onPress={() => void removeStaffAbsence(absence.id)}><Text style={styles.removeText}>Quitar</Text></Pressable></View>)}
                <View style={styles.actionRow}><Button compact variant="secondary" label="Editar" onPress={() => openStaff(profile)} /><Button compact variant="secondary" label="Registrar ausencia" onPress={() => openAbsence(profile)} /></View>
              </Card>
            );
          })}
        </View>
      ) : null}

      {tab === 'vans' ? (
        <View style={[styles.vanLayout, compact && styles.vanLayoutCompact]}>
          <View style={styles.vanList}>
            {vans.map((van) => <Pressable key={van.id} onPress={() => setSelectedVanId(van.id)} style={[styles.vanListItem, selectedVan?.id === van.id && styles.vanListItemActive]}><View><Text style={styles.vanListTitle}>{van.name}</Text><Text style={styles.muted}>{van.plate}</Text></View><Pill label={van.status} tone={statusTone(van.status)} /></Pressable>)}
          </View>
          {selectedVan ? (
            <View style={styles.vanDetails}>
              <Card>
                <View style={styles.cardTop}><View><Text style={styles.detailTitle}>{selectedVan.name}</Text><Text style={styles.muted}>{selectedVan.plate}</Text></View><View style={styles.actionRow}><Button compact variant="secondary" label="Editar perfil" onPress={() => openVan(selectedVan)} /><Button compact label="Registrar mantenimiento" onPress={() => openMaintenance(selectedVan)} /></View></View>
                <View style={styles.metricsRow}><Metric label="Kilometraje" value={`${(selectedVan.odometerKm ?? 0).toLocaleString()} km`} /><Metric label="Próximo servicio" value={selectedVan.nextServiceKm ? `${selectedVan.nextServiceKm.toLocaleString()} km` : 'Sin definir'} /><Metric label="Fecha prevista" value={selectedVan.nextServiceDate ?? 'Sin definir'} /></View>
                <CrewRow label="Técnico responsable" value={staffProfiles.find((item) => item.id === selectedVan.responsibleStaffId)?.name ?? 'Sin asignar'} />
                <CrewRow label="Ayudante habitual" value={staffProfiles.find((item) => item.id === selectedVan.regularHelperId)?.name ?? 'Sin asignar'} />
                <CrewRow label="Seguro vence" value={selectedVan.insuranceExpiresAt ?? 'Sin registrar'} />
                <CrewRow label="Matrícula vence" value={selectedVan.registrationExpiresAt ?? 'Sin registrar'} />
                {selectedVan.notes ? <Text style={styles.notesText}>{selectedVan.notes}</Text> : null}
              </Card>

              <Card>
                <View style={styles.cardTop}><View><Text style={styles.subTitle}>Inventario de la van</Text><Text style={styles.muted}>Herramientas, equipos y consumibles asignados.</Text></View><Button compact label="Añadir artículo" icon="＋" onPress={openTool} /></View>
                {(selectedVan.inventory ?? []).length ? (selectedVan.inventory ?? []).map((item) => <View key={item.id} style={styles.listRow}><View style={{ flex: 1 }}><Text style={styles.listTitle}>{item.name}</Text><Text style={styles.muted}>{item.category} · Cantidad: {item.quantity}</Text></View><Pill label={item.condition} tone={statusTone(item.condition)} /></View>) : <Text style={styles.emptyText}>No hay herramientas registradas para esta van.</Text>}
              </Card>

              <Card>
                <Text style={styles.subTitle}>Historial de mantenimiento</Text>
                {selectedVanLogs.length ? selectedVanLogs.map((log) => <View key={log.id} style={styles.listRow}><View style={{ flex: 1 }}><Text style={styles.listTitle}>{log.type}</Text><Text style={styles.muted}>{log.date} · {log.odometerKm.toLocaleString()} km</Text><Text style={styles.notesText}>{log.description}</Text></View><Text style={styles.costText}>{log.cost ? formatMoney(log.cost) : '—'}</Text></View>) : <Text style={styles.emptyText}>No hay mantenimientos registrados.</Text>}
              </Card>
            </View>
          ) : null}
        </View>
      ) : null}

      <AppModal visible={assignmentModal} title="Editar despacho diario" onClose={() => !saving && setAssignmentModal(false)}>
        <ScrollView>
          {message ? <FormMessage text={message} /> : null}
          <Text style={styles.modalHelp}>La asignación solo aplica a {selectedDate}. El responsable permanente de la van no cambia.</Text>
          <Text style={styles.fieldTitle}>Estado de la van</Text>
          <OptionWrap options={assignmentStatuses} value={assignmentForm?.status} onChange={(value) => setAssignmentForm((current) => current ? { ...current, status: value as DailyVanAssignment['status'] } : current)} />
          <Text style={styles.fieldTitle}>Conductor autorizado</Text>
          <OptionWrap options={['Sin conductor', ...staffProfiles.filter((item) => item.active && item.canDriveVan && !isAbsent(item, selectedDate, staffAbsences)).map((item) => item.name)]} value={staffProfiles.find((item) => item.id === assignmentForm?.driverStaffId)?.name ?? 'Sin conductor'} onChange={(value) => setAssignmentForm((current) => current ? { ...current, driverStaffId: staffProfiles.find((item) => item.name === value)?.id } : current)} />
          <Text style={styles.fieldTitle}>Ayudante del día</Text>
          <OptionWrap options={['Sin ayudante', ...staffProfiles.filter((item) => item.active && item.id !== assignmentForm?.driverStaffId && !isAbsent(item, selectedDate, staffAbsences)).map((item) => item.name)]} value={staffProfiles.find((item) => item.id === assignmentForm?.helperStaffId)?.name ?? 'Sin ayudante'} onChange={(value) => setAssignmentForm((current) => current ? { ...current, helperStaffId: staffProfiles.find((item) => item.name === value)?.id } : current)} />
          <Input label="Notas del despacho" multiline value={assignmentForm?.notes ?? ''} onChangeText={(notes) => setAssignmentForm((current) => current ? { ...current, notes } : current)} placeholder="Ej. Ayudante movido desde Van 2 por instalación pesada." />
          <ModalActions saving={saving} onCancel={() => setAssignmentModal(false)} onSave={() => void submitAssignment()} />
        </ScrollView>
      </AppModal>

      <AppModal visible={staffModal} title={staffForm?.createdAt && !staffProfiles.some((item) => item.id === staffForm.id) ? 'Nuevo trabajador' : 'Editar trabajador'} onClose={() => !saving && setStaffModal(false)}>
        <ScrollView>
          {message ? <FormMessage text={message} /> : null}
          <Input label="Nombre completo" value={staffForm?.name ?? ''} onChangeText={(name) => setStaffForm((current) => current ? { ...current, name } : current)} />
          <View style={styles.twoColumns}><Input style={styles.flexField} label="Teléfono" value={staffForm?.phone ?? ''} onChangeText={(phone) => setStaffForm((current) => current ? { ...current, phone } : current)} /><Input style={styles.flexField} label="Correo" value={staffForm?.email ?? ''} onChangeText={(email) => setStaffForm((current) => current ? { ...current, email } : current)} /></View>
          <Text style={styles.fieldTitle}>Cargo</Text><OptionWrap options={staffRoles} value={staffForm?.role} onChange={(role) => setStaffForm((current) => current ? { ...current, role: role as StaffRole, canDriveVan: role === 'Técnico responsable' ? true : current.canDriveVan } : current)} />
          <Text style={styles.fieldTitle}>Autorizado para manejar</Text><OptionWrap options={['Sí', 'No']} value={staffForm?.canDriveVan ? 'Sí' : 'No'} onChange={(value) => setStaffForm((current) => current ? { ...current, canDriveVan: value === 'Sí' } : current)} />
          <Text style={styles.fieldTitle}>Van principal</Text><OptionWrap options={['Sin van', ...vans.map((van) => van.name)]} value={vans.find((van) => van.id === staffForm?.primaryVanId)?.name ?? 'Sin van'} onChange={(value) => setStaffForm((current) => current ? { ...current, primaryVanId: vans.find((van) => van.name === value)?.id } : current)} />
          <Text style={styles.fieldTitle}>Disponibilidad general</Text><OptionWrap options={availabilityOptions} value={staffForm?.availability} onChange={(availability) => setStaffForm((current) => current ? { ...current, availability: availability as StaffAvailability } : current)} />
          <Input label="Especialidades" value={staffForm?.skills.join(', ') ?? ''} onChangeText={(value) => setStaffForm((current) => current ? { ...current, skills: value.split(',').map((item) => item.trim()).filter(Boolean) } : current)} placeholder="Servicio, instalación, VRF, electricidad…" />
          <Input label="Notas internas" multiline value={staffForm?.notes ?? ''} onChangeText={(notes) => setStaffForm((current) => current ? { ...current, notes } : current)} />
          <ModalActions saving={saving} onCancel={() => setStaffModal(false)} onSave={() => void submitStaff()} />
        </ScrollView>
      </AppModal>

      <AppModal visible={absenceModal} title="Registrar ausencia" onClose={() => !saving && setAbsenceModal(false)}>
        <ScrollView>
          {message ? <FormMessage text={message} /> : null}
          <Text style={styles.fieldTitle}>Motivo</Text><OptionWrap options={['Enfermo', 'Vacaciones', 'Libre', 'Otro']} value={absenceForm?.reason} onChange={(reason) => setAbsenceForm((current) => current ? { ...current, reason: reason as StaffAbsence['reason'] } : current)} />
          <View style={styles.twoColumns}><Input style={styles.flexField} label="Desde" value={absenceForm?.fromDate ?? ''} onChangeText={(fromDate) => setAbsenceForm((current) => current ? { ...current, fromDate } : current)} placeholder="YYYY-MM-DD" /><Input style={styles.flexField} label="Hasta" value={absenceForm?.toDate ?? ''} onChangeText={(toDate) => setAbsenceForm((current) => current ? { ...current, toDate } : current)} placeholder="YYYY-MM-DD" /></View>
          <Input label="Notas" multiline value={absenceForm?.notes ?? ''} onChangeText={(notes) => setAbsenceForm((current) => current ? { ...current, notes } : current)} />
          <ModalActions saving={saving} onCancel={() => setAbsenceModal(false)} onSave={() => void submitAbsence()} />
        </ScrollView>
      </AppModal>

      <AppModal visible={vanModal} title="Perfil de la van" onClose={() => !saving && setVanModal(false)}>
        <ScrollView>
          {message ? <FormMessage text={message} /> : null}
          <View style={styles.twoColumns}><Input style={styles.flexField} label="Nombre" value={vanForm?.name ?? ''} onChangeText={(name) => setVanForm((current) => current ? { ...current, name } : current)} /><Input style={styles.flexField} label="Matrícula" value={vanForm?.plate ?? ''} onChangeText={(plate) => setVanForm((current) => current ? { ...current, plate } : current)} /></View>
          <Text style={styles.fieldTitle}>Estado operativo</Text><OptionWrap options={vanStatuses} value={vanForm?.status} onChange={(status) => setVanForm((current) => current ? { ...current, status: status as VanOperationalStatus } : current)} />
          <Text style={styles.fieldTitle}>Técnico responsable y conductor principal</Text><OptionWrap options={['Sin responsable', ...staffProfiles.filter((item) => item.canDriveVan).map((item) => item.name)]} value={staffProfiles.find((item) => item.id === vanForm?.responsibleStaffId)?.name ?? 'Sin responsable'} onChange={(value) => setVanForm((current) => current ? { ...current, responsibleStaffId: staffProfiles.find((item) => item.name === value)?.id } : current)} />
          <Text style={styles.fieldTitle}>Ayudante habitual</Text><OptionWrap options={['Sin ayudante', ...staffProfiles.filter((item) => item.id !== vanForm?.responsibleStaffId).map((item) => item.name)]} value={staffProfiles.find((item) => item.id === vanForm?.regularHelperId)?.name ?? 'Sin ayudante'} onChange={(value) => setVanForm((current) => current ? { ...current, regularHelperId: staffProfiles.find((item) => item.name === value)?.id } : current)} />
          <View style={styles.twoColumns}><Input style={styles.flexField} label="Kilometraje actual" keyboardType="numeric" value={String(vanForm?.odometerKm ?? 0)} onChangeText={(value) => setVanForm((current) => current ? { ...current, odometerKm: Number(value) || 0 } : current)} /><Input style={styles.flexField} label="Próximo servicio (km)" keyboardType="numeric" value={String(vanForm?.nextServiceKm ?? '')} onChangeText={(value) => setVanForm((current) => current ? { ...current, nextServiceKm: Number(value) || undefined } : current)} /></View>
          <View style={styles.twoColumns}><Input style={styles.flexField} label="Fecha próximo servicio" value={vanForm?.nextServiceDate ?? ''} onChangeText={(nextServiceDate) => setVanForm((current) => current ? { ...current, nextServiceDate } : current)} placeholder="YYYY-MM-DD" /><Input style={styles.flexField} label="Seguro vence" value={vanForm?.insuranceExpiresAt ?? ''} onChangeText={(insuranceExpiresAt) => setVanForm((current) => current ? { ...current, insuranceExpiresAt } : current)} placeholder="YYYY-MM-DD" /></View>
          <Input label="Matrícula vence" value={vanForm?.registrationExpiresAt ?? ''} onChangeText={(registrationExpiresAt) => setVanForm((current) => current ? { ...current, registrationExpiresAt } : current)} placeholder="YYYY-MM-DD" />
          <Input label="Notas" multiline value={vanForm?.notes ?? ''} onChangeText={(notes) => setVanForm((current) => current ? { ...current, notes } : current)} />
          <ModalActions saving={saving} onCancel={() => setVanModal(false)} onSave={() => void submitVan()} />
        </ScrollView>
      </AppModal>

      <AppModal visible={maintenanceModal} title="Registrar mantenimiento" onClose={() => !saving && setMaintenanceModal(false)}>
        <ScrollView>
          {message ? <FormMessage text={message} /> : null}
          <View style={styles.twoColumns}><Input style={styles.flexField} label="Fecha" value={maintenanceForm?.date ?? ''} onChangeText={(date) => setMaintenanceForm((current) => current ? { ...current, date } : current)} /><Input style={styles.flexField} label="Kilometraje" keyboardType="numeric" value={String(maintenanceForm?.odometerKm ?? 0)} onChangeText={(value) => setMaintenanceForm((current) => current ? { ...current, odometerKm: Number(value) || 0 } : current)} /></View>
          <Input label="Tipo de servicio" value={maintenanceForm?.type ?? ''} onChangeText={(type) => setMaintenanceForm((current) => current ? { ...current, type } : current)} />
          <Input label="Descripción" multiline value={maintenanceForm?.description ?? ''} onChangeText={(description) => setMaintenanceForm((current) => current ? { ...current, description } : current)} />
          <View style={styles.twoColumns}><Input style={styles.flexField} label="Costo Afl." keyboardType="numeric" value={String(maintenanceForm?.cost ?? '')} onChangeText={(value) => setMaintenanceForm((current) => current ? { ...current, cost: Number(value) || 0 } : current)} /><Input style={styles.flexField} label="Próximo servicio (km)" keyboardType="numeric" value={String(maintenanceForm?.nextDueKm ?? '')} onChangeText={(value) => setMaintenanceForm((current) => current ? { ...current, nextDueKm: Number(value) || undefined } : current)} /></View>
          <Input label="Próxima fecha" value={maintenanceForm?.nextDueDate ?? ''} onChangeText={(nextDueDate) => setMaintenanceForm((current) => current ? { ...current, nextDueDate } : current)} placeholder="YYYY-MM-DD" />
          <ModalActions saving={saving} onCancel={() => setMaintenanceModal(false)} onSave={() => void submitMaintenance()} />
        </ScrollView>
      </AppModal>

      <AppModal visible={toolModal} title="Añadir artículo a la van" onClose={() => !saving && setToolModal(false)}>
        <ScrollView>
          {message ? <FormMessage text={message} /> : null}
          <Input label="Herramienta, equipo o material" value={toolForm.name} onChangeText={(name) => setToolForm((current) => ({ ...current, name }))} />
          <View style={styles.twoColumns}><Input style={styles.flexField} label="Categoría" value={toolForm.category} onChangeText={(category) => setToolForm((current) => ({ ...current, category }))} /><Input style={styles.flexField} label="Cantidad" keyboardType="numeric" value={toolForm.quantity} onChangeText={(quantity) => setToolForm((current) => ({ ...current, quantity }))} /></View>
          <Text style={styles.fieldTitle}>Condición</Text><OptionWrap options={toolConditions} value={toolForm.condition} onChange={(condition) => setToolForm((current) => ({ ...current, condition: condition as VanToolCondition }))} />
          <Input label="Notas" multiline value={toolForm.notes} onChangeText={(notes) => setToolForm((current) => ({ ...current, notes }))} />
          <ModalActions saving={saving} onCancel={() => setToolModal(false)} onSave={() => void submitTool()} />
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>;
}

function CrewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <View style={styles.crewRow}><Text style={styles.crewLabel}>{label}</Text><Text style={[styles.crewValue, strong && styles.crewValueAlert]}>{value}</Text></View>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function OptionWrap({ options, value, onChange }: { options: readonly string[]; value?: string; onChange: (value: string) => void }) {
  return <View style={styles.optionWrap}>{options.map((option) => <Pressable key={option} onPress={() => onChange(option)} style={[styles.option, value === option && styles.optionActive]}><Text style={[styles.optionText, value === option && styles.optionTextActive]}>{option}</Text></Pressable>)}</View>;
}

function ModalActions({ saving, onCancel, onSave }: { saving: boolean; onCancel: () => void; onSave: () => void }) {
  return <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={onCancel} /><Button label={saving ? 'Guardando…' : 'Guardar'} disabled={saving} onPress={onSave} /></View>;
}

function FormMessage({ text }: { text: string }) {
  return <View style={styles.formMessage}><Text style={styles.formMessageText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: 26, gap: 16, paddingBottom: 96 },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 12 },
  errorText: { color: colors.danger, fontWeight: '700', fontSize: 11 },
  tabsCard: { flexDirection: 'row', padding: 5, gap: 4, alignSelf: 'flex-start' },
  tab: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 7 },
  tabActive: { backgroundColor: colors.primaryLight },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  tabTextActive: { color: colors.primaryDark },
  dateCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  dateValue: { color: colors.text, fontSize: 16, fontWeight: '900', textTransform: 'capitalize', marginTop: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridCompact: { flexDirection: 'column' },
  dispatchCard: { width: '48.8%', minWidth: 350, gap: 12 },
  dispatchCardAlert: { borderColor: '#F2B8B5' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  vanName: { color: colors.text, fontSize: 18, fontWeight: '900' },
  muted: { color: colors.muted, fontSize: 10, marginTop: 3 },
  crewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: '#EEF0F2', paddingBottom: 8 },
  crewLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  crewValue: { color: colors.text, fontSize: 11, fontWeight: '800', textAlign: 'right', flex: 1 },
  crewValueAlert: { color: colors.danger },
  workload: { flexDirection: 'row', alignItems: 'baseline', gap: 7, backgroundColor: '#F4F5F7', padding: 10, borderRadius: 8 },
  workloadNumber: { color: colors.text, fontSize: 20, fontWeight: '900' },
  workloadText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  warningBox: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
  warningText: { color: colors.danger, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  notesText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  personCard: { width: '32%', minWidth: 310, gap: 11 },
  personHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brandBlue, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 },
  personName: { color: colors.text, fontWeight: '900', fontSize: 14 },
  skills: { color: colors.primaryDark, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  absenceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.warningLight, borderRadius: 7, padding: 8 },
  absenceText: { color: colors.warning, fontSize: 9, fontWeight: '700', flex: 1 },
  removeText: { color: colors.danger, fontSize: 9, fontWeight: '900' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vanLayout: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  vanLayoutCompact: { flexDirection: 'column' },
  vanList: { width: 270, gap: 8 },
  vanListItem: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 12, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  vanListItemActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  vanListTitle: { color: colors.text, fontWeight: '900', fontSize: 13 },
  vanDetails: { flex: 1, gap: 14, minWidth: 0 },
  detailTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 14 },
  metric: { flex: 1, minWidth: 150, backgroundColor: '#F4F5F7', borderRadius: 8, padding: 12 },
  metricLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  metricValue: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 5 },
  subTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderBottomWidth: 1, borderBottomColor: '#EEF0F2', paddingVertical: 12 },
  listTitle: { color: colors.text, fontSize: 12, fontWeight: '900' },
  costText: { color: colors.text, fontSize: 11, fontWeight: '900' },
  emptyText: { color: colors.muted, fontSize: 11, paddingVertical: 18 },
  modalHelp: { color: colors.muted, fontSize: 11, lineHeight: 16, marginBottom: 13 },
  fieldTitle: { color: colors.text, fontSize: 11, fontWeight: '900', marginBottom: 8, marginTop: 3 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: '#FFFFFF' },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  optionTextActive: { color: colors.primaryDark, fontWeight: '900' },
  twoColumns: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  flexField: { flex: 1, minWidth: 210 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 10 },
  formMessage: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10, marginBottom: 12 },
  formMessageText: { color: colors.danger, fontSize: 10, fontWeight: '700' },
});
