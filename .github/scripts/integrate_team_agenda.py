from pathlib import Path

path = Path('src/screens/AgendaScreen.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'Missing source fragment: {old[:140]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "import { useAppState } from '../state/AppState';\n",
    "import { useAppState } from '../state/AppState';\nimport { useTeamState } from '../state/TeamState';\n",
)
replace_once(
    "import { AppointmentStatus, Client, Property, PropertyType, ServiceType, Van, WorkOrder } from '../types';",
    "import { AppointmentStatus, Client, DailyVanAssignment, Property, PropertyType, ServiceType, StaffAbsence, StaffProfile, Van, WorkOrder } from '../types';",
)

replace_once(
    "function orderDescription(order: WorkOrder, service?: ServiceType) {\n  const text = order.problem?.trim();\n  if (text && text !== 'Cita programada desde agenda.') return text;\n  return service?.name ?? 'Trabajo programado';\n}\n",
    "function orderDescription(order: WorkOrder, service?: ServiceType) {\n  const text = order.problem?.trim();\n  if (text && text !== 'Cita programada desde agenda.') return text;\n  return service?.name ?? 'Trabajo programado';\n}\n\ntype AgendaVan = Van & {\n  dispatchStatus: DailyVanAssignment['status'];\n  driverStaffId?: string;\n  helperStaffId?: string;\n};\n\nfunction staffUnavailable(profile: StaffProfile | undefined, date: string, absences: StaffAbsence[]) {\n  if (!profile || !profile.active || profile.availability === 'Inactivo') return true;\n  const generallyUnavailable = profile.availability !== 'Disponible'\n    && (!profile.unavailableFrom || date >= profile.unavailableFrom)\n    && (!profile.unavailableUntil || date <= profile.unavailableUntil);\n  return generallyUnavailable || absences.some((absence) =>\n    absence.active\n    && absence.staffId === profile.id\n    && date >= absence.fromDate\n    && date <= absence.toDate,\n  );\n}\n\nfunction resolveAgendaAssignment(van: Van, date: string, profiles: StaffProfile[], assignments: DailyVanAssignment[], absences: StaffAbsence[]): DailyVanAssignment {\n  const saved = assignments.find((item) => item.vanId === van.id && item.date === date);\n  const driver = profiles.find((item) => item.id === (saved?.driverStaffId ?? van.responsibleStaffId));\n  const helper = profiles.find((item) => item.id === (saved?.helperStaffId ?? van.regularHelperId));\n  const driverStaffId = driver?.canDriveVan && !staffUnavailable(driver, date, absences) ? driver.id : undefined;\n  const helperStaffId = !staffUnavailable(helper, date, absences) ? helper?.id : undefined;\n\n  let status: DailyVanAssignment['status'];\n  if (van.active === false || van.status === 'Fuera de servicio' || saved?.status === 'Fuera de servicio') status = 'Fuera de servicio';\n  else if (van.status === 'Mantenimiento' || saved?.status === 'Mantenimiento') status = 'Mantenimiento';\n  else if (!driverStaffId || saved?.status === 'Sin personal') status = 'Sin personal';\n  else if (!helperStaffId || saved?.status === 'Trabajo liviano') status = 'Trabajo liviano';\n  else status = 'Disponible';\n\n  return {\n    id: saved?.id ?? `${date}-${van.id}`,\n    date,\n    vanId: van.id,\n    driverStaffId,\n    helperStaffId,\n    status,\n    notes: saved?.notes,\n    updatedAt: saved?.updatedAt,\n  };\n}\n\nfunction vanCanReceiveAppointments(van: AgendaVan) {\n  return van.active !== false\n    && !!van.driverStaffId\n    && !['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(van.status);\n}\n",
)

replace_once(
    "    services,\n    vans,\n    users,\n    addClient,",
    "    services,\n    vans: legacyVans,\n    users: legacyUsers,\n    addClient,",
)
replace_once(
    "  } = useAppState();\n\n  const [selectedDate, setSelectedDate] = useState(localDateKey());",
    "  } = useAppState();\n  const { vans: teamVans, staffProfiles, dailyVanAssignments, staffAbsences, teamLoading, teamDataError, refreshTeamData } = useTeamState();\n\n  const [selectedDate, setSelectedDate] = useState(localDateKey());",
)
replace_once(
    "  const [saving, setSaving] = useState(false);\n  const [formMessage, setFormMessage] = useState('');\n\n  useEffect(() => {",
    "  const [saving, setSaving] = useState(false);\n  const [formMessage, setFormMessage] = useState('');\n\n  const staffDirectory = useMemo(\n    () => staffProfiles.length\n      ? staffProfiles.map((profile) => ({ id: profile.id, name: profile.name }))\n      : legacyUsers.map((user) => ({ id: user.id, name: user.name })),\n    [staffProfiles, legacyUsers],\n  );\n\n  const agendaVans = useMemo<AgendaVan[]>(() => {\n    const sourceVans = teamVans.length ? teamVans : legacyVans;\n    return sourceVans\n      .filter((van) => van.active !== false)\n      .slice(0, 4)\n      .map((van) => {\n        const assignment = resolveAgendaAssignment(van, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences);\n        const technicianIds = [assignment.driverStaffId, assignment.helperStaffId].filter(Boolean) as string[];\n        const status: Van['status'] = assignment.status === 'Mantenimiento'\n          ? 'Mantenimiento'\n          : assignment.status === 'Fuera de servicio'\n            ? 'Fuera de servicio'\n            : assignment.status === 'Sin personal' || !assignment.driverStaffId\n              ? 'Sin personal'\n              : van.status === 'En ruta' ? 'En ruta' : 'Disponible';\n        return { ...van, technicianIds, status, dispatchStatus: assignment.status, driverStaffId: assignment.driverStaffId, helperStaffId: assignment.helperStaffId };\n      });\n  }, [teamVans, legacyVans, selectedDate, staffProfiles, dailyVanAssignments, staffAbsences]);\n\n  useEffect(() => {\n    if (!agendaVans.length) {\n      if (vanId) setVanId('');\n      return;\n    }\n    if (!agendaVans.some((van) => van.id === vanId)) {\n      setVanId(agendaVans.find(vanCanReceiveAppointments)?.id ?? agendaVans[0].id);\n    }\n  }, [agendaVans, vanId]);\n\n  useEffect(() => {",
)

replace_once(
    "  const selectedVan = vans.find((item) => item.id === vanId);",
    "  const selectedVan = agendaVans.find((item) => item.id === vanId);",
)
replace_once(
    "  const monthTitle = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });",
    "  const monthTitle = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });\n  const combinedDataError = teamDataError ?? dataError;",
)
replace_once(
    "  const isAvailable = (candidateVan: Van, candidateTime: string, date = selectedDate) => {\n    if (candidateVan.status === 'Mantenimiento') return false;",
    "  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) => {\n    if (!vanCanReceiveAppointments(candidateVan)) return false;",
)
replace_once(
    "  }, [workHours, vanId, selectedDate, workOrders]);",
    "  }, [workHours, vanId, selectedDate, workOrders, agendaVans]);",
)
replace_once(
    "    const van = vans.find((item) => item.id === vanId);",
    "    const van = agendaVans.find((item) => item.id === vanId);",
)

replace_once("      {dataError ? (", "      {combinedDataError ? (")
replace_once("<Text style={styles.errorText}>{dataError}</Text>", "<Text style={styles.errorText}>{combinedDataError}</Text>")
replace_once(
    "onPress={() => void refreshOperationalData()}",
    "onPress={() => void Promise.all([refreshOperationalData(), refreshTeamData()])}",
)
replace_once(
    "<Card><Text style={styles.sideTitle}>Técnicos</Text>{vans.slice(0, 4).map((van) => <TechnicianFilter key={van.id} van={van} users={users} />)}</Card>",
    "<Card><Text style={styles.sideTitle}>Equipo del día</Text>{agendaVans.map((van) => <TechnicianFilter key={van.id} van={van} users={staffDirectory} />)}</Card>",
)
replace_once("{dataLoading ? <Text style={styles.syncText}>Sincronizando agenda…</Text> : null}", "{dataLoading || teamLoading ? <Text style={styles.syncText}>Sincronizando agenda y equipo…</Text> : null}")
replace_once(
    "<View style={styles.boardGrid}>{vans.slice(0, 4).map((van) => <VanColumn key={van.id} van={van} users={users} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} />)}</View>",
    "<View style={styles.boardGrid}>{agendaVans.map((van) => <VanColumn key={van.id} van={van} users={staffDirectory} orders={orders} services={services} clients={clients} properties={properties} selectedOrderId={selectedOrder?.id} onSelectOrder={setSelectedOrderId} onCreate={(slot) => openCreate(van.id, slot)} />)}</View>",
)
replace_once(
    "<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} clients={clients} properties={properties} services={services} vans={vans} users={users} onUpdate={updateWorkOrder} /></Card>",
    "<Card style={styles.detailPanel}><AppointmentDetails order={selectedOrder} clients={clients} properties={properties} services={services} vans={agendaVans} users={staffDirectory} onUpdate={updateWorkOrder} /></Card>",
)
replace_once(
    "<View style={styles.optionWrap}>{vans.slice(0, 4).map((van) => { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + '); return <Option key={van.id} label={`${van.name} · ${names || 'Sin equipo'}`} active={vanId === van.id} onPress={() => setVanId(van.id)} />; })}</View>",
    "<View style={styles.optionWrap}>{agendaVans.map((van) => { const names = van.technicianIds.map((id) => staffDirectory.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + '); const disabled = !vanCanReceiveAppointments(van); return <Option key={van.id} label={`${van.name} · ${names || 'Sin equipo'} · ${van.dispatchStatus}`} active={vanId === van.id} disabled={disabled} onPress={() => setVanId(van.id)} />; })}</View>",
)

replace_once(
    "function VanColumn({ van, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate }: { van: Van; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void }) {\n  const techNames = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo';",
    "function VanColumn({ van, users, orders, services, clients, properties, selectedOrderId, onSelectOrder, onCreate }: { van: AgendaVan; users: { id: string; name: string }[]; orders: WorkOrder[]; services: ServiceType[]; clients: Client[]; properties: Property[]; selectedOrderId?: string; onSelectOrder: (id: string) => void; onCreate: (slot: string) => void }) {\n  const techNames = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo';\n  const unavailableReason = van.status === 'Mantenimiento' ? 'Mantenimiento' : van.status === 'Fuera de servicio' ? 'Fuera de servicio' : 'Sin personal';",
)
replace_once(
    "<View style={styles.vanColumnHeader}><Text style={styles.vanIcon}>🚐</Text><Text style={styles.vanTitle}>{van.name}</Text><Text style={styles.vanTechs}>{techNames}</Text></View>",
    "<View style={styles.vanColumnHeader}><Text style={styles.vanIcon}>🚐</Text><Text style={styles.vanTitle}>{van.name}</Text><Text style={styles.vanTechs}>{techNames} · {van.dispatchStatus}</Text></View>",
)
replace_once(
    "          if (van.status === 'Mantenimiento') return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>No disponible</Text></View>;",
    "          if (!vanCanReceiveAppointments(van)) return <View key={`${van.id}-${slot}`} style={[styles.absoluteSlot, styles.slotUnavailable, { top }]}><Text style={styles.slotTime}>{slotLabel(slot)}</Text><Text style={styles.unavailableText}>{unavailableReason}</Text></View>;",
)
replace_once(
    "function TechnicianFilter({ van, users }: { van: Van; users: { id: string; name: string }[] }) { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo'; return <View style={styles.techFilter}><Text style={styles.checkBox}>✓</Text><View><Text style={styles.techFilterVan}>{van.name}</Text><Text style={styles.techFilterName}>{names}</Text></View></View>; }",
    "function TechnicianFilter({ van, users }: { van: AgendaVan; users: { id: string; name: string }[] }) { const names = van.technicianIds.map((id) => users.find((user) => user.id === id)?.name.split(' ')[0]).filter(Boolean).join(' + ') || 'Sin equipo'; return <View style={styles.techFilter}><Text style={styles.checkBox}>{vanCanReceiveAppointments(van) ? '✓' : '!'}</Text><View><Text style={styles.techFilterVan}>{van.name}</Text><Text style={styles.techFilterName}>{names} · {van.dispatchStatus}</Text></View></View>; }",
)

path.write_text(text, encoding='utf-8')
