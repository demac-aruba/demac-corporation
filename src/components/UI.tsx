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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        styles[`button_${variant}`],
        pressed && !disabled && { opacity: 0.82 },
        disabled && { opacity: 0.45 },
      ]}
    >
      {icon ? <Text style={styles.buttonIcon}>{icon}</Text> : null}
      <Text style={[styles.buttonText, variant === 'secondary' || variant === 'ghost' ? { color: colors.primary } : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Input({ label, multiline, style, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={[styles.inputGroup, style as object]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor="#94A0B3"
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
    neutral: { bg: '#EDF1F6', fg: '#526071' },
    success: { bg: colors.successLight, fg: colors.success },
    warning: { bg: colors.warningLight, fg: colors.warning },
    danger: { bg: colors.dangerLight, fg: colors.danger },
    info: { bg: colors.primaryLight, fg: colors.primary },
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
  if (['Cancelada', 'Vencida'].includes(status)) return 'danger';
  if (['En proceso', 'En camino', 'En el sitio', 'Parcial'].includes(status)) return 'warning';
  if (['Asignada', 'Confirmada', 'Enviada', 'Facturada'].includes(status)) return 'info';
  if (['Pendiente', 'Reprogramada', 'Solicitud recibida'].includes(status)) return 'purple';
  return 'neutral';
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    shadowColor: '#152238',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  sectionSubtitle: { color: colors.muted, marginTop: 4, fontSize: 13, lineHeight: 19 },
  button: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10 },
  button_primary: { backgroundColor: colors.primary },
  button_secondary: { backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: '#C9DEFF' },
  button_danger: { backgroundColor: colors.danger },
  button_ghost: { backgroundColor: 'transparent' },
  button_success: { backgroundColor: colors.success },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  buttonIcon: { color: '#FFFFFF', fontSize: 16 },
  inputGroup: { gap: 7, marginBottom: 13 },
  inputLabel: { color: colors.text, fontWeight: '700', fontSize: 13 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    paddingHorizontal: 13,
    backgroundColor: '#FBFCFE',
    color: colors.text,
    fontSize: 14,
  },
  inputMultiline: { minHeight: 92, paddingTop: 12, textAlignVertical: 'top' },
  pill: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: 20 },
  emptyIcon: { fontSize: 38, marginBottom: 10 },
  emptyTitle: { fontWeight: '800', color: colors.text, fontSize: 17 },
  emptyMessage: { color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(11,31,58,0.56)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { width: '100%', maxWidth: 620, maxHeight: '92%', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  modalTitle: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '900' },
  closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF3F8', alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { fontSize: 25, lineHeight: 26, color: colors.text },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: 14 },
  loadingText: { color: colors.muted, fontWeight: '700' },
});
