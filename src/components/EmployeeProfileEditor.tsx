import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Input } from './UI';
import { colors } from '../theme';
import { StaffAvailability, StaffEmployeeType, StaffProfile, StaffRole, Van } from '../types';

const EMPLOYEE_TYPES: StaffEmployeeType[] = ['Técnico', 'Secretaria', 'Administración', 'Otro'];
const TECHNICAL_ROLES: StaffRole[] = ['Técnico', 'Ayudante', 'Supervisor'];
const OFFICE_ROLES: StaffRole[] = ['Secretaria', 'Administración', 'Contabilidad', 'Almacén', 'Otro'];
const AVAILABILITY: StaffAvailability[] = ['Disponible', 'Enfermo', 'Vacaciones', 'Libre', 'Inactivo'];

function defaultRole(type: StaffEmployeeType): StaffRole {
  if (type === 'Técnico') return 'Ayudante';
  if (type === 'Secretaria') return 'Secretaria';
  if (type === 'Administración') return 'Administración';
  return 'Otro';
}

function rolesFor(type: StaffEmployeeType) {
  return type === 'Técnico' ? TECHNICAL_ROLES : OFFICE_ROLES;
}

function ChoiceGroup<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <Pressable key={option} onPress={() => onChange(option)} style={[styles.choice, value === option && styles.choiceActive]}>
          <Text style={[styles.choiceText, value === option && styles.choiceTextActive]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function EmployeeProfileEditor({
  profile,
  vans,
  busy,
  onSave,
  onCancel,
}: {
  profile: StaffProfile;
  vans: Van[];
  busy: boolean;
  onSave: (profile: StaffProfile) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => setDraft(profile), [profile]);

  const employeeType = draft.employeeType ?? (['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(draft.role) ? 'Técnico' : draft.role === 'Secretaria' ? 'Secretaria' : 'Administración');
  const assignedVans = vans.filter((van) => van.responsibleStaffId === draft.id || van.regularHelperId === draft.id);

  function changeType(nextType: StaffEmployeeType) {
    const allowed = rolesFor(nextType);
    setDraft((current) => ({
      ...current,
      employeeType: nextType,
      role: allowed.includes(current.role) ? current.role : defaultRole(nextType),
      canDriveVan: nextType === 'Técnico' ? current.canDriveVan : false,
      skills: nextType === 'Técnico' ? current.skills : [],
    }));
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Registro maestro del empleado</Text>
        <Text style={styles.noticeText}>Este perfil se usa en vans, despacho, disponibilidad y Timesheet. No es necesario crear a la persona nuevamente en otro módulo.</Text>
      </View>

      <Input label="Nombre completo" value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
      <View style={styles.twoColumns}>
        <Input style={styles.flex} label="Teléfono" value={draft.phone} onChangeText={(phone) => setDraft((current) => ({ ...current, phone }))} />
        <Input style={styles.flex} label="Correo" value={draft.email ?? ''} onChangeText={(email) => setDraft((current) => ({ ...current, email }))} />
      </View>

      <Text style={styles.label}>TIPO DE EMPLEADO</Text>
      <ChoiceGroup options={EMPLOYEE_TYPES} value={employeeType} onChange={changeType} />

      <Text style={styles.label}>CARGO</Text>
      <ChoiceGroup
        options={rolesFor(employeeType)}
        value={(rolesFor(employeeType).includes(draft.role) ? draft.role : defaultRole(employeeType)) as StaffRole}
        onChange={(role) => setDraft((current) => ({ ...current, role }))}
      />

      {employeeType === 'Técnico' ? (
        <>
          <Text style={styles.label}>AUTORIZADO PARA MANEJAR VANS</Text>
          <ChoiceGroup options={['Sí', 'No']} value={draft.canDriveVan ? 'Sí' : 'No'} onChange={(value) => setDraft((current) => ({ ...current, canDriveVan: value === 'Sí' }))} />
          <Input label="Especialidades" value={draft.skills.join(', ')} onChangeText={(value) => setDraft((current) => ({ ...current, skills: value.split(',').map((item) => item.trim()).filter(Boolean) }))} placeholder="Servicio, instalación, VRF, electricidad…" />
        </>
      ) : null}

      <Text style={styles.label}>DISPONIBILIDAD ACTUAL</Text>
      <ChoiceGroup options={AVAILABILITY} value={draft.availability} onChange={(availability) => setDraft((current) => ({ ...current, availability, active: availability !== 'Inactivo' }))} />

      <View style={styles.assignmentBox}>
        <Text style={styles.assignmentTitle}>Asignación operativa</Text>
        <Text style={styles.assignmentText}>{assignedVans.length ? assignedVans.map((van) => `${van.name}: ${van.responsibleStaffId === draft.id ? 'responsable' : 'ayudante'}`).join(' · ') : 'Sin van asignada. La vinculación se realiza desde Equipo → Vans.'}</Text>
      </View>

      <Input label="Notas internas" multiline value={draft.notes ?? ''} onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))} />

      <View style={styles.actions}>
        <Button variant="secondary" label="Cancelar" onPress={onCancel} disabled={busy} />
        <Button variant="success" label={busy ? 'Guardando…' : 'Guardar empleado'} onPress={() => void onSave({ ...draft, employeeType })} disabled={busy} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 12 },
  notice: { backgroundColor: colors.primaryLight, borderRadius: 9, padding: 12, marginBottom: 15 },
  noticeTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  noticeText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 4 },
  twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flex: { flex: 1, minWidth: 210 },
  label: { color: colors.muted, fontWeight: '900', fontSize: 10, marginBottom: 7, marginTop: 4 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  choice: { minHeight: 38, borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.text, fontWeight: '800', fontSize: 11 },
  choiceTextActive: { color: '#FFFFFF' },
  assignmentBox: { backgroundColor: '#F7F8FA', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 13 },
  assignmentTitle: { color: colors.text, fontWeight: '900', fontSize: 11 },
  assignmentText: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 4 },
});