import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input, SectionTitle } from '../components/UI';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { useAppState } from '../state/AppState';
import { AppointmentWorkPreset, formatAppointmentDuration, useCalendarState } from '../state/CalendarState';
import { colors } from '../theme';
import { ServiceType } from '../types';
import { WhatsAppKnowledgeScreen } from './WhatsAppKnowledgeScreen';

type RulesSection = 'operations' | 'services' | 'responses';

type CompanyOperationalRules = {
  id: 'company-operational-rules';
  version: number;
  standardService: {
    differentPropertyDailyCapacity: number;
    morningDifferentPropertyStops: number;
    afternoonDifferentPropertyStops: number;
    singlePropertyMainVanMaxUnits: number;
    automaticSupportFromUnits: number;
    automaticSupportMaxUnits: number;
    supportHalfDayMaxUnits: number;
  };
  routing: {
    officeZoneId: 'santa-cruz';
    morningAnchorTime: '08:30';
    afternoonAnchorTime: '13:30';
  };
  customerCommunication: {
    hideSupportVanDetails: true;
    largeJobAllDayNotice: true;
    answerCurrentQuestionFirst: true;
  };
  updatedAt?: string;
};

const DEFAULT_OPERATIONAL_RULES: CompanyOperationalRules = {
  id: 'company-operational-rules',
  version: 1,
  standardService: {
    differentPropertyDailyCapacity: 6,
    morningDifferentPropertyStops: 3,
    afternoonDifferentPropertyStops: 3,
    singlePropertyMainVanMaxUnits: 7,
    automaticSupportFromUnits: 8,
    automaticSupportMaxUnits: 10,
    supportHalfDayMaxUnits: 3,
  },
  routing: {
    officeZoneId: 'santa-cruz',
    morningAnchorTime: '08:30',
    afternoonAnchorTime: '13:30',
  },
  customerCommunication: {
    hideSupportVanDetails: true,
    largeJobAllDayNotice: true,
    answerCurrentQuestionFirst: true,
  },
};

const REQUIRED_PRESETS: AppointmentWorkPreset[] = [
  { id: 'standard_service', label: 'Servicio estándar', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: 10 },
  { id: 'deep_cleaning', label: 'Servicio deep cleaning', durationMinutesPerUnit: 120, kind: 'service', active: true, sortOrder: 20 },
  { id: 'standard_installation', label: 'Instalación estándar', durationMinutesPerUnit: 120, kind: 'installation', active: true, sortOrder: 30 },
  { id: 'special_installation', label: 'Instalación especial', durationMinutesPerUnit: 180, kind: 'installation', active: true, sortOrder: 40 },
  { id: 'repair_diagnostic', label: 'Diagnóstico / reparación', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: 50 },
];

function boundedInteger(value: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value.replace(/[^0-9]/g, ''));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

function moneyValue(value: string, fallback: number) {
  const parsed = Number(value.replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function mergeOperationalRules(value?: Partial<CompanyOperationalRules>): CompanyOperationalRules {
  return {
    ...DEFAULT_OPERATIONAL_RULES,
    ...value,
    id: 'company-operational-rules',
    standardService: {
      ...DEFAULT_OPERATIONAL_RULES.standardService,
      ...(value?.standardService ?? {}),
    },
    routing: DEFAULT_OPERATIONAL_RULES.routing,
    customerCommunication: DEFAULT_OPERATIONAL_RULES.customerCommunication,
  };
}

export function CompanyRulesScreen() {
  const [section, setSection] = useState<RulesSection>('operations');

  return (
    <View style={styles.root}>
      <View style={styles.sectionTabs}>
        <RulesTab label="Operaciones y capacidad" active={section === 'operations'} onPress={() => setSection('operations')} />
        <RulesTab label="Servicios, duración y precios" active={section === 'services'} onPress={() => setSection('services')} />
        <RulesTab label="Respuestas del Copilot" active={section === 'responses'} onPress={() => setSection('responses')} />
      </View>
      {section === 'operations' ? <OperationalRulesSection /> : null}
      {section === 'services' ? <ServiceRulesSection /> : null}
      {section === 'responses' ? <WhatsAppKnowledgeScreen /> : null}
    </View>
  );
}

function RulesTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.sectionTab, active && styles.sectionTabActive]}>
      <Text style={[styles.sectionTabText, active && styles.sectionTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function OperationalRulesSection() {
  const { currentUser } = useAppState();
  const [rules, setRules] = useState(DEFAULT_OPERATIONAL_RULES);
  const [draft, setDraft] = useState(DEFAULT_OPERATIONAL_RULES.standardService);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    if (currentUser?.authProvider !== 'firebase') {
      setRules(DEFAULT_OPERATIONAL_RULES);
      setDraft(DEFAULT_OPERATIONAL_RULES.standardService);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const settings = await listFirestoreCollection<CompanyOperationalRules>('businessSettings');
      const next = mergeOperationalRules(settings.find((item) => item.id === 'company-operational-rules'));
      setRules(next);
      setDraft(next.standardService);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [currentUser?.id]);

  async function save() {
    const normalized: CompanyOperationalRules = {
      ...rules,
      standardService: {
        differentPropertyDailyCapacity: Math.max(1, draft.differentPropertyDailyCapacity),
        morningDifferentPropertyStops: Math.max(1, draft.morningDifferentPropertyStops),
        afternoonDifferentPropertyStops: Math.max(1, draft.afternoonDifferentPropertyStops),
        singlePropertyMainVanMaxUnits: Math.max(1, draft.singlePropertyMainVanMaxUnits),
        automaticSupportFromUnits: Math.max(2, draft.automaticSupportFromUnits),
        automaticSupportMaxUnits: Math.max(draft.automaticSupportFromUnits, draft.automaticSupportMaxUnits),
        supportHalfDayMaxUnits: Math.max(1, draft.supportHalfDayMaxUnits),
      },
      routing: DEFAULT_OPERATIONAL_RULES.routing,
      customerCommunication: DEFAULT_OPERATIONAL_RULES.customerCommunication,
      updatedAt: new Date().toISOString(),
    };
    if (normalized.standardService.morningDifferentPropertyStops + normalized.standardService.afternoonDifferentPropertyStops !== normalized.standardService.differentPropertyDailyCapacity) {
      setError('La suma de los cupos de mañana y tarde debe ser igual al cupo diario por van.');
      return;
    }
    if (normalized.standardService.automaticSupportFromUnits <= normalized.standardService.singlePropertyMainVanMaxUnits) {
      setError('La ayuda automática debe comenzar después del máximo que maneja la van principal.');
      return;
    }
    if (normalized.standardService.automaticSupportMaxUnits - normalized.standardService.singlePropertyMainVanMaxUnits > normalized.standardService.supportHalfDayMaxUnits) {
      setError('El máximo automático no puede requerir más aires de apoyo que el cupo configurado para media jornada.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (currentUser?.authProvider === 'firebase') await saveFirestoreDocument('businessSettings', normalized);
      setRules(normalized);
      setDraft(normalized.standardService);
      setMessage('Las reglas operativas quedaron guardadas. La agenda y el Copilot utilizarán estos valores.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  const change = (key: keyof CompanyOperationalRules['standardService'], value: string, min: number, max: number) => {
    setDraft((current) => ({ ...current, [key]: boundedInteger(value, current[key], min, max) }));
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle
        title="Reglas operativas de DEMAC"
        subtitle="Estos valores controlan capacidad y apoyo interno. Las reglas protegidas de ruta y comunicación no pueden modificarse desde esta pantalla."
        action={<Button compact variant="secondary" label={loading ? 'Cargando…' : 'Actualizar'} disabled={loading} onPress={() => void refresh()} />}
      />
      {message ? <View style={styles.success}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

      <Card>
        <SectionTitle title="Capacidad del servicio estándar" subtitle="Una unidad equivale al servicio de un aire acondicionado en una sola propiedad." />
        <View style={styles.fieldGrid}>
          <NumberField label="Cupo diario por van — direcciones distintas" value={draft.differentPropertyDailyCapacity} onChange={(value) => change('differentPropertyDailyCapacity', value, 1, 12)} help="Regla actual: 6 clientes de un aire por día." />
          <NumberField label="Cupos en la mañana" value={draft.morningDifferentPropertyStops} onChange={(value) => change('morningDifferentPropertyStops', value, 1, 6)} help="Regla actual: 3 citas." />
          <NumberField label="Cupos en la tarde" value={draft.afternoonDifferentPropertyStops} onChange={(value) => change('afternoonDifferentPropertyStops', value, 1, 6)} help="Regla actual: 3 citas." />
          <NumberField label="Máximo de una van en una sola propiedad" value={draft.singlePropertyMainVanMaxUnits} onChange={(value) => change('singlePropertyMainVanMaxUnits', value, 1, 12)} help="Con inicio a las 8:30 a. m., la van principal puede manejar 7 aires." />
          <NumberField label="Desde cuántos aires se activa apoyo" value={draft.automaticSupportFromUnits} onChange={(value) => change('automaticSupportFromUnits', value, 2, 20)} help="Regla actual: desde 8 aires." />
          <NumberField label="Máximo automático con apoyo" value={draft.automaticSupportMaxUnits} onChange={(value) => change('automaticSupportMaxUnits', value, 2, 24)} help="Regla actual: hasta 10 aires; por encima requiere revisión de Operaciones." />
          <NumberField label="Cupo máximo de la van de apoyo" value={draft.supportHalfDayMaxUnits} onChange={(value) => change('supportHalfDayMaxUnits', value, 1, 6)} help="La ayuda ocupa la mañana o la tarde, sin duplicar mensajes al cliente." />
        </View>
        <View style={styles.actions}><Button label={saving ? 'Guardando…' : 'Guardar reglas operativas'} disabled={saving} onPress={() => void save()} /></View>
      </Card>

      <Card>
        <SectionTitle title="Escenario programado: cliente con 8, 9 o 10 aires" />
        <View style={styles.scenarioBox}>
          <Text style={styles.scenarioTitle}>Lo que ve el cliente</Text>
          <Text style={styles.scenarioText}>El Copilot ofrece una cita a las 8:30 a. m. e informa que, por la cantidad de aires, el trabajo puede extenderse durante el día.</Text>
        </View>
        <View style={styles.scenarioBox}>
          <Text style={styles.scenarioTitle}>Lo que hace el ERP internamente</Text>
          <Text style={styles.scenarioText}>Reserva la van principal todo el día para hasta 7 aires y crea una asignación interna de apoyo, en la mañana o en la tarde, para los aires restantes. Solo la orden principal envía confirmación y recordatorio.</Text>
        </View>
      </Card>

      <Card>
        <SectionTitle title="Reglas protegidas programadas" subtitle="Estas reglas se muestran para auditoría, pero no se pueden cambiar sin una actualización del sistema." />
        <ProtectedRule title="Ancla de ruta de la mañana" text="La primera cita de las 8:30 a. m. define el sector principal de las siguientes citas de la mañana." />
        <ProtectedRule title="Ancla de ruta de la tarde" text="La primera cita de la 1:30 p. m. define el sector de la tarde y la ruta debe avanzar progresivamente hacia la oficina en Santa Cruz." />
        <ProtectedRule title="Asignación real de personal" text="Una van necesita un conductor autorizado. Un trabajador no puede estar asignado a dos vans el mismo día y los trabajos que requieren apoyo deben validar personal disponible." />
        <ProtectedRule title="Respuesta actual antes de continuar la cita" text="El Copilot responde primero la pregunta más reciente del cliente y conserva dirección, cantidad y restricciones horarias para continuar después." />
        <ProtectedRule title="Privacidad operativa" text="El cliente no necesita conocer cuántas vans participan. Las órdenes de apoyo son internas y no generan confirmaciones ni recordatorios duplicados." />
      </Card>
    </ScrollView>
  );
}

function NumberField({ label, value, onChange, help }: { label: string; value: number; onChange: (value: string) => void; help: string }) {
  return (
    <View style={styles.fieldCard}>
      <Input label={label} value={String(value)} onChangeText={onChange} keyboardType="numeric" />
      <Text style={styles.help}>{help}</Text>
    </View>
  );
}

function ProtectedRule({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.protectedRule}>
      <View style={styles.lockBadge}><Text style={styles.lockBadgeText}>PROTEGIDA</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.protectedTitle}>{title}</Text><Text style={styles.protectedText}>{text}</Text></View>
    </View>
  );
}

function ServiceRulesSection() {
  const { currentUser, services, updateCatalogItem } = useAppState();
  const { appointmentWorkPresets, saveAppointmentWorkPresets } = useCalendarState();
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const presets = useMemo(() => REQUIRED_PRESETS.map((fallback) => (
    appointmentWorkPresets.find((item) => item.id === fallback.id) ?? fallback
  )), [appointmentWorkPresets]);

  const pricedServices = useMemo(() => services
    .filter((service) => (service.itemType ?? 'Servicio') === 'Servicio' && service.active !== false)
    .sort((a, b) => `${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`)), [services]);

  useEffect(() => {
    setDurationDrafts(Object.fromEntries(presets.map((preset) => [preset.id, String(preset.durationMinutesPerUnit)])));
  }, [appointmentWorkPresets]);

  useEffect(() => {
    setPriceDrafts(Object.fromEntries(pricedServices.map((service) => [service.id, String(service.basePrice ?? 0)])));
  }, [services]);

  async function saveDuration(preset: AppointmentWorkPreset) {
    const minutes = boundedInteger(durationDrafts[preset.id] ?? '', preset.durationMinutesPerUnit, 30, 480);
    const normalized: AppointmentWorkPreset = { ...preset, durationMinutesPerUnit: minutes, active: true };
    const next = [...appointmentWorkPresets.filter((item) => item.id !== normalized.id), normalized]
      .sort((a, b) => a.sortOrder - b.sortOrder);
    setSavingId(`duration-${preset.id}`);
    setError('');
    setMessage('');
    const result = await saveAppointmentWorkPresets(next);
    setSavingId('');
    if (!result.ok) return setError(result.message ?? 'No se pudo guardar la duración.');
    setDurationDrafts((current) => ({ ...current, [preset.id]: String(minutes) }));
    setMessage(`La duración de ${preset.label} quedó en ${formatAppointmentDuration(minutes)} por aire.`);
  }

  async function savePrice(service: ServiceType) {
    const price = moneyValue(priceDrafts[service.id] ?? '', service.basePrice ?? 0);
    setSavingId(`price-${service.id}`);
    setError('');
    setMessage('');
    const result = await updateCatalogItem(service.id, { basePrice: price, updatedAt: new Date().toISOString() });
    setSavingId('');
    if (!result.ok) return setError(result.message ?? 'No se pudo actualizar el precio.');
    setPriceDrafts((current) => ({ ...current, [service.id]: String(price) }));
    setMessage(`El precio de ${service.name} quedó actualizado a Afl. ${price.toFixed(2)}.`);
  }

  const canEdit = ['admin', 'office', 'supervisor'].includes(currentUser?.role ?? '');

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle title="Servicios, duración y precios" subtitle="El Copilot lee estos valores directamente del ERP. No existe una copia separada dentro de la extensión." />
      {message ? <View style={styles.success}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

      <Card>
        <SectionTitle title="Duración para la agenda" subtitle="Controla cuánto tiempo reserva el ERP por cada aire para cada tipo de trabajo." />
        {presets.map((preset) => (
          <View key={preset.id} style={styles.ruleRow}>
            <View style={styles.ruleInfo}><Text style={styles.ruleName}>{preset.label}</Text><Text style={styles.ruleMeta}>{preset.kind === 'installation' ? 'Instalación' : 'Servicio'} · valor actual: {formatAppointmentDuration(preset.durationMinutesPerUnit)}</Text></View>
            <View style={styles.inlineInput}><Input label="Minutos por aire" value={durationDrafts[preset.id] ?? String(preset.durationMinutesPerUnit)} onChangeText={(value) => setDurationDrafts((current) => ({ ...current, [preset.id]: value }))} keyboardType="numeric" /></View>
            <Button compact label={savingId === `duration-${preset.id}` ? 'Guardando…' : 'Guardar'} disabled={!canEdit || !!savingId} onPress={() => void saveDuration(preset)} />
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle title="Precios del catálogo" subtitle="Cada cambio se guarda en el catálogo real de servicios y queda disponible para las respuestas del Copilot." />
        {pricedServices.length ? pricedServices.map((service) => (
          <View key={service.id} style={styles.ruleRow}>
            <View style={styles.ruleInfo}><Text style={styles.ruleName}>{service.name}</Text><Text style={styles.ruleMeta}>{service.category || 'Servicio'} · duración de catálogo: {service.durationMinutes || 0} min</Text></View>
            <View style={styles.inlineInput}><Input label="Precio Afl." value={priceDrafts[service.id] ?? String(service.basePrice ?? 0)} onChangeText={(value) => setPriceDrafts((current) => ({ ...current, [service.id]: value }))} keyboardType="decimal-pad" /></View>
            <Button compact label={savingId === `price-${service.id}` ? 'Guardando…' : 'Guardar'} disabled={!canEdit || !!savingId} onPress={() => void savePrice(service)} />
          </View>
        )) : <Text style={styles.empty}>No hay servicios activos en el catálogo.</Text>}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  sectionTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionTab: { minHeight: 36, paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center', backgroundColor: '#F3F5F7', borderWidth: 1, borderColor: 'transparent' },
  sectionTabActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  sectionTabText: { color: colors.muted, fontWeight: '800', fontSize: 10 },
  sectionTabTextActive: { color: colors.primaryDark },
  page: { padding: 24, gap: 18, paddingBottom: 100 },
  success: { backgroundColor: colors.successLight, borderRadius: 10, padding: 12 },
  successText: { color: colors.success, fontSize: 11, fontWeight: '800' },
  error: { backgroundColor: colors.dangerLight, borderRadius: 10, padding: 12 },
  errorText: { color: colors.danger, fontSize: 11, fontWeight: '800' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fieldCard: { width: '48%', minWidth: 260, flexGrow: 1, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12 },
  help: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: -4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  scenarioBox: { backgroundColor: colors.infoLight, borderRadius: 10, padding: 12, marginBottom: 10 },
  scenarioTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 11 },
  scenarioText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 4 },
  protectedRule: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  lockBadge: { backgroundColor: '#EEF0F2', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  lockBadgeText: { color: colors.muted, fontSize: 8, fontWeight: '900' },
  protectedTitle: { color: colors.text, fontWeight: '900', fontSize: 11 },
  protectedText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  ruleInfo: { flex: 1, minWidth: 250 },
  ruleName: { color: colors.text, fontWeight: '900', fontSize: 11 },
  ruleMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  inlineInput: { width: 170 },
  empty: { color: colors.muted, fontSize: 11, paddingVertical: 14 },
});
