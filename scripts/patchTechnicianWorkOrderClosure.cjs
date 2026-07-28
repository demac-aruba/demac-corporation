const fs = require('fs');

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Required closure patch block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required closure patch anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

function replaceRange(path, startMarker, endMarker, replacement, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Required closure patch range not found in ${path}: ${marker}`);
  text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  fs.writeFileSync(path, text);
}

// ---------------------------------------------------------------------------
// Technician report submission: close the unit/visit/order after all reports
// for the registered equipment have been submitted.
// ---------------------------------------------------------------------------
const reportFile = 'src/screens/TechnicianInterventionReportScreen.tsx';
insertAfter(
  reportFile,
  "import { getTechnicianReportTemplate, TemplateFieldDefinition, TemplateSectionDefinition } from '../features/technicianPortal/templates';",
  "\nimport { unitHasSubmittedFieldWork, visitHasSubmittedFieldWork } from '../features/technicianPortal/closure';",
  "visitHasSubmittedFieldWork } from '../features/technicianPortal/closure'",
);
replaceOnce(
  reportFile,
  "    addWorkOrderEvidence,\n  } = useAppState();",
  "    addWorkOrderEvidence,\n    updateWorkOrder,\n  } = useAppState();",
  "    updateWorkOrder,\n  } = useAppState();",
);
replaceOnce(
  reportFile,
  "    updateReportSection,\n    saveWorkIntervention,\n  } = useTechnicianPortalState();",
  "    updateReportSection,\n    saveWorkIntervention,\n    saveVisitUnit,\n    saveWorkVisit,\n  } = useTechnicianPortalState();",
  "    saveWorkVisit,\n  } = useTechnicianPortalState();",
);
insertAfter(
  reportFile,
  "  const reportReady = requiredSections.length > 0 && completedRequiredSections.length === requiredSections.length;",
  "\n  const reportLocked = intervention?.status === 'ready_for_review' || intervention?.status === 'completed';",
  "const reportLocked = intervention?.status",
);
replaceOnce(
  reportFile,
  "  function selectSection(section: ReportSection) {\n    setActiveSectionId(section.id);",
  "  function selectSection(section: ReportSection) {\n    if (reportLocked) {\n      setMessage(intervention?.status === 'completed'\n        ? 'Este reporte ya fue revisado y el trabajo está cerrado.'\n        : 'Este reporte ya fue enviado. Solo puede editarse nuevamente si la oficina solicita una corrección.');\n      return;\n    }\n    setActiveSectionId(section.id);",
  "Este reporte ya fue revisado y el trabajo está cerrado.",
);
replaceRange(
  reportFile,
  '  async function submitForReview() {',
  '  if (!visit || !unit || !intervention',
  `  async function submitForReview() {
    if (!intervention || !visit || !unit || !reportReady || !currentUser) return;
    setWorking(true);
    const now = new Date().toISOString();
    const submittedIntervention = {
      ...intervention,
      status: 'ready_for_review' as const,
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? intervention.updatedByStaffId,
      updatedByName: currentUser.name,
      version: Math.max(1, Number(intervention.version ?? 1)) + 1,
    };
    const result = await saveWorkIntervention(submittedIntervention);
    if (!result.ok) {
      setWorking(false);
      setMessage(result.message ?? 'No se pudo enviar el reporte.');
      scrollToTop();
      return;
    }

    const nextInterventions = workInterventions.map((item) => item.id === intervention.id ? submittedIntervention : item);
    const closureErrors: string[] = [];

    if (unitHasSubmittedFieldWork(unit.id, nextInterventions)) {
      const unitResult = await saveVisitUnit({
        ...unit,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? unit.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(unit.version ?? 1)) + 1,
      });
      if (!unitResult.ok) closureErrors.push(unitResult.message ?? 'No se pudo cerrar el aire.');
    }

    const visitSubmitted = visitHasSubmittedFieldWork(visit.id, visitUnits, nextInterventions);
    if (visitSubmitted) {
      const visitResult = await saveWorkVisit({
        ...visit,
        status: 'ready_for_office_review',
        completedAt: now,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? visit.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(visit.version ?? 1)) + 1,
      });
      if (!visitResult.ok) closureErrors.push(visitResult.message ?? 'No se pudo cerrar la visita.');

      if (workOrder && workOrder.status !== 'Completada') {
        const orderResult = await updateWorkOrder(workOrder.id, {
          status: 'Completada',
          completedAt: now,
          statusHistory: [
            ...(workOrder.statusHistory ?? []),
            {
              status: 'Completada',
              changedAt: now,
              changedByUserId: currentUser.id,
              changedByName: currentUser.name,
              note: 'Todos los reportes técnicos de la visita fueron enviados a revisión.',
            },
          ],
        } as any);
        if (!orderResult.ok) closureErrors.push(orderResult.message ?? 'No se pudo marcar la orden como terminada.');
      }
    }

    setWorking(false);
    if (closureErrors.length) {
      setMessage(\`El reporte fue enviado, pero falta sincronizar el cierre: \${closureErrors.join(' ')}\`);
      scrollToTop();
      return;
    }

    setMessage(visitSubmitted
      ? 'Reporte enviado. Todos los aires de la visita están terminados y la orden quedó cerrada.'
      : 'Reporte enviado. Este aire quedó terminado; todavía faltan otros aires de la visita.');
    scrollToTop();
    setTimeout(goBack, 1300);
  }

`,
  'Todos los aires de la visita están terminados y la orden quedó cerrada.',
);
replaceOnce(
  reportFile,
  "                  <Pressable key={section.id} onPress={() => selectSection(section)} style={styles.sectionRow}>",
  "                  <Pressable key={section.id} disabled={reportLocked} onPress={() => selectSection(section)} style={[styles.sectionRow, reportLocked && styles.sectionRowLocked]}>",
  "reportLocked && styles.sectionRowLocked",
);
replaceOnce(
  reportFile,
  "              disabled={working || !reportReady || intervention.status === 'ready_for_review'}",
  "              disabled={working || !reportReady || intervention.status === 'ready_for_review' || intervention.status === 'completed'}",
  "intervention.status === 'ready_for_review' || intervention.status === 'completed'",
);
insertAfter(
  reportFile,
  "  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, backgroundColor: '#FFFFFF' },",
  "\n  sectionRowLocked: { opacity: 0.72, backgroundColor: '#F4F6F8' },",
  'sectionRowLocked:',
);

// ---------------------------------------------------------------------------
// Equipment profile: once submitted/reviewed, existing reports remain visible
// but no new work type can be added or removed.
// ---------------------------------------------------------------------------
const profileFile = 'src/screens/TechnicianEquipmentProfileScreen.tsx';
insertAfter(
  profileFile,
  "import { InterventionType, WorkIntervention } from '../features/technicianPortal/contracts';",
  "\nimport { isUnitLockedForNewWork } from '../features/technicianPortal/closure';",
  "isUnitLockedForNewWork } from '../features/technicianPortal/closure'",
);
replaceOnce(
  profileFile,
  "  const { clients, properties, currentUser } = useAppState();",
  "  const { clients, properties, workOrders, currentUser } = useAppState();",
  'clients, properties, workOrders, currentUser',
);
insertAfter(
  profileFile,
  "  const property = properties.find((item) => item.id === visit?.propertyId);",
  "\n  const workOrder = workOrders.find((item) => item.id === visit?.workOrderId);",
  'const workOrder = workOrders.find',
);
insertAfter(
  profileFile,
  "  const primaryIntervention = interventions.find((item) => item.isPrimary) ?? interventions[0];",
  "\n  const newWorkLocked = isUnitLockedForNewWork(unit, visit, workInterventions) || workOrder?.status === 'Completada';",
  'const newWorkLocked = isUnitLockedForNewWork',
);
replaceOnce(
  profileFile,
  "  async function createIntervention(definition: WorkTypeDefinition) {\n    if (!visit || !unit || !equipment) {",
  "  async function createIntervention(definition: WorkTypeDefinition) {\n    if (newWorkLocked) {\n      setMessage('Este aire ya fue terminado o enviado a revisión. No se pueden agregar trabajos nuevos a una orden cerrada.');\n      return;\n    }\n    if (!visit || !unit || !equipment) {",
  'No se pueden agregar trabajos nuevos a una orden cerrada.',
);
replaceOnce(
  profileFile,
  "  async function removeIntervention(intervention: WorkIntervention) {\n    if (!currentUser) {",
  "  async function removeIntervention(intervention: WorkIntervention) {\n    if (newWorkLocked) {\n      setPendingRemovalId('');\n      setMessage('Este aire ya fue terminado o enviado a revisión. El alcance quedó bloqueado.');\n      return;\n    }\n    if (!currentUser) {",
  'El alcance quedó bloqueado.',
);
replaceOnce(
  profileFile,
  "          subtitle={primaryIntervention ? 'Puedes abrir el reporte, añadir otro trabajo o quitar una selección incorrecta' : 'La primera selección será el trabajo principal'}",
  "          subtitle={newWorkLocked ? 'Orden cerrada: puedes consultar el reporte existente, pero no cambiar el alcance' : primaryIntervention ? 'Puedes abrir el reporte, añadir otro trabajo o quitar una selección incorrecta' : 'La primera selección será el trabajo principal'}",
  "Orden cerrada: puedes consultar el reporte existente",
);
replaceOnce(
  profileFile,
  "          const canRemove = intervention.status !== 'ready_for_review' && intervention.status !== 'completed';",
  "          const canRemove = !newWorkLocked && intervention.status !== 'ready_for_review' && intervention.status !== 'changes_requested' && intervention.status !== 'completed';",
  "const canRemove = !newWorkLocked",
);
replaceRange(
  profileFile,
  "        <Text style={styles.selectionTitle}>{primaryIntervention ? 'Agregar otro trabajo' : 'Seleccionar trabajo principal'}</Text>",
  '      </Card>\n\n      <View style={styles.messageBox}>',
  `        {newWorkLocked ? (
          <View style={styles.closedWorkBox}>
            <Text style={styles.closedWorkTitle}>TRABAJO CERRADO</Text>
            <Text style={styles.closedWorkText}>Este aire ya fue terminado o enviado a revisión. El técnico puede consultar o corregir el reporte existente cuando la oficina lo solicite, pero no puede agregar un servicio, reparación, instalación, diagnóstico o chequeo nuevo.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.selectionTitle}>{primaryIntervention ? 'Agregar otro trabajo' : 'Seleccionar trabajo principal'}</Text>
            <View style={styles.workTypeGrid}>
              {WORK_TYPES.map((definition) => {
                const alreadyAdded = interventions.some((item) => item.type === definition.type);
                return (
                  <View key={definition.type} style={[styles.workTypeCard, alreadyAdded && styles.workTypeDisabled]}>
                    <Text style={styles.workTypeName}>{alreadyAdded ? '✓ ' : ''}{definition.label}</Text>
                    <Text style={styles.workTypeDescription}>{alreadyAdded ? 'Ya agregado a este aire.' : definition.description}</Text>
                    <Button
                      compact
                      label={alreadyAdded ? 'Agregado' : primaryIntervention ? 'Agregar trabajo' : 'Seleccionar'}
                      variant={alreadyAdded ? 'secondary' : 'primary'}
                      disabled={working || alreadyAdded}
                      onPress={() => void createIntervention(definition)}
                    />
                  </View>
                );
              })}
            </View>
          </>
        )}
      </Card>

      <View style={styles.messageBox}>`,
  'TRABAJO CERRADO',
);
insertAfter(
  profileFile,
  "  workTypeDescription: { color: colors.muted, fontSize: 9, lineHeight: 14, minHeight: 28 },",
  "\n  closedWorkBox: { backgroundColor: '#F0F8F1', borderWidth: 1, borderColor: '#B8D8BD', borderRadius: 12, padding: 13, marginTop: 10 },\n  closedWorkTitle: { color: '#2F6A3B', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },\n  closedWorkText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },",
  'closedWorkBox:',
);

// ---------------------------------------------------------------------------
// Equipment management: completed visits remain viewable but all mutation
// actions are disabled.
// ---------------------------------------------------------------------------
const equipmentFile = 'src/screens/TechnicianPortalEquipmentTestScreen.tsx';
insertAfter(
  equipmentFile,
  "  const selectedOrder = workOrders.find((order) => order.id === selectedVisit?.workOrderId);",
  "\n  const selectedVisitLocked = selectedVisit?.status === 'ready_for_office_review' || selectedVisit?.status === 'completed' || selectedOrder?.status === 'Completada';",
  'const selectedVisitLocked = selectedVisit?.status',
);
replaceOnce(
  equipmentFile,
  "  function openAdd(unitId = '') {\n    resetForm();",
  "  function openAdd(unitId = '') {\n    if (selectedVisitLocked) {\n      setMessage('Esta orden está terminada. Los aires pueden consultarse, pero no se pueden añadir ni modificar.');\n      return;\n    }\n    resetForm();",
  'Los aires pueden consultarse, pero no se pueden añadir ni modificar.',
);
replaceOnce(
  equipmentFile,
  "  function openSearch(unitId = '') {\n    setSelectedUnitId(unitId);",
  "  function openSearch(unitId = '') {\n    if (selectedVisitLocked) {\n      setMessage('Esta orden está terminada. No se pueden asociar otros aires.');\n      return;\n    }\n    setSelectedUnitId(unitId);",
  'No se pueden asociar otros aires.',
);
replaceOnce(
  equipmentFile,
  "  async function scanQr(target: 'register' | 'lookup') {\n    setMessage('');",
  "  async function scanQr(target: 'register' | 'lookup') {\n    if (selectedVisitLocked) {\n      setMessage('Esta orden está terminada. El registro de equipos está bloqueado.');\n      return;\n    }\n    setMessage('');",
  'El registro de equipos está bloqueado.',
);
replaceOnce(
  equipmentFile,
  "  async function registerEquipment() {\n    if (!selectedVisit || !selectedOrder || !currentUser) {",
  "  async function registerEquipment() {\n    if (selectedVisitLocked) {\n      setMessage('Esta orden está terminada. No se puede registrar otro aire.');\n      return;\n    }\n    if (!selectedVisit || !selectedOrder || !currentUser) {",
  'No se puede registrar otro aire.',
);
replaceOnce(
  equipmentFile,
  "  async function attachExistingEquipment(equipment: RegisteredEquipmentSystem) {\n    if (!selectedVisit || !selectedOrder) return;",
  "  async function attachExistingEquipment(equipment: RegisteredEquipmentSystem) {\n    if (selectedVisitLocked) {\n      setMessage('Esta orden está terminada. No se puede agregar otro aire.');\n      return;\n    }\n    if (!selectedVisit || !selectedOrder) return;",
  'No se puede agregar otro aire.',
);
replaceOnce(
  equipmentFile,
  "          <View style={styles.mainActions}>\n            <Button compact icon=\"▣\" label={working ? 'Escaneando…' : 'Escanear QR'} disabled={working} onPress={() => void scanQr('lookup')} />\n            <Button compact icon=\"⌕\" label=\"Buscar aire\" variant=\"secondary\" onPress={() => openSearch(selectedUnitId)} />\n            <Button compact icon=\"＋\" label=\"Añadir\" variant=\"success\" onPress={() => openAdd()} />\n          </View>",
  "          {selectedVisitLocked ? (\n            <View style={styles.closedVisitBox}>\n              <Text style={styles.closedVisitTitle}>ORDEN TERMINADA</Text>\n              <Text style={styles.closedVisitText}>Esta visita está cerrada. Puedes abrir los perfiles y consultar sus reportes, pero no escanear, buscar, registrar ni añadir otros aires.</Text>\n            </View>\n          ) : null}\n          <View style={styles.mainActions}>\n            <Button compact icon=\"▣\" label={working ? 'Escaneando…' : 'Escanear QR'} disabled={working || selectedVisitLocked} onPress={() => void scanQr('lookup')} />\n            <Button compact icon=\"⌕\" label=\"Buscar aire\" variant=\"secondary\" disabled={selectedVisitLocked} onPress={() => openSearch(selectedUnitId)} />\n            <Button compact icon=\"＋\" label=\"Añadir\" variant=\"success\" disabled={selectedVisitLocked} onPress={() => openAdd()} />\n          </View>",
  'ORDEN TERMINADA',
);
insertAfter(
  equipmentFile,
  "  mainActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },",
  "\n  closedVisitBox: { backgroundColor: '#F0F8F1', borderWidth: 1, borderColor: '#B8D8BD', borderRadius: 12, padding: 13, marginBottom: 12 },\n  closedVisitTitle: { color: '#2F6A3B', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },\n  closedVisitText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },",
  'closedVisitBox:',
);

// ---------------------------------------------------------------------------
// Technician work list: reconcile older submitted visits, display TERMINADO,
// disable Manage equipment, and hide every editable legacy form after closure.
// ---------------------------------------------------------------------------
const technicianFile = 'src/screens/TechnicianScreen.tsx';
replaceOnce(
  technicianFile,
  "import React, { useEffect, useMemo, useState } from 'react';",
  "import React, { useEffect, useMemo, useRef, useState } from 'react';",
  'useMemo, useRef, useState',
);
insertAfter(
  technicianFile,
  "import { useAppState } from '../state/TeamState';",
  "\nimport { useTechnicianPortalState } from '../state/TechnicianPortalState';\nimport { registeredUnitsForVisit, unitHasSubmittedFieldWork, visitHasSubmittedFieldWork } from '../features/technicianPortal/closure';",
  "registeredUnitsForVisit, unitHasSubmittedFieldWork",
);
insertAfter(
  technicianFile,
  "  const pwa = usePwaStatus();",
  "\n  const { workVisits: portalVisits, visitUnits: portalUnits, workInterventions: portalInterventions, saveWorkVisit, saveVisitUnit } = useTechnicianPortalState();\n  const closureSyncRef = useRef(new Set<string>());",
  'const closureSyncRef = useRef',
);
insertAfter(
  technicianFile,
  "  const technicianView = currentUser?.role === 'technician';",
  `

  useEffect(() => {
    if (!currentUser) return;
    for (const order of workOrders) {
      const visit = portalVisits.find((item) => item.workOrderId === order.id);
      if (!visit || !visitHasSubmittedFieldWork(visit.id, portalUnits, portalInterventions)) continue;
      const registeredUnits = registeredUnitsForVisit(visit.id, portalUnits);
      const needsSync = order.status !== 'Completada'
        || (visit.status !== 'ready_for_office_review' && visit.status !== 'completed')
        || registeredUnits.some((unit) => unit.status !== 'completed' && unitHasSubmittedFieldWork(unit.id, portalInterventions));
      if (!needsSync || closureSyncRef.current.has(order.id)) continue;

      closureSyncRef.current.add(order.id);
      void (async () => {
        const now = new Date().toISOString();
        for (const unit of registeredUnits) {
          if (unit.status === 'completed' || !unitHasSubmittedFieldWork(unit.id, portalInterventions)) continue;
          await saveVisitUnit({
            ...unit,
            status: 'completed',
            completedAt: unit.completedAt ?? now,
            updatedAt: now,
            updatedByUserId: currentUser.id,
            updatedByStaffId: currentStaff?.id ?? unit.updatedByStaffId,
            updatedByName: currentStaff?.name ?? currentUser.name,
            version: Math.max(1, Number(unit.version ?? 1)) + 1,
          });
        }
        if (visit.status !== 'completed' && visit.status !== 'ready_for_office_review') {
          await saveWorkVisit({
            ...visit,
            status: 'ready_for_office_review',
            completedAt: visit.completedAt ?? now,
            updatedAt: now,
            updatedByUserId: currentUser.id,
            updatedByStaffId: currentStaff?.id ?? visit.updatedByStaffId,
            updatedByName: currentStaff?.name ?? currentUser.name,
            version: Math.max(1, Number(visit.version ?? 1)) + 1,
          });
        }
        if (order.status !== 'Completada') {
          await updateWorkOrder(order.id, {
            status: 'Completada',
            completedAt: now,
            statusHistory: [
              ...(order.statusHistory ?? []),
              {
                status: 'Completada',
                changedAt: now,
                changedByUserId: currentUser.id,
                changedByName: currentStaff?.name ?? currentUser.name,
                note: 'Cierre sincronizado porque todos los reportes técnicos fueron enviados.',
              },
            ],
          } as any);
        }
      })().finally(() => closureSyncRef.current.delete(order.id));
    }
  }, [currentUser?.id, currentStaff?.id, workOrders, portalVisits, portalUnits, portalInterventions]);`,
  'Cierre sincronizado porque todos los reportes técnicos fueron enviados.',
);
insertAfter(
  technicianFile,
  "  const selected = workOrders.find((order) => order.id === selectedId) as OperationalWorkOrder | undefined;",
  "\n  const selectedPortalVisit = portalVisits.find((visit) => visit.workOrderId === selected?.id);\n  const selectedIsClosed = selected?.status === 'Completada' || selectedPortalVisit?.status === 'ready_for_office_review' || selectedPortalVisit?.status === 'completed';",
  'const selectedIsClosed = selected?.status',
);
replaceOnce(
  technicianFile,
  '<Pill label={job.status} tone={statusTone(job.status)} />',
  "<Pill label={job.status === 'Completada' ? 'Terminado' : job.status} tone={statusTone(job.status)} />",
  "job.status === 'Completada' ? 'Terminado'",
);
replaceOnce(
  technicianFile,
  '<Pill label={selected.status} tone={statusTone(selected.status)} />',
  "<Pill label={selectedIsClosed ? 'Terminado' : selected.status} tone={statusTone(selected.status)} />",
  "selectedIsClosed ? 'Terminado'",
);
replaceOnce(
  technicianFile,
  '<Button compact icon="❄" label="Gestionar aires" onPress={() => {',
  '<Button compact icon="❄" label={selectedIsClosed ? "Trabajo cerrado" : "Gestionar aires"} disabled={selectedIsClosed} onPress={() => {',
  'selectedIsClosed ? "Trabajo cerrado"',
);
replaceOnce(
  technicianFile,
  '            <TechnicianEvidenceReport order={selected} currentStaff={currentStaff} />',
  "            {selectedIsClosed ? (\n              <Card>\n                <View style={styles.closedOrderBox}>\n                  <Text style={styles.closedOrderTitle}>TRABAJO TERMINADO</Text>\n                  <Text style={styles.closedOrderText}>Todos los reportes de esta visita fueron enviados. La orden está cerrada y ya no permite agregar aires, seleccionar otro tipo de trabajo, cambiar mediciones ni modificar el reporte.</Text>\n                </View>\n              </Card>\n            ) : (\n              <>\n            <TechnicianEvidenceReport order={selected} currentStaff={currentStaff} />",
  'Todos los reportes de esta visita fueron enviados.',
);
replaceOnce(
  technicianFile,
  "            {formMessage ? <View style={styles.messageBox}><Text style={styles.messageText}>{formMessage}</Text></View> : null}",
  "              </>\n            )}\n\n            {formMessage ? <View style={styles.messageBox}><Text style={styles.messageText}>{formMessage}</Text></View> : null}",
  '              </>\n            )}',
);
insertAfter(
  technicianFile,
  "  equipmentPortalText: { color: colors.text, marginTop: 5, fontSize: 10, lineHeight: 15 },",
  "\n  closedOrderBox: { backgroundColor: '#F0F8F1', borderWidth: 1, borderColor: '#B8D8BD', borderRadius: 12, padding: 14 },\n  closedOrderTitle: { color: '#2F6A3B', fontSize: 11, fontWeight: '900', letterSpacing: 0.9 },\n  closedOrderText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 6 },",
  'closedOrderBox:',
);

// ---------------------------------------------------------------------------
// Office review: finalize the visit and core order after all reports are
// reviewed. Returning a report reopens it for correction but still locks the
// scope so the technician cannot add a different job.
// ---------------------------------------------------------------------------
const officeFile = 'src/screens/OfficeReportReviewScreen.tsx';
insertAfter(
  officeFile,
  "import { getTechnicianReportTemplate, TemplateFieldDefinition } from '../features/technicianPortal/templates';",
  "\nimport { unitHasCompletedReview, visitHasCompletedReview } from '../features/technicianPortal/closure';",
  "visitHasCompletedReview } from '../features/technicianPortal/closure'",
);
replaceOnce(
  officeFile,
  "  const { currentUser, clients, properties, workOrders, workOrderEvidence } = useAppState();",
  "  const { currentUser, clients, properties, workOrders, workOrderEvidence, updateWorkOrder } = useAppState();",
  'workOrderEvidence, updateWorkOrder',
);
replaceOnce(
  officeFile,
  "    saveVisitUnit,\n    refreshTechnicianPortalData,",
  "    saveVisitUnit,\n    saveWorkVisit,\n    refreshTechnicianPortalData,",
  "    saveWorkVisit,\n    refreshTechnicianPortalData,",
);
replaceOnce(
  officeFile,
  `    const activeInterventions = workInterventions
      .filter((item) => item.visitUnitId === selected.visitUnitId && item.status !== 'cancelled')
      .map((item) => item.id === selected.id ? { ...item, status: 'completed' as const } : item);
    if (activeInterventions.length && activeInterventions.every((item) => item.status === 'completed')) {
      await saveVisitUnit({
        ...selectedUnit,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? selectedUnit.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(selectedUnit.version ?? 1)) + 1,
      });
    }`,
  `    const reviewedInterventions = workInterventions.map((item) => item.id === selected.id
      ? { ...item, status: 'completed' as const }
      : item);
    if (unitHasCompletedReview(selected.visitUnitId, reviewedInterventions)) {
      await saveVisitUnit({
        ...selectedUnit,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? selectedUnit.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(selectedUnit.version ?? 1)) + 1,
      });
    }

    if (selectedVisit && visitHasCompletedReview(selectedVisit.id, visitUnits, reviewedInterventions)) {
      await saveWorkVisit({
        ...selectedVisit,
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? selectedVisit.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(selectedVisit.version ?? 1)) + 1,
      });
      if (selectedOrder && selectedOrder.status !== 'Completada') {
        await updateWorkOrder(selectedOrder.id, {
          status: 'Completada',
          completedAt: now,
          statusHistory: [
            ...(selectedOrder.statusHistory ?? []),
            {
              status: 'Completada',
              changedAt: now,
              changedByUserId: currentUser.id,
              changedByName: currentUser.name,
              note: 'Todos los reportes técnicos fueron revisados por la oficina.',
            },
          ],
        } as any);
      }
    }`,
  'Todos los reportes técnicos fueron revisados por la oficina.',
);
replaceOnce(
  officeFile,
  "    setMessage('Reporte devuelto al técnico con la corrección solicitada.');",
  `    if (selectedUnit) {
      await saveVisitUnit({
        ...selectedUnit,
        status: 'in_progress',
        completedAt: undefined,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? selectedUnit.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(selectedUnit.version ?? 1)) + 1,
      });
    }
    if (selectedVisit) {
      await saveWorkVisit({
        ...selectedVisit,
        status: 'in_progress',
        completedAt: undefined,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? selectedVisit.updatedByStaffId,
        updatedByName: currentUser.name,
        version: Math.max(1, Number(selectedVisit.version ?? 1)) + 1,
      });
    }
    if (selectedOrder && selectedOrder.status === 'Completada') {
      await updateWorkOrder(selectedOrder.id, {
        status: 'En proceso',
        completedAt: null,
        statusHistory: [
          ...(selectedOrder.statusHistory ?? []),
          {
            status: 'En proceso',
            changedAt: now,
            changedByUserId: currentUser.id,
            changedByName: currentUser.name,
            note: 'La oficina devolvió un reporte para corrección.',
          },
        ],
      } as any);
    }

    setMessage('Reporte devuelto al técnico. La orden se reabrió únicamente para corregir el reporte existente; no permite agregar trabajos nuevos.');`,
  'La orden se reabrió únicamente para corregir el reporte existente',
);

console.log('Technician work-order closure patch applied.');
