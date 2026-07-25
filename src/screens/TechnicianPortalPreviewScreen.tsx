import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Pill, SectionTitle } from '../components/UI';
import { colors } from '../theme';

type PreviewRole = 'lead' | 'helper';
type PreviewUnitStatus = 'En proceso' | 'No iniciado' | 'Pendiente';

type PreviewUnit = {
  id: string;
  label: string;
  qr?: string;
  source: string;
  workType: string;
  status: PreviewUnitStatus;
  indoor?: { owner: string; completed: number; total: number };
  outdoor?: { owner: string; completed: number; total: number };
  findings?: number;
};

const previewUnits: PreviewUnit[] = [
  {
    id: 'sala',
    label: 'Sala',
    qr: 'DEMAC-000145',
    source: 'Aire registrado',
    workType: 'Servicio estándar',
    status: 'En proceso',
    indoor: { owner: 'Miguel', completed: 7, total: 10 },
    outdoor: { owner: 'José', completed: 6, total: 9 },
    findings: 1,
  },
  {
    id: 'cuarto-principal',
    label: 'Cuarto principal',
    source: 'Agregado en el sitio',
    workType: 'Servicio estándar',
    status: 'No iniciado',
  },
  {
    id: 'cocina',
    label: 'Cocina',
    source: 'Sin QR',
    workType: 'Diagnóstico',
    status: 'Pendiente',
  },
];

const leadPermissions = [
  'Agregar, registrar y nombrar aires.',
  'Seleccionar o cambiar el trabajo real.',
  'Registrar autorizaciones y trabajos adicionales.',
  'Completar unidades y finalizar la visita.',
];

const helperPermissions = [
  'Abrir los mismos aires de la visita.',
  'Completar Indoor, Outdoor, fotos y mediciones.',
  'Registrar hallazgos y marcar su sección completa.',
  'No puede cambiar alcance, eliminar aires ni cerrar la visita.',
];

function progressPercent(completed: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function statusTone(status: PreviewUnitStatus): 'info' | 'neutral' | 'warning' {
  if (status === 'En proceso') return 'info';
  if (status === 'Pendiente') return 'warning';
  return 'neutral';
}

export function TechnicianPortalPreviewScreen() {
  const [role, setRole] = useState<PreviewRole>('lead');
  const [selectedUnitId, setSelectedUnitId] = useState('sala');
  const [message, setMessage] = useState('Vista piloto: los botones simulan el flujo sin modificar Firebase.');
  const selectedUnit = previewUnits.find((unit) => unit.id === selectedUnitId) ?? previewUnits[0];
  const permissions = role === 'lead' ? leadPermissions : helperPermissions;
  const roleName = role === 'lead' ? 'Técnico responsable' : 'Ayudante';
  const canManageScope = role === 'lead';

  const visitSummary = useMemo(() => ({
    completed: previewUnits.filter((unit) => unit.status !== 'No iniciado').length,
    pending: previewUnits.filter((unit) => unit.status === 'Pendiente').length,
  }), []);

  function simulateAction(label: string, requiresLead = false) {
    if (requiresLead && !canManageScope) {
      setMessage(`${label}: solamente el técnico responsable puede realizar esta acción.`);
      return;
    }
    setMessage(`${label}: acción simulada correctamente en la vista piloto.`);
  }

  function returnToCurrentSystem() {
    if (typeof window === 'undefined') return;
    const nextUrl = `${window.location.pathname}${window.location.hash}`;
    window.location.assign(nextUrl || '/');
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>DEMAC</Text>
          <Text style={styles.headerEyebrow}>PORTAL DEL TÉCNICO V2 · VISTA PILOTO</Text>
          <Text style={styles.headerTitle}>Mi trabajo</Text>
          <Text style={styles.headerCopy}>Diseño aprobado aplicado al estilo actual de DEMAC.</Text>
        </View>
        <View style={styles.headerStatus}>
          <Text style={styles.headerStatusText}>● En línea</Text>
        </View>
      </View>

      <View style={styles.roleSelector}>
        <Text style={styles.roleLabel}>Simular permisos como:</Text>
        <View style={styles.roleButtons}>
          <Button compact label="Técnico responsable" variant={role === 'lead' ? 'primary' : 'secondary'} onPress={() => setRole('lead')} />
          <Button compact label="Ayudante" variant={role === 'helper' ? 'primary' : 'secondary'} onPress={() => setRole('helper')} />
        </View>
      </View>

      <Card>
        <SectionTitle title="Visita actual" subtitle="Información programada por la oficina" />
        <View style={styles.summaryGrid}>
          <SummaryItem icon="●" label="Cliente" value="María Rodríguez" />
          <SummaryItem icon="⌖" label="Dirección" value="Santa Cruz" />
          <SummaryItem icon="▣" label="Trabajo programado" value="1 servicio estándar" />
          <SummaryItem icon="✓" label="Estado" value="En el sitio" accent />
          <SummaryItem icon="👥" label="Equipo" value="Van 2 · Miguel + José" />
          <SummaryItem icon="♟" label="Rol activo" value={roleName} />
        </View>
      </Card>

      <View style={styles.actionGrid}>
        <ActionTile icon="⌗" label="Escanear QR" disabled={!canManageScope} onPress={() => simulateAction('Escanear QR', true)} />
        <ActionTile icon="▭" label="Seleccionar aire registrado" disabled={!canManageScope} onPress={() => simulateAction('Seleccionar aire registrado', true)} />
        <ActionTile icon="＋" label="Registrar aire nuevo" disabled={!canManageScope} onPress={() => simulateAction('Registrar aire nuevo', true)} />
      </View>

      <Card>
        <SectionTitle title="Aires de esta visita" subtitle="El trabajo real puede incluir más unidades que el booking original" />
        <View style={styles.unitsList}>
          {previewUnits.map((unit) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              selected={selectedUnit.id === unit.id}
              onPress={() => {
                setSelectedUnitId(unit.id);
                setMessage(`${unit.label}: aire seleccionado para continuar el reporte.`);
              }}
            />
          ))}
        </View>
      </Card>

      <View style={styles.detailColumns}>
        <Card style={styles.detailCard}>
          <SectionTitle title={selectedUnit.label} subtitle={`${selectedUnit.workType} · ${selectedUnit.source}`} />
          <View style={styles.detailStatusRow}>
            <Pill label={selectedUnit.status} tone={statusTone(selectedUnit.status)} />
            <Text style={styles.qrText}>{selectedUnit.qr ? `QR: ${selectedUnit.qr}` : 'QR pendiente'}</Text>
          </View>
          <View style={styles.sectionButtons}>
            <Button label="Abrir Indoor" onPress={() => simulateAction(`Abrir Indoor de ${selectedUnit.label}`)} />
            <Button label="Abrir Outdoor" variant="secondary" onPress={() => simulateAction(`Abrir Outdoor de ${selectedUnit.label}`)} />
            <Button label="Mediciones" variant="secondary" onPress={() => simulateAction(`Abrir mediciones de ${selectedUnit.label}`)} />
            <Button label="Agregar trabajo" variant="secondary" disabled={!canManageScope} onPress={() => simulateAction(`Agregar trabajo a ${selectedUnit.label}`, true)} />
          </View>
        </Card>

        <Card style={styles.detailCard}>
          <SectionTitle title={`Permisos · ${roleName}`} subtitle="Control operativo para evitar cambios no autorizados" />
          <View style={styles.permissionList}>
            {permissions.map((permission) => (
              <View key={permission} style={styles.permissionRow}>
                <Text style={styles.permissionCheck}>✓</Text>
                <Text style={styles.permissionText}>{permission}</Text>
              </View>
            ))}
          </View>
        </Card>
      </View>

      <Card>
        <SectionTitle title="Resumen de la visita" subtitle="Datos simulados para validar el flujo visual" />
        <View style={styles.finalSummary}>
          <View><Text style={styles.finalMetric}>{previewUnits.length}</Text><Text style={styles.finalLabel}>Aires incluidos</Text></View>
          <View><Text style={styles.finalMetric}>{visitSummary.completed}</Text><Text style={styles.finalLabel}>Iniciados</Text></View>
          <View><Text style={styles.finalMetric}>{visitSummary.pending}</Text><Text style={styles.finalLabel}>Pendientes</Text></View>
          <View><Text style={styles.finalMetric}>1</Text><Text style={styles.finalLabel}>Trabajo adicional</Text></View>
        </View>
        <View style={styles.footerActions}>
          <Button variant="secondary" label="Resumen de la visita" onPress={() => simulateAction('Resumen de la visita')} />
          <Button variant="success" label="Finalizar visita" disabled={!canManageScope} onPress={() => simulateAction('Finalizar visita', true)} />
        </View>
      </Card>

      <View style={styles.messageBox}>
        <Text style={styles.messageTitle}>Estado de la prueba</Text>
        <Text style={styles.messageText}>{message}</Text>
      </View>

      <Button variant="secondary" label="Volver al sistema actual" onPress={returnToCurrentSystem} />
    </ScrollView>
  );
}

function SummaryItem({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.summaryItem}>
      <View style={styles.summaryIcon}><Text style={styles.summaryIconText}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={[styles.summaryValue, accent && styles.summaryValueAccent]}>{value}</Text>
      </View>
    </View>
  );
}

function ActionTile({ icon, label, disabled, onPress }: { icon: string; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionTile, disabled && styles.actionTileDisabled, pressed && !disabled && styles.actionTilePressed]}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
      {disabled ? <Text style={styles.actionHelp}>Solo técnico responsable</Text> : null}
    </Pressable>
  );
}

function UnitCard({ unit, selected, onPress }: { unit: PreviewUnit; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.unitCard, selected && styles.unitCardSelected, pressed && styles.unitCardPressed]}>
      <View style={styles.unitTop}>
        <View style={styles.unitIcon}><Text style={styles.unitIconText}>❄</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.unitName}>{unit.label}</Text>
          <Text style={styles.unitSource}>{unit.qr ? `QR: ${unit.qr}` : unit.source}</Text>
          <Text style={styles.unitWork}>Trabajo: {unit.workType}</Text>
        </View>
        <View style={styles.unitOpen}><Text style={styles.unitOpenText}>Abrir ›</Text></View>
      </View>
      <View style={styles.unitStatusRow}>
        <Pill label={unit.status} tone={statusTone(unit.status)} />
        {unit.findings ? <Text style={styles.findingText}>{unit.findings} hallazgo registrado</Text> : null}
      </View>
      {unit.indoor && unit.outdoor ? (
        <View style={styles.progressGrid}>
          <ProgressItem label={`Indoor · ${unit.indoor.owner}`} completed={unit.indoor.completed} total={unit.indoor.total} />
          <ProgressItem label={`Outdoor · ${unit.outdoor.owner}`} completed={unit.outdoor.completed} total={unit.outdoor.total} />
        </View>
      ) : null}
    </Pressable>
  );
}

function ProgressItem({ label, completed, total }: { label: string; completed: number; total: number }) {
  return (
    <View style={styles.progressItem}>
      <View style={styles.progressHeader}><Text style={styles.progressLabel}>{label}</Text><Text style={styles.progressValue}>{completed}/{total}</Text></View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progressPercent(completed, total)}%` }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 90, backgroundColor: '#F7F9FC' },
  header: { backgroundColor: colors.primary, borderRadius: 18, padding: 20, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  brand: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 1.5 },
  headerEyebrow: { color: '#A9D1FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginTop: 8 },
  headerTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', marginTop: 4 },
  headerCopy: { color: '#D8E9FF', marginTop: 6, lineHeight: 19 },
  headerStatus: { borderRadius: 18, backgroundColor: '#DDF8E6', paddingHorizontal: 10, paddingVertical: 7 },
  headerStatusText: { color: '#236B3A', fontSize: 9, fontWeight: '900' },
  roleSelector: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, gap: 10 },
  roleLabel: { color: colors.text, fontWeight: '900', fontSize: 11 },
  roleButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryItem: { width: '48%', minWidth: 220, flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F7F9FC', borderRadius: 12, padding: 12 },
  summaryIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  summaryIconText: { color: colors.primary, fontWeight: '900' },
  summaryLabel: { color: colors.muted, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  summaryValue: { color: colors.text, fontWeight: '900', marginTop: 3 },
  summaryValueAccent: { color: '#267A41' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionTile: { flex: 1, minWidth: 170, minHeight: 116, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 16, alignItems: 'center', justifyContent: 'center' },
  actionTileDisabled: { opacity: 0.45 },
  actionTilePressed: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  actionIcon: { color: colors.primary, fontSize: 30, fontWeight: '500' },
  actionLabel: { color: colors.text, fontWeight: '900', textAlign: 'center', marginTop: 10, lineHeight: 19 },
  actionHelp: { color: colors.muted, fontSize: 8, marginTop: 5 },
  unitsList: { gap: 10 },
  unitCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, backgroundColor: '#FFFFFF' },
  unitCardSelected: { borderColor: colors.primary, backgroundColor: '#F7FAFF' },
  unitCardPressed: { opacity: 0.78 },
  unitTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  unitIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  unitIconText: { color: colors.primary, fontSize: 22 },
  unitName: { color: colors.text, fontWeight: '900', fontSize: 16 },
  unitSource: { color: colors.primary, fontWeight: '700', fontSize: 10, marginTop: 4 },
  unitWork: { color: colors.muted, fontSize: 10, marginTop: 4 },
  unitOpen: { paddingVertical: 4 },
  unitOpenText: { color: colors.primary, fontWeight: '900' },
  unitStatusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  findingText: { color: '#267A41', fontSize: 10, fontWeight: '800' },
  progressGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  progressItem: { flex: 1, minWidth: 180 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  progressLabel: { color: colors.text, fontSize: 10, fontWeight: '800' },
  progressValue: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#E3E8EF', marginTop: 7, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  detailColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  detailCard: { flex: 1, minWidth: 290 },
  detailStatusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 14 },
  qrText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  sectionButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  permissionList: { gap: 10 },
  permissionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  permissionCheck: { color: '#267A41', fontWeight: '900' },
  permissionText: { color: colors.text, flex: 1, lineHeight: 18 },
  finalSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  finalMetric: { color: colors.primary, fontSize: 24, fontWeight: '900' },
  finalLabel: { color: colors.muted, fontSize: 9, marginTop: 2 },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
  messageBox: { backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14 },
  messageTitle: { color: colors.primaryDark, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  messageText: { color: colors.text, marginTop: 5, lineHeight: 18 },
});
