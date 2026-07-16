from pathlib import Path

path = Path('src/screens/AgendaScreen.tsx')
source = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    source = source.replace(old, new, 1)


replace_once(
    "  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);\n  const [reschedulingOrderId, setReschedulingOrderId] = useState<string | null>(null);\n  const [sendWhatsApp, setSendWhatsApp] = useState(true);",
    "  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);\n  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);\n  const [reschedulingOrderId, setReschedulingOrderId] = useState<string | null>(null);\n  const [sendWhatsApp, setSendWhatsApp] = useState(true);",
    'editing state',
)

replace_once(
    "  const reschedulingOrder = workOrders.find((order) => order.id === reschedulingOrderId);\n  const monthTitle =",
    "  const editingOrder = workOrders.find((order) => order.id === editingOrderId);\n  const reschedulingOrder = workOrders.find((order) => order.id === reschedulingOrderId);\n  const monthTitle =",
    'editing order selector',
)

replace_once(
    "  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) =>\n    isAvailableFor(candidateVan, candidateTime, date, workHours, reschedulingOrderId ?? undefined);",
    "  const isAvailable = (candidateVan: AgendaVan, candidateTime: string, date = selectedDate) =>\n    isAvailableFor(candidateVan, candidateTime, date, workHours, editingOrderId ?? reschedulingOrderId ?? undefined);",
    'availability ignored order',
)

replace_once(
    "  }, [workHours, vanId, selectedDate, workOrders, agendaVans, vanHalfDaySchedules, reschedulingOrderId]);",
    "  }, [workHours, vanId, selectedDate, workOrders, agendaVans, vanHalfDaySchedules, editingOrderId, reschedulingOrderId]);",
    'availability dependencies',
)

replace_once(
    "    if (reschedulingOrder) {\n      setClientId(reschedulingOrder.clientId);\n      setPropertyId(reschedulingOrder.propertyId ?? '');\n      setWorkDescriptionText(reschedulingOrder.problem);\n      setWorkHours(orderSlotCount(reschedulingOrder, services));\n      setSendWhatsApp(reschedulingOrder.whatsappNotificationsEnabled !== false);\n    } else if (cancelled) {",
    "    const sourceOrder = editingOrder ?? reschedulingOrder;\n    if (sourceOrder) {\n      setClientId(sourceOrder.clientId);\n      setPropertyId(sourceOrder.propertyId ?? '');\n      setWorkDescriptionText(sourceOrder.problem);\n      setWorkHours(orderSlotCount(sourceOrder, services));\n      setSendWhatsApp(sourceOrder.whatsappNotificationsEnabled !== false);\n    } else if (cancelled) {",
    'form prefill source',
)

replace_once(
    "    if (!isAvailableFor(van, time, selectedDate, workHours, reschedulingOrderId ?? undefined)) return setFormMessage('Ese horario no tiene suficientes horas consecutivas para este trabajo.');",
    "    if (!isAvailableFor(van, time, selectedDate, workHours, editingOrderId ?? reschedulingOrderId ?? undefined)) return setFormMessage('Ese horario no tiene suficientes horas consecutivas para este trabajo.');",
    'save availability ignored order',
)

replace_once(
    "    if (reschedulingOrder) {\n      const history = scheduleHistoryEntry(reschedulingOrder, services);",
    "    if (editingOrder) {\n      const scheduleChanged = editingOrder.date !== selectedDate\n        || normalizeTime(editingOrder.time) !== time\n        || resolveStoredVanId(editingOrder.vanId, agendaVans, legacyVans) !== vanId\n        || orderSlotCount(editingOrder, services) !== workHours;\n      const result = await updateWorkOrder(editingOrder.id, {\n        clientId,\n        propertyId: selectedProperty?.id,\n        date: selectedDate,\n        time,\n        status: editingOrder.status,\n        technicianIds: van.technicianIds,\n        vanId,\n        address: selectedProperty?.address ?? client.address,\n        zone,\n        problem: description,\n        scheduledSlots: workHours,\n        whatsappNotificationsEnabled: editingOrder.status === 'Reserva temporal' ? false : sendWhatsApp,\n        scheduleHistory: scheduleChanged\n          ? [...(editingOrder.scheduleHistory ?? []), scheduleHistoryEntry(editingOrder, services)]\n          : editingOrder.scheduleHistory,\n        updatedAt: now,\n      });\n      setSaving(false);\n      if (!result.ok) return setFormMessage(result.message ?? 'No se pudieron guardar los cambios de la cita.');\n      setSelectedOrderId(editingOrder.id);\n      setEditingOrderId(null);\n    } else if (reschedulingOrder) {\n      const history = scheduleHistoryEntry(reschedulingOrder, services);",
    'editing save branch',
)

replace_once(
    "  const startReschedule = (order: WorkOrder) => {\n    setReschedulingOrderId(order.id);",
    "  const startEdit = (order: WorkOrder) => {\n    setEditingOrderId(order.id);\n    setReschedulingOrderId(null);\n    setSelectedDate(order.date);\n    setCalendarMonth(monthStart(order.date));\n    setClientId(order.clientId);\n    setPropertyId(order.propertyId ?? '');\n    setWorkDescriptionText(order.problem);\n    setWorkHours(orderSlotCount(order, services));\n    setVanId(resolveStoredVanId(order.vanId, agendaVans, legacyVans));\n    setTime(normalizeTime(order.time));\n    setSendWhatsApp(order.whatsappNotificationsEnabled !== false);\n    setFormMessage('');\n    setSuccessMessage('');\n    setShowQuickClient(false);\n    setShowCreate(true);\n  };\n\n  const startReschedule = (order: WorkOrder) => {\n    setEditingOrderId(null);\n    setReschedulingOrderId(order.id);",
    'edit and reschedule actions',
)

replace_once(
    "onUpdate={updateWorkOrder} onConfirm={confirmTemporaryAppointment} onCancel={cancelAppointment} onReschedule={startReschedule}",
    "onUpdate={updateWorkOrder} onConfirm={confirmTemporaryAppointment} onEdit={startEdit} onCancel={cancelAppointment} onReschedule={startReschedule}",
    'appointment details props',
)

replace_once(
    "title={showQuickClient ? 'Agregar cliente rápido' : reschedulingOrder ? 'Reprogramar cita' : 'Confirmar nueva cita'}",
    "title={showQuickClient ? 'Agregar cliente rápido' : editingOrder ? 'Editar cita' : reschedulingOrder ? 'Reprogramar cita' : 'Confirmar nueva cita'}",
    'modal title',
)

replace_once(
    "          if (!saving) setShowCreate(false);",
    "          if (!saving) {\n            setShowCreate(false);\n            setEditingOrderId(null);\n          }",
    'modal close action',
)

old_actions = "            <View style={styles.modalActions}><Button variant=\"secondary\" label=\"Cancelar\" disabled={saving} onPress={() => setShowCreate(false)} /><Button variant=\"secondary\" label={saving ? 'Guardando…' : 'Reservar temporalmente'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment('Reserva temporal')} /><Button label={saving ? 'Guardando…' : reschedulingOrder ? 'Guardar reprogramación' : 'Confirmar cita'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment('Confirmada')} /></View>"
new_actions = """            <View style={styles.modalActions}>
              <Button variant=\"secondary\" label=\"Cancelar\" disabled={saving} onPress={() => { setShowCreate(false); setEditingOrderId(null); }} />
              {editingOrder ? (
                <Button label={saving ? 'Guardando…' : 'Guardar cambios'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment(editingOrder.status === 'Reserva temporal' ? 'Reserva temporal' : 'Confirmada')} />
              ) : (
                <>
                  <Button variant=\"secondary\" label={saving ? 'Guardando…' : 'Reservar temporalmente'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment('Reserva temporal')} />
                  <Button label={saving ? 'Guardando…' : reschedulingOrder ? 'Guardar reprogramación' : 'Confirmar cita'} disabled={saving || !clientId || !workDescriptionText.trim()} onPress={() => void saveAppointment('Confirmada')} />
                </>
              )}
            </View>"""
replace_once(old_actions, new_actions, 'modal action buttons')

replace_once(
    "function AppointmentDetails({ order, halfDay, clients, properties, services, vans, users, onUpdate, onConfirm, onCancel, onReschedule }: { order?: WorkOrder; halfDay: boolean; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }>; onConfirm: (order: WorkOrder, enableWhatsApp: boolean) => Promise<void>; onCancel: (order: WorkOrder) => Promise<void>; onReschedule: (order: WorkOrder) => void }) {",
    "function AppointmentDetails({ order, halfDay, clients, properties, services, vans, users, onUpdate, onConfirm, onEdit, onCancel, onReschedule }: { order?: WorkOrder; halfDay: boolean; clients: Client[]; properties: Property[]; services: ServiceType[]; vans: Van[]; users: { id: string; name: string }[]; onUpdate: (id: string, changes: Partial<WorkOrder>) => Promise<{ ok: boolean; message?: string }>; onConfirm: (order: WorkOrder, enableWhatsApp: boolean) => Promise<void>; onEdit: (order: WorkOrder) => void; onCancel: (order: WorkOrder) => Promise<void>; onReschedule: (order: WorkOrder) => void }) {",
    'appointment details signature',
)

replace_once(
    "</> : null}<Button variant=\"secondary\" label=\"Reprogramar cita\" onPress={() => onReschedule(order)} />",
    "</> : null}<Button variant=\"secondary\" label=\"Editar cita\" onPress={() => onEdit(order)} /><Button variant=\"secondary\" label=\"Reprogramar cita\" onPress={() => onReschedule(order)} />",
    'edit detail button',
)

path.write_text(source, encoding='utf-8')
