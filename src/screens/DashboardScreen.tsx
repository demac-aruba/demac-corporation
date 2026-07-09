import React from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Button, Card, formatMoney, Pill, SectionTitle, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors, roleLabels } from '../theme';
import { ScreenKey } from '../types';

export function DashboardScreen({ navigate }: { navigate: (screen: ScreenKey) => void }) {
  const { width } = useWindowDimensions();
  const compact = width < 800;
  const { currentUser, clients, workOrders, invoices, inventory, services, vans } = useAppState();
  const today = '2026-07-08';
  const todayOrders = workOrders.filter((order) => order.date === today);
  const receivables = invoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.paid), 0);
  const paidToday = invoices.filter((invoice) => invoice.date === today).reduce((sum, invoice) => sum + invoice.paid, 0);
  const lowStock = inventory.filter((item) => item.quantity <= item.minimum);

  const metrics = [
    { icon: '📅', label: 'Trabajos de hoy', value: String(todayOrders.length), hint: `${todayOrders.filter((o) => o.status === 'Completada').length} completados`, tone: colors.primary },
    { icon: '🚐', label: 'Vans en ruta', value: String(vans.filter((van) => van.status === 'En ruta').length), hint: `${vans.filter((van) => van.status === 'Disponible').length} disponibles`, tone: colors.purple },
    { icon: '💳', label: 'Cobrado hoy', value: formatMoney(paidToday), hint: 'Datos de demostración', tone: colors.success },
    { icon: '📌', label: 'Cuentas por cobrar', value: formatMoney(receivables), hint: `${invoices.filter((i) => i.status === 'Vencida').length} vencidas`, tone: colors.warning },
  ];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{roleLabels[currentUser?.role ?? 'admin']}</Text>
          <Text style={styles.title}>Buenos días, {currentUser?.name.split(' ')[0]}</Text>
          <Text style={styles.subtitle}>Aquí tienes el resumen operativo de DEMAC para el miércoles 8 de julio de 2026.</Text>
        </View>
        <View style={styles.demo}><Text style={styles.demoText}>DEMO</Text></View>
      </View>

      <View style={styles.metricGrid}>
        {metrics.map((metric) => (
          <Card key={metric.label} style={[styles.metricCard, { width: compact ? '100%' : '23.5%' }]}>
            <View style={[styles.metricIcon, { backgroundColor: `${metric.tone}16` }]}><Text style={styles.metricEmoji}>{metric.icon}</Text></View>
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricValue}>{metric.value}</Text>
            <Text style={styles.metricHint}>{metric.hint}</Text>
          </Card>
        ))}
      </View>

      <View style={[styles.twoColumns, compact && { flexDirection: 'column' }]}>
        <Card style={{ flex: 1.65 }}>
          <SectionTitle title="Agenda de hoy" subtitle="Estado en tiempo real de las órdenes programadas" action={<Button compact variant="secondary" label="Ver agenda" onPress={() => navigate('agenda')} />} />
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { width: 60 }]}>HORA</Text><Text style={[styles.th, { flex: 1.3 }]}>CLIENTE</Text><Text style={[styles.th, { flex: 1 }]}>SERVICIO</Text><Text style={[styles.th, { width: 110 }]}>ESTADO</Text>
          </View>
          {todayOrders.map((order) => {
            const client = clients.find((item) => item.id === order.clientId);
            const service = services.find((item) => item.id === order.serviceId);
            return (
              <View key={order.id} style={styles.tableRow}>
                <Text style={[styles.tdStrong, { width: 60 }]}>{order.time}</Text>
                <View style={{ flex: 1.3 }}><Text style={styles.tdStrong}>{client?.name}</Text><Text style={styles.subCell} numberOfLines={1}>{order.address}</Text></View>
                <Text style={[styles.td, { flex: 1 }]}>{service?.name}</Text>
                <View style={{ width: 110 }}><Pill label={order.status} tone={statusTone(order.status)} /></View>
              </View>
            );
          })}
        </Card>

        <Card style={{ flex: 1 }}>
          <SectionTitle title="Alertas" subtitle="Asuntos que necesitan atención" />
          <Alert icon="⚠️" title={`${lowStock.length} artículos con inventario bajo`} copy={lowStock.map((item) => item.name).join(', ')} onPress={() => navigate('inventory')} />
          <Alert icon="💰" title={`${invoices.filter((i) => i.status === 'Vencida').length} invoices vencidas`} copy="Revisa clientes con balances pendientes." onPress={() => navigate('finance')} />
          <Alert icon="🔧" title={`${workOrders.filter((o) => o.status === 'Pendiente').length} trabajos pendientes`} copy="Requieren seguimiento de oficina o supervisor." onPress={() => navigate('workOrders')} />
        </Card>
      </View>

      <Card>
        <SectionTitle title="Acciones rápidas" subtitle="Operaciones frecuentes" />
        <View style={styles.quickActions}>
          <QuickAction icon="＋" label="Nueva cita" onPress={() => navigate('agenda')} />
          <QuickAction icon="👤" label="Nuevo cliente" onPress={() => navigate('clients')} />
          <QuickAction icon="🧾" label="Nueva venta" onPress={() => navigate('sales')} />
          <QuickAction icon="📦" label="Revisar inventario" onPress={() => navigate('inventory')} />
          <QuickAction icon="🔧" label="Órdenes de trabajo" onPress={() => navigate('workOrders')} />
        </View>
      </Card>
    </ScrollView>
  );
}

function Alert({ icon, title, copy, onPress }: { icon: string; title: string; copy: string; onPress: () => void }) {
  return (
    <View style={styles.alertRow}>
      <View style={styles.alertIcon}><Text>{icon}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.alertTitle}>{title}</Text><Text style={styles.alertCopy} numberOfLines={2}>{copy}</Text></View>
      <Button compact variant="ghost" label="Ver" onPress={onPress} />
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Button icon={icon} label={label} onPress={onPress} variant="secondary" />
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  hero: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: 20, padding: 25 },
  eyebrow: { color: '#86BBF3', fontSize: 11, letterSpacing: 1.3, fontWeight: '900', textTransform: 'uppercase' },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', marginTop: 5 },
  subtitle: { color: '#C7DCF4', marginTop: 7, lineHeight: 20 },
  demo: { backgroundColor: '#FFFFFF1A', borderWidth: 1, borderColor: '#FFFFFF38', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999 },
  demoText: { color: '#FFFFFF', fontWeight: '900', fontSize: 11, letterSpacing: 1.5 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  metricCard: { minWidth: 220 },
  metricIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  metricEmoji: { fontSize: 20 },
  metricLabel: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  metricValue: { color: colors.text, fontWeight: '900', fontSize: 23, marginTop: 5 },
  metricHint: { color: colors.muted, fontSize: 11, marginTop: 5 },
  twoColumns: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 9 },
  th: { color: colors.muted, fontSize: 10, fontWeight: '900' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F6', minHeight: 57 },
  tdStrong: { color: colors.text, fontWeight: '800', fontSize: 12 },
  td: { color: colors.text, fontSize: 12 },
  subCell: { color: colors.muted, fontSize: 10, marginTop: 2 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  alertIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { color: colors.text, fontWeight: '800', fontSize: 12 },
  alertCopy: { color: colors.muted, fontSize: 10, marginTop: 3, lineHeight: 15 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
