import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Card, formatMoney, Pill, statusTone } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { ScreenKey } from '../types';

export function DashboardScreen({ navigate }: { navigate: (screen: ScreenKey) => void }) {
  const { width } = useWindowDimensions();
  const compact = width < 980;
  const narrow = width < 680;
  const { currentUser, clients, workOrders, invoices, inventory, services, vans } = useAppState();
  const today = '2026-07-08';
  const todayOrders = workOrders.filter((order) => order.date === today);
  const completedToday = todayOrders.filter((order) => ['Completada', 'Facturada', 'Pagada'].includes(order.status)).length;
  const activeToday = todayOrders.filter((order) => ['Asignada', 'En camino', 'En el sitio', 'En proceso'].includes(order.status)).length;
  const receivables = invoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.paid), 0);
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const paidTotal = invoices.reduce((sum, invoice) => sum + invoice.paid, 0);
  const paidToday = invoices.filter((invoice) => invoice.date === today).reduce((sum, invoice) => sum + invoice.paid, 0);
  const overdueInvoices = invoices.filter((invoice) => invoice.status === 'Vencida');
  const lowStock = inventory.filter((item) => item.quantity <= item.minimum);
  const displayName = currentUser?.name.split(' ').slice(0, 2).join(' ') || 'Christian';
  const completionPercent = todayOrders.length ? Math.round((completedToday / todayOrders.length) * 100) : 0;
  const collectionPercent = totalInvoiced ? Math.round((paidTotal / totalInvoiced) * 100) : 0;

  const modules: { icon: string; label: string; screen: ScreenKey }[] = [
    { icon: '▣', label: 'Agenda', screen: 'agenda' },
    { icon: '☷', label: 'Trabajos', screen: 'workOrders' },
    { icon: '♙', label: 'Clientes', screen: 'clients' },
    { icon: '$', label: 'Ventas y cobros', screen: 'sales' },
    { icon: '✓', label: 'Equipo', screen: 'technician' },
    { icon: '◇', label: 'Inventario', screen: 'inventory' },
    { icon: '▤', label: 'Contabilidad', screen: 'finance' },
  ];

  return (
    <ScrollView contentContainerStyle={[styles.page, narrow && styles.pageNarrow]}>
      <View style={styles.dashboardContainer}>
        <View style={styles.welcomeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Buenas tardes, {displayName}!</Text>
            <Text style={styles.greetingSub}>Aquí tienes una vista general de las operaciones de DEMAC.</Text>
          </View>
          {!narrow ? <View style={styles.personalizeRow}><Text style={styles.personalizeText}>⚙ Personalizar</Text><Text style={styles.privacyText}>● Privacidad</Text></View> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moduleRow}>
          {modules.map((module) => <ModuleChip key={module.label} icon={module.icon} label={module.label} onPress={() => navigate(module.screen)} />)}
        </ScrollView>

        <View style={styles.quickSection}>
          <Text style={styles.quickTitle}>Crear acciones</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
            <QuickAction label="Nueva cita" onPress={() => navigate('agenda')} />
            <QuickAction label="Agregar cliente" onPress={() => navigate('clients')} />
            <QuickAction label="Crear orden" onPress={() => navigate('workOrders')} />
            <QuickAction label="Registrar venta" onPress={() => navigate('sales')} />
            <QuickAction label="Revisar inventario" onPress={() => navigate('inventory')} />
          </ScrollView>
        </View>

        <Text style={styles.sectionLabel}>Negocio en un vistazo</Text>

        <View style={styles.cardGrid}>
          <OverviewCard style={{ width: compact ? '48.5%' : '24%' }} title="OPERACIÓN" period="Hoy">
            <Text style={styles.cardCaption}>Trabajos programados</Text>
            <Text style={styles.primaryValue}>{todayOrders.length}</Text>
            <Text style={styles.positiveText}>✓ {completedToday} completados · {activeToday} activos</Text>
            <View style={styles.metricDivider} />
            <Text style={styles.smallLabel}>Progreso del día</Text>
            <ProgressBar percent={completionPercent} />
            <Text style={styles.percentText}>{completionPercent}% completado</Text>
          </OverviewCard>

          <OverviewCard style={{ width: compact ? '48.5%' : '24%' }} title="COBROS" period="Este mes">
            <Text style={styles.cardCaption}>Cobrado hoy</Text>
            <Text style={styles.primaryValue}>{formatMoney(paidToday)}</Text>
            <Text style={styles.positiveText}>↑ {collectionPercent}% del total facturado</Text>
            <View style={styles.metricDivider} />
            <BarRow label="Cobrado" value={paidTotal} total={Math.max(totalInvoiced, 1)} />
            <BarRow label="Pendiente" value={receivables} total={Math.max(totalInvoiced, 1)} muted />
          </OverviewCard>

          <OverviewCard style={{ width: compact ? '48.5%' : '24%' }} title="FACTURAS" period="Últimos 365 días">
            <Text style={styles.cardCaption}>Cuentas por cobrar</Text>
            <Text style={styles.primaryValue}>{formatMoney(receivables)}</Text>
            <Text style={styles.warningText}>{overdueInvoices.length} vencidas requieren atención</Text>
            <View style={styles.invoiceSplit}>
              <View><Text style={styles.splitValue}>{formatMoney(paidTotal)}</Text><Text style={styles.splitLabel}>Pagado</Text></View>
              <View style={{ alignItems: 'flex-end' }}><Text style={styles.splitValue}>{formatMoney(receivables)}</Text><Text style={styles.splitLabel}>Pendiente</Text></View>
            </View>
            <ProgressBar percent={collectionPercent} />
          </OverviewCard>

          <OverviewCard style={{ width: compact ? '48.5%' : '24%' }} title="FLOTA" period="Ahora">
            <Text style={styles.cardCaption}>Estado de vans</Text>
            {vans.slice(0, 4).map((van) => (
              <View key={van.id} style={styles.vanRow}>
                <View style={styles.vanIcon}><Text style={styles.vanIconText}>🚐</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.vanName}>{van.name}</Text><Text style={styles.vanPlate}>{van.plate}</Text></View>
                <Pill label={van.status} tone={van.status === 'Disponible' ? 'success' : van.status === 'Mantenimiento' ? 'danger' : 'info'} />
              </View>
            ))}
          </OverviewCard>
        </View>

        <View style={[styles.secondGrid, compact && styles.secondGridCompact]}>
          <Card style={styles.agendaCard}>
            <View style={styles.cardHeaderRow}>
              <View><Text style={styles.panelTitle}>Agenda de hoy</Text><Text style={styles.panelSubtitle}>Estado en tiempo real de las visitas programadas</Text></View>
              <Pressable onPress={() => navigate('agenda')}><Text style={styles.linkText}>Ver agenda</Text></Pressable>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { width: 56 }]}>HORA</Text>
              <Text style={[styles.th, { flex: 1.35 }]}>CLIENTE</Text>
              <Text style={[styles.th, { flex: 1 }]}>SERVICIO</Text>
              <Text style={[styles.th, { width: 105 }]}>ESTADO</Text>
            </View>
            {todayOrders.map((order) => {
              const client = clients.find((item) => item.id === order.clientId);
              const service = services.find((item) => item.id === order.serviceId);
              return (
                <Pressable key={order.id} onPress={() => navigate('agenda')} style={styles.tableRow}>
                  <Text style={[styles.tdStrong, { width: 56 }]}>{order.time}</Text>
                  <View style={{ flex: 1.35 }}><Text style={styles.tdStrong}>{client?.name}</Text><Text style={styles.subCell} numberOfLines={1}>{order.address}</Text></View>
                  <Text style={[styles.td, { flex: 1 }]} numberOfLines={1}>{service?.name}</Text>
                  <View style={{ width: 105 }}><Pill label={order.status} tone={statusTone(order.status)} /></View>
                </Pressable>
              );
            })}
          </Card>

          <Card style={styles.salesCard}>
            <View style={styles.cardHeaderRow}><View><Text style={styles.panelTitle}>Ventas</Text><Text style={styles.panelSubtitle}>Este año hasta hoy</Text></View><Text style={styles.menuDots}>⋮</Text></View>
            <Text style={styles.cardCaption}>Total facturado</Text>
            <Text style={styles.salesValue}>{formatMoney(totalInvoiced)}</Text>
            <View style={styles.barChart}>
              {[38, 46, 44, 58, 74, 91, 52].map((height, index) => <View key={index} style={styles.chartColumn}><View style={[styles.chartBar, { height }]} /><Text style={styles.chartLabel}>{['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul'][index]}</Text></View>)}
            </View>
            <Pressable onPress={() => navigate('sales')}><Text style={styles.linkText}>Ver ventas y cobros</Text></Pressable>
          </Card>

          <Card style={styles.alertCard}>
            <View style={styles.cardHeaderRow}><View><Text style={styles.panelTitle}>Asuntos pendientes</Text><Text style={styles.panelSubtitle}>Requieren atención</Text></View><Text style={styles.menuDots}>⋮</Text></View>
            <AlertRow icon="◇" title={`${lowStock.length} artículos con inventario bajo`} copy={lowStock.map((item) => item.name).join(', ') || 'Inventario en buen estado'} onPress={() => navigate('inventory')} />
            <AlertRow icon="$" title={`${overdueInvoices.length} facturas vencidas`} copy="Revisa balances pendientes de clientes." onPress={() => navigate('finance')} />
            <AlertRow icon="✓" title={`${workOrders.filter((order) => order.status === 'Pendiente').length} trabajos pendientes`} copy="Seguimiento de oficina o supervisor." onPress={() => navigate('workOrders')} />
          </Card>
        </View>
      </View>
    </ScrollView>
  );
}

function ModuleChip({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.moduleChip}>
      <View style={styles.moduleIcon}><Text style={styles.moduleIconText}>{icon}</Text></View>
      <Text style={styles.moduleLabel}>{label}</Text>
    </Pressable>
  );
}

function QuickAction({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.quickAction}><Text style={styles.quickActionText}>{label}</Text></Pressable>;
}

function OverviewCard({ title, period, children, style }: { title: string; period: string; children: React.ReactNode; style?: object }) {
  return (
    <Card style={[styles.overviewCard, style]}>
      <View style={styles.cardHeaderRow}><Text style={styles.overviewTitle}>{title}</Text><Text style={styles.periodText}>{period}⌄</Text></View>
      {children}
    </Card>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const width = `${Math.max(3, Math.min(100, percent))}%` as `${number}%`;
  return <View style={styles.progressTrack}><View style={[styles.progressFill, { width }]} /></View>;
}

function BarRow({ label, value, total, muted }: { label: string; value: number; total: number; muted?: boolean }) {
  const percent = Math.min(100, Math.round((value / total) * 100));
  const width = `${Math.max(2, percent)}%` as `${number}%`;
  return (
    <View style={styles.barRow}>
      <View style={styles.barRowHeader}><Text style={styles.barLabel}>{label}</Text><Text style={styles.barValue}>{formatMoney(value)}</Text></View>
      <View style={styles.smallTrack}><View style={[styles.smallFill, muted && styles.smallFillMuted, { width }]} /></View>
    </View>
  );
}

function AlertRow({ icon, title, copy, onPress }: { icon: string; title: string; copy: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.alertRow}>
      <View style={styles.alertIcon}><Text style={styles.alertIconText}>{icon}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.alertTitle}>{title}</Text><Text style={styles.alertCopy} numberOfLines={2}>{copy}</Text></View>
      <Text style={styles.alertArrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 26, paddingTop: 0, paddingBottom: 88, backgroundColor: '#FFFFFF' },
  pageNarrow: { paddingHorizontal: 14 },
  dashboardContainer: { width: '100%', maxWidth: 1380, alignSelf: 'center', paddingTop: 4 },
  welcomeRow: { minHeight: 96, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  greeting: { color: colors.text, fontSize: 27, fontWeight: '400', textAlign: 'center' },
  greetingSub: { color: colors.muted, fontSize: 11, marginTop: 5, textAlign: 'center' },
  personalizeRow: { position: 'absolute', right: 4, top: 12, flexDirection: 'row', gap: 13 },
  personalizeText: { color: colors.muted, fontSize: 10 },
  privacyText: { color: colors.muted, fontSize: 10 },
  moduleRow: { gap: 8, paddingHorizontal: 4, paddingBottom: 22, justifyContent: 'center' },
  moduleChip: { minHeight: 36, borderWidth: 1, borderColor: '#C7CCD2', borderRadius: 18, paddingLeft: 5, paddingRight: 13, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#FFFFFF' },
  moduleIcon: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#073B5C', alignItems: 'center', justifyContent: 'center' },
  moduleIconText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  moduleLabel: { color: colors.text, fontSize: 11, fontWeight: '700' },
  quickSection: { paddingHorizontal: 4, marginBottom: 20 },
  quickTitle: { color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: 9 },
  quickRow: { gap: 8 },
  quickAction: { minHeight: 32, borderWidth: 1, borderColor: '#AEB4BC', borderRadius: 16, justifyContent: 'center', paddingHorizontal: 13, backgroundColor: '#FFFFFF' },
  quickActionText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  sectionLabel: { color: colors.text, fontSize: 13, fontWeight: '800', marginHorizontal: 4, marginBottom: 10 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  overviewCard: { minHeight: 230, padding: 14 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  overviewTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  periodText: { color: colors.muted, fontSize: 9 },
  cardCaption: { color: colors.muted, fontSize: 10, marginTop: 15 },
  primaryValue: { color: colors.text, fontSize: 24, fontWeight: '400', marginTop: 3 },
  positiveText: { color: colors.success, fontSize: 9, marginTop: 5 },
  warningText: { color: colors.warning, fontSize: 9, marginTop: 5 },
  metricDivider: { height: 1, backgroundColor: '#ECEFF1', marginVertical: 14 },
  smallLabel: { color: colors.text, fontSize: 10, marginBottom: 7 },
  progressTrack: { height: 10, borderRadius: 2, backgroundColor: '#E6E9ED', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary },
  percentText: { color: colors.muted, fontSize: 9, marginTop: 6 },
  barRow: { marginTop: 10 },
  barRowHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { color: colors.text, fontSize: 9 },
  barValue: { color: colors.text, fontSize: 9, fontWeight: '700' },
  smallTrack: { height: 6, marginTop: 5, backgroundColor: '#E8EAED', overflow: 'hidden' },
  smallFill: { height: '100%', backgroundColor: colors.primary },
  smallFillMuted: { backgroundColor: '#1295A8' },
  invoiceSplit: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 },
  splitValue: { color: colors.text, fontSize: 13 },
  splitLabel: { color: colors.muted, fontSize: 8, marginTop: 2 },
  vanRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#ECEFF1' },
  vanIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.infoLight, alignItems: 'center', justifyContent: 'center' },
  vanIconText: { fontSize: 12 },
  vanName: { color: colors.text, fontSize: 9, fontWeight: '800' },
  vanPlate: { color: colors.muted, fontSize: 8, marginTop: 1 },
  secondGrid: { flexDirection: 'row', gap: 12, marginTop: 12, alignItems: 'stretch' },
  secondGridCompact: { flexWrap: 'wrap' },
  agendaCard: { flex: 1.65, minWidth: 420, minHeight: 285 },
  salesCard: { flex: 0.8, minWidth: 260, minHeight: 285 },
  alertCard: { flex: 0.8, minWidth: 270, minHeight: 285 },
  panelTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  panelSubtitle: { color: colors.muted, fontSize: 9, marginTop: 3 },
  linkText: { color: colors.info, fontSize: 9, fontWeight: '700' },
  menuDots: { color: colors.muted, fontSize: 18 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8, marginTop: 14 },
  th: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ECEFF1', minHeight: 48 },
  tdStrong: { color: colors.text, fontWeight: '700', fontSize: 10 },
  td: { color: colors.text, fontSize: 9 },
  subCell: { color: colors.muted, fontSize: 8, marginTop: 2 },
  salesValue: { color: colors.text, fontSize: 25, fontWeight: '400', marginTop: 3 },
  barChart: { height: 132, flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingTop: 18, paddingBottom: 18 },
  chartColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  chartBar: { width: '60%', minWidth: 10, backgroundColor: colors.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  chartLabel: { color: colors.muted, fontSize: 7, marginTop: 5 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ECEFF1' },
  alertIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F0F2F4', alignItems: 'center', justifyContent: 'center' },
  alertIconText: { color: colors.info, fontSize: 14, fontWeight: '900' },
  alertTitle: { color: colors.text, fontWeight: '700', fontSize: 9 },
  alertCopy: { color: colors.muted, fontSize: 8, marginTop: 2, lineHeight: 12 },
  alertArrow: { color: colors.muted, fontSize: 20 },
});