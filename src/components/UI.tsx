import React, { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors } from '../theme';

const INVENTORY_TOOL_CATEGORIES = ['Power Tools', 'Hand Tools'] as const;

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  compact,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  disabled?: boolean;
  compact?: boolean;
  icon?: string;
}) {
  // InventoryScreenV2 previously rendered two controls with the same action:
  // “Agregar unidades” in the catalog header and “Asignar ahora” below it.
  // Keep one consistent action without changing the underlying inventory flow.
  if (label === 'Asignar ahora') return null;
  const displayLabel = label === 'Agregar unidades' ? 'Asignar ahora' : label;
  const alternateText = variant === 'secondary' ? styles.buttonTextSecondary : variant === 'ghost' ? styles.buttonTextGhost : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        styles[`button_${variant}`],
        pressed && !disabled && { opacity: 0.76 },
        disabled && { opacity: 0.45 },
      ]}
    >
      {icon ? <Text style={[styles.buttonIcon, alternateText]}>{icon}</Text> : null}
      <Text style={[styles.buttonText, alternateText]}>{displayLabel}</Text>
    </Pressable>
  );
}

export function Input({ label, multiline, style, ...props }: TextInputProps & { label?: string }) {
  const currentValue = typeof props.value === 'string' ? props.value : '';
  const normalizedCategory = currentValue.toLowerCase();
  const isInventoryToolCategory = label === 'Categoría'
    && ['power tools', 'power tool', 'power tools', 'hand tools'].includes(normalizedCategory);

  if (isInventoryToolCategory) {
    const selectedCategory = normalizedCategory === 'hand tools' ? 'Hand Tools' : 'Power Tools';
    return (
      <View style={[styles.inputGroup, style as object]}>
        <Text style={styles.inputLabel}>Categoría</Text>
        <View style={styles.categoryOptions}>
          {INVENTORY_TOOL_CATEGORIES.map((category) => {
            const selected = selectedCategory === category;
            return (
              <Pressable
                key={category}
                disabled={props.editable === false}
                onPress={() => props.onChangeText?.(category)}
                style={({ pressed }) => [
                  styles.categoryOption,
                  selected && styles.categoryOptionActive,
                  pressed && props.editable !== false && { opacity: 0.76 },
                  props.editable === false && { opacity: 0.45 },
                ]}
              >
                <Text style={[styles.categoryOptionText, selected && styles.categoryOptionTextActive]}>{category}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.inputGroup, style as object]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor="#8A9099"
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
        {...props}
      />
    </View>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
}) {
  const palette = {
    neutral: { bg: '#F0F2F4', fg: '#4B5563' },
    success: { bg: colors.successLight, fg: colors.success },
    warning: { bg: colors.warningLight, fg: colors.warning },
    danger: { bg: colors.dangerLight, fg: colors.danger },
    info: { bg: colors.infoLight, fg: colors.info },
    purple: { bg: '#F1EAFE', fg: colors.purple },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
}

export function AppModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function LoadingScreen() {
  return (
    <View style={styles.loadingScreen}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>Cargando DEMAC Corporation…</Text>
    </View>
  );
}

export function formatMoney(value: number) {
  return `Afl. ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple' {
  if (['Pagada', 'Completada'].includes(status)) return 'success';
  if (['Cancelada', 'Reprogramada', 'Vencida'].includes(status)) return 'danger';
  if (['Reserva temporal', 'En proceso', 'En camino', 'En el sitio', 'Parcial'].includes(status)) return 'warning';
  if (['Asignada', 'Confirmada', 'Enviada', 'Facturada'].includes(status)) return 'info';
  if (['Pendiente', 'Solicitud recibida'].includes(status)) return 'purple';
  return 'neutral';
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 13, gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sectionSubtitle: { color: colors.muted, marginTop: 3, fontSize: 11, lineHeight: 16 },
  button: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 7,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: { minHeight: 32, paddingHorizontal: 11, borderRadius: 6 },
  button_primary: { backgroundColor: colors.primary },
  button_secondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#AEB4BC' },
  button_danger: { backgroundColor: colors.danger },
  button_ghost: { backgroundColor: 'transparent' },
  button_success: { backgroundColor: colors.success },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  buttonTextSecondary: { color: colors.text },
  buttonTextGhost: { color: colors.info },
  buttonIcon: { color: '#FFFFFF', fontSize: 15 },
  inputGroup: { gap: 6, marginBottom: 12 },
  inputLabel: { color: colors.text, fontWeight: '700', fontSize: 12 },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#B9BEC5',
    borderRadius: 7,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    color: colors.text,
    fontSize: 13,
  },
  inputMultiline: { minHeight: 88, paddingTop: 11, textAlignVertical: 'top' },
  categoryOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryOption: {
    minHeight: 42,
    minWidth: 120,
    flex: 1,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#B9BEC5',
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryOptionText: { color: colors.text, fontWeight: '800', fontSize: 12 },
  categoryOptionTextActive: { color: '#FFFFFF' },
  pill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: 42, paddingHorizontal: 20 },
  emptyIcon: { fontSize: 34, marginBottom: 9 },
  emptyTitle: { fontWeight: '800', color: colors.text, fontSize: 16 },
  emptyMessage: { color: colors.muted, textAlign: 'center', marginTop: 5, lineHeight: 19 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(32,33,36,0.46)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { width: '100%', maxWidth: 620, maxHeight: '92%', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 19 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  modalTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '800' },
  closeButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0F2F4', alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { fontSize: 23, lineHeight: 24, color: colors.text },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: 13 },
  loadingText: { color: colors.muted, fontWeight: '700' },
});