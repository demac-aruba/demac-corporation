import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AgendaScreen } from './AgendaScreen';
import { AgendaScheduleScreen } from './AgendaScheduleScreen';
import { colors } from '../theme';

type AgendaTab = 'complete' | 'halfDays';

export function AgendaHubScreen() {
  const [tab, setTab] = useState<AgendaTab>('complete');

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Pressable
          onPress={() => setTab('complete')}
          style={[styles.tab, tab === 'complete' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'complete' && styles.tabTextActive]}>Agenda completa</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('halfDays')}
          style={[styles.tab, tab === 'halfDays' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'halfDays' && styles.tabTextActive]}>Tardes libres</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        {tab === 'complete' ? <AgendaScreen /> : <AgendaScheduleScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 26,
    paddingTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  tabTextActive: { color: colors.primaryDark },
  content: { flex: 1 },
});
