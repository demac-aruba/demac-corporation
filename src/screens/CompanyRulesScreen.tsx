import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input, SectionTitle } from '../components/UI';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { useAppState } from '../state/AppState';
import { AppointmentWorkPreset, useCalendarState } from '../state/CalendarState';
import { colors } from '../theme';
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

type PricingRow = {
  btu: number;
  price: number;
  durationMinutes: number;
  priceType?: 'special' | 'regular';
};

type CompanyServicePricingRules = {
  id: 'company-service-pricing-rules';
  version: number;
  currency: 'Afl.';
  standardServiceSplit: PricingRow[];
  deepCleaningSplit: PricingRow[];
  standardInstallationAdinaDemac: PricingRow[];
  updatedAt?: string;
};

type NumericDraft = Record<string, string>;
type MatrixDraft = Record<string, { price: string; durationMinutes: string }>;

const DEFAULT_OPERATIONAL_RULES: CompanyOperationalRules = {
  id: 'company-operational-rules',
  version: 2,
  standardService: {
    differentPropertyDailyCapacity: 6,
    morningDifferentPropertyStops: 3,
    afternoonDifferentPropertyStops: 3,
    singlePropertyMainVanMaxUnits: 7,
    automaticSupportFromUnits: 8,
    automaticSupportMaxUnits: 0,
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

const DEFAULT_PRICING_RULES: CompanyServicePricingRules = {
  id: 'company-service-pricing-rules',
  version: 1,
  currency: 'Afl.',
  standardServiceSplit: [
    { btu: 9000, price: 100, durationMinutes: 60, priceType: 'special' },
    { btu: 12000, price: 125, durationMinutes: 60, priceType: 'special' },
    { btu: 18000, price: 135, durationMinutes: 60, priceType: 'special' },
    { btu: 24000, price: 145, durationMinutes: 60, priceType: 'special' },
    { btu: 36000, price: 175, durationMinutes: 60, priceType: 'regular' },
  ],
  deepCleaningSplit: [
    { btu: 9000, price: 195, durationMinutes: 120 },
    { btu: 12000, price: 195, durationMinutes: 120 },
    { btu: 18000, price: 195, durationMinutes: 120 },
    { btu: 24000, price: 195, durationMinutes: 120 },
    { btu: 36000, price: 225, durationMinutes: 120 },
  ],
  standardInstallationAdinaDemac: [
    { btu: 12000, price: 200, durationMinutes: 120, priceType: 'special' },
    { btu: 18000, price: 225, durationMinutes: 120, priceType: 'special' },
    { btu: 24000, price: 250, durationMinutes: 120, priceType: 'special' },
    { btu: 36000, price: 300, durationMinutes: 180, priceType: 'special' },
  ],
};

const REQUIRED_PRESETS: AppointmentWorkPreset[] = [
  { id: 'standard_service', label: 'Servicio estándar', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: 10 },
  { id: 'deep_cleaning', label: 'Servicio deep cleaning', durationMinutesPerUnit: 120, kind: 'service', active: true, sortOrder: 20 },
  { id: 'standard_installation', label: 'Instalación estándar', durationMinutesPerUnit: 120, kind: 'installation', active: true, sortOrder: 30 },
  { id: 'special_installation', label: 'Instalación especial', durationMinutesPerUnit: 180, kind: 'installation', active: true, sortOrder: 40 },
  { id: 'repair_diagnostic', label: 'Diagnóstico / reparación', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: 50 },
];

function numericValue(value: string, fallback: number, minimum = 0, maximum = 999) {
  if (!value.trim()) return fallback;
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

function mergeOperationalRules(value?: Partial<CompanyOperationalRules>): CompanyOperationalRules {
  return {
    ...DEFAULT_OPERATIONAL_RULES,
    ...value,
    id: 'company-operational-rules',
    standardService: {
      ...DEFAULT_OPERATIONAL_RULES.standardService,
      ...(value?.standardService ?? {}),
      differentPropertyDailyCapacity: 6,
      morningDifferentPropertyStops: 3,
      afternoonDifferentPropertyStops: 3,
    },
    routing: DEFAULT_OPERATIONAL_RULES.routing,
    customerCommunication: DEFAULT_OPERATIONAL_RULES.customerCommunication,
  };
}

function mergeRows(saved: PricingRow[] | undefined, defaults: PricingRow[]) {
  const savedByBtu = new Map((saved ?? []).map((row) => [Number(row.btu), row]));
  return defaults.map((fallback) => ({ ...fallback, ...(savedByBtu.get(fallback.btu) ?? {}), btu: fallback.btu }));
}

function mergePricingRules(value?: Partial<CompanyServicePricingRules>): CompanyServicePricingRules {
  return {
    ...DEFAULT_PRICING_RULES,
    ...value,
    id: 'company-service-pricing-rules',
    currency: 'Afl.',
    standardServiceSplit: mergeRows(value?.standardServiceSplit, DEFAULT_PRICING_RULES.standardServiceSplit),
    deepCleaningSplit: mergeRows(value?.deepCleaningSplit, DEFAULT_PRICING_RULES.deepCleaningSplit),
    standardInstallationAdinaDemac: mergeRows(value?.standardInstallationAdinaDemac, DEFAULT_PRICING_RULES.standardInstallationAdinaDemac),
  };
}

function operationalDraft(rules: CompanyOperationalRules): NumericDraft {
  return {
    singlePropertyMainVanMaxUnits: String(rules.standardService.singlePropertyMainVanMaxUnits),
    automaticSupportFromUnits: String(rules.standardService.automaticSupportFromUnits),
    automaticSupportMaxUnits: String(rules.standardService.automaticSupportMaxUnits),
    supportHalfDayMaxUnits: String(rules.standardService.supportHalfDayMaxUnits),
  };
}

function matrixDraft(rules: CompanyServicePricingRules): MatrixDraft {
  const result: MatrixDraft = {};
  const add = (key: string, rows: PricingRow[]) => rows.forEach((row) => {
    result[`${key}-${row.btu}`] = { price: String(row.price), durationMinutes: String(row.durationMinutes) };
  });
  add('standard', rules.standardServiceSplit);
  add('deep', rules.deepCleaningSplit);
  add('install', rules.standardInstallationAdinaDemac);
  return result;
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
  const [draft, setDraft] = useState<NumericDraft>(operationalDraft(DEFAULT_OPERATIONAL_RULES));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      if (currentUser?.authProvider !== 'firebase') {
        setRules(DEFAULT_OPERATIONAL_RULES);
        setDraft(operationalDraft(DEFAULT_OPERATIONAL_RULES));
        return;
      }
      const settings = await listFirestoreCollection<CompanyOperationalRules>('businessSettings');
      const next = mergeOperationalRules(settings.find((item) => item.id === 'company-operational-rules'));
      setRules(next);
      setDraft(operationalDraft(next));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [currentUser?.id]);

  async function save() {
    const mainMax = numericValue(draft.singlePropertyMainVanMaxUnits, 7, 1, 20);
    const supportFrom = numericValue(draft.automaticSupportFromUnits, mainMax + 1, 2, 100);
    const autoMax = numericValue(draft.automaticSupportMaxUnits, 0, 0, 500);
    const halfDayMax = numericValue(draft.supportHalfDayMaxUnits, 3, 1, 6);
    if (supportFrom <= mainMax) return setError('La ayuda automática debe comenzar después del máximo de la van principal.');
    if (autoMax > 0 && autoMax < supportFrom) return setError('El máximo automático debe ser 0 (sin límite fijo) o ser mayor que el inicio de apoyo.');

    const normalized: CompanyOperationalRules = {
      ...rules,
      version: 2,
      standardService: {
        differentPropertyDailyCapacity: 6,
        morningDifferentPropertyStops: 3,
        afternoonDifferentPropertyStops: 3,
        singlePropertyMainVanMaxUnits: mainMax,
        automaticSupportFromUnits: supportFrom,
        automaticSupportMaxUnits: autoMax,
        supportHalfDayMaxUnits: halfDayMax,
      },
      routing: DEFAULT_OPERATIONAL_RULES.routing,
      customerCommunication: DEFAULT_OPERATIONAL_RULES.customerCommunication,
      updatedAt: new Date().toISOString(),
    };

    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (currentUser?.authProvider === 'firebase') await saveFirestoreDocument('businessSettings', normalized);
      setRules(normalized);
      setDraft(operationalDraft(normalized));
      setMessage('Las reglas operativas quedaron guardadas. La agenda y el Copilot utilizarán estos valores.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  const setValue = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value.replace(/[^0-9]/g, '') }));

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle title="Reglas operativas de DEMAC" subtitle="La estructura de 3 cupos en la mañana + 3 en la tarde permanece protegida. Aquí puedes ajustar la capacidad para un solo cliente y el uso de apoyo." action={<Button compact variant="secondary" label={loading ? 'Cargando…' : 'Actualizar'} disabled={loading} onPress={() => void refresh()} />} />
      {message ? <View style={styles.success}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

      <Card>
        <SectionTitle title="Capacidad — servicio estándar de split units" subtitle="Estas reglas aplican cuando todos los aires pertenecen al mismo cliente y el trabajo inicia a las 8:30 a. m." />
        <View style={styles.scenarioBox}><Text style={styles.scenarioTitle}>Capacidad diaria protegida</Text><Text style={styles.scenarioText}>Para direcciones distintas, una van mantiene 6 cupos: 3 en la mañana y 3 en la tarde. Esta estructura depende de los horarios y de la ruta.</Text></View>
        <View style={styles.fieldGrid}>
          <TextNumberField label="Máximo por van en una sola propiedad" value={draft.singlePropertyMainVanMaxUnits} onChange={(value) => setValue('singlePropertyMainVanMaxUnits', value)} help="Regla actual: 7 aires por van si empieza a las 8:30 a. m." />
          <TextNumberField label="Desde cuántos aires se activa apoyo" value={draft.automaticSupportFromUnits} onChange={(value) => setValue('automaticSupportFromUnits', value)} help="Normalmente empieza desde 8 aires." />
          <TextNumberField label="Máximo automático con apoyo" value={draft.automaticSupportMaxUnits} onChange={(value) => setValue('automaticSupportMaxUnits', value)} help="Escribe 0 para no tener un límite fijo. El límite real será la cantidad de vans con personal y agenda disponibles." />
          <TextNumberField label="Máximo de apoyo en media jornada" value={draft.supportHalfDayMaxUnits} onChange={(value) => setValue('supportHalfDayMaxUnits', value)} help="Hasta 3 aires pueden entrar como apoyo de mañana o tarde; 4–7 requieren la jornada completa de esa van." />
        </View>
        <View style={styles.actions}><Button label={saving ? 'Guardando…' : 'Guardar reglas operativas'} disabled={saving} onPress={() => void save()} /></View>
      </Card>

      <Card>
        <SectionTitle title="Ejemplos de distribución automática" />
        <View style={styles.scenarioBox}><Text style={styles.scenarioTitle}>10 aires</Text><Text style={styles.scenarioText}>Van principal: 7 aires desde las 8:30 a. m. + una van de apoyo para 3 aires en la mañana o tarde, según ruta y disponibilidad.</Text></View>
        <View style={styles.scenarioBox}><Text style={styles.scenarioTitle}>14 aires</Text><Text style={styles.scenarioText}>Dos vans desde las 8:30 a. m., 7 aires por van. El cliente solo recibe una cita y una confirmación.</Text></View>
        <View style={styles.scenarioBox}><Text style={styles.scenarioTitle}>Más de 14 aires</Text><Text style={styles.scenarioText}>Si el máximo automático está en 0, el ERP calcula cuántas vans necesita en grupos de hasta 7 y solo ofrece la cita si realmente existen vans, personal y capacidad de ruta.</Text></View>
      </Card>

      <Card>
        <SectionTitle title="Reglas protegidas programadas" subtitle="Estas reglas no se editan como un precio porque afectan la seguridad y la consistencia de la agenda." />
        <ProtectedRule title="Ancla de ruta de la mañana" text="La primera cita de las 8:30 a. m. define el sector principal de las siguientes citas de la mañana." />
        <ProtectedRule title="Ancla de ruta de la tarde" text="La primera cita de la 1:30 p. m. define el sector de la tarde y la ruta debe avanzar progresivamente hacia la oficina en Santa Cruz." />
        <ProtectedRule title="Asignación real de personal" text="Una van necesita un conductor autorizado. Un trabajador no puede estar asignado a dos vans el mismo día." />
        <ProtectedRule title="Pregunta actual primero" text="El Copilot debe responder primero lo último que el cliente dijo o preguntó. La memoria solo conserva datos; no decide la intención actual." />
        <ProtectedRule title="Privacidad operativa" text="El cliente no necesita conocer cuántas vans participan. Las órdenes de apoyo son internas y no generan mensajes duplicados." />
      </Card>
    </ScrollView>
  );
}

function TextNumberField({ label, value, onChange, help }: { label: string; value: string; onChange: (value: string) => void; help: string }) {
  return <View style={styles.fieldCard}><Input label={label} value={value} onChangeText={onChange} keyboardType="numeric" /><Text style={styles.help}>{help}</Text></View>;
}

function ProtectedRule({ title, text }: { title: string; text: string }) {
  return <View style={styles.protectedRule}><View style={styles.lockBadge}><Text style={styles.lockBadgeText}>PROTEGIDA</Text></View><View style={{ flex: 1 }}><Text style={styles.protectedTitle}>{title}</Text><Text style={styles.protectedText}>{text}</Text></View></View>;
}

function ServiceRulesSection() {
  const { currentUser } = useAppState();
  const { appointmentWorkPresets, saveAppointmentWorkPresets } = useCalendarState();
  const [rules, setRules] = useState(DEFAULT_PRICING_RULES);
  const [draft, setDraft] = useState<MatrixDraft>(matrixDraft(DEFAULT_PRICING_RULES));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      if (currentUser?.authProvider !== 'firebase') {
        setRules(DEFAULT_PRICING_RULES);
        setDraft(matrixDraft(DEFAULT_PRICING_RULES));
        return;
      }
      const settings = await listFirestoreCollection<CompanyServicePricingRules>('businessSettings');
      const next = mergePricingRules(settings.find((item) => item.id === 'company-service-pricing-rules'));
      setRules(next);
      setDraft(matrixDraft(next));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [currentUser?.id]);

  const updateDraft = (group: string, btu: number, field: 'price' | 'durationMinutes', value: string) => {
    const key = `${group}-${btu}`;
    setDraft((current) => ({ ...current, [key]: { ...(current[key] ?? { price: '', durationMinutes: '' }), [field]: value.replace(/[^0-9.]/g, '') } }));
  };

  function normalizedRows(group: string, rows: PricingRow[]) {
    return rows.map((row) => {
      const value = draft[`${group}-${row.btu}`];
      return {
        ...row,
        price: numericValue(value?.price ?? '', row.price, 0, 10000),
        durationMinutes: numericValue(value?.durationMinutes ?? '', row.durationMinutes, 30, 600),
      };
    });
  }

  async function save() {
    const normalized: CompanyServicePricingRules = {
      ...rules,
      version: 1,
      standardServiceSplit: normalizedRows('standard', rules.standardServiceSplit),
      deepCleaningSplit: normalizedRows('deep', rules.deepCleaningSplit),
      standardInstallationAdinaDemac: normalizedRows('install', rules.standardInstallationAdinaDemac),
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    setMessage('');
    setError('');
    try {
      if (currentUser?.authProvider === 'firebase') await saveFirestoreDocument('businessSettings', normalized);

      const presetDuration = new Map<string, number>([
        ['standard_service', normalized.standardServiceSplit[0]?.durationMinutes ?? 60],
        ['deep_cleaning', normalized.deepCleaningSplit[0]?.durationMinutes ?? 120],
        ['standard_installation', normalized.standardInstallationAdinaDemac.find((row) => row.btu === 12000)?.durationMinutes ?? 120],
      ]);
      const nextPresets = REQUIRED_PRESETS.map((fallback) => {
        const existing = appointmentWorkPresets.find((item) => item.id === fallback.id) ?? fallback;
        return { ...existing, durationMinutesPerUnit: presetDuration.get(existing.id) ?? existing.durationMinutesPerUnit, active: true };
      }).sort((a, b) => a.sortOrder - b.sortOrder);
      const presetResult = await saveAppointmentWorkPresets(nextPresets);
      if (!presetResult.ok) throw new Error(presetResult.message ?? 'No se pudieron sincronizar las duraciones de agenda.');

      setRules(normalized);
      setDraft(matrixDraft(normalized));
      setMessage('Precios y duraciones guardados. El Copilot y la agenda ya usarán esta matriz como fuente de verdad.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle title="Servicios, duración y precios" subtitle="Esta matriz es la fuente de verdad para respuestas del Copilot. Los valores pueden cambiarse aquí sin reprogramar la extensión." action={<Button compact variant="secondary" label={loading ? 'Cargando…' : 'Actualizar'} disabled={loading} onPress={() => void refresh()} />} />
      {message ? <View style={styles.success}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

      <PriceMatrixCard title="Servicio estándar — split units" subtitle="Duración normal: 1 hora por aire. 9k–24k son precios especiales; 36k es precio regular." group="standard" rows={rules.standardServiceSplit} draft={draft} onChange={updateDraft} />
      <PriceMatrixCard title="Deep cleaning — split units" subtitle="Precio fijo Afl. 195 hasta 24,000 BTU y Afl. 225 para 36,000 BTU. La duración queda editable." group="deep" rows={rules.deepCleaningSplit} draft={draft} onChange={updateDraft} />
      <PriceMatrixCard title="Instalación estándar — Adina comprado con DEMAC" subtitle="Estos precios especiales aplican cuando el cliente compra el equipo Adina con DEMAC. 12k/18k/24k reservan 2 horas; 36k reserva 3 horas." group="install" rows={rules.standardInstallationAdinaDemac} draft={draft} onChange={updateDraft} />

      <Card><View style={styles.actions}><Button label={saving ? 'Guardando…' : 'Guardar todos los precios y duraciones'} disabled={saving} onPress={() => void save()} /></View></Card>
    </ScrollView>
  );
}

function PriceMatrixCard({ title, subtitle, group, rows, draft, onChange }: { title: string; subtitle: string; group: string; rows: PricingRow[]; draft: MatrixDraft; onChange: (group: string, btu: number, field: 'price' | 'durationMinutes', value: string) => void }) {
  return (
    <Card>
      <SectionTitle title={title} subtitle={subtitle} />
      <View style={styles.matrixHeader}><Text style={styles.matrixBtu}>BTU</Text><Text style={styles.matrixColumn}>Precio Afl.</Text><Text style={styles.matrixColumn}>Minutos</Text><Text style={styles.matrixType}>Tipo</Text></View>
      {rows.map((row) => {
        const value = draft[`${group}-${row.btu}`] ?? { price: String(row.price), durationMinutes: String(row.durationMinutes) };
        return (
          <View key={row.btu} style={styles.matrixRow}>
            <Text style={styles.matrixBtu}>{row.btu.toLocaleString('en-US')}</Text>
            <View style={styles.matrixColumn}><Input value={value.price} onChangeText={(text) => onChange(group, row.btu, 'price', text)} keyboardType="decimal-pad" /></View>
            <View style={styles.matrixColumn}><Input value={value.durationMinutes} onChangeText={(text) => onChange(group, row.btu, 'durationMinutes', text)} keyboardType="numeric" /></View>
            <Text style={styles.matrixType}>{row.priceType === 'special' ? 'Especial' : row.priceType === 'regular' ? 'Regular' : 'Fijo'}</Text>
          </View>
        );
      })}
    </Card>
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
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  scenarioBox: { backgroundColor: colors.infoLight, borderRadius: 10, padding: 12, marginBottom: 10 },
  scenarioTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 11 },
  scenarioText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 4 },
  protectedRule: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  lockBadge: { backgroundColor: '#EEF0F2', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  lockBadgeText: { color: colors.muted, fontSize: 8, fontWeight: '900' },
  protectedTitle: { color: colors.text, fontWeight: '900', fontSize: 11 },
  protectedText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  matrixHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  matrixRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  matrixBtu: { width: 90, color: colors.text, fontWeight: '900', fontSize: 11 },
  matrixColumn: { width: 150, color: colors.muted, fontWeight: '800', fontSize: 10 },
  matrixType: { flex: 1, minWidth: 70, color: colors.muted, fontWeight: '800', fontSize: 10 },
});
