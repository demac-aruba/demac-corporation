import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, formatMoney, Input, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';

export function FinanceScreen({ salesMode = false }: { salesMode?: boolean }) {
  const { invoices, clients, registerPayment } = useAppState();
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [payment, setPayment] = useState('');
  const totalSales = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const received = invoices.reduce((sum, invoice) => sum + invoice.paid, 0);
  const pending = totalSales - received;
  const selected = invoices.find((invoice) => invoice.id === selectedInvoice);
  const channelTotals = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((invoice) => map.set(invoice.channel, (map.get(invoice.channel) ?? 0) + invoice.total));
    return Array.from(map.entries());
  }, [invoices]);

  const submitPayment = () => {
    const amount = Number(payment);
    if (!selected || !Number.isFinite(amount) || amount <= 0) return;
    registerPayment(selected.id, amount);
    setPayment('');
    setSelectedInvoice(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle title={salesMode ? 'Ventas y estimates' : 'Facturación y contabilidad'} subtitle={salesMode ? 'Ventas realizadas en tienda, WhatsApp, llamadas y visitas técnicas.' : 'Control DEMO de invoices, pagos y cuentas por cobrar.'} action={salesMode ? <Button label="Nueva venta" icon="＋" onPress={() => {}} /> : undefined} />
      <View style={styles.metrics}>
        <Metric label="Ventas facturadas" value={formatMoney(totalSales)} tone="blue" />
        <Metric label="Pagos recibidos" value={formatMoney(received)} tone="green" />
        <Metric label="Por cobrar" value={formatMoney(pending)} tone="orange" />
        <Metric label="Invoices vencidas" value={String(invoices.filter((item) => item.status === 'Vencida').length)} tone="red" />
      </View>

      {salesMode ? (
        <Card>
          <SectionTitle title="Ventas por canal" subtitle="Distribución de los datos ficticios cargados." />
          <View style={styles.channelGrid}>{channelTotals.map(([channel, amount]) => <View key={channel} style={styles.channel}><Text style={styles.channelName}>{channel}</Text><Text style={styles.channelValue}>{formatMoney(amount)}</Text><View style={styles.bar}><View style={[styles.barFill, { width: `${Math.max(12, (amount / totalSales) * 100)}%` }]} /></View></View>)}</View>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Invoices" subtitle="Haz clic en registrar pago para actualizar el balance." />
        <ScrollView horizontal>
          <View style={{ minWidth: 900, width: '100%' }}>
            <View style={styles.tableHeader}><Text style={[styles.th, { width: 120 }]}>INVOICE</Text><Text style={[styles.th, { flex: 1.4 }]}>CLIENTE</Text><Text style={[styles.th, { width: 110 }]}>FECHA</Text><Text style={[styles.th, { width: 120 }]}>TOTAL</Text><Text style={[styles.th, { width: 120 }]}>PAGADO</Text><Text style={[styles.th, { width: 120 }]}>ESTADO</Text><Text style={[styles.th, { width: 145 }]}>ACCIÓN</Text></View>
            {invoices.map((invoice) => {
              const client = clients.find((item) => item.id === invoice.clientId);
              const balance = invoice.total - invoice.paid;
              return <View key={invoice.id} style={styles.tableRow}><Text style={[styles.invoiceId, { width: 120 }]}>{invoice.id}</Text><View style={{ flex: 1.4 }}><Text style={styles.client}>{client?.name}</Text><Text style={styles.channelMeta}>{invoice.channel}</Text></View><Text style={[styles.cell, { width: 110 }]}>{invoice.date}</Text><Text style={[styles.money, { width: 120 }]}>{formatMoney(invoice.total)}</Text><Text style={[styles.cell, { width: 120 }]}>{formatMoney(invoice.paid)}</Text><View style={{ width: 120 }}><Pill label={invoice.status} tone={statusTone(invoice.status)} /></View><View style={{ width: 145 }}>{balance > 0 ? <Button compact label="Registrar pago" onPress={() => setSelectedInvoice(invoice.id)} /> : <Pill label="Saldo 0" tone="success" />}</View></View>;
            })}
          </View>
        </ScrollView>
      </Card>

      <AppModal visible={Boolean(selected)} title={`Registrar pago · ${selected?.id ?? ''}`} onClose={() => setSelectedInvoice(null)}>
        <Text style={styles.paymentInfo}>Balance pendiente: {formatMoney((selected?.total ?? 0) - (selected?.paid ?? 0))}</Text>
        <Input label="Monto recibido (Afl.)" value={payment} onChangeText={setPayment} keyboardType="decimal-pad" placeholder="0.00" />
        <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" onPress={() => setSelectedInvoice(null)} /><Button variant="success" label="Confirmar pago" onPress={submitPayment} /></View>
      </AppModal>
    </ScrollView>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'green' | 'orange' | 'red' }) {
  const toneColor = { blue: colors.primary, green: colors.success, orange: colors.warning, red: colors.danger }[tone];
  return <Card style={styles.metric}><View style={[styles.metricLine, { backgroundColor: toneColor }]} /><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></Card>;
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flex: 1, minWidth: 220, overflow: 'hidden' },
  metricLine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  metricLabel: { color: colors.muted, fontWeight: '800', fontSize: 11 },
  metricValue: { color: colors.text, fontWeight: '900', fontSize: 22, marginTop: 7 },
  channelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  channel: { flex: 1, minWidth: 180, backgroundColor: '#F7F9FC', borderRadius: 12, padding: 14 },
  channelName: { color: colors.muted, fontSize: 10, fontWeight: '900' },
  channelValue: { color: colors.text, fontWeight: '900', fontSize: 17, marginTop: 5 },
  bar: { height: 5, borderRadius: 3, backgroundColor: '#E2E8F0', marginTop: 10, overflow: 'hidden' },
  barFill: { height: 5, backgroundColor: colors.primary, borderRadius: 3 },
  tableHeader: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  tableRow: { flexDirection: 'row', alignItems: 'center', minHeight: 58, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  invoiceId: { color: colors.primary, fontWeight: '900', fontSize: 11 },
  client: { color: colors.text, fontWeight: '900', fontSize: 12 },
  channelMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  cell: { color: colors.text, fontSize: 11 },
  money: { color: colors.text, fontWeight: '900', fontSize: 11 },
  paymentInfo: { backgroundColor: colors.primaryLight, color: colors.primary, padding: 13, borderRadius: 10, fontWeight: '900', marginBottom: 14 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
});
