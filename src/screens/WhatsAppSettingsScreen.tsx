import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Input, Pill, SectionTitle } from '../components/UI';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { colors } from '../theme';

const OFFICIAL_PHONE = '+297 564-2625';
const DEFAULT_PHONE_NUMBER_ID = '1264611476725499';

type WhatsAppSettings = {
  id: 'whatsapp';
  enabled: boolean;
  displayPhoneNumber: string;
  phoneNumberId: string;
  confirmationTemplateName: string;
  appointmentReminderTemplateName: string;
  papiamentoTemplateLanguage: 'en' | 'es' | 'nl';
  graphApiVersion: string;
  connectionStatus?: 'connected' | 'number-mismatch' | 'error' | 'disabled' | string;
  validationMessage?: string;
  verifiedDisplayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  codeVerificationStatus?: string;
  lastValidationError?: string;
  lastValidatedAt?: string;
};

type QueueRecord = {
  id: string;
  to?: string;
  status?: string;
  templateName?: string;
  languageCode?: string;
  notificationType?: string;
  recipientName?: string;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt?: string;
  completedAt?: string;
  failedAt?: string;
};

type WhatsAppMessage = {
  id: string;
  messageId?: string;
  direction?: string;
  displayPhoneNumber?: string;
  phoneNumberId?: string;
  queueId?: string;
  status?: string;
  createdAt?: string;
  receivedAt?: string;
};

type MessageStatus = {
  id: string;
  messageId?: string;
  status?: string;
  receivedAt?: string;
  errors?: unknown;
};

const defaults: WhatsAppSettings = {
  id: 'whatsapp',
  enabled: true,
  displayPhoneNumber: OFFICIAL_PHONE,
  phoneNumberId: DEFAULT_PHONE_NUMBER_ID,
  confirmationTemplateName: 'appointment_confirmation',
  appointmentReminderTemplateName: 'appointment_reminder_24_hours',
  papiamentoTemplateLanguage: 'en',
  graphApiVersion: 'v25.0',
};

function digits(value: string) {
  return value.replace(/\D/g, '');
}

function statusTone(status?: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  if (['connected', 'sent', 'accepted', 'delivered', 'read'].includes(status ?? '')) return 'success';
  if (['failed', 'error', 'number-mismatch'].includes(status ?? '')) return 'danger';
  if (['queued', 'processing'].includes(status ?? '')) return 'warning';
  if (status === 'disabled') return 'neutral';
  return 'info';
}

function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    connected: 'Conectado',
    'number-mismatch': 'Número diferente',
    error: 'Error',
    disabled: 'Desactivado',
    queued: 'En cola',
    processing: 'Procesando',
    sent: 'Enviado a Meta',
    accepted: 'Aceptado',
    delivered: 'Entregado',
    read: 'Leído',
    failed: 'Falló',
  };
  return labels[status ?? ''] ?? status ?? 'Sin estado';
}

function timestamp(value?: string) {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-AW', { timeZone: 'America/Aruba' });
}

function recordTime(record: { createdAt?: string; completedAt?: string; failedAt?: string; receivedAt?: string }) {
  return record.completedAt ?? record.failedAt ?? record.createdAt ?? record.receivedAt ?? '';
}

export function WhatsAppSettingsScreen() {
  const [settings, setSettings] = useState<WhatsAppSettings>(defaults);
  const [testRecipient, setTestRecipient] = useState('');
  const [queues, setQueues] = useState<QueueRecord[]>([]);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [statuses, setStatuses] = useState<MessageStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError('');
    try {
      const [businessSettings, queueItems, messageItems, statusItems] = await Promise.all([
        listFirestoreCollection<WhatsAppSettings>('businessSettings'),
        listFirestoreCollection<QueueRecord>('whatsappOutboundQueue'),
        listFirestoreCollection<WhatsAppMessage>('whatsappMessages'),
        listFirestoreCollection<MessageStatus>('whatsappMessageStatuses'),
      ]);
      const saved = businessSettings.find((item) => item.id === 'whatsapp');
      setSettings({ ...defaults, ...(saved ?? {}), id: 'whatsapp', displayPhoneNumber: OFFICIAL_PHONE });
      setQueues([...queueItems].sort((a, b) => recordTime(b).localeCompare(recordTime(a))).slice(0, 20));
      setMessages([...messageItems].sort((a, b) => recordTime(b).localeCompare(recordTime(a))).slice(0, 100));
      setStatuses([...statusItems].sort((a, b) => recordTime(b).localeCompare(recordTime(a))).slice(0, 200));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const webhookObservedNumber = useMemo(() => messages.find((item) => item.displayPhoneNumber)?.displayPhoneNumber, [messages]);
  const officialDigits = digits(OFFICIAL_PHONE);
  const observedMatches = webhookObservedNumber ? digits(webhookObservedNumber) === officialDigits : undefined;
  const latestStatusByMessageId = useMemo(() => {
    const map = new Map<string, MessageStatus>();
    for (const item of statuses) {
      if (item.messageId && !map.has(item.messageId)) map.set(item.messageId, item);
    }
    return map;
  }, [statuses]);
  const messageByQueueId = useMemo(() => {
    const map = new Map<string, WhatsAppMessage>();
    for (const item of messages) {
      if (item.queueId && !map.has(item.queueId)) map.set(item.queueId, item);
    }
    return map;
  }, [messages]);

  const save = async () => {
    const phoneNumberId = digits(settings.phoneNumberId);
    if (!/^\d{5,30}$/.test(phoneNumberId)) {
      setError('El Phone Number ID de Meta debe contener solamente números.');
      return;
    }
    if (!/^[a-z0-9_]{1,512}$/.test(settings.confirmationTemplateName.trim()) || !/^[a-z0-9_]{1,512}$/.test(settings.appointmentReminderTemplateName.trim())) {
      setError('Los nombres de templates solo pueden contener letras minúsculas, números y guion bajo.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await saveFirestoreDocument('businessSettings', {
        ...settings,
        id: 'whatsapp' as const,
        displayPhoneNumber: OFFICIAL_PHONE,
        phoneNumberId,
        confirmationTemplateName: settings.confirmationTemplateName.trim(),
        appointmentReminderTemplateName: settings.appointmentReminderTemplateName.trim(),
        graphApiVersion: settings.graphApiVersion.trim() || 'v25.0',
        updatedAt: new Date().toISOString(),
      } as WhatsAppSettings & { updatedAt: string });
      setMessage('Configuración guardada. Firebase está validando el número con Meta.');
      globalThis.setTimeout(() => { void load(false); }, 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const to = digits(testRecipient);
    const phoneNumberId = digits(settings.phoneNumberId);
    if (!/^\d{8,15}$/.test(to)) {
      setError('Escribe el número de prueba con código de país. Ejemplo: 297XXXXXXXX.');
      return;
    }
    if (!settings.enabled) {
      setError('Activa WhatsApp antes de enviar una prueba.');
      return;
    }
    if (!/^\d{5,30}$/.test(phoneNumberId)) {
      setError('Guarda primero un Phone Number ID válido.');
      return;
    }

    setTesting(true);
    setError('');
    setMessage('');
    try {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const queueId = `manual-test-${Date.now()}`;
      await saveFirestoreDocument('whatsappOutboundQueue', {
        id: queueId,
        to,
        phoneNumberId,
        senderDisplayPhoneNumber: OFFICIAL_PHONE,
        templateName: settings.confirmationTemplateName.trim(),
        languageCode: 'es',
        bodyParameters: [
          'Prueba DEMAC',
          tomorrow.toLocaleDateString('es-AW', { timeZone: 'America/Aruba', year: 'numeric', month: 'long', day: 'numeric' }),
          '10:00 a. m.',
          'Santa Cruz 54-C, Aruba',
          'Mensaje de prueba de confirmación de cita',
        ],
        status: 'queued',
        notificationType: 'manual-test',
        reason: 'official-phone-validation',
        recipientName: 'Prueba DEMAC',
        source: 'whatsapp-settings-test',
        createdAt: now.toISOString(),
      });
      setMessage(`Prueba colocada en la cola para ${to}. El estado se actualizará automáticamente.`);
      globalThis.setTimeout(() => { void load(false); }, 1800);
      globalThis.setTimeout(() => { void load(false); }, 5500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SectionTitle title="WhatsApp y mensajes automáticos" subtitle="Conecta el número oficial de DEMAC, prueba los templates y supervisa confirmaciones y recordatorios de la agenda." />

      {message ? <View style={styles.successBox}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

      <Card>
        <SectionTitle title="Número oficial de DEMAC" subtitle="El access token permanece protegido en Firebase y nunca se guarda en el navegador." />
        <View style={styles.statusRow}>
          <View style={styles.officialNumber}><Text style={styles.numberLabel}>REMITE DESDE</Text><Text style={styles.numberValue}>{OFFICIAL_PHONE}</Text></View>
          <Pill label={statusLabel(settings.connectionStatus)} tone={statusTone(settings.connectionStatus)} />
        </View>
        <Text style={styles.detail}>{settings.validationMessage ?? 'Guarda la configuración para verificar el Phone Number ID directamente con Meta.'}</Text>
        {settings.verifiedDisplayPhoneNumber ? <Text style={styles.detail}>Número devuelto por Meta: {settings.verifiedDisplayPhoneNumber}</Text> : null}
        {settings.verifiedName ? <Text style={styles.detail}>Nombre verificado: {settings.verifiedName}</Text> : null}
        {settings.qualityRating ? <Text style={styles.detail}>Calidad del número: {settings.qualityRating}</Text> : null}
        {settings.lastValidationError ? <Text style={styles.failure}>Error de validación: {settings.lastValidationError}</Text> : null}
        <Text style={styles.muted}>Última validación: {timestamp(settings.lastValidatedAt)}</Text>
        {webhookObservedNumber ? (
          <View style={[styles.observedBox, observedMatches === false && styles.observedBad]}>
            <Text style={styles.observedTitle}>Webhook observado: {webhookObservedNumber}</Text>
            <Text style={styles.detail}>{observedMatches ? 'Coincide con el teléfono oficial.' : 'No coincide con el teléfono oficial configurado.'}</Text>
          </View>
        ) : <Text style={styles.muted}>Todavía no hay un evento entrante con número visible para comparar.</Text>}
      </Card>

      <Card>
        <SectionTitle title="Configuración de Meta" subtitle="El Phone Number ID identifica el teléfono dentro de WhatsApp Cloud API; no es el número telefónico normal." />
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}><Text style={styles.fieldTitle}>Mensajes automáticos</Text><Text style={styles.detail}>Control general para confirmaciones y recordatorios.</Text></View>
          <Button variant={settings.enabled ? 'success' : 'secondary'} label={settings.enabled ? 'Activados' : 'Desactivados'} onPress={() => setSettings((current) => ({ ...current, enabled: !current.enabled }))} />
        </View>
        <Input label="Meta Phone Number ID" value={settings.phoneNumberId} keyboardType="numeric" onChangeText={(phoneNumberId) => setSettings((current) => ({ ...current, phoneNumberId }))} placeholder="Ej. 1264611476725499" />
        <Input label="Template de confirmación" value={settings.confirmationTemplateName} autoCapitalize="none" onChangeText={(confirmationTemplateName) => setSettings((current) => ({ ...current, confirmationTemplateName }))} />
        <Input label="Template de recordatorio de cita" value={settings.appointmentReminderTemplateName} autoCapitalize="none" onChangeText={(appointmentReminderTemplateName) => setSettings((current) => ({ ...current, appointmentReminderTemplateName }))} />
        <Text style={styles.fieldTitle}>Idioma temporal para clientes en Papiamento</Text>
        <Text style={styles.detail}>Hasta que Meta apruebe un template propio en Papiamento, selecciona cuál versión aprobada usar.</Text>
        <View style={styles.languageRow}>{(['en', 'es', 'nl'] as const).map((language) => <Button key={language} compact variant={settings.papiamentoTemplateLanguage === language ? 'primary' : 'secondary'} label={language === 'en' ? 'English' : language === 'es' ? 'Español' : 'Nederlands'} onPress={() => setSettings((current) => ({ ...current, papiamentoTemplateLanguage: language }))} />)}</View>
        <View style={styles.actions}><Button variant="secondary" label={loading ? 'Actualizando…' : 'Actualizar estados'} disabled={loading} onPress={() => void load()} /><Button label={saving ? 'Guardando…' : 'Guardar y validar'} disabled={saving} onPress={() => void save()} /></View>
      </Card>

      <Card>
        <SectionTitle title="Prueba real desde el número oficial" subtitle="Utiliza el template de confirmación configurado y muestra cualquier rechazo exacto de Meta." />
        <Input label="WhatsApp que recibirá la prueba" value={testRecipient} keyboardType="phone-pad" onChangeText={setTestRecipient} placeholder="297XXXXXXXX" />
        <View style={styles.actions}><Button variant="success" label={testing ? 'Enviando prueba…' : 'Enviar mensaje de prueba'} disabled={testing || !testRecipient.trim()} onPress={() => void sendTest()} /></View>
      </Card>

      <Card>
        <SectionTitle title="Actividad reciente" subtitle="La cola indica si Firebase procesó el mensaje; Meta confirma después si fue entregado o leído." />
        {!queues.length ? <Text style={styles.muted}>Todavía no hay mensajes salientes en la cola.</Text> : queues.slice(0, 12).map((queue) => {
          const outbound = messageByQueueId.get(queue.id);
          const delivery = outbound?.messageId ? latestStatusByMessageId.get(outbound.messageId) : undefined;
          const finalStatus = delivery?.status ?? outbound?.status ?? queue.status;
          return (
            <View key={queue.id} style={styles.activityRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.activityTitle}>{queue.recipientName || queue.to || 'Destinatario'}</Text>
                <Text style={styles.detail}>{queue.templateName} · {queue.notificationType ?? 'mensaje'} · {queue.languageCode ?? 'sin idioma'}</Text>
                <Text style={styles.muted}>{timestamp(recordTime(queue))}</Text>
                {queue.errorMessage ? <Text style={styles.failure}>{queue.errorCode ? `[${queue.errorCode}] ` : ''}{queue.errorMessage}</Text> : null}
              </View>
              <Pill label={statusLabel(finalStatus)} tone={statusTone(finalStatus)} />
            </View>
          );
        })}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 100 },
  successBox: { backgroundColor: colors.successLight, borderRadius: 10, padding: 12 },
  successText: { color: colors.success, fontWeight: '800' },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: 10, padding: 12 },
  errorText: { color: colors.danger, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  officialNumber: { flex: 1, minWidth: 230 },
  numberLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  numberValue: { color: colors.text, fontSize: 24, fontWeight: '900', marginTop: 5 },
  detail: { color: colors.text, fontSize: 11, lineHeight: 17, marginTop: 5 },
  muted: { color: colors.muted, fontSize: 10, marginTop: 5 },
  failure: { color: colors.danger, fontSize: 10, fontWeight: '800', marginTop: 5 },
  observedBox: { marginTop: 12, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.successLight, borderRadius: 10, padding: 11 },
  observedBad: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  observedTitle: { color: colors.text, fontWeight: '900', fontSize: 11 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  fieldTitle: { color: colors.text, fontWeight: '900', fontSize: 11, marginTop: 10 },
  languageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 9, marginTop: 14 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  activityTitle: { color: colors.text, fontWeight: '900', fontSize: 12 },
});
