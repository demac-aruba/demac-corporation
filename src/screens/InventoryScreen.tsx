import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';

export function InventoryScreen() {
  const { inventory, adjustInventory } = useAppState();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');
  const categories = ['Todos', ...Array.from(new Set(inventory.map((item) => item.category)))];
  const filtered = useMemo(() => inventory.filter((item) => (category === 'Todos' || item.category === category) && item.name.toLowerCase().includes(query.toLowerCase())), [inventory, query, category]);
  const totalValue = inventory.reduce((sum, item) => sum + item.quantity * item.cost, 0);
  const lowStock = inventory.filter((item) => item.quantity <= item.minimum);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle title="Inventario y almacén" subtitle="Control de equipos, refrigerantes, materiales y consumibles." />
      <View style={styles.metrics}>
        <Metric label="Valor estimado" value={formatMoney(totalValue)} icon="💰" />
        <Metric label="Artículos registrados" value={String(inventory.length)} icon="📦" />
        <Metric label="Inventario bajo" value={String(lowStock.length)} icon="⚠️" warning />
      </View>
      <Card>
        <View style={styles.toolbar}>
          <View style={{ flex: 1, minWidth: 260 }}><Input placeholder="Buscar producto…" value={query} onChangeText={setQuery} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {categories.map((item) => <Button key={item} compact variant={category === item ? 'primary' : 'secondary'} label={item} onPress={() => setCategory(item)} />)}
          </ScrollView>
        </View>

        <View style={styles.tableHeader}><Text style={[styles.th, { flex: 1.6 }]}>PRODUCTO</Text><Text style={[styles.th, { width: 110 }]}>CATEGORÍA</Text><Text style={[styles.th, { width: 100 }]}>CANTIDAD</Text><Text style={[styles.th, { width: 100 }]}>MÍNIMO</Text><Text style={[styles.th, { width: 110 }]}>COSTO</Text><Text style={[styles.th, { width: 145 }]}>AJUSTAR</Text></View>
        {filtered.map((item) => {
          const low = item.quantity <= item.minimum;
          return (
            <View key={item.id} style={[styles.tableRow, low && styles.lowRow]}>
              <View style={{ flex: 1.6, minWidth: 200 }}><Text style={styles.product}>{item.name}</Text><Text style={styles.location}>{item.location} · por {item.unit}</Text></View>
              <View style={{ width: 110 }}><Pill label={item.category} tone="info" /></View>
              <Text style={[styles.quantity, { width: 100 }, low && { color: colors.danger }]}>{item.quantity}</Text>
              <Text style={[styles.cell, { width: 100 }]}>{item.minimum}</Text>
              <Text style={[styles.cell, { width: 110 }]}>{formatMoney(item.cost)}</Text>
              <View style={styles.adjust}><Button compact variant="secondary" label="−" onPress={() => adjustInventory(item.id, -1)} /><Button compact variant="secondary" label="＋" onPress={() => adjustInventory(item.id, 1)} /></View>
            </View>
          );
        })}
      </Card>

      <Card>
        <SectionTitle title="Artículos que requieren reposición" subtitle="La cantidad actual está igual o por debajo del mínimo configurado." />
        <View style={styles.restockGrid}>
          {lowStock.map((item) => <View key={item.id} style={styles.restockItem}><View style={styles.restockIcon}><Text>⚠️</Text></View><View style={{ flex: 1 }}><Text style={styles.restockName}>{item.name}</Text><Text style={styles.restockMeta}>Actual: {item.quantity} · Mínimo: {item.minimum}</Text></View><Button compact label="Crear solicitud" onPress={() => adjustInventory(item.id, 5)} /></View>)}
        </View>
      </Card>
    </ScrollView>
  );
}

function Metric({ label, value, icon, warning }: { label: string; value: string; icon: string; warning?: boolean }) {
  return <Card style={styles.metric}><View style={[styles.metricIcon, warning && { backgroundColor: colors.warningLight }]}><Text>{icon}</Text></View><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></Card>;
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flex: 1, minWidth: 230 },
  metricIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  metricLabel: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 5 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  categoryRow: { gap: 7, paddingBottom: 12 },
  tableHeader: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, minWidth: 850 },
  th: { color: colors.muted, fontWeight: '900', fontSize: 9 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#EDF1F6', minWidth: 850 },
  lowRow: { backgroundColor: '#FFF9F3' },
  product: { color: colors.text, fontWeight: '900', fontSize: 12 },
  location: { color: colors.muted, fontSize: 9, marginTop: 3 },
  quantity: { color: colors.text, fontWeight: '900', fontSize: 15 },
  cell: { color: colors.text, fontSize: 12 },
  adjust: { width: 145, flexDirection: 'row', gap: 6 },
  restockGrid: { gap: 8 },
  restockItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#F2D4AF', backgroundColor: '#FFFCF8', padding: 11, borderRadius: 12 },
  restockIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center' },
  restockName: { color: colors.text, fontWeight: '900', fontSize: 12 },
  restockMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
});
