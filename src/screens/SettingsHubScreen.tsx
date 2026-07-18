import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { UserManagementCard } from '../components/UserManagementCard';
import { colors } from '../theme';
import { SettingsScreen } from './SettingsScreen';

type SettingsTab = 'users' | 'calendar';

export function SettingsHubScreen() {
  const [tab, setTab] = useState<SettingsTab>('users');

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('users')} style={[styles.tab, tab === 'users' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'users' && styles.tabTextActive]}>Usuarios y accesos</Text>
        </Pressable>
        <Pressable onPress={() => setTab('calendar')} style={[styles.tab, tab === 'calendar' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'calendar' && styles.tabTextActive]}>Calendario y empresa</Text>
        </Pressable>
      </View>
      {tab === 'users' ? (
        <ScrollView contentContainerStyle={styles.userPage} keyboardShouldPersistTaps="handled">
          <UserManagementCard />
        </ScrollView>
      ) : <SettingsScreen />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: colors.border, flexWrap: 'wrap' },
  tab: { minHeight: 38, paddingHorizontal: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F5F7', borderWidth: 1, borderColor: 'transparent' },
  tabActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  tabText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  tabTextActive: { color: colors.primaryDark },
  userPage: { padding: 24, paddingBottom: 100 },
});
