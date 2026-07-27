const fs = require('fs');

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) {
    throw new Error(`Required technician equipment patch block not found in ${path}: ${marker}`);
  }
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) {
    throw new Error(`Required technician equipment patch anchor not found in ${path}: ${marker}`);
  }
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

const qrFile = 'src/features/technicianPortal/equipmentQr.ts';
insertAfter(
  qrFile,
  "export function equipmentDocumentIdFromQr(qrCode: string) {\n  const normalized = normalizeEquipmentQrCode(qrCode);\n  return `equipment-qr-${stableHash(normalized)}-${normalized.length}`;\n}",
  "\n\nexport function equipmentDocumentIdWithoutQr(seed: string) {\n  const normalized = seed.trim() || `${Date.now()}-${Math.random()}`;\n  return `equipment-manual-${stableHash(normalized)}-${Date.now().toString(36)}`;\n}",
  'export function equipmentDocumentIdWithoutQr',
);

const stateFile = 'src/state/TechnicianPortalState.tsx';
replaceOnce(
  stateFile,
  "import { equipmentDocumentIdFromQr, equipmentQrCodesMatch, isValidEquipmentQrCode, normalizeEquipmentQrCode } from '../features/technicianPortal/equipmentQr';",
  "import { equipmentDocumentIdFromQr, equipmentDocumentIdWithoutQr, equipmentQrCodesMatch, isValidEquipmentQrCode, normalizeEquipmentQrCode } from '../features/technicianPortal/equipmentQr';",
  'equipmentDocumentIdWithoutQr, equipmentQrCodesMatch',
);
replaceOnce(
  stateFile,
  "type RegisterEquipmentSystemInput = {\n  qrCode: string;",
  "type RegisterEquipmentSystemInput = {\n  equipmentId?: string;\n  qrCode: string;",
  'equipmentId?: string;',
);
replaceOnce(
  stateFile,
  "    if (!isValidEquipmentQrCode(qrCode)) {\n      return { result: { ok: false, message: 'Escanea o escribe el código completo del sticker QR preimpreso.' } };\n    }\n    const existing = equipmentSystems.find((equipment) => equipmentQrCodesMatch(equipment.qrCode, qrCode));\n    if (existing) {\n      return { result: { ok: false, message: `Este QR ya pertenece a ${existing.locationLabel}.` }, equipment: existing };\n    }",
  "    if (qrCode && !isValidEquipmentQrCode(qrCode)) {\n      return { result: { ok: false, message: 'El código del sticker QR no es válido.' } };\n    }\n    const existing = qrCode ? equipmentSystems.find((equipment) => equipmentQrCodesMatch(equipment.qrCode, qrCode)) : undefined;\n    if (existing) {\n      return { result: { ok: false, message: `Este QR ya pertenece a ${existing.locationLabel}.` }, equipment: existing };\n    }",
  "const existing = qrCode ? equipmentSystems.find",
);
replaceOnce(
  stateFile,
  "      id: equipmentDocumentIdFromQr(qrCode),\n      qrCode,",
  "      id: input.equipmentId ?? (qrCode ? equipmentDocumentIdFromQr(qrCode) : equipmentDocumentIdWithoutQr(`${input.clientId}-${input.locationLabel}-${now}`)),\n      qrCode,",
  'input.equipmentId ?? (qrCode ?',
);

const equipmentScreen = 'src/screens/TechnicianPortalEquipmentTestScreen.tsx';
replaceOnce(
  equipmentScreen,
  "  equipmentDocumentIdFromQr,\n  equipmentQrCodesMatch,",
  "  equipmentDocumentIdFromQr,\n  equipmentDocumentIdWithoutQr,\n  equipmentQrCodesMatch,",
  'equipmentDocumentIdWithoutQr,',
);
replaceOnce(
  equipmentScreen,
  "    workOrders,\n    currentUser,",
  "    workOrders,\n    services,\n    currentUser,",
  '    services,\n    currentUser,',
);
replaceOnce(
  equipmentScreen,
  "    registerEquipmentSystem,\n    attachEquipmentToVisitUnit,",
  "    registerEquipmentSystem,\n    prepareVisitFromWorkOrder,\n    attachEquipmentToVisitUnit,",
  '    prepareVisitFromWorkOrder,',
);
insertAfter(
  equipmentScreen,
  "  const [message, setMessage] = useState('Selecciona una visita preparada para registrar, buscar o escanear un aire acondicionado.');",
  "\n  const [preparingVisit, setPreparingVisit] = useState(false);\n  const requestedWorkOrderId = useMemo(() => {\n    if (typeof window === 'undefined') return '';\n    return new URLSearchParams(window.location.search).get('workOrderId') ?? '';\n  }, []);\n  const returnToTechnician = useMemo(() => {\n    if (typeof window === 'undefined') return false;\n    return new URLSearchParams(window.location.search).get('returnTo') === 'technician';\n  }, []);",
  'const [preparingVisit, setPreparingVisit]',
);
replaceOnce(
  equipmentScreen,
  "  const eligibleVisits = useMemo(() => workVisits\n    .filter((visit) => visit.status !== 'cancelled')",
  "  const eligibleVisits = useMemo(() => workVisits\n    .filter((visit) => visit.status !== 'cancelled')\n    .filter((visit) => !requestedWorkOrderId || visit.workOrderId === requestedWorkOrderId)",
  ".filter((visit) => !requestedWorkOrderId || visit.workOrderId === requestedWorkOrderId)",
);
replaceOnce(
  equipmentScreen,
  "    .slice(0, 12), [workVisits]);",
  "    .slice(0, 12), [workVisits, requestedWorkOrderId]);",
  "[workVisits, requestedWorkOrderId]",
);
insertAfter(
  equipmentScreen,
  "  useEffect(() => {\n    if (!selectedVisitId && eligibleVisits.length) setSelectedVisitId(eligibleVisits[0].id);\n  }, [eligibleVisits, selectedVisitId]);",
  "\n\n  useEffect(() => {\n    if (!requestedWorkOrderId || preparingVisit) return;\n    const existingVisit = workVisits.find((visit) => visit.workOrderId === requestedWorkOrderId);\n    if (existingVisit) {\n      if (selectedVisitId !== existingVisit.id) setSelectedVisitId(existingVisit.id);\n      return;\n    }\n    const requestedOrder = workOrders.find((order) => order.id === requestedWorkOrderId);\n    if (!requestedOrder) return;\n    setPreparingVisit(true);\n    const requestedService = services.find((service) => service.id === requestedOrder.serviceId);\n    void prepareVisitFromWorkOrder(requestedOrder, { serviceName: requestedService?.name })\n      .then(({ result, visit }) => {\n        if (result.ok && visit) {\n          setSelectedVisitId(visit.id);\n          setMessage('Visita preparada. Ya puedes añadir o buscar los aires acondicionados del cliente.');\n        } else {\n          setMessage(result.message ?? 'No se pudo preparar la visita para registrar equipos.');\n        }\n      })\n      .finally(() => setPreparingVisit(false));\n  }, [requestedWorkOrderId, workVisits.length, workOrders.length, services.length, preparingVisit]);",
  'Visita preparada. Ya puedes añadir',
);
replaceOnce(
  equipmentScreen,
  "  const targetPendingUnit = selectedUnit && !selectedUnit.equipmentSystemId\n    ? selectedUnit\n    : selectedUnits.find((unit) => !unit.equipmentSystemId);",
  "  const targetPendingUnit = selectedUnits.find((unit) => !unit.equipmentSystemId && unit.source !== 'scheduled');\n  const registeredVisitUnits = selectedUnits.filter((unit) => unit.equipmentSystemId && equipmentSystems.some((equipment) => equipment.id === unit.equipmentSystemId));",
  'const registeredVisitUnits = selectedUnits.filter',
);
replaceOnce(
  equipmentScreen,
  "    if (!qrCode.trim()) {\n      setMessage('Escanea el sticker QR preimpreso o escribe su código para vincularlo.');\n      return;\n    }\n    if (equipmentSystems.some((equipment) => equipmentQrCodesMatch(equipment.qrCode, qrCode))) {",
  "    if (qrCode.trim() && equipmentSystems.some((equipment) => equipmentQrCodesMatch(equipment.qrCode, qrCode))) {",
  'if (qrCode.trim() && equipmentSystems.some',
);
replaceOnce(
  equipmentScreen,
  "    const normalizedQr = normalizeEquipmentQrCode(qrCode);\n    const equipmentId = equipmentDocumentIdFromQr(normalizedQr);",
  "    const normalizedQr = normalizeEquipmentQrCode(qrCode);\n    const equipmentId = normalizedQr\n      ? equipmentDocumentIdFromQr(normalizedQr)\n      : equipmentDocumentIdWithoutQr(`${selectedVisit.clientId}-${locationLabel}-${Date.now()}-${Math.random()}`);",
  'equipmentDocumentIdWithoutQr(`${selectedVisit.clientId}',
);
replaceOnce(
  equipmentScreen,
  "      const { result, equipment } = await registerEquipmentSystem({\n        qrCode: normalizedQr,",
  "      const { result, equipment } = await registerEquipmentSystem({\n        equipmentId,\n        qrCode: normalizedQr,",
  '        equipmentId,\n        qrCode: normalizedQr,',
);
replaceOnce(
  equipmentScreen,
  "      setMessage(`${equipment.locationLabel} registrado y vinculado con el sticker QR ${shortEquipmentQrCode(equipment.qrCode)}.`);",
  "      setMessage(equipment.qrCode\n        ? `${equipment.locationLabel} registrado y vinculado con el sticker QR ${shortEquipmentQrCode(equipment.qrCode)}.`\n        : `${equipment.locationLabel} registrado correctamente. El QR queda pendiente para vincularlo cuando estén disponibles los stickers.`);",
  'El QR queda pendiente para vincularlo',
);
replaceOnce(
  equipmentScreen,
  "  async function findAndUseQr(value = lookupQr, autoAttach = false) {\n    const normalized = normalizeEquipmentQrCode(value);",
  "  async function findAndUseQr(value = lookupQr, autoAttach = false) {\n    const normalized = normalizeEquipmentQrCode(value);\n    if (!normalized) {\n      setMessage('Escanea o escribe un código QR para buscarlo.');\n      return;\n    }",
  "setMessage('Escanea o escribe un código QR para buscarlo.')",
);
replaceOnce(
  equipmentScreen,
  "  function returnToPersistence() {\n    if (typeof window === 'undefined') return;\n    window.location.assign(`${window.location.pathname}?technicianPortalPersistence=1`);\n  }",
  "  function returnToPersistence() {\n    if (typeof window === 'undefined') return;\n    if (returnToTechnician) {\n      window.location.assign(window.location.pathname);\n      return;\n    }\n    window.location.assign(`${window.location.pathname}?technicianPortalPersistence=1`);\n  }",
  'if (returnToTechnician)',
);
replaceOnce(
  equipmentScreen,
  "          {selectedUnits.length ? selectedUnits.map((unit) => {",
  "          {registeredVisitUnits.length ? registeredVisitUnits.map((unit) => {",
  'registeredVisitUnits.length ? registeredVisitUnits.map',
);
replaceOnce(
  equipmentScreen,
  "                  <Text style={styles.rowMeta}>{linkedEquipment ? `${linkedEquipment.systemType} · QR ${shortEquipmentQrCode(linkedEquipment.qrCode, 24)}` : 'Aire programado pendiente de identificar'}</Text>",
  "                  <Text style={styles.rowMeta}>{linkedEquipment ? `${linkedEquipment.systemType} · ${linkedEquipment.qrCode ? `QR ${shortEquipmentQrCode(linkedEquipment.qrCode, 24)}` : 'Sin QR vinculado'}` : ''}</Text>",
  "'Sin QR vinculado'",
);
replaceOnce(
  equipmentScreen,
  "                {linkedEquipment\n                  ? <Pill label=\"Registrado\" tone=\"success\" />\n                  : <Button compact label=\"Registrar\" variant=\"secondary\" onPress={() => openAdd(unit.id)} />}",
  "                <Pill label=\"Registrado\" tone=\"success\" />",
  '<Pill label="Registrado" tone="success" />',
);
replaceOnce(
  equipmentScreen,
  "          }) : <EmptyState icon=\"❄\" title=\"Sin aires en esta visita\" message=\"Presiona Añadir, escanea un QR o busca un aire registrado.\" />}",
  "          }) : null}",
  '}) : null}',
);
replaceOnce(
  equipmentScreen,
  "              <Text style={styles.qrLabel}>STICKER QR PREIMPRESO</Text>\n              <Text style={styles.qrValue}>{qrCode ? shortEquipmentQrCode(qrCode) : 'Aún no vinculado'}</Text>\n              <Text style={styles.qrHelp}>Pega el sticker al equipo y escanéalo. DEMAC no genera el código.</Text>",
  "              <Text style={styles.qrLabel}>STICKER QR PREIMPRESO · OPCIONAL POR AHORA</Text>\n              <Text style={styles.qrValue}>{qrCode ? shortEquipmentQrCode(qrCode) : 'Pendiente de vincular'}</Text>\n              <Text style={styles.qrHelp}>Puedes registrar el aire sin QR. Cuando lleguen los stickers, esta misma función permitirá vincular el código.</Text>",
  'OPCIONAL POR AHORA',
);
replaceOnce(
  equipmentScreen,
  '<Input label="Código del QR" value={qrCode} onChangeText={setQrCode} placeholder="Escanea el sticker o escribe su código" autoCapitalize="none" />',
  '<Input label="Código del QR (opcional)" value={qrCode} onChangeText={setQrCode} placeholder="Déjalo vacío hasta recibir los stickers" autoCapitalize="none" />',
  'label="Código del QR (opcional)"',
);
replaceOnce(
  equipmentScreen,
  "              <Text style={styles.selectedEquipmentMeta}>{selectedEquipment.systemType} · QR {shortEquipmentQrCode(selectedEquipment.qrCode)}</Text>",
  "              <Text style={styles.selectedEquipmentMeta}>{selectedEquipment.systemType} · {selectedEquipment.qrCode ? `QR ${shortEquipmentQrCode(selectedEquipment.qrCode)}` : 'Sin QR vinculado'}</Text>",
  "selectedEquipment.qrCode ? `QR",
);
replaceOnce(
  equipmentScreen,
  "                <Text style={styles.rowMeta}>{equipment.systemType} · QR {shortEquipmentQrCode(equipment.qrCode, 24)}</Text>",
  "                <Text style={styles.rowMeta}>{equipment.systemType} · {equipment.qrCode ? `QR ${shortEquipmentQrCode(equipment.qrCode, 24)}` : 'Sin QR vinculado'}</Text>",
  "equipment.qrCode ? `QR ${shortEquipmentQrCode(equipment.qrCode, 24)}`",
);
replaceOnce(
  equipmentScreen,
  '<Text style={styles.messageTitle}>Resultado de la prueba</Text>',
  '<Text style={styles.messageTitle}>{returnToTechnician ? \'Estado del registro\' : \'Resultado de la prueba\'}</Text>',
  "returnToTechnician ? 'Estado del registro'",
);
replaceOnce(
  equipmentScreen,
  '<Button variant="secondary" label="Volver a persistencia" onPress={returnToPersistence} />',
  '<Button variant="secondary" label={returnToTechnician ? \'Volver a Mi trabajo\' : \'Volver a persistencia\'} onPress={returnToPersistence} />',
  "returnToTechnician ? 'Volver a Mi trabajo'",
);

const technicianScreen = 'src/screens/TechnicianScreen.tsx';
replaceOnce(
  technicianScreen,
  "              {unit ? <View style={styles.unitBox}><Text style={styles.unitTitle}>Equipo: {unit.brand} {unit.model}</Text><Text style={styles.unitMeta}>{unit.location} · {unit.btu.toLocaleString()} BTU · {unit.refrigerant} · S/N {unit.serial}</Text></View> : null}\n\n              <View style={styles.progressRow}>",
  "              {unit ? <View style={styles.unitBox}><Text style={styles.unitTitle}>Equipo: {unit.brand} {unit.model}</Text><Text style={styles.unitMeta}>{unit.location} · {unit.btu.toLocaleString()} BTU · {unit.refrigerant} · S/N {unit.serial}</Text></View> : null}\n\n              <View style={styles.equipmentPortalBox}>\n                <View style={{ flex: 1 }}>\n                  <Text style={styles.equipmentPortalTitle}>AIRES ACONDICIONADOS DEL CLIENTE</Text>\n                  <Text style={styles.equipmentPortalText}>Escanea, busca o registra los equipos reales que serán atendidos en esta visita.</Text>\n                </View>\n                <Button compact icon=\"❄\" label=\"Gestionar aires\" onPress={() => {\n                  const locationApi = (globalThis as any).location;\n                  if (!locationApi) return;\n                  locationApi.assign(`${locationApi.pathname}?technicianPortalEquipment=1&workOrderId=${encodeURIComponent(selected.id)}&returnTo=technician`);\n                }} />\n              </View>\n\n              <View style={styles.progressRow}>",
  'AIRES ACONDICIONADOS DEL CLIENTE',
);
replaceOnce(
  technicianScreen,
  "  unitMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },\n  progressRow:",
  "  unitMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },\n  equipmentPortalBox: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 13, marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },\n  equipmentPortalTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 9, letterSpacing: 1 },\n  equipmentPortalText: { color: colors.text, marginTop: 5, fontSize: 10, lineHeight: 15 },\n  progressRow:",
  'equipmentPortalBox:',
);

console.log('Technician equipment real-testing patch applied.');
