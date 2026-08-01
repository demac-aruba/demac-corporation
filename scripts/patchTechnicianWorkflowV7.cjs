const { read, write } = require('./serviceFlowPatchUtils.cjs');

const marker = 'TECHNICIAN_WORKFLOW_V7';

function update(file, transform) {
  const source = read(file);
  if (source.includes(marker)) return;
  const result = transform(source);
  if (!result.includes(marker)) throw new Error(`${file} did not receive ${marker}.`);
  write(file, result);
}

function replace(source, oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(`Required V7 block not found: ${label}`);
  return source.replace(oldText, newText);
}

update('src/screens/TechnicianPortalEquipmentTestScreen.tsx', (original) => {
  let source = replace(
    original,
    `const SYSTEM_TYPES = ['Split wall mounted', 'Cassette', 'Floor ceiling', 'Central', 'VRF', 'Otro'];
const REFRIGERANTS = ['R22', 'R32', 'R410A'];`,
    `// ${marker}: guided capacity selection by equipment type.
const SYSTEM_TYPES = ['Split wall mounted', 'Cassette', 'Floor ceiling', 'Central', 'VRF', 'Otro'];
const CAPACITY_PRESETS: Record<string, number[]> = {
  'Split wall mounted': [12000, 18000, 24000, 36000],
  Cassette: [12000, 18000, 24000, 36000, 60000],
  'Floor ceiling': [36000, 60000],
  Central: [36000, 60000],
};
const CENTRAL_TONNAGES = [6, 7, 7.5, ...Array.from({ length: 23 }, (_, index) => index + 8)];
const REFRIGERANTS = ['R22', 'R32', 'R410A'];`,
    'capacity constants',
  );
  source = replace(
    source,
    `function formatBtu(value?: number) {
  return value ? \`${'${value.toLocaleString(\'en-US\')}'} BTU\` : 'BTU pendiente';
}`,
    `function formatBtu(value?: number) {
  return value ? \`${'${value.toLocaleString(\'en-US\')}'} BTU\` : 'BTU pendiente';
}

function capacityButtonLabel(value: number, systemType: string) {
  const tons = value / 12000;
  if (systemType === 'Central') return \`${'${value.toLocaleString(\'en-US\')}'} BTU (${ '${Number.isInteger(tons) ? tons : tons.toFixed(1)}' } ton)\`;
  return \`${'${value.toLocaleString(\'en-US\')}'} BTU\`;
}`,
    'capacity formatter',
  );
  source = replace(
    source,
    `  const [btu, setBtu] = useState('');
  const [refrigerant, setRefrigerant] = useState('R32');`,
    `  const [btu, setBtu] = useState('');
  const [customCapacity, setCustomCapacity] = useState(false);
  const [centralTonnageOpen, setCentralTonnageOpen] = useState(false);
  const [refrigerant, setRefrigerant] = useState('R32');`,
    'capacity state',
  );
  source = replace(
    source,
    `    setBtu('');
    setRefrigerant('R32');`,
    `    setBtu('');
    setCustomCapacity(false);
    setCentralTonnageOpen(false);
    setRefrigerant('R32');`,
    'capacity reset',
  );
  source = replace(
    source,
    `  function openAdd(unitId = '') {`,
    `  function selectSystemType(nextSystemType: string) {
    setSystemType(nextSystemType);
    setBtu('');
    setCentralTonnageOpen(false);
    setCustomCapacity(nextSystemType === 'VRF' || nextSystemType === 'Otro');
  }

  function selectCapacity(capacity: number) {
    setBtu(String(Math.round(capacity)));
    setCustomCapacity(false);
    setCentralTonnageOpen(false);
  }

  function selectCentralTonnage(tons: number) {
    selectCapacity(tons * 12000);
  }

  function openAdd(unitId = '') {`,
    'capacity handlers',
  );
  source = replace(
    source,
    `<ChoiceGroup label="TIPO DE SISTEMA" options={SYSTEM_TYPES} value={systemType} onChange={setSystemType} />

          <View style={styles.formGrid}>
            <Input style={styles.field} label="Marca" value={brand} onChangeText={setBrand} placeholder="Adina, Gree, Carrier..." />
            <Input style={styles.field} keyboardType="number-pad" label="BTU" value={btu} onChangeText={(value) => setBtu(value.replace(/\\D/g, ''))} placeholder="12000" />
          </View>`,
    `<ChoiceGroup label="TIPO DE SISTEMA" options={SYSTEM_TYPES} value={systemType} onChange={selectSystemType} />

          <Input label="Marca" value={brand} onChangeText={setBrand} placeholder="Adina, Gree, Carrier..." />
          <View style={styles.capacitySection}>
            <Text style={styles.fieldLabel}>CAPACIDAD</Text>
            {(CAPACITY_PRESETS[systemType] ?? []).length ? (
              <View style={styles.suggestionRow}>
                {(CAPACITY_PRESETS[systemType] ?? []).map((capacity) => (
                  <Button
                    key={capacity}
                    compact
                    label={capacityButtonLabel(capacity, systemType)}
                    variant={btu === String(capacity) ? 'primary' : 'secondary'}
                    onPress={() => selectCapacity(capacity)}
                  />
                ))}
              </View>
            ) : null}
            {systemType === 'Central' ? (
              <View style={styles.tonnagePicker}>
                <Pressable onPress={() => setCentralTonnageOpen((open) => !open)} style={styles.tonnageButton}>
                  <Text style={styles.tonnageButtonText}>
                    {Number(btu) > 60000 ? \`${'${(Number(btu) / 12000).toLocaleString(\'es-AW\')}'} toneladas · ${'${Number(btu).toLocaleString(\'en-US\')}'} BTU\` : 'Más de 5 toneladas ▾'}
                  </Text>
                </Pressable>
                {centralTonnageOpen ? (
                  <View style={styles.tonnageOptions}>
                    {CENTRAL_TONNAGES.map((tons) => (
                      <Button
                        key={tons}
                        compact
                        label={\`${'${tons}'} ton\`}
                        variant={btu === String(tons * 12000) ? 'primary' : 'secondary'}
                        onPress={() => selectCentralTonnage(tons)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            {!customCapacity ? <Button compact variant="ghost" label="Otro tamaño" onPress={() => { setBtu(''); setCustomCapacity(true); setCentralTonnageOpen(false); }} /> : null}
            {customCapacity ? (
              <Input keyboardType="number-pad" label="Otro tamaño en BTU" value={btu} onChangeText={(value) => setBtu(value.replace(/\\D/g, ''))} placeholder="Escribe la capacidad de la placa" />
            ) : null}
            {btu ? <Text style={styles.capacitySelection}>Seleccionado: {Number(btu).toLocaleString('en-US')} BTU</Text> : null}
          </View>`,
    'capacity form',
  );
  source = replace(
    source,
    `  choiceGroup: { marginTop: 2 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },`,
    `  choiceGroup: { marginTop: 2 },
  capacitySection: { marginTop: 4, marginBottom: 8 },
  tonnagePicker: { marginBottom: 9 },
  tonnageButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 11 },
  tonnageButtonText: { color: colors.text, fontSize: 10, fontWeight: '900' },
  tonnageOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, padding: 10, backgroundColor: '#FAFBFD' },
  capacitySelection: { color: colors.primaryDark, fontSize: 10, fontWeight: '900', marginTop: 6 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },`,
    'capacity styles',
  );
});

update('src/screens/TechnicianInterventionReportScreen.tsx', (original) => {
  let source = replace(
    original,
    `// TECHNICIAN_WORKFLOW_V4
// const visibleFields = definition.fields.filter — compatibility marker for V3.`,
    `// TECHNICIAN_WORKFLOW_V4
// ${marker}: preserve drafts during media uploads and reuse equipment identification.
// setDraft(applyTechnicianReportDerivedValues — V3 repeated-build compatibility marker.
// const visibleFields = definition.fields.filter — compatibility marker for V3.`,
    'report marker',
  );
  source = replace(
    source,
    `  const workOrder = workOrders.find((item) => item.id === visit?.workOrderId);

  const reportSections = useMemo(() => {
    if (!template) return [];
    const existing = workReportSections.filter((section) => section.interventionId === interventionId);
    return template.sections
      .map((definition) => ({ definition, section: existing.find((item) => item.sectionType === definition.sectionType) }))`,
    `  const workOrder = workOrders.find((item) => item.id === visit?.workOrderId);
  const equipmentIdentificationComplete = Boolean(
    equipment?.locationLabel
      && equipment?.systemType
      && equipment.components.some((component) => component.componentType === 'indoor' && component.nameplateEvidenceId)
      && equipment.components.some((component) => component.componentType === 'outdoor' && component.nameplateEvidenceId),
  );

  const reportSections = useMemo(() => {
    if (!template) return [];
    const existing = workReportSections.filter((section) => section.interventionId === interventionId);
    return template.sections
      .filter((definition) => definition.sectionType !== 'identification' || !equipmentIdentificationComplete)
      .map((definition) => ({ definition, section: existing.find((item) => item.sectionType === definition.sectionType) }))`,
    'conditional identification',
  );
  source = replace(
    source,
    `  }, [template, workReportSections, interventionId]);`,
    `  }, [template, workReportSections, interventionId, equipmentIdentificationComplete]);`,
    'report memo dependencies',
  );
  source = replace(
    source,
    `    setDraft(applyTechnicianReportDerivedValues({ ...activeItem.section.fields }));
  }, [activeItem?.section.id, activeItem?.section.updatedAt]);`,
    `    const sectionDraft = applyTechnicianReportDerivedValues({ ...activeItem.section.fields });
    draftRef.current = sectionDraft;
    setDraft(sectionDraft);
  }, [activeItem?.section.id]);`,
    'draft hydration',
  );
  source = replace(
    source,
    `    setActiveSectionId(section.id);
    setDraft({ ...section.fields });`,
    `    const sectionDraft = applyTechnicianReportDerivedValues({ ...section.fields });
    setActiveSectionId(section.id);
    draftRef.current = sectionDraft;
    setDraft(sectionDraft);`,
    'section selection draft',
  );
  source = replace(
    source,
    `      const savedSection = await updateReportSection(sectionSnapshot, {
        fields: { [field.key]: evidence.id },`,
    `      const savedSection = await updateReportSection(sectionSnapshot, {
        fields: nextDraft,`,
    'persist complete photo draft',
  );
  source = replace(
    source,
    `        transcriptionStatus: 'not_requested',`,
    `        transcriptionStatus: 'pending',`,
    'request transcription',
  );
  source = replace(
    source,
    `      const savedSection = await updateReportSection(sectionSnapshot, { fields: { [field.key]: evidence.id }, evidenceIds: [evidence.id] });`,
    `      const savedSection = await updateReportSection(sectionSnapshot, { fields: nextDraft, evidenceIds: [evidence.id] });`,
    'persist complete voice draft',
  );
  source = replace(
    source,
    `      setMessage('Nota de voz guardada. Quedó preparada para una futura transcripción con IA.');`,
    `      setMessage('Nota de voz guardada. La transcripción automática con IA está en proceso.');`,
    'voice success message',
  );
  source = replace(
    source,
    `            <Text style={styles.templateDescription}>{template.description}</Text>`,
    `            <Text style={styles.templateDescription}>{template.description}</Text>
            {equipmentIdentificationComplete ? <Text style={styles.profileReuseText}>La ubicación, el tipo de sistema y las placas se reutilizan del perfil del aire; no tienes que registrarlos otra vez.</Text> : null}`,
    'profile reuse notice',
  );
  return replace(
    source,
    `  templateDescription: { color: colors.muted, marginTop: 10, lineHeight: 18 },`,
    `  templateDescription: { color: colors.muted, marginTop: 10, lineHeight: 18 },
  profileReuseText: { color: colors.primaryDark, backgroundColor: colors.primaryLight, borderRadius: 9, padding: 10, marginTop: 10, fontSize: 9, lineHeight: 14, fontWeight: '800' },`,
    'profile reuse style',
  );
});

update('src/components/TechnicianVoiceNoteField.tsx', (original) => {
  let source = replace(
    original,
    `const MAX_SECONDS = 120;`,
    `// ${marker}: automatic transcription status and transcript preview.
const MAX_SECONDS = 120;`,
    'voice marker',
  );
  source = replace(
    source,
    `      <Text style={styles.message}>{uploading ? 'Subiendo la nota de voz en segundo plano…' : message}</Text>`,
    `      <Text style={styles.message}>{uploading ? 'Subiendo la nota de voz en segundo plano…' : message}</Text>
      {evidence?.transcriptionStatus === 'pending' || evidence?.transcriptionStatus === 'processing' ? (
        <View style={styles.transcriptionPending}><Text style={styles.transcriptionPendingText}>Transcripción automática en proceso…</Text></View>
      ) : null}
      {evidence?.transcriptionStatus === 'failed' ? (
        <View style={styles.transcriptionError}><Text style={styles.transcriptionErrorText}>El audio quedó guardado, pero la transcripción no terminó. La oficina puede escuchar la nota y reintentar el procesamiento.</Text></View>
      ) : null}
      {evidence?.transcript ? (
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptTitle}>TRANSCRIPCIÓN AUTOMÁTICA</Text>
          <Text style={styles.transcriptText}>{evidence.transcript}</Text>
        </View>
      ) : null}`,
    'transcription display',
  );
  return replace(
    source,
    `  message: { color: colors.muted, fontSize: 9, lineHeight: 14 },`,
    `  message: { color: colors.muted, fontSize: 9, lineHeight: 14 },
  transcriptionPending: { backgroundColor: '#EEF6FF', borderRadius: 9, padding: 9 },
  transcriptionPendingText: { color: '#0B5CAD', fontSize: 9, fontWeight: '800' },
  transcriptionError: { backgroundColor: '#FFF4E5', borderRadius: 9, padding: 9 },
  transcriptionErrorText: { color: '#8A5200', fontSize: 9, lineHeight: 14, fontWeight: '800' },
  transcriptBox: { backgroundColor: colors.primaryLight, borderRadius: 9, padding: 10 },
  transcriptTitle: { color: colors.primaryDark, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  transcriptText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },`,
    'transcription styles',
  );
});

update('src/types.ts', (original) => {
  let source = replace(
    original,
    `// TECHNICIAN_WORKFLOW_V4
export interface WorkOrderEvidence {`,
    `// TECHNICIAN_WORKFLOW_V4
// ${marker}: server-side voice transcription fields.
export interface WorkOrderEvidence {`,
    'evidence marker',
  );
  return replace(
    source,
    `  transcriptionStatus?: 'not_requested' | 'pending' | 'completed' | 'failed';
  note?: string;`,
    `  transcriptionStatus?: 'not_requested' | 'pending' | 'processing' | 'completed' | 'failed';
  transcript?: string;
  transcriptionError?: string;
  transcriptionModel?: string;
  transcribedAt?: string;
  note?: string;`,
    'transcription evidence fields',
  );
});

update('src/services/firebase.ts', (original) => {
  let source = replace(
    original,
    `export type FirebaseSession = {
  uid: string;`,
    `// ${marker}: share one cached session and one refresh across concurrent reads.
export type FirebaseSession = {
  uid: string;`,
    'firebase session marker',
  );
  source = replace(
    source,
    `type IdentityToolkitSignInResponse = {`,
    `let cachedFirebaseSession: FirebaseSession | null | undefined;
let sessionReadPromise: Promise<FirebaseSession | null> | null = null;
let sessionRefreshPromise: Promise<FirebaseSession> | null = null;

type IdentityToolkitSignInResponse = {`,
    'firebase session cache',
  );
  source = replace(
    source,
    `export async function loadFirebaseSession() {
  const stored = await AsyncStorage.getItem(FIREBASE_SESSION_KEY);
  return stored ? (JSON.parse(stored) as FirebaseSession) : null;
}

export async function getValidFirebaseSession() {
  const session = await loadFirebaseSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) return session;
  return refreshFirebaseSession(session);
}`,
    `export async function loadFirebaseSession() {
  if (cachedFirebaseSession !== undefined) return cachedFirebaseSession;
  if (!sessionReadPromise) {
    sessionReadPromise = AsyncStorage.getItem(FIREBASE_SESSION_KEY)
      .then((stored) => {
        cachedFirebaseSession = stored ? (JSON.parse(stored) as FirebaseSession) : null;
        return cachedFirebaseSession;
      })
      .finally(() => { sessionReadPromise = null; });
  }
  return sessionReadPromise;
}

export async function getValidFirebaseSession() {
  const session = await loadFirebaseSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) return session;
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = refreshFirebaseSession(session)
      .finally(() => { sessionRefreshPromise = null; });
  }
  return sessionRefreshPromise;
}`,
    'firebase coordinated refresh',
  );
  source = replace(
    source,
    `export async function persistFirebaseSession(session: FirebaseSession) {
  await AsyncStorage.setItem(FIREBASE_SESSION_KEY, JSON.stringify(session));
}

export async function clearFirebaseSession() {
  await AsyncStorage.removeItem(FIREBASE_SESSION_KEY);
}`,
    `export async function persistFirebaseSession(session: FirebaseSession) {
  cachedFirebaseSession = session;
  await AsyncStorage.setItem(FIREBASE_SESSION_KEY, JSON.stringify(session));
}

export async function clearFirebaseSession() {
  cachedFirebaseSession = null;
  sessionReadPromise = null;
  sessionRefreshPromise = null;
  await AsyncStorage.removeItem(FIREBASE_SESSION_KEY);
}`,
    'firebase cache persistence',
  );
  return source;
});

update('src/state/TechnicianPortalState.tsx', (original) => {
  return replace(
    original,
    `// TECHNICIAN_WORKFLOW_V4
// templateFieldIsVisible(field, initialFields)`,
    `// TECHNICIAN_WORKFLOW_V4
// ${marker}: durable deployable permissions and friendlier assignment errors.
// templateFieldIsVisible(field, initialFields)`,
    'portal state marker',
  ).replace(
    'Firebase rechazó el cambio del Portal del Técnico. Publica las reglas nuevas y confirma que el usuario esté asignado a la orden o van.',
    'Firebase no pudo completar este cambio. Confirma que la visita esté asignada a este técnico o a su van e inténtalo nuevamente.',
  );
});

update('src/screens/OfficeReportReviewScreen.tsx', (original) => {
  let source = replace(
    original,
    `import React, { useEffect, useMemo, useState } from 'react';`,
    `import React, { useEffect, useMemo, useState } from 'react';
// ${marker}: voice notes render their automatic transcript in office and PDF output.`,
    'office marker',
  );
  source = replace(
    source,
    `            return field.type === 'photo'
              ? {
                  label: field.label,
                  value: evidence?.label ?? 'Fotografía no disponible',
                  photoUrl: evidence?.downloadUrl,
                  photoCaption: evidence?.label,
                }
              : { label: field.label, value: fieldValue(value, field) };`,
    `            return field.type === 'photo'
              ? {
                  label: field.label,
                  value: evidence?.label ?? 'Fotografía no disponible',
                  photoUrl: evidence?.downloadUrl,
                  photoCaption: evidence?.label,
                }
              : field.type === 'voice_note'
                ? { label: 'Transcripción de la nota de voz', value: evidence?.transcript ?? (evidence?.transcriptionStatus === 'failed' ? 'La transcripción automática no pudo completarse.' : 'Transcripción automática en proceso.') }
                : { label: field.label, value: fieldValue(value, field) };`,
    'voice transcript printable output',
  );
  return replace(
    source,
    `                      {field.type === 'photo'
                        ? evidence
                          ? <EvidencePreview evidence={evidence} onOpen={() => setLightboxEvidence(evidence)} />
                          : <><Text style={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</Text><Text style={styles.missingValue}>Fotografía no disponible</Text></>
                        : <><Text style={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</Text><Text style={styles.fieldValue}>{fieldValue(value, field)}</Text></>}`,
    `                      {field.type === 'photo'
                        ? evidence
                          ? <EvidencePreview evidence={evidence} onOpen={() => setLightboxEvidence(evidence)} />
                          : <><Text style={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</Text><Text style={styles.missingValue}>Fotografía no disponible</Text></>
                        : field.type === 'voice_note'
                          ? <><Text style={styles.fieldLabel}>Nota de voz · {evidence?.durationSeconds ? \`${'${Math.floor(evidence.durationSeconds / 60)}'}:${'${String(Math.round(evidence.durationSeconds % 60)).padStart(2, \'0\')}'}\` : 'duración pendiente'}</Text><Text style={styles.fieldValue}>{evidence?.transcript ?? (evidence?.transcriptionStatus === 'failed' ? 'La transcripción automática no pudo completarse; el audio original permanece guardado.' : 'Transcripción automática en proceso.')}</Text></>
                          : <><Text style={styles.fieldLabel}>{field.label}{field.required ? ' *' : ''}</Text><Text style={styles.fieldValue}>{fieldValue(value, field)}</Text></>}`,
    'voice transcript office display',
  );
});

update('firestore.rules', (original) => {
  let source = replace(
    original,
    `    function assignedToTechnician() {
      return technicianRole()
        && (
          request.auth.uid in resource.data.technicianIds
          || ('staffId' in userProfile().data && userProfile().data.staffId in resource.data.technicianIds)
          || ('vanId' in userProfile().data && userProfile().data.vanId == resource.data.vanId)
        );
    }

    function workOrderData(workOrderId) {
      return get(/databases/$(database)/documents/workOrders/$(workOrderId)).data;
    }

    function assignedToWorkOrderId(workOrderId) {
      return technicianRole()
        && (
          request.auth.uid in workOrderData(workOrderId).technicianIds
          || ('staffId' in userProfile().data && userProfile().data.staffId in workOrderData(workOrderId).technicianIds)
          || ('vanId' in userProfile().data && userProfile().data.vanId == workOrderData(workOrderId).vanId)
        );
    }

    function visitData(visitId) {
      return get(/databases/$(database)/documents/workVisits/$(visitId)).data;
    }

    function assignedToVisitId(visitId) {
      return assignedToWorkOrderId(visitData(visitId).workOrderId);
    }`,
    `    // ${marker}: assignment checks tolerate uid/staff/van identifiers and visit snapshots.
    function currentStaffId() {
      return userProfile().data.get('staffId', '');
    }

    function currentVanId() {
      return userProfile().data.get('vanId', '');
    }

    function assignedToWorkOrderData(data) {
      return technicianRole()
        && (
          request.auth.uid in data.get('technicianIds', [])
          || currentStaffId() in data.get('technicianIds', [])
          || (currentVanId() != '' && currentVanId() == data.get('vanId', ''))
        );
    }

    function assignedToTechnician() {
      return assignedToWorkOrderData(resource.data);
    }

    function workOrderData(workOrderId) {
      return get(/databases/$(database)/documents/workOrders/$(workOrderId)).data;
    }

    function assignedToWorkOrderId(workOrderId) {
      return assignedToWorkOrderData(workOrderData(workOrderId));
    }

    function visitData(visitId) {
      return get(/databases/$(database)/documents/workVisits/$(visitId)).data;
    }

    function assignedToVisitId(visitId) {
      return technicianRole()
        && (
          assignedToWorkOrderId(visitData(visitId).workOrderId)
          || request.auth.uid in visitData(visitId).get('participatingStaffIds', [])
          || currentStaffId() in visitData(visitId).get('participatingStaffIds', [])
          || (currentStaffId() != '' && currentStaffId() == visitData(visitId).get('leadTechnicianStaffId', ''))
        );
    }`,
    'assignment helpers',
  );
  source = replace(
    source,
    `      allow create: if operationsRole()
        || (assignedToWorkOrderId(request.resource.data.sourceWorkOrderId)
          && request.resource.data.sourceWorkOrderId == visitData(request.resource.data.sourceVisitId).workOrderId`,
    `      allow create: if operationsRole()
        || (assignedToVisitId(request.resource.data.sourceVisitId)
          && request.resource.data.sourceWorkOrderId == visitData(request.resource.data.sourceVisitId).workOrderId`,
    'equipment visit authorization',
  );
  return replace(
    source,
    `      allow update: if operationsRole()
        || (assignedToWorkOrderId(resource.data.sourceWorkOrderId)`,
    `      allow update: if operationsRole()
        || (assignedToVisitId(resource.data.sourceVisitId)`,
    'equipment update visit authorization',
  );
});

console.log('patchTechnicianWorkflowV7.cjs applied.');
