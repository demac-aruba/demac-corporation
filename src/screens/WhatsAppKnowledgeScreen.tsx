import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input, SectionTitle } from '../components/UI';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';

type PolicyTopic = 'warranty' | 'payments' | 'cancellation_reschedule' | 'maintenance' | 'service_area' | 'emergency';

type CustomerPolicy = {
  active: boolean;
  textEs: string;
  textEn: string;
  textPapAw: string;
  requiresHumanForExceptions: boolean;
};

type CustomerPolicySettings = {
  id: 'company-customer-policies';
  version: number;
  policies: Record<PolicyTopic, CustomerPolicy>;
  updatedAt?: string;
  updatedByUserId?: string;
  updatedByName?: string;
};

type PolicyDefinition = {
  topic: PolicyTopic;
  title: string;
  description: string;
};

const POLICY_DEFINITIONS: PolicyDefinition[] = [
  { topic: 'warranty', title: 'Garantía', description: 'Condiciones generales de garantía que sí pueden comunicarse automáticamente al cliente.' },
  { topic: 'payments', title: 'Pagos', description: 'Métodos y condiciones generales de pago aprobadas para atención al cliente.' },
  { topic: 'cancellation_reschedule', title: 'Cancelación y reprogramación', description: 'Reglas generales para cancelar o mover una cita existente.' },
  { topic: 'maintenance', title: 'Mantenimiento', description: 'Política general de mantenimiento, frecuencia o requisitos que DEMAC desea comunicar.' },
  { topic: 'service_area', title: 'Área de servicio', description: 'Cobertura geográfica general para servicios de DEMAC.' },
  { topic: 'emergency', title: 'Emergencias', description: 'Política general para solicitudes urgentes o fuera del horario regular.' },
];

function emptyPolicy(): CustomerPolicy {
  return {
    active: false,
    textEs: '',
    textEn: '',
    textPapAw: '',
    requiresHumanForExceptions: true,
  };
}

function emptySettings(): CustomerPolicySettings {
  return {
    id: 'company-customer-policies',
    version: 1,
    policies: Object.fromEntries(POLICY_DEFINITIONS.map(({ topic }) => [topic, emptyPolicy()])) as Record<PolicyTopic, CustomerPolicy>,
  };
}

function normalizePolicy(value?: Partial<CustomerPolicy>): CustomerPolicy {
  return {
    active: value?.active === true,
    textEs: String(value?.textEs ?? ''),
    textEn: String(value?.textEn ?? ''),
    textPapAw: String(value?.textPapAw ?? ''),
    requiresHumanForExceptions: value?.requiresHumanForExceptions !== false,
  };
}

function normalizeSettings(value?: Partial<CustomerPolicySettings>): CustomerPolicySettings {
  const base = emptySettings();
  const policies = Object.fromEntries(POLICY_DEFINITIONS.map(({ topic }) => [
    topic,
    normalizePolicy(value?.policies?.[topic]),
  ])) as Record<PolicyTopic, CustomerPolicy>;
  return {
    ...base,
    ...value,
    id: 'company-customer-policies',
    version: Math.max(1, Number(value?.version || 1)),
    policies,
  };
}

function hasAnyApprovedText(policy: CustomerPolicy) {
  return Boolean(policy.textEs.trim() || policy.textEn.trim() || policy.textPapAw.trim());
}

export function WhatsAppKnowledgeScreen() {
  const { currentUser } = useAppState();
  const [settings, setSettings] = useState<CustomerPolicySettings>(emptySettings());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCount = useMemo(
    () => POLICY_DEFINITIONS.filter(({ topic }) => settings.policies[topic].active).length,
    [settings],
  );

  async function refresh() {
    setLoading(true);
    setMessage('');
    setError('');
    try {
      if (currentUser?.authProvider !== 'firebase') {
        setSettings(emptySettings());
        setMessage('Modo demostración: las políticas se muestran vacías y no se guardan en Firebase.');
        return;
      }
      const documents = await listFirestoreCollection<CustomerPolicySettings>('businessSettings');
      setSettings(normalizeSettings(documents.find((item) => item.id === 'company-customer-policies')));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [currentUser?.id]);

  function patchPolicy(topic: PolicyTopic, patch: Partial<CustomerPolicy>) {
    setSettings((current) => ({
      ...current,
      policies: {
        ...current.policies,
        [topic]: { ...current.policies[topic], ...patch },
      },
    }));
    setMessage('');
    setError('');
  }

  async function save() {
    const invalidActive = POLICY_DEFINITIONS.find(({ topic }) => {
      const policy = settings.policies[topic];
      return policy.active && !hasAnyApprovedText(policy);
    });
    if (invalidActive) {
      setError(`La política “${invalidActive.title}” está activa pero no tiene ningún texto aprobado.`);
      return;
    }

    const normalized: CustomerPolicySettings = {
      ...normalizeSettings(settings),
      version: Math.max(1, Number(settings.version || 1)),
      updatedAt: new Date().toISOString(),
      updatedByUserId: currentUser?.id ?? '',
      updatedByName: currentUser?.name ?? 'Usuario DEMAC',
    };

    setSaving(true);
    setMessage('');
    setError('');
    try {
      if (currentUser?.authProvider === 'firebase') {
        await saveFirestoreDocument('businessSettings', normalized);
      }
      setSettings(normalized);
      setMessage(currentUser?.authProvider === 'firebase'
        ? 'Políticas guardadas. El Customer Sales & Booking Agent consultará esta versión desde el ERP.'
        : 'Cambios aplicados solamente en modo demostración.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle
        title="Políticas para clientes"
        subtitle="Fuente estructurada de políticas aprobadas para el Customer Sales & Booking Agent. La IA decide semánticamente qué tema consultar; no existen frases gatillo, prioridades ni respuestas hardcodeadas."
        action={<Button compact variant="secondary" label={loading ? 'Cargando…' : 'Actualizar'} disabled={loading || saving} onPress={() => void refresh()} />}
      />

      {message ? <View style={styles.success}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

      <Card>
        <SectionTitle
          title={`Políticas configuradas · ${activeCount}/${POLICY_DEFINITIONS.length} activas`}
          subtitle="Una política inactiva, vacía o no configurada nunca autoriza al agente a inventar una respuesta. Las excepciones pueden mantenerse bajo revisión humana."
        />
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Regla de seguridad</Text>
          <Text style={styles.infoText}>Activa únicamente información que DEMAC haya aprobado. Los precios de servicios, productos, disponibilidad y citas siguen viniendo de sus herramientas ERP específicas; no se duplican aquí.</Text>
        </View>
      </Card>

      {POLICY_DEFINITIONS.map((definition) => {
        const policy = settings.policies[definition.topic];
        return (
          <Card key={definition.topic}>
            <View style={styles.policyHeader}>
              <View style={styles.policyHeaderText}>
                <Text style={styles.policyTitle}>{definition.title}</Text>
                <Text style={styles.policyDescription}>{definition.description}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => patchPolicy(definition.topic, { active: !policy.active })}
                style={[styles.toggle, policy.active && styles.toggleActive]}
              >
                <Text style={[styles.toggleText, policy.active && styles.toggleTextActive]}>{policy.active ? 'Activa' : 'Inactiva'}</Text>
              </Pressable>
            </View>

            <View style={styles.languageGrid}>
              <Input
                label="Respuesta aprobada — Español"
                value={policy.textEs}
                onChangeText={(textEs) => patchPolicy(definition.topic, { textEs })}
                multiline
                placeholder="Dejar vacío si todavía no existe una respuesta aprobada."
              />
              <Input
                label="Approved answer — English"
                value={policy.textEn}
                onChangeText={(textEn) => patchPolicy(definition.topic, { textEn })}
                multiline
                placeholder="Leave empty until DEMAC approves the wording."
              />
              <Input
                label="Contesta aproba — Papiamento Aruba"
                value={policy.textPapAw}
                onChangeText={(textPapAw) => patchPolicy(definition.topic, { textPapAw })}
                multiline
                placeholder="Laga bashí te ora DEMAC aproba e texto."
              />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => patchPolicy(definition.topic, { requiresHumanForExceptions: !policy.requiresHumanForExceptions })}
              style={[styles.exceptionToggle, policy.requiresHumanForExceptions && styles.exceptionToggleActive]}
            >
              <Text style={styles.exceptionTitle}>{policy.requiresHumanForExceptions ? 'Excepciones requieren una persona' : 'Excepciones no fuerzan handoff'}</Text>
              <Text style={styles.exceptionText}>Recomendado activo para solicitudes que se salgan de la política general, descuentos, disputas o decisiones especiales.</Text>
            </Pressable>
          </Card>
        );
      })}

      <View style={styles.actions}>
        <Button label={saving ? 'Guardando…' : 'Guardar políticas'} disabled={saving || loading} onPress={() => void save()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 100 },
  success: { backgroundColor: colors.successLight, borderRadius: 10, padding: 12 },
  successText: { color: colors.success, fontSize: 12, fontWeight: '800' },
  error: { backgroundColor: colors.dangerLight, borderRadius: 10, padding: 12 },
  errorText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  infoBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 5, backgroundColor: colors.background },
  infoTitle: { color: colors.text, fontWeight: '900', fontSize: 13 },
  infoText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  policyHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 },
  policyHeaderText: { flex: 1, gap: 4 },
  policyTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  policyDescription: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  toggle: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.background },
  toggleActive: { borderColor: colors.success, backgroundColor: colors.successLight },
  toggleText: { color: colors.muted, fontSize: 11, fontWeight: '900' },
  toggleTextActive: { color: colors.success },
  languageGrid: { gap: 12 },
  exceptionToggle: { marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 4, backgroundColor: colors.background },
  exceptionToggleActive: { borderColor: colors.warning },
  exceptionTitle: { color: colors.text, fontSize: 12, fontWeight: '900' },
  exceptionText: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  actions: { alignItems: 'flex-end' },
});
