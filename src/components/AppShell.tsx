import React, { ReactNode, useMemo, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAppState } from '../state/AppState';
import { colors, roleLabels } from '../theme';
import { ScreenKey, UserRole } from '../types';
import { AgendaHubScreen } from '../screens/AgendaHubScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { ClientsScreen } from '../screens/ClientsScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { FinanceScreen } from '../screens/FinanceScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { SettingsHubScreen } from '../screens/SettingsHubScreen';
import { TeamHubScreen } from '../screens/TeamHubScreen';
import { TechnicianScreen } from '../screens/TechnicianScreen';
import { WorkOrdersScreen } from '../screens/WorkOrdersScreen';

const navItems: { key: ScreenKey; label: string; icon: string; roles: UserRole[] }[] = [
  { key: 'dashboard', label: 'Inicio', icon: '⌂', roles: ['admin', 'office', 'supervisor', 'accounting', 'inventory'] },
  { key: 'agenda', label: 'Agenda', icon: '▣', roles: ['admin', 'office', 'supervisor'] },
  { key: 'clients', label: 'Clientes', icon: '♙', roles: ['admin', 'office', 'supervisor', 'accounting'] },
  { key: 'catalog', label: 'Catálogo', icon: '▦', roles: ['admin', 'office', 'supervisor'] },
  { key: 'workOrders', label: 'Trabajos', icon: '☷', roles: ['admin', 'office', 'supervisor'] },
  { key: 'team', label: 'Equipo', icon: '♟', roles: ['admin', 'office', 'supervisor'] },
  { key: 'technician', label: 'Mi trabajo', icon: '✓', roles: ['admin', 'supervisor', 'technician'] },
  { key: 'sales', label: 'Ventas', icon: '$', roles: ['admin', 'office', 'accounting'] },
  { key: 'inventory', label: 'Inventario', icon: '◇', roles: ['admin', 'supervisor', 'inventory'] },
  { key: 'finance', label: 'Cuentas', icon: '▤', roles: ['admin', 'accounting'] },
  { key: 'settings', label: 'Ajustes', icon: '⚙', roles: ['admin'] },
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
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const activeLabel = availableItems.find((item) => item.key === activeScreen)?.label ?? 'Inicio';
  const profileMenuWidth = Math.min(320, Math.max(260, width - 24));

  const navigate = (screen: ScreenKey) => {
    if (availableItems.some((item) => item.key === screen)) setActiveScreen(screen);
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
    case 'team': content = <TeamHubScreen />; break;
    case 'technician': content = <TechnicianScreen />; break;
    case 'sales': content = <FinanceScreen salesMode />; break;
    case 'inventory': content = <InventoryScreen />; break;
    case 'finance': content = <FinanceScreen />; break;
    case 'settings': content = <SettingsHubScreen />; break;
    default: content = <DashboardScreen navigate={navigate} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        {isDesktop ? (
          <View style={styles.rail}>
            <View style={styles.railLogo}><Text style={styles.railLogoText}>❄</Text></View>
            <Pressable onPress={() => setActiveScreen('agenda')} style={styles.createItem}>
              <View style={styles.createCircle}><Text style={styles.createIcon}>＋</Text></View>
              <Text style={styles.createLabel}>Crear</Text>
            </Pressable>
            <ScrollView contentContainerStyle={styles.railNav} showsVerticalScrollIndicator={false}>
              {availableItems.map((item) => <RailButton key={item.key} item={item} active={activeScreen === item.key} onPress={() => setActiveScreen(item.key)} />)}
            </ScrollView>
            <Pressable onPress={() => void handleLogout()} style={styles.railFooter}>
              <Text style={styles.railFooterIcon}>↪</Text>
              <Text style={styles.railFooterLabel}>Salir</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.main}>
          <View style={styles.topbar}>
            <View style={styles.brandArea}>
              <Text style={styles.brandName}>DEMAC</Text>
              {!isDesktop ? <Text style={styles.mobilePage}>{activeLabel}</Text> : null}
            </View>

            {isDesktop ? (
              <View style={styles.searchBox}>
                <Text style={styles.searchIcon}>⌕</Text>
                <Text style={styles.searchPlaceholder}>Navegar. Buscar clientes, órdenes, reportes y más.</Text>
              </View>
            ) : null}

            <View style={styles.topbarActions}>
              {isDesktop ? <TopIcon icon="▣" label="Tareas" /> : null}
              {isDesktop ? <TopIcon icon="⚡" label="Rápido" onPress={() => setActiveScreen('agenda')} /> : null}
              {isDesktop ? <TopIcon icon="?" label="Ayuda" /> : null}
              <View style={styles.notification}><Text style={styles.notificationText}>♢</Text><View style={styles.notificationDot} /></View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir menú de cuenta"
                onPress={() => setProfileMenuVisible(true)}
                style={({ pressed }) => [styles.profileCircle, pressed && styles.profileCirclePressed]}
              >
                <Text style={styles.profileText}>{initials(currentUser?.name)}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.content}>{content}</View>

          {!isDesktop ? (
            <View style={styles.bottomNav}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bottomNavInner}>
                {availableItems.map((item) => (
                  <Pressable key={item.key} onPress={() => setActiveScreen(item.key)} style={[styles.bottomItem, activeScreen === item.key && styles.bottomItemActive]}>
                    <Text style={[styles.bottomIcon, activeScreen === item.key && styles.bottomTextActive]}>{item.icon}</Text>
                    <Text style={[styles.bottomLabel, activeScreen === item.key && styles.bottomTextActive]} numberOfLines={1}>{item.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </View>

      <Modal visible={profileMenuVisible} transparent animationType="fade" onRequestClose={() => setProfileMenuVisible(false)}>
        <View style={styles.profileMenuOverlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar menú de cuenta" style={StyleSheet.absoluteFillObject} onPress={() => setProfileMenuVisible(false)} />
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

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar sesión y cambiar de cuenta"
              onPress={() => void handleLogout()}
              style={({ pressed }) => [styles.logoutMenuItem, pressed && styles.logoutMenuItemPressed]}
            >
              <View style={styles.logoutMenuIcon}><Text style={styles.logoutMenuIconText}>↪</Text></View>
              <View style={styles.logoutMenuCopy}>
                <Text style={styles.logoutMenuTitle}>Cerrar sesión</Text>
                <Text style={styles.logoutMenuHelp}>Volver al inicio de sesión para entrar con otra cuenta.</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TopIcon({ icon, label, onPress }: { icon: string; label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.topIconButton}>
      <Text style={styles.topIconGlyph}>{icon}</Text>
      <Text style={styles.topIconLabel}>{label}</Text>
    </Pressable>
  );
}

function RailButton({ item, active, onPress }: { item: (typeof navItems)[number]; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.railItem, pressed && { opacity: 0.75 }]}>
      <View style={[styles.railIconBox, active && styles.railIconBoxActive]}><Text style={[styles.railIcon, active && styles.railIconActive]}>{item.icon}</Text></View>
      <Text style={[styles.railLabel, active && styles.railLabelActive]} numberOfLines={1}>{item.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  root: { flex: 1, flexDirection: 'row' },
  rail: { width: 72, backgroundColor: '#F3F5F7', borderRightWidth: 1, borderRightColor: '#E1E4E8', alignItems: 'center', paddingTop: 10, paddingBottom: 10 },
  railLogo: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandBlue, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  railLogoText: { color: '#FFFFFF', fontSize: 18 },
  createItem: { width: '100%', alignItems: 'center', paddingVertical: 8 },
  createCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#AAB1B9', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  createIcon: { color: colors.primary, fontWeight: '900', fontSize: 18, lineHeight: 20 },
  createLabel: { color: colors.text, fontSize: 9, fontWeight: '700', marginTop: 4 },
  railNav: { width: 72, alignItems: 'center', gap: 2, paddingVertical: 6 },
  railItem: { width: 68, minHeight: 58, alignItems: 'center', justifyContent: 'center' },
  railIconBox: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  railIconBoxActive: { backgroundColor: colors.primaryDark },
  railIcon: { color: '#252A31', fontSize: 17, fontWeight: '900' },
  railIconActive: { color: '#FFFFFF' },
  railLabel: { color: '#555B64', fontSize: 8, fontWeight: '700', marginTop: 3, maxWidth: 64, textAlign: 'center' },
  railLabelActive: { color: colors.text, fontWeight: '900' },
  railFooter: { width: 68, alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#DDE1E5' },
  railFooterIcon: { color: colors.text, fontSize: 17 },
  railFooterLabel: { color: colors.muted, fontSize: 8, fontWeight: '700', marginTop: 2 },
  main: { flex: 1, backgroundColor: '#FFFFFF' },
  topbar: { height: 56, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E1E4E8', paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 20, zIndex: 5 },
  brandArea: { width: 180 },
  brandName: { color: colors.text, fontWeight: '800', fontSize: 14 },
  mobilePage: { color: colors.muted, fontSize: 9, marginTop: 1 },
  searchBox: { flex: 1, maxWidth: 520, minHeight: 36, borderRadius: 6, backgroundColor: '#F0F2F4', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchIcon: { color: '#374151', fontSize: 18 },
  searchPlaceholder: { color: '#4B5563', fontSize: 12, flex: 1 },
  topbarActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 12 },
  topIconButton: { alignItems: 'center', minWidth: 34 },
  topIconGlyph: { color: colors.text, fontSize: 16, fontWeight: '800' },
  topIconLabel: { color: colors.muted, fontSize: 7, marginTop: 1 },
  notification: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  notificationText: { color: colors.text, fontSize: 19 },
  notificationDot: { position: 'absolute', top: 3, right: 4, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger, borderWidth: 1, borderColor: '#FFFFFF' },
  profileCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  profileCirclePressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  profileText: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 },
  profileMenuOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.18)' },
  profileMenuCard: { position: 'absolute', top: 60, right: 12, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 10 },
  profileMenuHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  profileMenuAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  profileMenuAvatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  profileMenuIdentity: { flex: 1, minWidth: 0 },
  profileMenuName: { color: colors.text, fontWeight: '900', fontSize: 13, lineHeight: 18 },
  profileMenuEmail: { color: colors.muted, fontSize: 10, marginTop: 3 },
  profileMenuRole: { color: colors.primaryDark, fontWeight: '800', fontSize: 9, marginTop: 5 },
  profileMenuClose: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F0F2F4', alignItems: 'center', justifyContent: 'center' },
  profileMenuCloseText: { color: colors.text, fontSize: 21, lineHeight: 22 },
  profileMenuDivider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  logoutMenuItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, padding: 10, backgroundColor: colors.dangerLight },
  logoutMenuItemPressed: { opacity: 0.72 },
  logoutMenuIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  logoutMenuIconText: { color: colors.danger, fontWeight: '900', fontSize: 18 },
  logoutMenuCopy: { flex: 1 },
  logoutMenuTitle: { color: colors.danger, fontWeight: '900', fontSize: 12 },
  logoutMenuHelp: { color: colors.text, fontSize: 9, lineHeight: 14, marginTop: 3 },
  content: { flex: 1, backgroundColor: '#FFFFFF' },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: colors.border, minHeight: 66 },
  bottomNavInner: { alignItems: 'stretch', paddingHorizontal: 6 },
  bottomItem: { width: 82, minHeight: 65, alignItems: 'center', justifyContent: 'center', gap: 3, borderTopWidth: 3, borderTopColor: 'transparent' },
  bottomItemActive: { borderTopColor: colors.primary, backgroundColor: colors.primaryLight },
  bottomIcon: { color: colors.muted, fontSize: 16, fontWeight: '900' },
  bottomLabel: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  bottomTextActive: { color: colors.primaryDark },
});