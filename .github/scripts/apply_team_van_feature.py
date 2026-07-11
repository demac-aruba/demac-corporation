from pathlib import Path
import re


def replace_once(path: str, old: str, new: str):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Missing source fragment in {path}: {old[:120]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_all(path: str, old: str, new: str, expected_min: int = 1):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count < expected_min:
        raise SystemExit(f'Expected at least {expected_min} occurrences in {path}, found {count}: {old[:120]!r}')
    file.write_text(text.replace(old, new), encoding='utf-8')

# ---------------- types.ts ----------------
replace_once('src/types.ts', "  | 'workOrders'\n  | 'technician'", "  | 'workOrders'\n  | 'team'\n  | 'technician'")

replace_once(
    'src/types.ts',
    'export interface User {',
    """export type StaffRole = 'Técnico responsable' | 'Técnico' | 'Ayudante' | 'Supervisor';
export type StaffAvailability = 'Disponible' | 'Enfermo' | 'Vacaciones' | 'Libre' | 'Inactivo';

export interface StaffProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: StaffRole;
  canDriveVan: boolean;
  primaryVanId?: string;
  skills: string[];
  availability: StaffAvailability;
  unavailableFrom?: string;
  unavailableUntil?: string;
  licenseNumber?: string;
  licenseExpiresAt?: string;
  active: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StaffAbsence {
  id: string;
  staffId: string;
  fromDate: string;
  toDate: string;
  reason: 'Enfermo' | 'Vacaciones' | 'Libre' | 'Otro';
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type VanOperationalStatus = 'Disponible' | 'En ruta' | 'Mantenimiento' | 'Fuera de servicio' | 'Sin personal';
export type VanToolCondition = 'Buena' | 'Requiere atención' | 'Fuera de servicio';

export interface VanToolItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  condition: VanToolCondition;
  notes?: string;
}

export interface DailyVanAssignment {
  id: string;
  date: string;
  vanId: string;
  driverStaffId?: string;
  helperStaffId?: string;
  status: 'Disponible' | 'Trabajo liviano' | 'Sin personal' | 'Mantenimiento' | 'Fuera de servicio';
  notes?: string;
  updatedAt?: string;
}

export interface VanMaintenanceLog {
  id: string;
  vanId: string;
  date: string;
  odometerKm: number;
  type: string;
  description: string;
  cost?: number;
  nextDueKm?: number;
  nextDueDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface User {""",
)

replace_once(
    'src/types.ts',
    """export interface Van {
  id: string;
  name: string;
  plate: string;
  technicianIds: string[];
  status: 'Disponible' | 'En ruta' | 'Mantenimiento';
}
""",
    """export interface Van {
  id: string;
  name: string;
  plate: string;
  technicianIds: string[];
  status: VanOperationalStatus;
  responsibleStaffId?: string;
  regularHelperId?: string;
  odometerKm?: number;
  nextServiceKm?: number;
  nextServiceDate?: string;
  insuranceExpiresAt?: string;
  registrationExpiresAt?: string;
  notes?: string;
  inventory?: VanToolItem[];
  active?: boolean;
  updatedAt?: string;
}
""",
)

# ---------------- AppShell.tsx ----------------
replace_once('src/components/AppShell.tsx', "import { TechnicianScreen } from '../screens/TechnicianScreen';", "import { TechnicianScreen } from '../screens/TechnicianScreen';\nimport { TeamScreen } from '../screens/TeamScreen';")
replace_once('src/components/AppShell.tsx', "  { key: 'workOrders', label: 'Trabajos', icon: '☷', roles: ['admin', 'office', 'supervisor'] },", "  { key: 'workOrders', label: 'Trabajos', icon: '☷', roles: ['admin', 'office', 'supervisor'] },\n  { key: 'team', label: 'Equipo', icon: '♟', roles: ['admin', 'office', 'supervisor'] },")
replace_once('src/components/AppShell.tsx', "    case 'workOrders': content = <WorkOrdersScreen />; break;", "    case 'workOrders': content = <WorkOrdersScreen />; break;\n    case 'team': content = <TeamScreen />; break;")

# ---------------- AppState.tsx ----------------
replace_once(
    'src/state/AppState.tsx',
    "} from '../data/demo';\nimport {",
    "} from '../data/demo';\nimport { demoDailyVanAssignments, demoStaffAbsences, demoStaffProfiles, demoTeamVans, demoVanMaintenanceLogs } from '../data/teamDemo';\nimport {",
)
replace_once(
    'src/state/AppState.tsx',
    "import { Client, InventoryItem, Invoice, Property, ServiceType, User, UserRole, WorkOrder } from '../types';",
    "import { Client, DailyVanAssignment, InventoryItem, Invoice, Property, ServiceType, StaffAbsence, StaffProfile, User, UserRole, Van, VanMaintenanceLog, WorkOrder } from '../types';",
)
replace_once(
    'src/state/AppState.tsx',
    "  invoices: Invoice[];\n};",
    "  invoices: Invoice[];\n  staffProfiles: StaffProfile[];\n  vans: Van[];\n  dailyVanAssignments: DailyVanAssignment[];\n  staffAbsences: StaffAbsence[];\n  vanMaintenanceLogs: VanMaintenanceLog[];\n};",
)
replace_once('src/state/AppState.tsx', "  users: User[];\n  clients: Client[];", "  users: User[];\n  staffProfiles: StaffProfile[];\n  clients: Client[];")
replace_once('src/state/AppState.tsx', "  vans: typeof demoVans;\n  workOrders: WorkOrder[];", "  vans: Van[];\n  dailyVanAssignments: DailyVanAssignment[];\n  staffAbsences: StaffAbsence[];\n  vanMaintenanceLogs: VanMaintenanceLog[];\n  workOrders: WorkOrder[];")
replace_once(
    'src/state/AppState.tsx',
    "  removeCatalogItem: (id: string) => Promise<OperationResult>;\n  addWorkOrder: (order: WorkOrder) => Promise<OperationResult>;",
    "  removeCatalogItem: (id: string) => Promise<OperationResult>;\n  saveStaffProfile: (profile: StaffProfile) => Promise<OperationResult>;\n  saveVanProfile: (van: Van) => Promise<OperationResult>;\n  saveDailyVanAssignment: (assignment: DailyVanAssignment) => Promise<OperationResult>;\n  saveStaffAbsence: (absence: StaffAbsence) => Promise<OperationResult>;\n  removeStaffAbsence: (id: string) => Promise<OperationResult>;\n  saveVanMaintenanceLog: (log: VanMaintenanceLog) => Promise<OperationResult>;\n  addWorkOrder: (order: WorkOrder) => Promise<OperationResult>;",
)
replace_once(
    'src/state/AppState.tsx',
    "  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);",
    "  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);\n  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>(demoStaffProfiles);\n  const [vans, setVans] = useState<Van[]>(demoTeamVans);\n  const [dailyVanAssignments, setDailyVanAssignments] = useState<DailyVanAssignment[]>(demoDailyVanAssignments);\n  const [staffAbsences, setStaffAbsences] = useState<StaffAbsence[]>(demoStaffAbsences);\n  const [vanMaintenanceLogs, setVanMaintenanceLogs] = useState<VanMaintenanceLog[]>(demoVanMaintenanceLogs);",
)

replace_once(
    'src/state/AppState.tsx',
    """      const [remoteClients, remoteProperties, remoteServices, remoteWorkOrders] = await Promise.all([
        listFirestoreCollection<Client>('clients'),
        listFirestoreCollection<Property>('properties'),
        listFirestoreCollection<ServiceType>('services'),
        listFirestoreCollection<WorkOrder>('workOrders'),
      ]);
      setClients(sortClients(remoteClients));
      setProperties(sortProperties(remoteProperties));
      setServices(sortCatalog(remoteServices));
      setWorkOrders(sortWorkOrders(remoteWorkOrders));""",
    """      const [remoteClients, remoteProperties, remoteServices, remoteWorkOrders, remoteStaff, remoteVans, remoteAssignments, remoteAbsences, remoteMaintenance] = await Promise.all([
        listFirestoreCollection<Client>('clients'),
        listFirestoreCollection<Property>('properties'),
        listFirestoreCollection<ServiceType>('services'),
        listFirestoreCollection<WorkOrder>('workOrders'),
        listFirestoreCollection<StaffProfile>('staffProfiles'),
        listFirestoreCollection<Van>('vans'),
        listFirestoreCollection<DailyVanAssignment>('dailyVanAssignments'),
        listFirestoreCollection<StaffAbsence>('staffAbsences'),
        listFirestoreCollection<VanMaintenanceLog>('vanMaintenanceLogs'),
      ]);
      setClients(sortClients(remoteClients));
      setProperties(sortProperties(remoteProperties));
      setServices(sortCatalog(remoteServices));
      setWorkOrders(sortWorkOrders(remoteWorkOrders));
      setStaffProfiles(sortStaff(remoteStaff.length ? remoteStaff : demoStaffProfiles));
      setVans(sortVans(remoteVans.length ? remoteVans : demoTeamVans));
      setDailyVanAssignments(sortAssignments(remoteAssignments));
      setStaffAbsences(sortAbsences(remoteAbsences));
      setVanMaintenanceLogs(sortMaintenance(remoteMaintenance));""",
)
replace_once('src/state/AppState.tsx', "function sortWorkOrders(items: WorkOrder[]) {\n  return [...items].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));\n}\n", "function sortWorkOrders(items: WorkOrder[]) {\n  return [...items].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));\n}\n\nfunction sortStaff(items: StaffProfile[]) { return [...items].sort((a, b) => a.name.localeCompare(b.name)); }\nfunction sortVans(items: Van[]) { return [...items].sort((a, b) => a.name.localeCompare(b.name)); }\nfunction sortAssignments(items: DailyVanAssignment[]) { return [...items].sort((a, b) => `${b.date}-${a.vanId}`.localeCompare(`${a.date}-${b.vanId}`)); }\nfunction sortAbsences(items: StaffAbsence[]) { return [...items].sort((a, b) => b.fromDate.localeCompare(a.fromDate)); }\nfunction sortMaintenance(items: VanMaintenanceLog[]) { return [...items].sort((a, b) => b.date.localeCompare(a.date)); }\n")
replace_once(
    'src/state/AppState.tsx',
    "          if (Array.isArray(parsed.invoices)) setInvoices(parsed.invoices);",
    "          if (Array.isArray(parsed.invoices)) setInvoices(parsed.invoices);\n          if (Array.isArray(parsed.staffProfiles)) setStaffProfiles(parsed.staffProfiles);\n          if (Array.isArray(parsed.vans)) setVans(parsed.vans);\n          if (Array.isArray(parsed.dailyVanAssignments)) setDailyVanAssignments(parsed.dailyVanAssignments);\n          if (Array.isArray(parsed.staffAbsences)) setStaffAbsences(parsed.staffAbsences);\n          if (Array.isArray(parsed.vanMaintenanceLogs)) setVanMaintenanceLogs(parsed.vanMaintenanceLogs);",
)
replace_all(
    'src/state/AppState.tsx',
    "        setWorkOrders([]);",
    "        setWorkOrders([]);\n        setStaffProfiles([]);\n        setVans([]);\n        setDailyVanAssignments([]);\n        setStaffAbsences([]);\n        setVanMaintenanceLogs([]);",
    expected_min=2,
)
replace_once(
    'src/state/AppState.tsx',
    "    const state: PersistedState = { clients, properties, services, workOrders, inventory, invoices };",
    "    const state: PersistedState = { clients, properties, services, workOrders, inventory, invoices, staffProfiles, vans, dailyVanAssignments, staffAbsences, vanMaintenanceLogs };",
)
replace_once(
    'src/state/AppState.tsx',
    "  }, [clients, properties, services, workOrders, inventory, invoices, localHydrated, currentUser?.authProvider]);",
    "  }, [clients, properties, services, workOrders, inventory, invoices, staffProfiles, vans, dailyVanAssignments, staffAbsences, vanMaintenanceLogs, localHydrated, currentUser?.authProvider]);",
)
replace_once(
    'src/state/AppState.tsx',
    "    setInvoices(demoInvoices);\n    setDataError(null);",
    "    setInvoices(demoInvoices);\n    setStaffProfiles(demoStaffProfiles);\n    setVans(demoTeamVans);\n    setDailyVanAssignments(demoDailyVanAssignments);\n    setStaffAbsences(demoStaffAbsences);\n    setVanMaintenanceLogs(demoVanMaintenanceLogs);\n    setDataError(null);",
)

crud_block = r'''
  const saveStaffProfile = async (profile: StaffProfile): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setStaffProfiles((previous) => sortStaff([profile, ...previous.filter((item) => item.id !== profile.id)]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('staffProfiles', profile);
      setStaffProfiles((previous) => sortStaff([profile, ...previous.filter((item) => item.id !== profile.id)]));
      setDataError(null); setLastSyncedAt(new Date().toISOString()); return { ok: true };
    } catch (error) { const message = friendlyDataError(error); setDataError(message); return { ok: false, message }; }
  };

  const saveVanProfile = async (van: Van): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setVans((previous) => sortVans([van, ...previous.filter((item) => item.id !== van.id)]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('vans', van);
      setVans((previous) => sortVans([van, ...previous.filter((item) => item.id !== van.id)]));
      setDataError(null); setLastSyncedAt(new Date().toISOString()); return { ok: true };
    } catch (error) { const message = friendlyDataError(error); setDataError(message); return { ok: false, message }; }
  };

  const saveDailyVanAssignment = async (assignment: DailyVanAssignment): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setDailyVanAssignments((previous) => sortAssignments([assignment, ...previous.filter((item) => item.id !== assignment.id)]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('dailyVanAssignments', assignment);
      setDailyVanAssignments((previous) => sortAssignments([assignment, ...previous.filter((item) => item.id !== assignment.id)]));
      setDataError(null); setLastSyncedAt(new Date().toISOString()); return { ok: true };
    } catch (error) { const message = friendlyDataError(error); setDataError(message); return { ok: false, message }; }
  };

  const saveStaffAbsence = async (absence: StaffAbsence): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setStaffAbsences((previous) => sortAbsences([absence, ...previous.filter((item) => item.id !== absence.id)]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('staffAbsences', absence);
      setStaffAbsences((previous) => sortAbsences([absence, ...previous.filter((item) => item.id !== absence.id)]));
      setDataError(null); setLastSyncedAt(new Date().toISOString()); return { ok: true };
    } catch (error) { const message = friendlyDataError(error); setDataError(message); return { ok: false, message }; }
  };

  const removeStaffAbsence = async (id: string): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') { setStaffAbsences((previous) => previous.filter((item) => item.id !== id)); return { ok: true }; }
    try {
      await deleteFirestoreDocument('staffAbsences', id);
      setStaffAbsences((previous) => previous.filter((item) => item.id !== id));
      setDataError(null); setLastSyncedAt(new Date().toISOString()); return { ok: true };
    } catch (error) { const message = friendlyDataError(error); setDataError(message); return { ok: false, message }; }
  };

  const saveVanMaintenanceLog = async (log: VanMaintenanceLog): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setVanMaintenanceLogs((previous) => sortMaintenance([log, ...previous.filter((item) => item.id !== log.id)]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('vanMaintenanceLogs', log);
      setVanMaintenanceLogs((previous) => sortMaintenance([log, ...previous.filter((item) => item.id !== log.id)]));
      setDataError(null); setLastSyncedAt(new Date().toISOString()); return { ok: true };
    } catch (error) { const message = friendlyDataError(error); setDataError(message); return { ok: false, message }; }
  };
'''
replace_once('src/state/AppState.tsx', "  const adjustInventory = (id: string, quantityDelta: number) => {", crud_block + "\n  const adjustInventory = (id: string, quantityDelta: number) => {")
replace_once(
    'src/state/AppState.tsx',
    "    users: demoUsers,\n    clients,",
    "    users: demoUsers,\n    staffProfiles,\n    clients,",
)
replace_once(
    'src/state/AppState.tsx',
    "    vans: demoVans,\n    workOrders,",
    "    vans,\n    dailyVanAssignments,\n    staffAbsences,\n    vanMaintenanceLogs,\n    workOrders,",
)
replace_once(
    'src/state/AppState.tsx',
    "    removeCatalogItem,\n    addWorkOrder,",
    "    removeCatalogItem,\n    saveStaffProfile,\n    saveVanProfile,\n    saveDailyVanAssignment,\n    saveStaffAbsence,\n    removeStaffAbsence,\n    saveVanMaintenanceLog,\n    addWorkOrder,",
)
replace_once(
    'src/state/AppState.tsx',
    "    currentUser,\n    clients,",
    "    currentUser,\n    staffProfiles,\n    vans,\n    dailyVanAssignments,\n    staffAbsences,\n    vanMaintenanceLogs,\n    clients,",
)
replace_once(
    'src/state/AppState.tsx',
    "Firebase rechazó la operación. Las reglas de Firestore deben permitir clientes, propiedades, catálogo y órdenes para tu rol.",
    "Firebase rechazó la operación. Las reglas de Firestore deben permitir clientes, propiedades, catálogo, órdenes, personal y vans para tu rol.",
)

# ---------------- AgendaScreen.tsx ----------------
replace_once(
    'src/screens/AgendaScreen.tsx',
    "import { AppointmentStatus, Client, Property, PropertyType, ServiceType, Van, WorkOrder } from '../types';",
    "import { AppointmentStatus, Client, DailyVanAssignment, Property, PropertyType, ServiceType, StaffAbsence, StaffProfile, Van, WorkOrder } from '../types';",
)
replace_once(
    'src/screens/AgendaScreen.tsx',
    """function orderDescription(order: WorkOrder, service?: ServiceType) {
  const text = order.problem?.trim();
  if (text && text !== 'Cita programada desde agenda.') return text;
  return service?.name ?? 'Trabajo programado';
}
""",
    """function orderDescription(order: WorkOrder, service?: ServiceType) {
  const text = order.problem?.trim();
  if (text && text !== 'Cita programada desde agenda.') return text;
  return service?.name ?? 'Trabajo programado';
}

function staffUnavailableOnDate(staff: StaffProfile | undefined, date: string, absences: StaffAbsence[]) {
  if (!staff || !staff.active || staff.availability === 'Inactivo') return true;
  const fixed = staff.availability !== 'Disponible' && (!staff.unavailableFrom || date >= staff.unavailableFrom) && (!staff.unavailableUntil || date <= staff.unavailableUntil);
  if (fixed) return true;
  return absences.some((absence) => absence.active && absence.staffId === staff.id && date >= absence.fromDate && date <= absence.toDate);
}

function effectiveVanCrew(van: Van, date: string, staffProfiles: StaffProfile[], assignments: DailyVanAssignment[], absences: StaffAbsence[]) {
  const saved = assignments.find((item) => item.vanId === van.id && item.date === date);
  const responsible = staffProfiles.find((item) => item.id === van.responsibleStaffId);
  const regularHelper = staffProfiles.find((item) => item.id === van.regularHelperId);
  const driverId = saved ? saved.driverStaffId : (staffUnavailableOnDate(responsible, date, absences) ? undefined : responsible?.id);
  const helperId = saved ? saved.helperStaffId : (staffUnavailableOnDate(regularHelper, date, absences) ? undefined : regularHelper?.id);
  const status = saved?.status ?? (van.status === 'Mantenimiento' ? 'Mantenimiento' : van.status === 'Fuera de servicio' ? 'Fuera de servicio' : driverId ? (helperId ? 'Disponible' : 'Trabajo liviano') : 'Sin personal');
  const ids = [driverId, helperId].filter(Boolean) as string[];
  const names = ids.map((id) => staffProfiles.find((item) => item.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ');
  return { ids, names: names || 'Sin equipo', status, disabled: ['Sin personal', 'Mantenimiento', 'Fuera de servicio'].includes(status) || !driverId };
}
""",
)
replace_once(
    'src/screens/AgendaScreen.tsx',
    "    vans,\n    users,",
    "    vans,\n    users,\n    staffProfiles,\n    dailyVanAssignments,\n    staffAbsences,",
)
replace_once(
    'src/screens/AgendaScreen.tsx',
    "  const isAvailable = (candidateVan: Van, candidateTime: string, date = selectedDate) => {\n    if (candidateVan.status === 'Mantenimiento') return false;",
    "  const isAvailable = (candidateVan: Van, candidateTime: string, date = selectedDate) => {\n    const crew = effectiveVanCrew(candidateVan, date, staffProfiles, dailyVanAssignments, staffAbsences);\n    if (crew.disabled) return false;",
)
replace_once(
    'src/screens/AgendaScreen.tsx',
    "  }, [workHours, vanId, selectedDate, workOrders]);",
    "  }, [workHours, vanId, selectedDate, workOrders, staffProfiles, dailyVanAssignments, staffAbsences]);",
)
replace_once(
    'src/screens/AgendaScreen.tsx',
    "    const zone = selectedProperty?.zone ?? client.zone;\n    const order: WorkOrder = {",
    "    const zone = selectedProperty?.zone ?? client.zone;\n    const crew = effectiveVanCrew(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences);\n    const order: WorkOrder = {",
)
replace_once('src/screens/AgendaScreen.tsx', "      status: van.technicianIds.length ? 'Asignada' : 'Confirmada',\n      technicianIds: van.technicianIds,", "      status: crew.ids.length ? 'Asignada' : 'Confirmada',\n      technicianIds: crew.ids,")
replace_once(
    'src/screens/AgendaScreen.tsx',
    "<Card><Text style={styles.sideTitle}>Técnicos</Text>{vans.slice(0, 4).map((van) => <TechnicianFilter key={van.id} van={van} users={users} />)}</Card>",
    "<Card><Text style={styles.sideTitle}>Técnicos</Text>{vans.slice(0, 4).map((van) => <TechnicianFilter key={van.id} van={van} date={selectedDate} staffProfiles={staffProfiles} assignments={dailyVanAssignments} absences={staffAbsences} />)}</Card>",
)
replace_once(
    'src/screens/AgendaScreen.tsx',
    "<View style={styles.boardGrid}>{vans.slice(0, 4).map((van) => <VanColumn key={van.id} van={van} users={users} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} />)}</View>",
    "<View style={styles.boardGrid}>{vans.slice(0, 4).map((van) => <VanColumn key={van.id} van={van} date={selectedDate} staffProfiles={staffProfiles} assignments={dailyVanAssignments} absences={staffAbsences} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} />)}</View>",
)
replace_once(
    'src/screens/AgendaScreen.tsx',
    "<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} clients={clients} properties={properties} services={services} vans={vans} users={users} onUpdate={updateWorkOrder} /></Card>",
    "<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} clients={clients} properties={properties} services={services} vans={vans} users={users} staffProfiles={staffProfiles} onUpdate={updateWorkOrder} /></Card>",
)
replace_once(
    'src/screens/AgendaScreen.tsx',
    "<View style={styles.optionWrap}>{vans.slice(0, 4).map((van) => { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + '); return <Option key={van.id} label={`${van.name} · ${names || 'Sin equipo'}`} active={vanId === van.id} onPress={() => setVanId(van.id)} />; })}</View>",
    "<View style={styles.optionWrap}>{vans.slice(0, 4).map((van) => { const crew = effectiveVanCrew(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences); return <Option key={van.id} label={`${van.name} · ${crew.names}${crew.status === 'Trabajo liviano' ? ' · solo' : ''}`} active={vanId === van.id} disabled={crew.disabled} onPress={() => setVanId(van.id)} />; })}</View>",
)

agenda = Path('src/screens/AgendaScreen.tsx')
text = agenda.read_text(encoding='utf-8')
old_signature = "function VanColumn({ van, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate }: { van: Van; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void }) {\n  const techNames = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo';"
new_signature = "function VanColumn({ van, date, staffProfiles, assignments, absences, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate }: { van: Van; date: string; staffProfiles: StaffProfile[]; assignments: DailyVanAssignment[]; absences: StaffAbsence[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void }) {\n  const crew = effectiveVanCrew(van, date, staffProfiles, assignments, absences);\n  const techNames = crew.names;"
if old_signature not in text:
    raise SystemExit('VanColumn signature not found')
text = text.replace(old_signature, new_signature, 1)
text = text.replace("          if (van.status === 'Mantenimiento') return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>No disponible</Text></View>;", "          if (crew.disabled) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>{crew.status}</Text></View>;", 1)
old_details = "function AppointmentDetails({ order, clients, properties, services, vans, users, onUpdate }: { order?: WorkOrder; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }> }) {"
new_details = "function AppointmentDetails({ order, clients, properties, services, vans, users, staffProfiles, onUpdate }: { order?: WorkOrder; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; staffProfiles: StaffProfile[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }> }) {"
if old_details not in text:
    raise SystemExit('AppointmentDetails signature not found')
text = text.replace(old_details, new_details, 1)
text = text.replace("  const techNames = order.technicianIds.map((id) => users.find((user) => user.id === id)?.name).filter(Boolean).join(' y ') || 'Sin técnico asignado';", "  const techNames = order.technicianIds.map((id) => staffProfiles.find((staff) => staff.id === id)?.name ?? users.find((user) => user.id === id)?.name).filter(Boolean).join(' y ') || 'Sin técnico asignado';", 1)
old_filter = "function TechnicianFilter({ van, users }: { van: Van; users: { id: string; name: string }[] }) { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo'; return <View style={styles.techFilter}><Text style={styles.checkBox}>✓</Text><View><Text style={styles.techFilterVan}>{van.name}</Text><Text style={styles.techFilterName}>{names}</Text></View></View>; }"
new_filter = "function TechnicianFilter({ van, date, staffProfiles, assignments, absences }: { van: Van; date: string; staffProfiles: StaffProfile[]; assignments: DailyVanAssignment[]; absences: StaffAbsence[] }) { const crew = effectiveVanCrew(van, date, staffProfiles, assignments, absences); return <View style={styles.techFilter}><Text style={[styles.checkBox, crew.disabled && { backgroundColor: colors.danger }]}>✓</Text><View><Text style={styles.techFilterVan}>{van.name}</Text><Text style={styles.techFilterName}>{crew.names}{crew.status === 'Trabajo liviano' ? ' · trabajando solo' : crew.disabled ? ` · ${crew.status}` : ''}</Text></View></View>; }"
if old_filter not in text:
    raise SystemExit('TechnicianFilter function not found')
text = text.replace(old_filter, new_filter, 1)
agenda.write_text(text, encoding='utf-8')

# ---------------- firestore.rules ----------------
replace_once(
    'firestore.rules',
    """    match /workOrders/{workOrderId} {
      allow read, create, update: if operationsRole();
      allow delete: if adminOrSupervisor();
    }
""",
    """    match /staffProfiles/{staffId} {
      allow read, create, update: if operationsRole();
      allow delete: if adminOrSupervisor();
    }

    match /vans/{vanId} {
      allow read, create, update: if operationsRole();
      allow delete: if adminOrSupervisor();
    }

    match /dailyVanAssignments/{assignmentId} {
      allow read, create, update, delete: if operationsRole();
    }

    match /staffAbsences/{absenceId} {
      allow read, create, update, delete: if operationsRole();
    }

    match /vanMaintenanceLogs/{logId} {
      allow read, create, update: if operationsRole();
      allow delete: if adminOrSupervisor();
    }

    match /workOrders/{workOrderId} {
      allow read, create, update: if operationsRole();
      allow delete: if adminOrSupervisor();
    }
""",
)

print('Team and van management feature applied successfully.')
