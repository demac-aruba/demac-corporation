import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { formatMoney } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { ScreenKey, WorkOrder } from '../types';

function arubaDateKey() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Aruba',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

function arubaLongDate() {
  try {
    return new Intl.DateTimeFormat('es-AW', {
      timeZone: 'America/Aruba',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date());
  } catch {
    return arubaDateKey();
  }
}

function orderDone(order: WorkOrder) {
  return ['Completada', 'Facturada', 'Pagada'].includes(order.status);
}

function orderActive(order: WorkOrder) {
  return ['Asignada', 'En camino', 'En el sitio', 'En proceso'].includes(order.status);
}

function orderTone(status: string) {
  if (['Completada', 'Facturada', 'Pagada'].includes(status)) return 'success';
  if (['Cancelada'].includes(status)) return 'danger';
  if (['En proceso', 'En el sitio', 'En camino'].includes(status)) return 'active';
  if (['Reserva temporal'].includes(status)) return 'warning';
  return 'neutral';
}

export function DashboardScreenV2({ navigate }: { navigate: (screen: ScreenKey) => void }) {
  const { width } = useWindowDimensions();
  const stacked = width < 1120;
  const narrow = width < 720;
  const { currentUser, clients, workOrders, invoices, inventory, vans } = useAppState();

  const today = arubaDateKey();
  const todayOrders = workOrders
    .filter((order) => order.date === today)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const completed = todayOrders.filter(orderDone).length;
  const active = todayOrders.filter(orderActive).length;
  const remaining = Math.max(0, todayOrders.length - completed);
  const activeVans = vans.filter((van) => van.status !== 'Mantenimiento' && van.status !== 'Fuera de servicio').length;
  const unassigned = todayOrders.filter((order) => !order.vanId || !(order.technicianIds ?? []).length).length;
  const pendingReports = workOrders.filter((order) => order.status === 'Pendiente').length;
  const overdueInvoices = invoices.filter((invoice) => invoice.status === 'Vencida');
  const overdueAmount = overdueInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.paid), 0);
  const receivables = invoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.paid), 0);
  const lowStock = inventory.filter((item) => item.quantity <= item.minimum);
  const displayName = currentUser?.name?.split(' ')[0] || 'Christian';

  const attentionItems = [
    {
      id: 'reports',
      kicker: 'OPERACIÓN',
      value: pendingReports,
      title: pendingReports === 1 ? 'reporte pendiente de revisión' : 'reportes pendientes de revisión',
      action: 'Abrir trabajos',
      screen: 'workOrders' as ScreenKey,
      tone: pendingReports ? 'warning' : 'quiet',
    },
    {
      id: 'unassigned',
      kicker: 'DESPACHO',
      value: unassigned,
      title: unassigned === 1 ? 'trabajo de hoy sin equipo completo' : 'trabajos de hoy sin equipo completo',
      action: 'Revisar agenda',
      screen: 'agenda' as ScreenKey,
      tone: unassigned ? 'danger' : 'quiet',
    },
    {
      id: 'stock',
      kicker: 'INVENTARIO',
      value: lowStock.length,
      title: lowStock.length === 1 ? 'artículo bajo mínimo' : 'artículos bajo mínimo',
      action: 'Ver inventario',
      screen: 'inventory' as ScreenKey,
      tone: lowStock.length ? 'warning' : 'quiet',
    },
    {
      id: 'billing',
      kicker: 'COBROS',
      value: overdueInvoices.length,
      title: overdueInvoices.length === 1 ? 'factura vencida' : 'facturas vencidas',
      action: 'Abrir cuentas',
      screen: 'finance' as ScreenKey,
      tone: overdueInvoices.length ? 'danger' : 'quiet',
    },
  ];

  return (
    <ScrollView contentContainerStyle={[styles.page, narrow && styles.pageNarrow]}>
      <View style={styles.frame}>
        <View style={[styles.header, narrow && styles.headerNarrow]}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>CENTRO DE OPERACIONES · {arubaLongDate().toUpperCase()}</Text>
            <Text style={[styles.title, narrow && styles.titleNarrow]}>Buenas tardes, {displayName}.</Text>
            <Text style={styles.subtitle}>Lo importante de DEMAC hoy, en una sola vista.</Text>
          </View>
          <View style={styles.headerActions}>
            <ActionButton label="Nuevo cliente" variant="secondary" onPress={() => navigate('clients')} />
            <ActionButton label="+ Nueva cita" onPress={() => navigate('agenda')} />
          </View>
        </View>

        <View style={[styles.hero, narrow && styles.heroNarrow]}>
          <View style={styles.heroMain}>
            <View style={styles.heroStatusRow}>
              <View style={styles.liveDot} />
              <Text style={styles.heroEyebrow}>OPERACIÓN EN VIVO</Text>
            </View>
            <Text style={styles.heroTitle}>{remaining === 0 && todayOrders.length > 0 ? 'La agenda de hoy está completada.' : `${remaining} trabajos todavía en movimiento.`}</Text>
            <Text style={styles.heroCopy}>{active} activos ahora · {completed} completados · {activeVans} vans operativas</Text>
            <View style={styles.heroProgressTrack}>
              <View style={[styles.heroProgressFill, { width: `${todayOrders.length ? Math.max(4, Math.round((completed / todayOrders.length) * 100)) : 4}%` as `${number}%` }]} />
            </View>
          </View>
          <View style={styles.heroMetrics}>
            <HeroMetric label="TRABAJOS HOY" value={String(todayOrders.length)} detail={`${completed} terminados`} />
            <HeroMetric label="VANS OPERATIVAS" value={`${activeVans}/${Math.max(4, vans.length || 4)}`} detail={activeVans >= 4 ? 'Capacidad completa' : 'Capacidad reducida'} />
            <HeroMetric label="POR COBRAR" value={formatMoney(receivables)} detail={overdueInvoices.length ? `${overdueInvoices.length} vencidas` : 'Sin vencidas'} />
          </View>
        </View>

        <View style={[styles.primaryGrid, stacked && styles.primaryGridStacked]}>
          <View style={styles.dispatchPanel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelEyebrow}>DESPACHO DE HOY</Text>
                <Text style={styles.panelTitle}>Las cuatro unidades operativas</Text>
              </View>
              <Pressable onPress={() => navigate('agenda')} style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
                <Text style={styles.textActionText}>Abrir agenda completa →</Text>
              </Pressable>
            </View>

            <View style={styles.dispatchList}>
              {(vans.length ? vans.slice(0, 4) : [{ id: 'v1', name: 'Van 1', status: 'Disponible' }, { id: 'v2', name: 'Van 2', status: 'Disponible' }, { id: 'v3', name: 'Van 3', status: 'Disponible' }, { id: 'v4', name: 'Van 4', status: 'Disponible' }] as any[]).map((van, index) => {
                const vanOrders = todayOrders.filter((order) => order.vanId === van.id);
                const vanCompleted = vanOrders.filter(orderDone).length;
                return (
                  <Pressable key={van.id} onPress={() => navigate('agenda')} style={({ pressed }) => [styles.vanLane, pressed && styles.vanLanePressed]}>
                    <View style={styles.vanIdentity}>
                      <View style={styles.vanNumber}><Text style={styles.vanNumberText}>{String(index + 1).padStart(2, '0')}</Text></View>
                      <View style={styles.vanIdentityCopy}>
                        <Text style={styles.vanName}>{van.name ?? `Van ${index + 1}`}</Text>
                        <Text style={styles.vanMeta}>{vanOrders.length ? `${vanCompleted}/${vanOrders.length} completados` : 'Sin trabajos asignados'}</Text>
                      </View>
                    </View>

                    <View style={styles.timeline}>
                      {vanOrders.length ? vanOrders.slice(0, 4).map((order) => {
                        const client = clients.find((item) => item.id === order.clientId);
                        const tone = orderTone(order.status);
                        return (
                          <View key={order.id} style={[styles.jobChip, tone === 'active' && styles.jobChipActive, tone === 'success' && styles.jobChipSuccess, tone === 'warning' && styles.jobChipWarning, tone === 'danger' && styles.jobChipDanger]}>
                            <Text style={styles.jobTime}>{order.time}</Text>
                            <Text style={styles.jobClient} numberOfLines={1}>{client?.name ?? 'Cliente'}</Text>
                            <Text style={styles.jobType} numberOfLines={1}>{order.appointmentWorkLabel ?? order.problem ?? 'Trabajo'}</Text>
                          </View>
                        );
                      }) : (
                        <View style={styles.emptyTimeline}>
                          <Text style={styles.emptyTimelineText}>Disponible para asignación</Text>
                        </View>
                      )}
                      {vanOrders.length > 4 ? <View style={styles.moreJobs}><Text style={styles.moreJobsText}>+{vanOrders.length - 4}</Text></View> : null}
                    </View>

                    <View style={styles.vanStatusBox}>
                      <View style={[styles.statusDot, van.status === 'Mantenimiento' && styles.statusDotDanger]} />
                      <Text style={styles.vanStatus}>{van.status ?? 'Disponible'}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.attentionPanel}>
            <View style={styles.panelHeaderCompact}>
              <Text style={styles.panelEyebrow}>ATENCIÓN</Text>
              <Text style={styles.panelTitle}>Decisiones pendientes</Text>
            </View>
            <View style={styles.attentionList}>
              {attentionItems.map((item) => (
                <Pressable key={item.id} onPress={() => navigate(item.screen)} style={({ pressed }) => [styles.attentionItem, pressed && styles.pressed]}>
                  <View style={[styles.attentionValueBox, item.tone === 'danger' && styles.attentionValueDanger, item.tone === 'warning' && styles.attentionValueWarning]}>
                    <Text style={[styles.attentionValue, item.tone === 'danger' && styles.attentionValueTextDanger, item.tone === 'warning' && styles.attentionValueTextWarning]}>{item.value}</Text>
                  </View>
                  <View style={styles.attentionCopy}>
                    <Text style={styles.attentionKicker}>{item.kicker}</Text>
                    <Text style={styles.attentionTitle}>{item.title}</Text>
                    <Text style={styles.attentionAction}>{item.action}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <View style={[styles.secondaryGrid, stacked && styles.secondaryGridStacked]}>
          <View style={styles.insightCard}>
            <View style={styles.insightHeader}>
              <View>
                <Text style={styles.panelEyebrow}>FLUJO OPERATIVO</Text>
                <Text style={styles.insightTitle}>Hoy en números</Text>
              </View>
              <Pressable onPress={() => navigate('workOrders')}><Text style={styles.textActionText}>Ver trabajos →</Text></Pressable>
            </View>
            <View style={styles.statStrip}>
              <StatCell value={String(todayOrders.length)} label="Programados" />
              <StatCell value={String(active)} label="En ejecución" />
              <StatCell value={String(completed)} label="Completados" />
              <StatCell value={String(unassigned)} label="Sin asignar" alert={unassigned > 0} />
            </View>
          </View>

          <View style={styles.insightCard}>
            <View style={styles.insightHeader}>
              <View>
                <Text style={styles.panelEyebrow}>SALUD FINANCIERA</Text>
                <Text style={styles.insightTitle}>Cobranza</Text>
              </View>
              <Pressable onPress={() => navigate('finance')}><Text style={styles.textActionText}>Abrir cuentas →</Text></Pressable>
            </View>
            <View style={styles.financeBody}>
              <View>
                <Text style={styles.financeLabel}>Cuentas por cobrar</Text>
                <Text style={styles.financeValue}>{formatMoney(receivables)}</Text>
              </View>
              <View style={styles.financeDivider} />
              <View>
                <Text style={styles.financeLabel}>Monto vencido</Text>
                <Text style={[styles.financeValue, overdueAmount > 0 && styles.financeValueAlert]}>{formatMoney(overdueAmount)}</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function ActionButton({ label, onPress, variant = 'primary' }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionButton, variant === 'secondary' && styles.actionButtonSecondary, pressed && styles.pressed]}>
      <Text style={[styles.actionButtonText, variant === 'secondary' && styles.actionButtonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function HeroMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <View style={styles.heroMetric}>
      <Text style={styles.heroMetricLabel}>{label}</Text>
      <Text style={styles.heroMetricValue}>{value}</Text>
      <Text style={styles.heroMetricDetail}>{detail}</Text>
    </View>
  );
}

function StatCell({ value, label, alert }: { value: string; label: string; alert?: boolean }) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, alert && styles.statValueAlert]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.background, paddingHorizontal: 30, paddingTop: 24, paddingBottom: 80 },
  pageNarrow: { paddingHorizontal: 14, paddingTop: 16 },
  frame: { width: '100%', maxWidth: 1480, alignSelf: 'center', gap: 18 },
  header: { minHeight: 96, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 },
  headerNarrow: { alignItems: 'flex-start', flexDirection: 'column', gap: 16 },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.25 },
  title: { color: colors.text, fontSize: 34, lineHeight: 42, fontWeight: '800', letterSpacing: -0.8, marginTop: 7 },
  titleNarrow: { fontSize: 28, lineHeight: 34 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 5 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionButton: { minHeight: 42, borderRadius: 12, paddingHorizontal: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  actionButtonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  actionButtonTextSecondary: { color: colors.text },
  pressed: { opacity: 0.72 },

  hero: { minHeight: 220, borderRadius: 22, backgroundColor: colors.navy, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: '#1D2B40' },
  heroNarrow: { flexDirection: 'column' },
  heroMain: { flex: 1.45, padding: 28, justifyContent: 'center' },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#44C06A' },
  heroEyebrow: { color: '#9FB0C9', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  heroTitle: { color: '#FFFFFF', fontSize: 28, lineHeight: 35, fontWeight: '800', letterSpacing: -0.5, marginTop: 16, maxWidth: 620 },
  heroCopy: { color: '#AFC0D7', fontSize: 12, marginTop: 10 },
  heroProgressTrack: { height: 4, maxWidth: 480, borderRadius: 99, backgroundColor: '#21314A', marginTop: 24, overflow: 'hidden' },
  heroProgressFill: { height: '100%', borderRadius: 99, backgroundColor: colors.primary },
  heroMetrics: { flex: 1, minWidth: 330, backgroundColor: '#101C2D', flexDirection: 'row', alignItems: 'stretch' },
  heroMetric: { flex: 1, paddingHorizontal: 18, paddingVertical: 28, justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: '#223147' },
  heroMetricLabel: { color: '#7890AE', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  heroMetricValue: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', marginTop: 10 },
  heroMetricDetail: { color: '#91A2B9', fontSize: 9, lineHeight: 14, marginTop: 5 },

  primaryGrid: { flexDirection: 'row', alignItems: 'stretch', gap: 18 },
  primaryGridStacked: { flexDirection: 'column' },
  dispatchPanel: { flex: 2.35, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20 },
  attentionPanel: { flex: 0.9, minWidth: 300, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20 },
  panelHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 14 },
  panelHeaderCompact: { marginBottom: 12 },
  panelEyebrow: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.15 },
  panelTitle: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '900', marginTop: 5 },
  textAction: { paddingVertical: 5 },
  textActionText: { color: colors.primary, fontSize: 10, fontWeight: '900' },

  dispatchList: { gap: 8 },
  vanLane: { minHeight: 102, borderRadius: 14, borderWidth: 1, borderColor: '#E6EBF2', backgroundColor: '#FBFCFE', flexDirection: 'row', alignItems: 'center', padding: 12, gap: 14 },
  vanLanePressed: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  vanIdentity: { width: 180, flexDirection: 'row', alignItems: 'center', gap: 10 },
  vanNumber: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  vanNumberText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  vanIdentityCopy: { flex: 1 },
  vanName: { color: colors.text, fontSize: 12, fontWeight: '900' },
  vanMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  timeline: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'stretch', gap: 7 },
  jobChip: { flex: 1, minWidth: 105, maxWidth: 180, borderRadius: 11, borderWidth: 1, borderColor: '#DFE5ED', backgroundColor: '#FFFFFF', padding: 9 },
  jobChipActive: { borderColor: '#9BC0F5', backgroundColor: '#EDF5FF' },
  jobChipSuccess: { borderColor: '#B8DFC3', backgroundColor: '#F1FAF4' },
  jobChipWarning: { borderColor: '#F1D394', backgroundColor: '#FFF9ED' },
  jobChipDanger: { borderColor: '#F1BCB9', backgroundColor: '#FFF4F3' },
  jobTime: { color: colors.primaryDark, fontSize: 9, fontWeight: '900' },
  jobClient: { color: colors.text, fontSize: 10, fontWeight: '900', marginTop: 5 },
  jobType: { color: colors.muted, fontSize: 8, marginTop: 3 },
  emptyTimeline: { flex: 1, minHeight: 68, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D6DEE9', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  emptyTimelineText: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  moreJobs: { width: 40, borderRadius: 10, backgroundColor: '#EEF2F7', alignItems: 'center', justifyContent: 'center' },
  moreJobsText: { color: colors.text, fontWeight: '900', fontSize: 10 },
  vanStatusBox: { width: 94, alignItems: 'flex-end', gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  statusDotDanger: { backgroundColor: colors.danger },
  vanStatus: { color: colors.muted, fontSize: 8, fontWeight: '800', textAlign: 'right' },

  attentionList: { gap: 6 },
  attentionItem: { minHeight: 84, borderRadius: 13, borderWidth: 1, borderColor: '#E7ECF2', backgroundColor: '#FCFDFE', padding: 11, flexDirection: 'row', gap: 11, alignItems: 'center' },
  attentionValueBox: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#EEF3F8', alignItems: 'center', justifyContent: 'center' },
  attentionValueDanger: { backgroundColor: '#FFF0EF' },
  attentionValueWarning: { backgroundColor: '#FFF7E7' },
  attentionValue: { color: colors.text, fontSize: 16, fontWeight: '900' },
  attentionValueTextDanger: { color: colors.danger },
  attentionValueTextWarning: { color: colors.warning },
  attentionCopy: { flex: 1 },
  attentionKicker: { color: colors.muted, fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  attentionTitle: { color: colors.text, fontSize: 10, lineHeight: 15, fontWeight: '800', marginTop: 3 },
  attentionAction: { color: colors.primary, fontSize: 8, fontWeight: '900', marginTop: 5 },

  secondaryGrid: { flexDirection: 'row', gap: 18 },
  secondaryGridStacked: { flexDirection: 'column' },
  insightCard: { flex: 1, minHeight: 162, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 19 },
  insightHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  insightTitle: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 4 },
  statStrip: { flex: 1, flexDirection: 'row', marginTop: 18, borderTopWidth: 1, borderTopColor: '#EDF0F4' },
  statCell: { flex: 1, minWidth: 85, paddingTop: 15, paddingRight: 10 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '900' },
  statValueAlert: { color: colors.danger },
  statLabel: { color: colors.muted, fontSize: 9, marginTop: 4 },
  financeBody: { flex: 1, flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  financeLabel: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  financeValue: { color: colors.text, fontSize: 24, fontWeight: '900', marginTop: 7 },
  financeValueAlert: { color: colors.danger },
  financeDivider: { width: 1, height: 48, backgroundColor: colors.border, marginHorizontal: 28 },
});
