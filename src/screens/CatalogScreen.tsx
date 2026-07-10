import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, EmptyState, formatMoney, Input, Pill, SectionTitle } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import { CatalogItemType, ServiceType } from '../types';

type CatalogFilter = 'Todos' | CatalogItemType;

type FormState = {
  itemType: CatalogItemType;
  name: string;
  category: string;
  price: string;
  durationSlots: string;
  description: string;
  sku: string;
  featured: boolean;
  active: boolean;
};

const emptyForm: FormState = {
  itemType: 'Servicio',
  name: '',
  category: 'Servicio',
  price: '',
  durationSlots: '1',
  description: '',
  sku: '',
  featured: true,
  active: true,
};

function normalizeType(item: ServiceType): CatalogItemType {
  return item.itemType ?? 'Servicio';
}

function slotsFor(item: ServiceType) {
  return Math.max(1, Math.min(3, Math.ceil((item.durationMinutes || 60) / 60)));
}

export function CatalogScreen() {
  const {
    services,
    addCatalogItem,
    updateCatalogItem,
    removeCatalogItem,
    dataError,
    refreshOperationalData,
  } = useAppState();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('Todos');
  const [selectedId, setSelectedId] = useState(services[0]?.id ?? '');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return services.filter((item) => {
      const type = normalizeType(item);
      const matchesType = filter === 'Todos' || type === filter;
      const haystack = `${item.name} ${item.category} ${item.description ?? ''} ${item.sku ?? ''}`.toLowerCase();
      return matchesType && (!needle || haystack.includes(needle));
    });
  }, [services, query, filter]);

  const selected = services.find((item) => item.id === selectedId) ?? filtered[0];

  const openNew = (itemType: CatalogItemType = 'Servicio') => {
    setEditingId(null);
    setForm({ ...emptyForm, itemType, category: itemType === 'Servicio' ? 'Servicio' : 'Producto', durationSlots: itemType === 'Servicio' ? '1' : '0', featured: itemType === 'Servicio' });
    setMessage('');
    setShowForm(true);
  };

  const openEdit = (item: ServiceType) => {
    const itemType = normalizeType(item);
    setEditingId(item.id);
    setForm({
      itemType,
      name: item.name,
      category: item.category,
      price: String(item.basePrice),
      durationSlots: itemType === 'Servicio' ? String(slotsFor(item)) : '0',
      description: item.description ?? '',
      sku: item.sku ?? '',
      featured: item.featured ?? false,
      active: item.active !== false,
    });
    setMessage('');
    setShowForm(true);
  };

  const saveItem = async () => {
    const name = form.name.trim();
    const price = Number(form.price.replace(',', '.'));
    const slotCount = form.itemType === 'Servicio' ? Number(form.durationSlots) : 0;
    if (!name) return setMessage('Escribe el nombre del artículo.');
    if (!Number.isFinite(price) || price < 0) return setMessage('Escribe un precio válido.');
    if (form.itemType === 'Servicio' && ![1, 2, 3].includes(slotCount)) return setMessage('Selecciona una duración de 1, 2 o 3 cupos.');

    const now = new Date().toISOString();
    const item: ServiceType = {
      id: editingId ?? `service-${Date.now()}`,
      itemType: form.itemType,
      name,
      category: form.category.trim() || form.itemType,
      basePrice: price,
      durationMinutes: form.itemType === 'Servicio' ? slotCount * 60 : 0,
      description: form.description.trim() || undefined,
      sku: form.sku.trim() || undefined,
      featured: form.itemType === 'Servicio' ? form.featured : false,
      active: form.active,
      createdAt: editingId ? services.find((entry) => entry.id === editingId)?.createdAt : now,
      updatedAt: now,
    };

    setSaving(true);
    setMessage('');
    const result = editingId
      ? await updateCatalogItem(editingId, item)
      : await addCatalogItem(item);
    setSaving(false);
    if (!result.ok) return setMessage(result.message ?? 'No se pudo guardar el artículo.');
    setSelectedId(item.id);
    setShowForm(false);
  };

  const toggleActive = async (item: ServiceType) => {
    const result = await updateCatalogItem(item.id, { active: item.active === false, updatedAt: new Date().toISOString() });
    if (!result.ok) setMessage(result.message ?? 'No se pudo actualizar.');
  };

  const removeItem = async (item: ServiceType) => {
    const result = await removeCatalogItem(item.id);
    if (!result.ok) {
      setMessage(result.message ?? 'No se pudo eliminar.');
      return;
    }
    setSelectedId('');
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {dataError ? (
        <View style={styles.errorBanner}>
          <View style={{ flex: 1 }}><Text style={styles.errorTitle}>No se pudo sincronizar el catálogo</Text><Text style={styles.errorText}>{dataError}</Text></View>
          <Button compact variant="secondary" label="Reintentar" onPress={() => void refreshOperationalData()} />
        </View>
      ) : null}

      <SectionTitle
        title="Servicios y productos"
        subtitle="Administra los servicios que aparecen en la agenda y los productos disponibles para ventas o trabajos."
        action={<Button label="Nuevo artículo" icon="＋" onPress={() => openNew('Servicio')} />}
      />

      <View style={styles.toolbar}>
        <View style={styles.search}><Input placeholder="Buscar por nombre, categoría, descripción o código…" value={query} onChangeText={setQuery} /></View>
        <View style={styles.filters}>
          {(['Todos', 'Servicio', 'Producto'] as CatalogFilter[]).map((value) => <Button key={value} compact variant={filter === value ? 'primary' : 'secondary'} label={value} onPress={() => setFilter(value)} />)}
        </View>
      </View>

      {message && !showForm ? <View style={styles.warningBanner}><Text style={styles.warningText}>{message}</Text></View> : null}

      <View style={styles.columns}>
        <Card style={styles.listCard}>
          <View style={styles.listHeader}><Text style={styles.listTitle}>{filtered.length} artículo{filtered.length === 1 ? '' : 's'}</Text><View style={styles.quickActions}><Button compact variant="secondary" label="+ Servicio" onPress={() => openNew('Servicio')} /><Button compact variant="secondary" label="+ Producto" onPress={() => openNew('Producto')} /></View></View>
          {filtered.length ? filtered.map((item) => {
            const type = normalizeType(item);
            const active = selected?.id === item.id;
            return (
              <Pressable key={item.id} onPress={() => setSelectedId(item.id)} style={[styles.itemRow, active && styles.itemRowActive]}>
                <View style={styles.itemIcon}><Text style={styles.itemIconText}>{type === 'Servicio' ? '🔧' : '▦'}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.itemMeta}>{type} · {item.category}{type === 'Servicio' ? ` · ${slotsFor(item)} cupo${slotsFor(item) > 1 ? 's' : ''}` : ''}</Text></View>
                <View style={styles.itemRight}><Text style={styles.itemPrice}>{formatMoney(item.basePrice)}</Text><Pill label={item.active === false ? 'Inactivo' : 'Activo'} tone={item.active === false ? 'neutral' : 'success'} /></View>
              </Pressable>
            );
          }) : <EmptyState icon="🔎" title="Sin resultados" message="Agrega el primer servicio o producto, o cambia los filtros de búsqueda." />}
        </Card>

        <View style={styles.detailColumn}>
          {selected ? (
            <Card>
              <View style={styles.detailHeader}>
                <View style={{ flex: 1 }}><Text style={styles.detailType}>{normalizeType(selected).toUpperCase()}</Text><Text style={styles.detailName}>{selected.name}</Text><Text style={styles.detailCategory}>{selected.category}</Text></View>
                <Pill label={selected.active === false ? 'Inactivo' : 'Activo'} tone={selected.active === false ? 'neutral' : 'success'} />
              </View>
              <View style={styles.infoGrid}>
                <Info label="Precio base" value={formatMoney(selected.basePrice)} />
                <Info label="Duración" value={normalizeType(selected) === 'Servicio' ? `${slotsFor(selected)} hora${slotsFor(selected) > 1 ? 's' : ''} / ${slotsFor(selected)} cupo${slotsFor(selected) > 1 ? 's' : ''}` : 'No aplica'} />
                <Info label="En agenda" value={normalizeType(selected) === 'Servicio' ? (selected.featured ? 'Servicio común' : 'Disponible por búsqueda') : 'No aparece'} />
                <Info label="Código / SKU" value={selected.sku || 'No registrado'} />
              </View>
              <View style={styles.descriptionBox}><Text style={styles.descriptionLabel}>DESCRIPCIÓN</Text><Text style={styles.descriptionText}>{selected.description || 'Sin descripción adicional.'}</Text></View>
              <View style={styles.actionRow}>
                <Button variant="secondary" label="Editar" onPress={() => openEdit(selected)} />
                <Button variant="secondary" label={selected.active === false ? 'Activar' : 'Desactivar'} onPress={() => void toggleActive(selected)} />
                <Button variant="danger" label="Eliminar" onPress={() => void removeItem(selected)} />
              </View>
            </Card>
          ) : <Card><EmptyState icon="▦" title="Catálogo vacío" message="Agrega servicios reales para utilizarlos en la agenda." /></Card>}
        </View>
      </View>

      <AppModal visible={showForm} title={editingId ? 'Editar artículo' : 'Agregar artículo'} onClose={() => !saving && setShowForm(false)}>
        <ScrollView>
          {message ? <View style={styles.formError}><Text style={styles.formErrorText}>{message}</Text></View> : null}
          <Text style={styles.fieldLabel}>Tipo</Text>
          <View style={styles.optionRow}><Choice label="Servicio" active={form.itemType === 'Servicio'} onPress={() => setForm({ ...form, itemType: 'Servicio', category: form.category === 'Producto' ? 'Servicio' : form.category, durationSlots: form.durationSlots === '0' ? '1' : form.durationSlots })} /><Choice label="Producto" active={form.itemType === 'Producto'} onPress={() => setForm({ ...form, itemType: 'Producto', category: form.category === 'Servicio' ? 'Producto' : form.category, durationSlots: '0', featured: false })} /></View>
          <Input label="Nombre" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="Ej. Servicio estándar 18,000 BTU" />
          <Input label="Categoría" value={form.category} onChangeText={(category) => setForm({ ...form, category })} placeholder="Servicio, instalación, diagnóstico…" />
          <Input label="Precio base (Afl.)" value={form.price} onChangeText={(price) => setForm({ ...form, price })} keyboardType="decimal-pad" placeholder="0.00" />
          {form.itemType === 'Servicio' ? <><Text style={styles.fieldLabel}>Duración en agenda</Text><View style={styles.optionRow}>{['1', '2', '3'].map((slots) => <Choice key={slots} label={`${slots} hora${slots === '1' ? '' : 's'} · ${slots} cupo${slots === '1' ? '' : 's'}`} active={form.durationSlots === slots} onPress={() => setForm({ ...form, durationSlots: slots })} />)}</View><Text style={styles.helperText}>Cada cupo representa una hora. La agenda bloqueará automáticamente los cupos consecutivos.</Text></> : null}
          <Input label="Código / SKU (opcional)" value={form.sku} onChangeText={(sku) => setForm({ ...form, sku })} />
          <Input label="Descripción" value={form.description} onChangeText={(description) => setForm({ ...form, description })} multiline placeholder="Información relevante para la oficina o el técnico…" />
          {form.itemType === 'Servicio' ? <><Text style={styles.fieldLabel}>Visibilidad en la agenda</Text><View style={styles.optionRow}><Choice label="Servicio común" active={form.featured} onPress={() => setForm({ ...form, featured: true })} /><Choice label="Solo por búsqueda" active={!form.featured} onPress={() => setForm({ ...form, featured: false })} /></View></> : null}
          <Text style={styles.fieldLabel}>Estado</Text><View style={styles.optionRow}><Choice label="Activo" active={form.active} onPress={() => setForm({ ...form, active: true })} /><Choice label="Inactivo" active={!form.active} onPress={() => setForm({ ...form, active: false })} /></View>
          <View style={styles.modalActions}><Button variant="secondary" label="Cancelar" disabled={saving} onPress={() => setShowForm(false)} /><Button label={saving ? 'Guardando…' : 'Guardar artículo'} disabled={saving} onPress={() => void saveItem()} /></View>
        </ScrollView>
      </AppModal>
    </ScrollView>
  );
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.info}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: 26, gap: 18, paddingBottom: 96 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#F2B8B5', backgroundColor: colors.dangerLight, borderRadius: 10, padding: 14 },
  errorTitle: { color: colors.danger, fontWeight: '900', fontSize: 13 },
  errorText: { color: colors.text, fontSize: 11, marginTop: 3 },
  warningBanner: { backgroundColor: colors.warningLight, borderRadius: 8, padding: 11 },
  warningText: { color: colors.warning, fontSize: 11, fontWeight: '700' },
  toolbar: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  search: { flex: 1, minWidth: 300 },
  filters: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 13 },
  columns: { flexDirection: 'row', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' },
  listCard: { flex: 1.2, minWidth: 400 },
  detailColumn: { flex: 1, minWidth: 340 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  listTitle: { color: colors.text, fontWeight: '900', fontSize: 14 },
  quickActions: { flexDirection: 'row', gap: 7 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 8, borderBottomWidth: 1, borderBottomColor: '#EEF0F2' },
  itemRowActive: { backgroundColor: colors.primaryLight },
  itemIcon: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#F0F2F4', alignItems: 'center', justifyContent: 'center' },
  itemIconText: { fontSize: 16 },
  itemName: { color: colors.text, fontWeight: '900', fontSize: 13 },
  itemMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  itemRight: { alignItems: 'flex-end', gap: 5 },
  itemPrice: { color: colors.text, fontWeight: '900', fontSize: 12 },
  detailHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  detailType: { color: colors.primary, fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  detailName: { color: colors.text, fontWeight: '900', fontSize: 22, marginTop: 5 },
  detailCategory: { color: colors.muted, marginTop: 4, fontSize: 12 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15, marginTop: 20, paddingTop: 17, borderTopWidth: 1, borderTopColor: colors.border },
  info: { flex: 1, minWidth: 150 },
  infoLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  infoValue: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 5 },
  descriptionBox: { marginTop: 18, backgroundColor: '#F6F8FA', borderRadius: 8, padding: 13 },
  descriptionLabel: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  descriptionText: { color: colors.text, lineHeight: 19, marginTop: 6, fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 9, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 18 },
  formError: { backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10, marginBottom: 12 },
  formErrorText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  fieldLabel: { color: colors.text, fontWeight: '900', marginTop: 4, marginBottom: 8 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#FFFFFF' },
  choiceActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  choiceText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  choiceTextActive: { color: colors.primaryDark },
  helperText: { color: colors.muted, fontSize: 10, marginTop: -8, marginBottom: 14 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15 },
});
