import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, Input, SectionTitle } from '../components/UI';
import { deleteFirestoreDocument, listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';

export type WhatsAppKnowledgeRule = {
  id: string;
  title: string;
  intent: string;
  source: 'manual' | 'erp_duration' | 'erp_service_description' | 'erp_service_price';
  triggerPhrases: string[];
  answerEs?: string;
  answerEn?: string;
  answerPapAw?: string;
  active: boolean;
  priority: number;
  requiresHuman?: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

const SOURCES: Array<{ value: WhatsAppKnowledgeRule['source']; label: string; help: string }> = [
  { value: 'manual', label: 'Respuesta aprobada', help: 'Usa exactamente el texto aprobado en español, inglés o Papiamento.' },
  { value: 'erp_duration', label: 'Duración del ERP', help: 'Calcula la duración con los trabajos predeterminados, cantidad de aires y capacidad.' },
  { value: 'erp_service_description', label: 'Descripción del servicio', help: 'Lee la descripción para clientes guardada en el catálogo de servicios.' },
  { value: 'erp_service_price', label: 'Precio del servicio', help: 'Lee el precio vigente guardado en el catálogo de servicios.' },
];

const INITIAL_RULES: WhatsAppKnowledgeRule[] = [
  {
    id: 'duration',
    title: 'Duración del trabajo',
    intent: 'duration',
    source: 'erp_duration',
    triggerPhrases: ['cuánto tiempo dura', 'cuanto durará el servicio', 'how long does the service take', 'cuanto tempo e servicio ta dura'],
    active: true,
    priority: 100,
  },
  {
    id: 'service-price',
    title: 'Precio del servicio',
    intent: 'price',
    source: 'erp_service_price',
    triggerPhrases: ['cuánto cuesta', 'cuál es el precio', 'how much does it cost', 'cuanto e servicio ta costa'],
    active: true,
    priority: 90,
  },
  {
    id: 'service-includes',
    title: 'Qué incluye el servicio',
    intent: 'service_includes',
    source: 'erp_service_description',
    triggerPhrases: ['qué incluye el servicio', 'qué van a hacer', 'what is included', 'kiko e servicio ta inclui'],
    active: true,
    priority: 90,
  },
  {
    id: 'warranty',
    title: 'Garantía',
    intent: 'warranty',
    source: 'manual',
    triggerPhrases: ['qué garantía tiene', 'cuánto dura la garantía', 'warranty'],
    answerEs: '',
    answerEn: '',
    answerPapAw: '',
    active: false,
    priority: 80,
  },
  {
    id: 'payment-methods',
    title: 'Métodos de pago',
    intent: 'payment',
    source: 'manual',
    triggerPhrases: ['cómo puedo pagar', 'aceptan transferencia', 'payment methods', 'con mi por paga'],
    answerEs: '',
    answerEn: '',
    answerPapAw: '',
    active: false,
    priority: 80,
  },
  {
    id: 'cancellation-reschedule',
    title: 'Cancelación y reprogramación',
    intent: 'cancellation_reschedule',
    source: 'manual',
    triggerPhrases: ['quiero cancelar', 'quiero reprogramar', 'cambiar la cita', 'cancel or reschedule'],
    answerEs: '',
    answerEn: '',
    answerPapAw: '',
    active: false,
    priority: 80,
  },
];

function newRule(): WhatsAppKnowledgeRule {
  return {
    id: `rule-${Date.now()}`,
    title: '',
    intent: 'general_question',
    source: 'manual',
    triggerPhrases: [],
    answerEs: '',
    answerEn: '',
    answerPapAw: '',
    active: true,
    priority: 50,
    requiresHuman: false,
  };
}

function sourceLabel(source: WhatsAppKnowledgeRule['source']) {
  return SOURCES.find((item) => item.value === source)?.label ?? source;
}

export function WhatsAppKnowledgeScreen() {
  const { currentUser } = useAppState();
  const [rules, setRules] = useState<WhatsAppKnowledgeRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<WhatsAppKnowledgeRule | null>(null);
  const [triggerText, setTriggerText] = useState('');

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => Number(b.active) - Number(a.active) || b.priority - a.priority || a.title.localeCompare(b.title)),
    [rules],
  );

  async function refresh() {
    if (currentUser?.authProvider !== 'firebase') {
      setRules(INITIAL_RULES);
      setMessage('Modo demostración: las reglas no se guardarán en Firebase.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRules(await listFirestoreCollection<WhatsAppKnowledgeRule>('whatsappKnowledgeRules'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [currentUser?.id]);

  function openRule(rule: WhatsAppKnowledgeRule) {
    setEditor({ ...rule, triggerPhrases: [...(rule.triggerPhrases ?? [])] });
    setTriggerText((rule.triggerPhrases ?? []).join('\n'));
    setMessage('');
    setError('');
  }

  async function seedRules() {
    if (currentUser?.authProvider !== 'firebase') {
      setRules(INITIAL_RULES);
      setMessage('Reglas iniciales cargadas en modo demostración.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (const rule of INITIAL_RULES) {
        await saveFirestoreDocument('whatsappKnowledgeRules', {
          ...rule,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      await refresh();
      setMessage('La base inicial de reglas fue creada. Completa las respuestas manuales antes de activarlas.');
    } catch (seedError) {
      setError(seedError instanceof Error ? seedError.message : String(seedError));
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    if (!editor) return;
    if (!editor.title.trim()) return setError('Escribe un nombre para la regla.');
    if (!editor.intent.trim()) return setError('Escribe la intención de la regla.');
    const normalized: WhatsAppKnowledgeRule = {
      ...editor,
      title: editor.title.trim(),
      intent: editor.intent.trim(),
      triggerPhrases: triggerText.split('\n').map((item) => item.trim()).filter(Boolean),
      priority: Number.isFinite(Number(editor.priority)) ? Number(editor.priority) : 50,
      createdAt: editor.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (normalized.source === 'manual' && normalized.active && !normalized.answerEs?.trim()) {
      return setError('Una regla manual activa necesita, como mínimo, una respuesta aprobada en español.');
    }

    setSaving(true);
    setError('');
    try {
      if (currentUser?.authProvider === 'firebase') await saveFirestoreDocument('whatsappKnowledgeRules', normalized);
      setRules((previous) => [...previous.filter((item) => item.id !== normalized.id), normalized]);
      setEditor(null);
      setMessage('Regla guardada. La extensión utilizará esta versión desde el ERP.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(rule: WhatsAppKnowledgeRule) {
    setSaving(true);
    setError('');
    try {
      if (currentUser?.authProvider === 'firebase') await deleteFirestoreDocument('whatsappKnowledgeRules', rule.id);
      setRules((previous) => previous.filter((item) => item.id !== rule.id));
      setEditor(null);
      setMessage('Regla eliminada.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle
        title="Base de conocimiento del WhatsApp Copilot"
        subtitle="Fuente única de reglas y respuestas aprobadas. La IA clasifica la pregunta, pero nunca inventa la respuesta."
        action={<Button label="Nueva regla" icon="＋" onPress={() => openRule(newRule())} />}
      />

      {message ? <View style={styles.success}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

      <Card>
        <SectionTitle title="Cómo funciona" />
        <View style={styles.steps}>
          <Text style={styles.step}>1. La extensión lee únicamente el último turno del cliente y la memoria confirmada.</Text>
          <Text style={styles.step}>2. La IA selecciona una regla aprobada o devuelve la conversación a Agenda.</Text>
          <Text style={styles.step}>3. La respuesta sale del ERP: duración, precio, descripción o texto aprobado.</Text>
          <Text style={styles.step}>4. Cuando no existe una regla, se solicita revisión humana en vez de inventar información.</Text>
        </View>
        {!rules.length ? <Button label={saving ? 'Creando…' : 'Crear reglas iniciales'} disabled={saving} onPress={() => void seedRules()} /> : null}
      </Card>

      <Card>
        <SectionTitle title={`Reglas configuradas (${rules.length})`} subtitle="Las reglas inactivas no se utilizan hasta que sus respuestas sean aprobadas." action={<Button compact variant="secondary" label={loading ? 'Cargando…' : 'Actualizar'} disabled={loading} onPress={() => void refresh()} />} />
        {sortedRules.length ? sortedRules.map((rule) => (
          <View key={rule.id} style={styles.ruleRow}>
            <View style={[styles.statusDot, rule.active ? styles.statusActive : styles.statusInactive]} />
            <View style={styles.ruleBody}>
              <View style={styles.ruleTitleRow}>
                <Text style={styles.ruleTitle}>{rule.title}</Text>
                <Text style={styles.intent}>{rule.intent}</Text>
              </View>
              <Text style={styles.ruleMeta}>{sourceLabel(rule.source)} · prioridad {rule.priority} · {(rule.triggerPhrases ?? []).length} frases de ejemplo</Text>
              {rule.source === 'manual' && !rule.answerEs?.trim() ? <Text style={styles.pending}>Falta respuesta aprobada en español.</Text> : null}
            </View>
            <Button compact variant="secondary" label="Editar" onPress={() => openRule(rule)} />
          </View>
        )) : <Text style={styles.empty}>No existen reglas todavía. Crea las reglas iniciales para comenzar.</Text>}
      </Card>

      <AppModal visible={!!editor} title={editor?.title || 'Nueva regla'} onClose={() => { if (!saving) setEditor(null); }}>
        {editor ? (
          <View style={styles.modalContent}>
            <Input label="Nombre interno" value={editor.title} onChangeText={(title) => setEditor({ ...editor, title })} placeholder="Ej. Métodos de pago" />
            <Input label="Intención" value={editor.intent} onChangeText={(intent) => setEditor({ ...editor, intent })} placeholder="Ej. payment" />
            <Input label="Prioridad" value={String(editor.priority)} onChangeText={(value) => setEditor({ ...editor, priority: Number(value.replace(/[^0-9]/g, '')) || 0 })} keyboardType="numeric" />

            <Text style={styles.label}>Fuente de la respuesta</Text>
            <View style={styles.sourceGrid}>{SOURCES.map((source) => (
              <Pressable key={source.value} onPress={() => setEditor({ ...editor, source: source.value })} style={[styles.sourceCard, editor.source === source.value && styles.sourceCardActive]}>
                <Text style={[styles.sourceTitle, editor.source === source.value && styles.sourceTitleActive]}>{source.label}</Text>
                <Text style={styles.sourceHelp}>{source.help}</Text>
              </Pressable>
            ))}</View>

            <Input label="Frases y preguntas de ejemplo (una por línea)" value={triggerText} onChangeText={setTriggerText} multiline placeholder={'¿Cuánto tiempo dura?\n¿Cuál es el precio?'} />

            {editor.source === 'manual' ? (
              <View style={styles.answers}>
                <Input label="Respuesta aprobada — Español" value={editor.answerEs ?? ''} onChangeText={(answerEs) => setEditor({ ...editor, answerEs })} multiline />
                <Input label="Approved answer — English" value={editor.answerEn ?? ''} onChangeText={(answerEn) => setEditor({ ...editor, answerEn })} multiline />
                <Input label="Contesta aproba — Papiamento Aruba" value={editor.answerPapAw ?? ''} onChangeText={(answerPapAw) => setEditor({ ...editor, answerPapAw })} multiline />
              </View>
            ) : null}

            <View style={styles.toggleRow}>
              <Pressable onPress={() => setEditor({ ...editor, active: !editor.active })} style={[styles.toggle, editor.active && styles.toggleActive]}>
                <Text style={[styles.toggleText, editor.active && styles.toggleTextActive]}>{editor.active ? 'Regla activa' : 'Regla inactiva'}</Text>
              </Pressable>
              <Pressable onPress={() => setEditor({ ...editor, requiresHuman: !editor.requiresHuman })} style={[styles.toggle, editor.requiresHuman && styles.toggleWarning]}>
                <Text style={styles.toggleText}>{editor.requiresHuman ? 'Requiere aprobación humana' : 'No requiere aprobación humana'}</Text>
              </Pressable>
            </View>

            <Input label="Notas internas" value={editor.notes ?? ''} onChangeText={(notes) => setEditor({ ...editor, notes })} multiline />
            <View style={styles.actions}>
              {rules.some((item) => item.id === editor.id) ? <Button variant="danger" label="Eliminar" disabled={saving} onPress={() => void removeRule(editor)} /> : null}
              <Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setEditor(null)} />
              <Button label={saving ? 'Guardando…' : 'Guardar regla'} disabled={saving} onPress={() => void saveRule()} />
            </View>
          </View>
        ) : null}
      </AppModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 100 },
  success: { backgroundColor: colors.successLight, borderRadius: 10, padding: 12 },
  successText: { color: colors.success, fontSize: 11, fontWeight: '800' },
  error: { backgroundColor: colors.dangerLight, borderRadius: 10, padding: 12 },
  errorText: { color: colors.danger, fontSize: 11, fontWeight: '800' },
  steps: { gap: 7, marginBottom: 14 },
  step: { color: colors.text, fontSize: 11, lineHeight: 17 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusActive: { backgroundColor: colors.success },
  statusInactive: { backgroundColor: colors.muted },
  ruleBody: { flex: 1 },
  ruleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  ruleTitle: { color: colors.text, fontSize: 12, fontWeight: '900' },
  intent: { color: colors.primaryDark, backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, fontSize: 9, fontWeight: '900' },
  ruleMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  pending: { color: colors.danger, fontSize: 9, fontWeight: '800', marginTop: 4 },
  empty: { color: colors.muted, fontSize: 11, paddingVertical: 16 },
  modalContent: { gap: 14 },
  label: { color: colors.text, fontSize: 11, fontWeight: '900' },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sourceCard: { width: '48.5%', borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, backgroundColor: '#FFFFFF' },
  sourceCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  sourceTitle: { color: colors.text, fontSize: 10, fontWeight: '900' },
  sourceTitleActive: { color: colors.primaryDark },
  sourceHelp: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 4 },
  answers: { gap: 12 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggle: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#F8F9FA' },
  toggleActive: { borderColor: colors.success, backgroundColor: colors.successLight },
  toggleWarning: { borderColor: '#D7A43A', backgroundColor: '#FFF6DD' },
  toggleText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  toggleTextActive: { color: colors.success },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 4 },
});
