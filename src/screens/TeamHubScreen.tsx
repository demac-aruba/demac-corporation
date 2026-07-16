import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TeamScreen } from './TeamScreen';
import { VanHalfDaysScreen } from './VanHalfDaysScreen';
import { colors } from '../theme';

type TeamHubTab = 'operations' | 'halfDays';

export function TeamHubScreen() {
  const [tab, setTab] = useState<TeamHubTab>('operations');
  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('operations')} style={[styles.tab, tab === 'operations' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'operations' && styles.tabTextActive]}>Equipo y flota</Text>
        </Pressable>
        <Pressable onPress={() => setTab('halfDays')} style={[styles.tab, tab === 'halfDays' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'halfDays' && styles.tabTextActive]}>Tardes libres</Text>
        </Pressable>
      </View>
      <View style={styles.content}>{tab === 'operations' ? <TeamScreen /> : <VanHalfDaysScreen />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  tabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 26, paddingTop: 14, paddingBottom: 0, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  tabTextActive: { color: colors.primaryDark },
  content: { flex: 1 },
});
