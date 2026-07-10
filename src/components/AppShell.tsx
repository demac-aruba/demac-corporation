import React, { ReactNode, useMemo, useState } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAppState } from '../state/AppState';
import { colors, roleLabels } from '../theme';
import { ScreenKey, UserRole } from '../types';
import { AgendaScreen } from '../screens/AgendaScreen';
import { ClientsScreen } from '../screens/ClientsScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { FinanceScreen } from '../screens/FinanceScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TechnicianScreen } from '../screens/TechnicianScreen';
import { WorkOrdersScreen } from '../screens/WorkOrdersScreen';

const navItems: { key: ScreenKey; label: string; icon: string; roles: UserRole[] }[] = [
  { key: 'dashboard', label: 'Panel de control', icon: '⌂', roles: ['admin', 'office', 'supervisor', 'accounting', 'inventory'] },
  { key: 'agenda', label: 'Agenda', icon: '▣', roles: ['admin', 'office', 'supervisor'] },
  { key: 'clients', label: 'Clientes', icon: '♙', roles: ['admin', 'office', 'supervisor', 'accounting'] },
  { key: 'workOrders', label: 'Trabajos', icon: '☷', roles: ['admin', 'office', 'supervisor'] },
  { key: 'technician', label: 'Mi trabajo', icon: '✓', roles: ['admin', 'supervisor', 'technician'] },
  { key: 'sales', label: 'Ventas', icon: '$', roles: ['admin', 'office', 'accounting'] },
  { key: 'inventory', label: 'Inventario', icon: '◇', roles: ['admin', 'supervisor', 'inventory'] },
  { key: 'finance', label: 'Contabilidad', icon: '▤', roles: ['admin', 'accounting'] },
  { key: 'settings', label: 'Configuración', icon: '⚙', roles: ['admin'] },
];

function initials(name?: string) {
  return (name ?? 'Usuario DEMAC')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function AppShell() {
  const { currentUser, logout } = useAppState();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 920;
  const availableItems = useMemo(() => navItems.filter((item) => currentUser && item.roles.includes(currentUser.role)), [currentUser]);
  const defaultScreen: ScreenKey = currentUser?.role === 'technician' ? 'technician' : currentUser?.role === 'inventory' ? 'inventory' : currentUser?.role === 'accounting' ? 'finance' : 'dashboard';
  const [activeScreen, setActiveScreen] = useState<ScreenKey>(defaultScreen);
  const activeLabel = availableItems.find((item) => item.key === activeScreen)?.label ?? 'Panel de control';

  const navigate = (screen: ScreenKey) => {
    if (availableItems.some((item) => item.key === screen)) setActiveScreen(screen);
  };

  let content: ReactNode;
  switch (activeScreen) {
    case 'agenda': content = <AgendaScreen />; break;
    case 'clients': content = <ClientsScreen />; break;
    case 'workOrders': content = <WorkOrdersScreen />; break;
    case 'technician': content = <TechnicianScreen />; break;
    case 'sales': content = <FinanceScreen salesMode />; break;
    case 'inventory': content = <InventoryScreen />; break;
    case 'finance': content = <FinanceScreen />; break;
    case 'settings': content = <SettingsScreen />; break;
    default: content = <DashboardScreen navigate={navigate} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        {isDesktop ? (
          <View style={styles.sidebar}>
            <View style={styles.logoPanel}>
              <Text style={styles.brandName}>DEMAC</Text>
              <Text style={styles.brandSub}>Professional Cooling Solutions</Text>
            </View>
            <Pressable onPress={() => setActiveScreen('agenda')} style={styles.newButton}>
              <Text style={styles.newIcon}>＋</Text>
              <Text style={styles.newText}>Nuevo</Text>
            </Pressable>
            <ScrollView contentContainerStyle={styles.nav} showsVerticalScrollIndicator={false}>
              {availableItems.map((item) => <NavButton key={item.key} item={item} active={activeScreen === item.key} onPress={() => setActiveScreen(item.key)} />)}
            </ScrollView>
            <View style={styles.trialBox}>
              <Text style={styles.trialTitle}>Entorno DEMAC</Text>
              <Text style={styles.trialText}>Agenda, clientes, ventas e inventario en una sola plataforma.</Text>
              <Pressable onPress={() => setActiveScreen('agenda')} style={styles.trialButton}><Text style={styles.trialButtonText}>Abrir agenda</Text></Pressable>
            </View>
            <View style={styles.userBox}>
              <View style={styles.userAvatar}><Text style={styles.userAvatarText}>{initials(currentUser?.name)}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.userName} numberOfLines={1}>{currentUser?.name}</Text><Text style={styles.userRole}>{currentUser ? roleLabels[currentUser.role] : ''}</Text></View>
            </View>
            <Pressable onPress={logout} style={styles.logoutRow}><Text style={styles.logoutIcon}>↪</Text><Text style={styles.logoutLabel}>Cerrar sesión</Text></Pressable>
          </View>
        ) : null}

        <View style={styles.main}>
          <View style={styles.topbar}>
            <View style={styles.topbarLeft}>
              <Pressable style={styles.menuButton}><Text style={styles.menuText}>☰</Text></Pressable>
              <View>
                <Text style={styles.topbarTitle}>{isDesktop ? 'DEMAC Corporation' : activeLabel}</Text>
                {!isDesktop ? <Text style={styles.topbarSubtitle}>Professional Cooling Solutions</Text> : null}
              </View>
            </View>
            <View style={styles.topbarActions}>
              {isDesktop ? <TopAction icon="＋" label="Nueva" onPress={() => setActiveScreen('agenda')} /> : null}
              {isDesktop ? <TopAction icon="⌕" label="Buscar" /> : null}
              {isDesktop ? <TopAction icon="?" label="Ayuda" /> : null}
              <Pressable style={styles.bell}><Text style={styles.bellText}>♢</Text><View style={styles.bellDot} /></Pressable>
              <View style={styles.profileCircle}><Text style={styles.profileText}>{initials(currentUser?.name)}</Text></View>
            </View>
          </View>
          <View style={styles.screenHeader}>
            <View>
              <Text style={styles.screenTitle}>{activeLabel}</Text>
              <Text style={styles.screenSubtitle}>Professional Cooling Solutions</Text>
            </View>
            <View style={styles.connection}><View style={styles.onlineDot} /><Text style={styles.onlineText}>Sistema conectado</Text></View>
          </View>
          <View style={styles.content}>{content}</View>

          {!isDesktop ? (
            <View style={styles.bottomNav}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bottomNavInner}>
                {availableItems.map((item) => <Pressable key={item.key} onPress={() => setActiveScreen(item.key)} style={[styles.bottomItem, activeScreen === item.key && styles.bottomItemActive]}><Text style={[styles.bottomIcon, activeScreen === item.key && styles.bottomTextActive]}>{item.icon}</Text><Text style={[styles.bottomLabel, activeScreen === item.key && styles.bottomTextActive]} numberOfLines={1}>{item.label}</Text></Pressable>)}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function TopAction({ icon, label, onPress }: { icon: string; label: string; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={styles.topAction}><Text style={styles.topActionIcon}>{icon}</Text><Text style={styles.topActionText}>{label}</Text></Pressable>;
}

function NavButton({ item, active, onPress }: { item: (typeof navItems)[number]; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.navItem, active && styles.navItemActive, pressed && { opacity: 0.84 }]}><Text style={[styles.navIcon, active && styles.navTextActive]}>{item.icon}</Text><Text style={[styles.navLabel, active && styles.navTextActive]}>{item.label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 232, backgroundColor: colors.sidebar, paddingHorizontal: 16, paddingTop: Platform.OS === 'web' ? 12 : 8, paddingBottom: 14 },
  logoPanel: { backgroundColor: '#FFFFFF', marginHorizontal: -16, marginTop: Platform.OS === 'web' ? -12 : -8, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  brandName: { color: colors.brandBlue, fontWeight: '900', fontSize: 29, letterSpacing: -1.4 },
  brandSub: { color: colors.brandBlue, fontWeight: '700', fontSize: 8, marginTop: -2 },
  newButton: { marginTop: 22, minHeight: 46, borderWidth: 1, borderColor: '#B8C0CC', borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 11 },
  newIcon: { color: colors.primary, fontWeight: '900', fontSize: 20 },
  newText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  nav: { gap: 7, paddingTop: 18, paddingBottom: 20 },
  navItem: { minHeight: 42, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10 },
  navItemActive: { backgroundColor: '#1F7A2E' },
  navIcon: { color: '#FFFFFF', width: 22, textAlign: 'center', fontSize: 16, fontWeight: '900', opacity: 0.92 },
  navLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, opacity: 0.94 },
  navTextActive: { color: '#FFFFFF', opacity: 1 },
  trialBox: { backgroundColor: '#222B36', borderRadius: 10, padding: 14, gap: 8, marginBottom: 14 },
  trialTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  trialText: { color: '#D1D5DB', fontSize: 11, lineHeight: 16 },
  trialButton: { backgroundColor: colors.primary, borderRadius: 7, paddingVertical: 9, alignItems: 'center', marginTop: 4 },
  trialButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  userBox: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#2E3742' },
  userAvatar: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
  userName: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  userRole: { color: '#C6CBD3', fontSize: 10, marginTop: 2 },
  logoutRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  logoutIcon: { color: '#E5E7EB', fontSize: 18 },
  logoutLabel: { color: '#E5E7EB', fontWeight: '700', fontSize: 13 },
  main: { flex: 1, backgroundColor: colors.background },
  topbar: { height: 72, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 },
  topbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  menuButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  menuText: { color: colors.text, fontSize: 24, lineHeight: 26 },
  topbarTitle: { color: colors.text, fontWeight: '800', fontSize: 14 },
  topbarSubtitle: { color: colors.muted, fontSize: 10, marginTop: 2 },
  topbarActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  topAction: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  topActionIcon: { color: '#111827', fontSize: 20, fontWeight: '800' },
  topActionText: { color: '#111827', fontSize: 13, fontWeight: '700' },
  bell: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  bellText: { color: colors.text, fontSize: 20 },
  bellDot: { position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  profileCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  profileText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  screenHeader: { minHeight: 58, backgroundColor: '#FFFFFF', paddingHorizontal: 28, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEF0F2', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  screenTitle: { color: colors.text, fontWeight: '900', fontSize: 17 },
  screenSubtitle: { color: colors.muted, fontSize: 10, marginTop: 2 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  onlineText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  content: { flex: 1 },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: colors.border, minHeight: 66 },
  bottomNavInner: { alignItems: 'stretch', paddingHorizontal: 6 },
  bottomItem: { width: 82, minHeight: 65, alignItems: 'center', justifyContent: 'center', gap: 3, borderTopWidth: 3, borderTopColor: 'transparent' },
  bottomItemActive: { borderTopColor: colors.primary, backgroundColor: colors.primaryLight },
  bottomIcon: { color: colors.muted, fontSize: 16, fontWeight: '900' },
  bottomLabel: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  bottomTextActive: { color: colors.primary },
});
