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
  { key: 'dashboard', label: 'Panel principal', icon: '⌂', roles: ['admin', 'office', 'supervisor', 'accounting', 'inventory'] },
  { key: 'agenda', label: 'Agenda', icon: '▣', roles: ['admin', 'office', 'supervisor'] },
  { key: 'clients', label: 'Clientes', icon: '♟', roles: ['admin', 'office', 'supervisor', 'accounting'] },
  { key: 'workOrders', label: 'Órdenes', icon: '⚒', roles: ['admin', 'office', 'supervisor'] },
  { key: 'technician', label: 'Mi trabajo', icon: '✓', roles: ['admin', 'supervisor', 'technician'] },
  { key: 'sales', label: 'Ventas', icon: '$', roles: ['admin', 'office', 'accounting'] },
  { key: 'inventory', label: 'Inventario', icon: '□', roles: ['admin', 'supervisor', 'inventory'] },
  { key: 'finance', label: 'Contabilidad', icon: '◫', roles: ['admin', 'accounting'] },
  { key: 'settings', label: 'Configuración', icon: '⚙', roles: ['admin'] },
];

export function AppShell() {
  const { currentUser, logout } = useAppState();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 920;
  const availableItems = useMemo(() => navItems.filter((item) => currentUser && item.roles.includes(currentUser.role)), [currentUser]);
  const defaultScreen: ScreenKey = currentUser?.role === 'technician' ? 'technician' : currentUser?.role === 'inventory' ? 'inventory' : currentUser?.role === 'accounting' ? 'finance' : 'dashboard';
  const [activeScreen, setActiveScreen] = useState<ScreenKey>(defaultScreen);

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
            <View style={styles.brand}>
              <View style={styles.logo}><Text style={styles.logoText}>❄</Text></View>
              <View><Text style={styles.brandName}>DEMAC</Text><Text style={styles.brandSub}>CORPORATION</Text></View>
            </View>
            <Text style={styles.environment}>ENTORNO DEMO</Text>
            <ScrollView contentContainerStyle={styles.nav} showsVerticalScrollIndicator={false}>
              {availableItems.map((item) => <NavButton key={item.key} item={item} active={activeScreen === item.key} onPress={() => setActiveScreen(item.key)} />)}
            </ScrollView>
            <View style={styles.userBox}>
              <View style={styles.userAvatar}><Text style={styles.userAvatarText}>{currentUser?.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.userName} numberOfLines={1}>{currentUser?.name}</Text><Text style={styles.userRole}>{currentUser ? roleLabels[currentUser.role] : ''}</Text></View>
              <Pressable onPress={logout} style={styles.logout}><Text style={styles.logoutText}>↪</Text></Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.main}>
          <View style={styles.topbar}>
            {!isDesktop ? <View style={styles.mobileBrand}><View style={styles.mobileLogo}><Text style={styles.mobileLogoText}>❄</Text></View><View><Text style={styles.mobileBrandName}>DEMAC</Text><Text style={styles.mobileBrandSub}>CORPORATION</Text></View></View> : <View><Text style={styles.topbarTitle}>{availableItems.find((item) => item.key === activeScreen)?.label}</Text><Text style={styles.topbarSubtitle}>Professional Cooling Solutions</Text></View>}
            <View style={styles.topbarRight}><View style={styles.onlineDot} /><Text style={styles.onlineText}>Sistema conectado</Text>{!isDesktop ? <Pressable onPress={logout} style={styles.mobileLogout}><Text style={styles.mobileLogoutText}>Salir</Text></Pressable> : null}</View>
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

function NavButton({ item, active, onPress }: { item: (typeof navItems)[number]; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.navItem, active && styles.navItemActive, pressed && { opacity: 0.8 }]}><Text style={[styles.navIcon, active && styles.navTextActive]}>{item.icon}</Text><Text style={[styles.navLabel, active && styles.navTextActive]}>{item.label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 245, backgroundColor: colors.navy, paddingHorizontal: 15, paddingTop: Platform.OS === 'web' ? 22 : 8, paddingBottom: 14 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 7 },
  logo: { width: 43, height: 43, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  logoText: { color: colors.primary, fontSize: 25 },
  brandName: { color: '#FFFFFF', fontWeight: '900', fontSize: 19, letterSpacing: 1.2 },
  brandSub: { color: '#82B8F2', fontWeight: '900', fontSize: 7, letterSpacing: 3.3 },
  environment: { color: '#8DB7E2', fontWeight: '900', fontSize: 8, letterSpacing: 1.5, marginTop: 20, marginBottom: 6, paddingHorizontal: 10 },
  nav: { gap: 4, paddingBottom: 20 },
  navItem: { minHeight: 44, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13 },
  navItemActive: { backgroundColor: colors.primary },
  navIcon: { color: '#8FA3BC', width: 21, textAlign: 'center', fontSize: 17, fontWeight: '900' },
  navLabel: { color: '#AFC0D3', fontWeight: '700', fontSize: 12 },
  navTextActive: { color: '#FFFFFF' },
  userBox: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#29405D' },
  userAvatar: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#27496E', alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 10 },
  userName: { color: '#FFFFFF', fontWeight: '800', fontSize: 10 },
  userRole: { color: '#8EA5BE', fontSize: 8, marginTop: 2 },
  logout: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  logoutText: { color: '#9EB2C8', fontSize: 18 },
  main: { flex: 1, backgroundColor: colors.background },
  topbar: { height: 66, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 },
  topbarTitle: { color: colors.text, fontWeight: '900', fontSize: 16 },
  topbarSubtitle: { color: colors.muted, fontSize: 9, marginTop: 2 },
  topbarRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  onlineText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  mobileBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mobileLogo: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  mobileLogoText: { color: '#FFFFFF', fontSize: 20 },
  mobileBrandName: { color: colors.text, fontWeight: '900', fontSize: 15, letterSpacing: 1 },
  mobileBrandSub: { color: colors.primary, fontWeight: '900', fontSize: 6, letterSpacing: 2.7 },
  mobileLogout: { marginLeft: 7, backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  mobileLogoutText: { color: colors.primary, fontWeight: '900', fontSize: 10 },
  content: { flex: 1 },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: colors.border, minHeight: 66 },
  bottomNavInner: { alignItems: 'stretch', paddingHorizontal: 6 },
  bottomItem: { width: 82, minHeight: 65, alignItems: 'center', justifyContent: 'center', gap: 3, borderTopWidth: 3, borderTopColor: 'transparent' },
  bottomItemActive: { borderTopColor: colors.primary, backgroundColor: '#F6FAFF' },
  bottomIcon: { color: colors.muted, fontSize: 16, fontWeight: '900' },
  bottomLabel: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  bottomTextActive: { color: colors.primary },
});
