import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAppState } from '../state/AppState';
import { pushHistoryScreen, readHistoryScreen, replaceHistoryScreen, subscribeToScreenHistory, useWebBackLayer } from '../navigation/appHistory';
import { colors, roleLabels } from '../theme';
import { ScreenKey, UserRole } from '../types';
import { AgendaHubScreen } from '../screens/AgendaHubScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { ClientsScreen } from '../screens/ClientsScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { FinanceScreen } from '../screens/FinanceScreen';
import { EmployeesTimesheetScreen } from '../screens/EmployeesTimesheetScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { SettingsHubScreen } from '../screens/SettingsHubScreen';
import { TeamHubScreen } from '../screens/TeamHubScreen';
import { TechnicianScreen } from '../screens/TechnicianScreen';
import { WorkOrdersScreen } from '../screens/WorkOrdersScreen';

type NavGroup = 'Operaciones' | 'Negocio' | 'Sistema';
type NavItem = { key: ScreenKey; label: string; short: string; group: NavGroup; roles: UserRole[] };

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Centro de control', short: 'CC', group: 'Operaciones', roles: ['admin', 'office', 'supervisor', 'accounting', 'inventory'] },
  { key: 'agenda', label: 'Agenda y despacho', short: 'AD', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },
  { key: 'clients', label: 'Clientes', short: 'CL', group: 'Operaciones', roles: ['admin', 'office', 'supervisor', 'accounting'] },
  { key: 'workOrders', label: 'Órdenes de trabajo', short: 'OT', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },
  { key: 'technician', label: 'Mi trabajo', short: 'MT', group: 'Operaciones', roles: ['admin', 'supervisor', 'technician'] },
  { key: 'team', label: 'Equipo y vans', short: 'EV', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },
  { key: 'catalog', label: 'Catálogo', short: 'CA', group: 'Negocio', roles: ['admin', 'office', 'supervisor'] },
  { key: 'sales', label: 'Ventas', short: 'VE', group: 'Negocio', roles: ['admin', 'office', 'accounting'] },
  { key: 'inventory', label: 'Inventario', short: 'IN', group: 'Negocio', roles: ['admin', 'supervisor', 'inventory'] },
  { key: 'employees', label: 'Empleados', short: 'EM', group: 'Negocio', roles: ['admin', 'accounting'] },
  { key: 'finance', label: 'Cuentas', short: 'CU', group: 'Negocio', roles: ['admin', 'accounting'] },
  { key: 'settings', label: 'Configuración', short: 'CF', group: 'Sistema', roles: ['admin'] },
];

const navGroups: NavGroup[] = ['Operaciones', 'Negocio', 'Sistema'];

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
  const isDesktop = width >= 980;
  const isWideDesktop = width >= 1180;
  const availableItems = useMemo(() => navItems.filter((item) => currentUser && item.roles.includes(currentUser.role)), [currentUser]);
  const availableScreenKeys = useMemo(() => availableItems.map((item) => item.key), [availableItems]);
  const defaultScreen: ScreenKey = currentUser?.role === 'technician' ? 'technician' : currentUser?.role === 'inventory' ? 'inventory' : currentUser?.role === 'accounting' ? 'finance' : 'dashboard';
  const [activeScreen, setActiveScreen] = useState<ScreenKey>(() => readHistoryScreen<ScreenKey>(availableScreenKeys) ?? defaultScreen);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  useWebBackLayer(profileMenuVisible, () => setProfileMenuVisible(false), 'account-menu');
  const activeItem = availableItems.find((item) => item.key === activeScreen);
  const activeLabel = activeItem?.label ?? 'Centro de control';
  const profileMenuWidth = Math.min(340, Math.max(270, width - 24));

  useEffect(() => {
    const restoredScreen = readHistoryScreen<ScreenKey>(availableScreenKeys);
    const nextScreen = restoredScreen ?? (availableScreenKeys.includes(activeScreen) ? activeScreen : defaultScreen);
    if (nextScreen !== activeScreen) setActiveScreen(nextScreen);
    replaceHistoryScreen(nextScreen);
  }, [currentUser?.id, defaultScreen, availableScreenKeys]);

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

  // Compatibility markers for the idempotent navigation-history patch:
  // onPress={() => navigate('agenda')} style={styles.createItem}
  // onPress={() => navigate(item.key)} />
  // onPress={() => navigate('agenda')} />
  // onPress={() => navigate(item.key)} style={[styles.bottomItem

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
    case 'team': content = <TeamHubScreen />; break;
    case 'technician': content = <TechnicianScreen />; break;
    case 'sales': content = <FinanceScreen salesMode />; break;
    case 'inventory': content = <InventoryScreen />; break;
    case 'employees': content = <EmployeesTimesheetScreen />; break;
    case 'finance': content = <FinanceScreen />; break;
    case 'settings': content = <SettingsHubScreen />; break;
    default: content = <DashboardScreen navigate={navigate} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        {isDesktop ? (
          <View style={[styles.sidebar, !isWideDesktop && styles.sidebarCompact]}>
            <View style={styles.brandBlock}>
              <View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View>
              {isWideDesktop ? (
                <View style={styles.brandCopy}>
                  <Text style={styles.brandName}>DEMAC</Text>
                  <Text style={styles.brandTagline}>Operations OS</Text>
                </View>
              ) : null}
            </View>

            <Pressable onPress={() => navigate('agenda')} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}>
              <View style={styles.primaryActionIcon}><Text style={styles.primaryActionIconText}>+</Text></View>
              {isWideDesktop ? <Text style={styles.primaryActionText}>Nueva cita</Text> : null}
            </Pressable>

            <ScrollView contentContainerStyle={styles.sidebarScroll} showsVerticalScrollIndicator={false}>
              {navGroups.map((group) => {
                const groupItems = availableItems.filter((item) => item.group === group);
                if (!groupItems.length) return null;
                return (
                  <View key={group} style={styles.navGroup}>
                    {isWideDesktop ? <Text style={styles.navGroupLabel}>{group.toUpperCase()}</Text> : null}
                    {groupItems.map((item) => (
                      <SidebarButton key={item.key} item={item} active={activeScreen === item.key} compact={!isWideDesktop} onPress={() => navigate(item.key)} />
                    ))}
                  </View>
                );
              })}
            </ScrollView>

            <Pressable onPress={() => setProfileMenuVisible(true)} style={({ pressed }) => [styles.sidebarProfile, !isWideDesktop && styles.sidebarProfileCompact, pressed && styles.pressed]}>
              <View style={styles.sidebarAvatar}><Text style={styles.sidebarAvatarText}>{initials(currentUser?.name)}</Text></View>
              {isWideDesktop ? (
                <View style={styles.sidebarProfileCopy}>
                  <Text style={styles.sidebarProfileName} numberOfLines={1}>{currentUser?.name ?? 'Usuario DEMAC'}</Text>
                  <Text style={styles.sidebarProfileRole} numberOfLines={1}>{currentUser ? roleLabels[currentUser.role] : ''}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        ) : null}

        <View style={styles.main}>
          <View style={styles.topbar}>
            <View style={styles.pageIdentity}>
              {!isDesktop ? (
                <View style={styles.mobileBrandMark}><Text style={styles.mobileBrandMarkText}>D</Text></View>
              ) : null}
              <View>
                <Text style={styles.pageEyebrow}>{activeItem?.group ?? 'Operaciones'}</Text>
                <Text style={styles.pageTitle}>{activeLabel}</Text>
              </View>
            </View>

            {isDesktop ? (
              <View style={styles.searchBox}>
                <Text style={styles.searchBadge}>⌕</Text>
                <Text style={styles.searchPlaceholder}>Buscar clientes, órdenes, equipos y reportes</Text>
                <View style={styles.searchShortcut}><Text style={styles.searchShortcutText}>CTRL K</Text></View>
              </View>
            ) : null}

            <View style={styles.topbarActions}>
              <Pressable onPress={() => navigate('agenda')} style={({ pressed }) => [styles.quickButton, pressed && styles.pressed]}>
                <Text style={styles.quickButtonText}>{isDesktop ? 'Crear cita' : '+'}</Text>
              </Pressable>
              <Pressable onPress={() => setProfileMenuVisible(true)} style={({ pressed }) => [styles.topbarAvatar, pressed && styles.pressed]}>
                <Text style={styles.topbarAvatarText}>{initials(currentUser?.name)}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.content}>{content}</View>

          {!isDesktop ? (
            <View style={styles.bottomNav}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bottomNavInner}>
                {availableItems.map((item) => (
                  <Pressable key={item.key} onPress={() => navigate(item.key)} style={[styles.bottomItem, activeScreen === item.key && styles.bottomItemActive]}>
                    <View style={[styles.bottomBadge, activeScreen === item.key && styles.bottomBadgeActive]}>
                      <Text style={[styles.bottomBadgeText, activeScreen === item.key && styles.bottomBadgeTextActive]}>{item.short}</Text>
                    </View>
                    <Text style={[styles.bottomLabel, activeScreen === item.key && styles.bottomLabelActive]} numberOfLines={1}>{item.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </View>

      <Modal visible={profileMenuVisible} transparent animationType="fade" onRequestClose={() => setProfileMenuVisible(false)}>
        <View style={styles.profileMenuOverlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar menú de cuenta" style={StyleSheet.absoluteFill} onPress={() => setProfileMenuVisible(false)} />
          <View style={[styles.profileMenuCard, { width: profileMenuWidth }]}>
            <View style={styles.profileMenuHeader}>
              <View style={styles.profileMenuAvatar}><Text style={styles.profileMenuAvatarText}>{initials(currentUser?.name)}</Text></View>
              <View style={styles.profileMenuIdentity}>
                <Text style={styles.profileMenuName} numberOfLines={2}>{currentUser?.name ?? 'Usuario DEMAC'}</Text>
                <Text style={styles.profileMenuEmail} numberOfLines={1}>{currentUser?.email ?? ''}</Text>
                {currentUser ? <Text style={styles.profileMenuRole}>{roleLabels[currentUser.role]}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Cerrar menú" onPress={() => setProfileMenuVisible(false)} style={styles.profileMenuClose}>
                <Text style={styles.profileMenuCloseText}>×</Text>
              </Pressable>
            </View>
            <View style={styles.profileMenuDivider} />
            <Pressable onPress={() => void handleLogout()} style={({ pressed }) => [styles.logoutMenuItem, pressed && styles.pressed]}>
              <Text style={styles.logoutMenuTitle}>Cerrar sesión</Text>
              <Text style={styles.logoutMenuHelp}>Salir de esta cuenta y volver al inicio de sesión.</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SidebarButton({ item, active, compact, onPress }: { item: NavItem; active: boolean; compact: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={item.label} style={({ pressed }) => [styles.navItem, compact && styles.navItemCompact, active && styles.navItemActive, pressed && styles.pressed]}>
      <View style={[styles.navBadge, active && styles.navBadgeActive]}>
        <Text style={[styles.navBadgeText, active && styles.navBadgeTextActive]}>{item.short}</Text>
      </View>
      {!compact ? <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>{item.label}</Text> : null}
      {!compact && active ? <View style={styles.activeDot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  sidebar: { width: 236, backgroundColor: colors.navy, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 14 },
  sidebarCompact: { width: 78, paddingHorizontal: 9 },
  brandBlock: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 6 },
  brandMark: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#FFFFFF', fontSize: 19, fontWeight: '900' },
  brandCopy: { flex: 1 },
  brandName: { color: '#FFFFFF', fontWeight: '900', fontSize: 16, letterSpacing: 0.6 },
  brandTagline: { color: '#8EA0BC', fontSize: 9, fontWeight: '700', marginTop: 2, letterSpacing: 0.4 },
  primaryAction: { minHeight: 44, borderRadius: 12, backgroundColor: colors.primary, marginTop: 16, marginBottom: 15, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryActionIcon: { width: 24, height: 24, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  primaryActionIconText: { color: '#FFFFFF', fontSize: 19, lineHeight: 21, fontWeight: '700' },
  primaryActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  sidebarScroll: { paddingBottom: 12 },
  navGroup: { marginBottom: 16, gap: 4 },
  navGroupLabel: { color: '#6F819C', fontSize: 8, fontWeight: '900', letterSpacing: 1.1, paddingHorizontal: 10, marginBottom: 4 },
  navItem: { minHeight: 42, borderRadius: 10, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  navItemCompact: { justifyContent: 'center', paddingHorizontal: 0 },
  navItemActive: { backgroundColor: '#16243A' },
  navBadge: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#17263D', borderWidth: 1, borderColor: '#263953', alignItems: 'center', justifyContent: 'center' },
  navBadgeActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  navBadgeText: { color: '#9CB0CC', fontSize: 8, fontWeight: '900', letterSpacing: 0.2 },
  navBadgeTextActive: { color: '#FFFFFF' },
  navLabel: { flex: 1, color: '#B8C4D7', fontSize: 11, fontWeight: '700' },
  navLabelActive: { color: '#FFFFFF', fontWeight: '900' },
  activeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#61A5FF' },
  sidebarProfile: { minHeight: 56, borderTopWidth: 1, borderTopColor: '#1F3049', paddingTop: 13, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sidebarProfileCompact: { justifyContent: 'center', paddingHorizontal: 0 },
  sidebarAvatar: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#1A3152', borderWidth: 1, borderColor: '#31557E', alignItems: 'center', justifyContent: 'center' },
  sidebarAvatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 10 },
  sidebarProfileCopy: { flex: 1, minWidth: 0 },
  sidebarProfileName: { color: '#FFFFFF', fontWeight: '800', fontSize: 10 },
  sidebarProfileRole: { color: '#8194AF', fontSize: 8, marginTop: 2 },
  main: { flex: 1, backgroundColor: colors.background },
  topbar: { minHeight: 66, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 18, zIndex: 5 },
  pageIdentity: { minWidth: 210, flexDirection: 'row', alignItems: 'center', gap: 10 },
  mobileBrandMark: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  mobileBrandMarkText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  pageEyebrow: { color: colors.muted, fontSize: 8, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  pageTitle: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 2 },
  searchBox: { flex: 1, maxWidth: 520, minHeight: 38, borderRadius: 11, backgroundColor: '#F6F8FB', borderWidth: 1, borderColor: '#E5EAF1', paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchBadge: { color: '#344054', fontSize: 17, fontWeight: '800' },
  searchPlaceholder: { color: '#7A8799', fontSize: 11, flex: 1 },
  searchShortcut: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE2EA' },
  searchShortcutText: { color: '#8491A3', fontSize: 7, fontWeight: '900' },
  topbarActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 9 },
  quickButton: { minHeight: 36, minWidth: 36, borderRadius: 10, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: '#CFE2FF', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  quickButtonText: { color: colors.primaryDark, fontSize: 10, fontWeight: '900' },
  topbarAvatar: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  topbarAvatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 9 },
  content: { flex: 1, backgroundColor: colors.background },
  profileMenuOverlay: { flex: 1, backgroundColor: 'rgba(11,18,32,0.28)' },
  profileMenuCard: { position: 'absolute', top: 66, right: 12, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  profileMenuHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  profileMenuAvatar: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  profileMenuAvatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  profileMenuIdentity: { flex: 1, minWidth: 0 },
  profileMenuName: { color: colors.text, fontWeight: '900', fontSize: 13, lineHeight: 18 },
  profileMenuEmail: { color: colors.muted, fontSize: 10, marginTop: 3 },
  profileMenuRole: { color: colors.primaryDark, fontWeight: '800', fontSize: 9, marginTop: 5 },
  profileMenuClose: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  profileMenuCloseText: { color: colors.text, fontSize: 20, lineHeight: 21 },
  profileMenuDivider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  logoutMenuItem: { borderRadius: 12, padding: 12, backgroundColor: colors.dangerLight },
  logoutMenuTitle: { color: colors.danger, fontWeight: '900', fontSize: 11 },
  logoutMenuHelp: { color: colors.text, fontSize: 9, lineHeight: 14, marginTop: 3 },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: colors.border, minHeight: 70 },
  bottomNavInner: { alignItems: 'stretch', paddingHorizontal: 6 },
  bottomItem: { width: 92, minHeight: 69, alignItems: 'center', justifyContent: 'center', gap: 4, borderTopWidth: 3, borderTopColor: 'transparent' },
  bottomItemActive: { borderTopColor: colors.primary, backgroundColor: '#F7FAFF' },
  bottomBadge: { width: 28, height: 24, borderRadius: 7, backgroundColor: '#F0F3F7', alignItems: 'center', justifyContent: 'center' },
  bottomBadgeActive: { backgroundColor: colors.primaryLight },
  bottomBadgeText: { color: colors.muted, fontSize: 7, fontWeight: '900' },
  bottomBadgeTextActive: { color: colors.primaryDark },
  bottomLabel: { color: colors.muted, fontSize: 7, fontWeight: '800', maxWidth: 84 },
  bottomLabelActive: { color: colors.primaryDark },
  pressed: { opacity: 0.72 },
});