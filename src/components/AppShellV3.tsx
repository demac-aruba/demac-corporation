import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { pushHistoryScreen, readHistoryScreen, replaceHistoryScreen, subscribeToScreenHistory, useWebBackLayer } from '../navigation/appHistory';
import { useAppState } from '../state/AppState';
import { colors, roleLabels } from '../theme';
import { ScreenKey, UserRole } from '../types';
import { AgendaHubScreen } from '../screens/AgendaHubScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { ClientsScreen } from '../screens/ClientsScreen';
import { DashboardScreenV2 } from '../screens/DashboardScreenV2';
import { FinanceScreen } from '../screens/FinanceScreen';
import { EmployeesTimesheetScreen } from '../screens/EmployeesTimesheetScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { OfficeReportReviewScreen } from '../screens/OfficeReportReviewScreen';
import { SettingsHubScreen } from '../screens/SettingsHubScreen';
import { TeamHubScreen } from '../screens/TeamHubScreen';
import { TechnicianScreen } from '../screens/TechnicianScreen';
import { WorkOrdersScreen } from '../screens/WorkOrdersScreen';

type NavGroup = 'Operaciones' | 'Negocio' | 'Sistema';
type NavItem = { key: ScreenKey; label: string; group: NavGroup; roles: UserRole[] };

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Centro de control', group: 'Operaciones', roles: ['admin', 'office', 'supervisor', 'accounting', 'inventory'] },
  { key: 'agenda', label: 'Agenda y despacho', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },
  { key: 'clients', label: 'Clientes', group: 'Operaciones', roles: ['admin', 'office', 'supervisor', 'accounting'] },
  { key: 'workOrders', label: 'Órdenes', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },
  { key: 'reportReview', label: 'Revisión', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },
  { key: 'team', label: 'Equipo y vans', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },
  { key: 'technician', label: 'Mi trabajo', group: 'Operaciones', roles: ['admin', 'supervisor', 'technician'] },
  { key: 'catalog', label: 'Catálogo', group: 'Negocio', roles: ['admin', 'office', 'supervisor'] },
  { key: 'sales', label: 'Ventas', group: 'Negocio', roles: ['admin', 'office', 'accounting'] },
  { key: 'inventory', label: 'Inventario', group: 'Negocio', roles: ['admin', 'supervisor', 'inventory'] },
  { key: 'employees', label: 'Empleados', group: 'Negocio', roles: ['admin', 'accounting'] },
  { key: 'finance', label: 'Cuentas', group: 'Negocio', roles: ['admin', 'accounting'] },
  { key: 'settings', label: 'Configuración', group: 'Sistema', roles: ['admin'] },
];

const groupLabels: NavGroup[] = ['Operaciones', 'Negocio', 'Sistema'];

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
  const desktop = width >= 940;
  const wide = width >= 1220;
  const availableItems = useMemo(() => navItems.filter((item) => currentUser && item.roles.includes(currentUser.role)), [currentUser]);
  const availableScreenKeys = useMemo(() => availableItems.map((item) => item.key), [availableItems]);
  const defaultScreen: ScreenKey = currentUser?.role === 'technician' ? 'technician' : currentUser?.role === 'inventory' ? 'inventory' : currentUser?.role === 'accounting' ? 'finance' : 'dashboard';
  const requestedScreen = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const value = new URLSearchParams(window.location.search).get('screen') as ScreenKey | null;
    return value && availableItems.some((item) => item.key === value) ? value : undefined;
  }, [availableItems]);
  const [activeScreen, setActiveScreen] = useState<ScreenKey>(() => readHistoryScreen<ScreenKey>(availableScreenKeys) ?? requestedScreen ?? defaultScreen);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  useWebBackLayer(profileMenuVisible, () => setProfileMenuVisible(false), 'account-menu');

  const activeItem = availableItems.find((item) => item.key === activeScreen);
  const profileMenuWidth = Math.min(350, Math.max(280, width - 24));

  useEffect(() => {
    const restoredScreen = readHistoryScreen<ScreenKey>(availableScreenKeys);
    const nextScreen = restoredScreen ?? requestedScreen ?? (availableScreenKeys.includes(activeScreen) ? activeScreen : defaultScreen);
    if (nextScreen !== activeScreen) setActiveScreen(nextScreen);
    replaceHistoryScreen(nextScreen);
  }, [currentUser?.id, defaultScreen, requestedScreen, availableScreenKeys]);

  useEffect(() => subscribeToScreenHistory((screen) => {
    if (screen && availableScreenKeys.includes(screen as ScreenKey)) {
      setActiveScreen(screen as ScreenKey);
      return;
    }
    setActiveScreen(defaultScreen);
    replaceHistoryScreen(defaultScreen);
  }), [availableScreenKeys, defaultScreen]);

  const navigate = (screen: ScreenKey) => {
    if (!availableScreenKeys.includes(screen) || screen === activeScreen) return;
    pushHistoryScreen(screen);
    setActiveScreen(screen);
  };

  const handleLogout = async () => {
    setProfileMenuVisible(false);
    await logout();
  };

  let content: ReactNode;
  switch (activeScreen) {
    case 'agenda': content = <AgendaHubScreen />; break;
    case 'clients': content = <ClientsScreen />; break;
    case 'catalog': content = <CatalogScreen />; break;
    case 'workOrders': content = <WorkOrdersScreen />; break;
    case 'reportReview': content = <OfficeReportReviewScreen />; break;
    case 'team': content = <TeamHubScreen />; break;
    case 'technician': content = <TechnicianScreen />; break;
    case 'sales': content = <FinanceScreen salesMode />; break;
    case 'inventory': content = <InventoryScreen />; break;
    case 'employees': content = <EmployeesTimesheetScreen />; break;
    case 'finance': content = <FinanceScreen />; break;
    case 'settings': content = <SettingsHubScreen />; break;
    default: content = <DashboardScreenV2 navigate={navigate} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        <View style={styles.masthead}>
          <View style={styles.brandRow}>
            <Pressable onPress={() => navigate('dashboard')} style={styles.brand}>
              <View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View>
              <View>
                <Text style={styles.brandName}>DEMAC</Text>
                {wide ? <Text style={styles.brandDescriptor}>Professional Cooling Solutions · ERP</Text> : null}
              </View>
            </Pressable>

            {desktop ? (
              <View style={styles.workspaceIdentity}>
                <Text style={styles.workspaceKicker}>{activeItem?.group?.toUpperCase() ?? 'OPERACIONES'}</Text>
                <Text style={styles.workspaceTitle}>{activeItem?.label ?? 'Centro de control'}</Text>
              </View>
            ) : null}

            <View style={styles.mastheadActions}>
              <Pressable onPress={() => navigate('agenda')} style={({ pressed }) => [styles.newAppointment, pressed && styles.pressed]}>
                <Text style={styles.newAppointmentText}>{desktop ? '+ Nueva cita' : '+'}</Text>
              </Pressable>
              <Pressable onPress={() => setProfileMenuVisible(true)} style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}>
                <Text style={styles.avatarText}>{initials(currentUser?.name)}</Text>
              </Pressable>
            </View>
          </View>

          {desktop ? (
            <View style={styles.navigationBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navigationScroll}>
                {groupLabels.map((group) => {
                  const items = availableItems.filter((item) => item.group === group);
                  if (!items.length) return null;
                  return (
                    <View key={group} style={styles.navigationGroup}>
                      <Text style={styles.navigationGroupLabel}>{group}</Text>
                      <View style={styles.navigationItems}>
                        {items.map((item) => (
                          <Pressable key={item.key} onPress={() => navigate(item.key)} style={({ pressed }) => [styles.navItem, activeScreen === item.key && styles.navItemActive, pressed && styles.pressed]}>
                            <View style={[styles.navIndicator, activeScreen === item.key && styles.navIndicatorActive]} />
                            <Text style={[styles.navText, activeScreen === item.key && styles.navTextActive]}>{item.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <View style={styles.mobileContext}>
              <Text style={styles.mobileContextKicker}>{activeItem?.group ?? 'Operaciones'}</Text>
              <Text style={styles.mobileContextTitle}>{activeItem?.label ?? 'Centro de control'}</Text>
            </View>
          )}
        </View>

        <View style={styles.content}>{content}</View>

        {!desktop ? (
          <View style={styles.bottomNav}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bottomNavInner}>
              {availableItems.map((item) => (
                <Pressable key={item.key} onPress={() => navigate(item.key)} style={[styles.bottomItem, activeScreen === item.key && styles.bottomItemActive]}>
                  <View style={[styles.bottomDot, activeScreen === item.key && styles.bottomDotActive]} />
                  <Text style={[styles.bottomLabel, activeScreen === item.key && styles.bottomLabelActive]} numberOfLines={1}>{item.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <Modal visible={profileMenuVisible} transparent animationType="fade" onRequestClose={() => setProfileMenuVisible(false)}>
        <View style={styles.profileOverlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar menú de cuenta" style={StyleSheet.absoluteFill} onPress={() => setProfileMenuVisible(false)} />
          <View style={[styles.profileCard, { width: profileMenuWidth }]}>
            <View style={styles.profileHeader}>
              <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials(currentUser?.name)}</Text></View>
              <View style={styles.profileIdentity}>
                <Text style={styles.profileName} numberOfLines={2}>{currentUser?.name ?? 'Usuario DEMAC'}</Text>
                <Text style={styles.profileEmail} numberOfLines={1}>{currentUser?.email ?? ''}</Text>
                {currentUser ? <Text style={styles.profileRole}>{roleLabels[currentUser.role]}</Text> : null}
              </View>
              <Pressable onPress={() => setProfileMenuVisible(false)} style={styles.profileClose}><Text style={styles.profileCloseText}>×</Text></Pressable>
            </View>
            <View style={styles.profileRule} />
            <Pressable onPress={() => void handleLogout()} style={({ pressed }) => [styles.logoutItem, pressed && styles.pressed]}>
              <View><Text style={styles.logoutTitle}>Cerrar sesión</Text><Text style={styles.logoutCopy}>Volver al acceso de DEMAC.</Text></View>
              <Text style={styles.logoutArrow}>→</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  root: { flex: 1, backgroundColor: colors.background },
  masthead: { backgroundColor: colors.navy, borderBottomWidth: 1, borderBottomColor: '#1A2A40' },
  brandRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, gap: 24 },
  brand: { minWidth: 220, flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 39, height: 39, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  brandName: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.7 },
  brandDescriptor: { color: '#7187A5', fontSize: 8, fontWeight: '700', marginTop: 2 },
  workspaceIdentity: { flex: 1, borderLeftWidth: 1, borderLeftColor: '#24354C', paddingLeft: 22 },
  workspaceKicker: { color: '#7187A5', fontSize: 7, fontWeight: '900', letterSpacing: 1.2 },
  workspaceTitle: { color: '#DCE5F1', fontSize: 12, fontWeight: '800', marginTop: 3 },
  mastheadActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 10 },
  newAppointment: { minHeight: 38, borderRadius: 11, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  newAppointmentText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  avatar: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, borderColor: '#31435B', backgroundColor: '#142237', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  navigationBar: { minHeight: 54, borderTopWidth: 1, borderTopColor: '#17283E', backgroundColor: '#0E1A2A' },
  navigationScroll: { paddingHorizontal: 18, alignItems: 'stretch' },
  navigationGroup: { flexDirection: 'row', alignItems: 'center', borderRightWidth: 1, borderRightColor: '#203047', marginRight: 8, paddingRight: 8 },
  navigationGroupLabel: { color: '#526983', fontSize: 7, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 9 },
  navigationItems: { flexDirection: 'row', alignItems: 'stretch' },
  navItem: { minHeight: 53, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  navItemActive: { borderBottomColor: colors.primary, backgroundColor: '#132136' },
  navIndicator: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#40536C' },
  navIndicatorActive: { backgroundColor: colors.primary },
  navText: { color: '#91A3BB', fontSize: 9, fontWeight: '800' },
  navTextActive: { color: '#FFFFFF' },
  mobileContext: { paddingHorizontal: 16, paddingBottom: 12 },
  mobileContextKicker: { color: '#68809F', fontSize: 7, fontWeight: '900', textTransform: 'uppercase' },
  mobileContextTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', marginTop: 2 },
  content: { flex: 1, backgroundColor: colors.background },
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 68, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: colors.border },
  bottomNavInner: { paddingHorizontal: 5, alignItems: 'stretch' },
  bottomItem: { width: 96, minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 5 },
  bottomItemActive: { backgroundColor: colors.primaryLight },
  bottomDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#CBD2DC' },
  bottomDotActive: { backgroundColor: colors.primary },
  bottomLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', textAlign: 'center' },
  bottomLabelActive: { color: colors.primaryDark },
  profileOverlay: { flex: 1, backgroundColor: 'rgba(3, 9, 18, 0.42)' },
  profileCard: { position: 'absolute', top: 66, right: 14, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 18, shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 10 },
  profileHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  profileAvatar: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  profileIdentity: { flex: 1 },
  profileName: { color: colors.text, fontSize: 13, fontWeight: '900' },
  profileEmail: { color: colors.muted, fontSize: 9, marginTop: 4 },
  profileRole: { color: colors.primary, fontSize: 8, fontWeight: '900', marginTop: 6 },
  profileClose: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#F1F4F8', alignItems: 'center', justifyContent: 'center' },
  profileCloseText: { color: colors.text, fontSize: 19 },
  profileRule: { height: 1, backgroundColor: colors.border, marginVertical: 15 },
  logoutItem: { minHeight: 56, borderRadius: 12, backgroundColor: colors.dangerLight, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logoutTitle: { color: colors.danger, fontSize: 11, fontWeight: '900' },
  logoutCopy: { color: colors.muted, fontSize: 8, marginTop: 3 },
  logoutArrow: { color: colors.danger, fontSize: 16, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});
