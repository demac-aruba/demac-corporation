import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Card, Input, Pill, SectionTitle } from './UI';
import { useAppState } from '../state/AppState';
import { useTeamState } from '../state/TeamState';
import { colors, roleLabels } from '../theme';
import { UserRole } from '../types';
import {
  createManagedUser,
  listManagedUsers,
  ManagedUser,
  ManagedUserInput,
  sendPasswordSetupEmail,
  updateManagedUser,
} from '../services/userAdmin';

const roleOptions: Array<{ value: UserRole; label: string; description: string }> = [
  { value: 'admin', label: 'Administrador', description: 'Acceso total y administración de usuarios.' },
  { value: 'office', label: 'Oficina / Ventas', description: 'Clientes, agenda, catálogo y operación diaria.' },
  { value: 'supervisor', label: 'Supervisor', description: 'Supervisión, equipo, agenda y trabajo técnico.' },
  { value: 'technician', label: 'Técnico / Ayudante', description: 'Acceso móvil a sus trabajos y reportes asignados.' },
  { value: 'accounting', label: 'Contabilidad', description: 'Cuentas, pagos y clientes.' },
  { value: 'inventory', label: 'Inventario', description: 'Almacén, herramientas y existencias.' },
];

type UserDraft = ManagedUserInput & { uid?: string };

const emptyDraft: UserDraft = {
  name: '',
  email: '',
  phone: '',
  role: 'technician',
  staffId: '',
  vanId: '',
  active: true,
};

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'U';
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Nunca';
  return new Intl.DateTimeFormat('es-AW', {
    timeZone: 'America/Aruba',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function UserManagementCard() {
  const { currentUser } = useAppState();
  const { staffProfiles, vans, refreshTeamData } = useTeamState();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyUserId, setBusyUserId] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);

  const firebaseAdmin = currentUser?.authProvider === 'firebase' && currentUser.role === 'admin';

  const loadUsers = useCallback(async () => {
    if (!firebaseAdmin) return;
    setLoading(true);
    setError('');
    try {
      setUsers(await listManagedUsers());
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [firebaseAdmin]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => [user.name, user.email, user.phone, roleLabels[user.role]]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)));
  }, [query, users]);

  const staffLinkedElsewhere = (staffId: string) => users.some((user) => user.staffId === staffId && user.uid !== editingUser?.uid);

  function openCreate() {
    setEditingUser(null);
    setDraft(emptyDraft);
    setMessage('');
    setError('');
    setShowModal(true);
  }

  function openEdit(user: ManagedUser) {
    setEditingUser(user);
    setDraft({
      uid: user.uid,
      name: user.name,
      email: user.email,
      phone: user.phone ?? '',
      role: user.role,
      staffId: user.staffId ?? '',
      vanId: user.vanId ?? '',
      active: user.active,
    });
    setMessage('');
    setError('');
    setShowModal(true);
  }

  function selectStaff(staffId: string) {
    if (!staffId) {
      setDraft((current) => ({ ...current, staffId: '' }));
      return;
    }
    const staff = staffProfiles.find((item) => item.id === staffId);
    if (!staff) return;
    const inferredRole: UserRole = staff.role === 'Supervisor' ? 'supervisor' : 'technician';
    setDraft((current) => ({
      ...current,
      staffId,
      name: staff.name || current.name,
      email: staff.email || current.email,
      phone: staff.phone || current.phone,
      role: inferredRole,
      vanId: staff.primaryVanId || current.vanId,
    }));
  }

  async function saveUser() {
    if (!draft.name.trim()) return setError('Escribe el nombre del usuario.');
    if (!draft.email.trim()) return setError('Escribe el correo que utilizará para iniciar sesión.');
    setBusy(true);
    setError('');
    setMessage('');
    const payload: ManagedUserInput = {
      name: draft.name.trim(),
      email: draft.email.trim().toLowerCase(),
      phone: draft.phone?.trim() || undefined,
      role: draft.role,
      staffId: draft.staffId || undefined,
      vanId: draft.vanId || undefined,
      active: draft.active,
    };

    try {
      if (editingUser) {
        await updateManagedUser({ ...payload, uid: editingUser.uid });
        setMessage(`El acceso de ${payload.name} fue actualizado.`);
      } else {
        await createManagedUser(payload);
        try {
          await sendPasswordSetupEmail(payload.email);
          setMessage(`Usuario creado. Firebase envió a ${payload.email} el correo para establecer su contraseña.`);
        } catch (mailError) {
          setMessage(`Usuario creado correctamente, pero el correo no pudo enviarse: ${errorMessage(mailError)}`);
        }
      }
      setShowModal(false);
      await Promise.all([loadUsers(), refreshTeamData()]);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: ManagedUser) {
    setBusyUserId(user.uid);
    setError('');
    setMessage('');
    try {
      await updateManagedUser({
        uid: user.uid,
        name: user.name,
        email: user.email,
        phone: user.phone ?? undefined,
        role: user.role,
        staffId: user.staffId ?? undefined,
        vanId: user.vanId ?? undefined,
        active: !user.active,
      });
      setMessage(user.active ? `${user.name} ya no puede iniciar sesión.` : `${user.name} fue reactivado.`);
      await loadUsers();
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    } finally {
      setBusyUserId('');
    }
  }

  async function sendAccess(user: ManagedUser) {
    setBusyUserId(user.uid);
    setError('');
    setMessage('');
    try {
      await sendPasswordSetupEmail(user.email);
      setMessage(`Firebase envió a ${user.email} un correo para establecer o cambiar su contraseña.`);
    } catch (mailError) {
      setError(errorMessage(mailError));
    } finally {
      setBusyUserId('');
    }
  }

  if (!firebaseAdmin) {
    return (
      <Card>
        <SectionTitle title="Usuarios y accesos" subtitle="La creación de usuarios reales está disponible al iniciar sesión como administrador de Firebase." />
        <Text style={styles.helpText}>El entorno DEMO no crea cuentas de acceso reales.</Text>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle
        title={`Usuarios y accesos (${users.length})`}
        subtitle="Crea cuentas, vincula empleados, asigna permisos y controla quién puede iniciar sesión."
        action={<Button label="Agregar usuario" icon="＋" onPress={openCreate} />}
      />

      <View style={styles.securityNote}>
        <Text style={styles.securityTitle}>Administración segura</Text>
        <Text style={styles.securityText}>Las cuentas se crean mediante Firebase Admin. DEMAC no muestra ni almacena contraseñas. El usuario recibe un correo para establecer la suya.</Text>
      </View>

      {message ? <View style={styles.successBanner}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}

      <View style={styles.toolbar}>
        <Input style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Buscar por nombre, correo, teléfono o rol" />
        <Button compact variant="secondary" label={loading ? 'Actualizando…' : 'Actualizar'} disabled={loading} onPress={() => void loadUsers()} />
      </View>

      {loading && !users.length ? <Text style={styles.helpText}>Cargando usuarios de Firebase…</Text> : null}
      {!loading && !filteredUsers.length ? <Text style={styles.helpText}>No se encontraron usuarios.</Text> : null}

      {filteredUsers.map((user) => {
        const staff = staffProfiles.find((item) => item.id === user.staffId);
        const van = vans.find((item) => item.id === user.vanId);
        const isSelf = user.uid === currentUser.id;
        return (
          <View key={user.uid} style={styles.userRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user.name)}</Text></View>
            <View style={styles.userMain}>
              <View style={styles.userTitleRow}>
                <Text style={styles.userName}>{user.name}</Text>
                {isSelf ? <Pill label="Tu cuenta" tone="success" /> : null}
                <Pill label={user.active ? 'Activo' : 'Desactivado'} tone={user.active ? 'success' : 'danger'} />
                <Pill label={roleLabels[user.role]} tone="info" />
              </View>
              <Text style={styles.userEmail}>{user.email}{user.phone ? ` · ${user.phone}` : ''}</Text>
              <Text style={styles.userMeta}>Empleado: {staff?.name ?? (user.staffId ? 'Perfil no encontrado' : 'Sin vínculo')} · Van: {van?.name ?? 'Sin van fija'}</Text>
              <Text style={styles.userMeta}>Último acceso: {formatDateTime(user.lastSignInAt)}</Text>
              {user.authMissing || user.profileMissing ? <Text style={styles.userWarning}>Cuenta incompleta: falta {user.authMissing ? 'Firebase Authentication' : 'el perfil de Firestore'}.</Text> : null}
            </View>
            <View style={styles.userActions}>
              <Button compact variant="secondary" label="Editar" disabled={busyUserId === user.uid || user.authMissing} onPress={() => openEdit(user)} />
              <Button compact variant="secondary" label="Enviar acceso" disabled={busyUserId === user.uid || !user.active || user.authMissing} onPress={() => void sendAccess(user)} />
              <Button compact variant={user.active ? 'danger' : 'success'} label={user.active ? 'Desactivar' : 'Reactivar'} disabled={busyUserId === user.uid || isSelf || user.authMissing} onPress={() => void toggleUser(user)} />
            </View>
          </View>
        );
      })}

      <AppModal visible={showModal} title={editingUser ? 'Editar usuario' : 'Agregar usuario'} onClose={() => { if (!busy) setShowModal(false); }}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.formSection}>Vincular con un empleado</Text>
          <Text style={styles.helpText}>Al elegir un técnico, ayudante o supervisor, DEMAC completa sus datos y conecta sus órdenes automáticamente.</Text>
          <View style={styles.optionGrid}>
            <Pressable onPress={() => selectStaff('')} style={[styles.optionChip, !draft.staffId && styles.optionChipActive]}>
              <Text style={[styles.optionTitle, !draft.staffId && styles.optionTitleActive]}>Sin empleado</Text>
              <Text style={styles.optionDescription}>Para oficina, contabilidad o inventario.</Text>
            </Pressable>
            {staffProfiles.filter((staff) => staff.active).map((staff) => {
              const selected = draft.staffId === staff.id;
              const unavailable = staffLinkedElsewhere(staff.id);
              return (
                <Pressable key={staff.id} disabled={unavailable} onPress={() => selectStaff(staff.id)} style={[styles.optionChip, selected && styles.optionChipActive, unavailable && styles.optionChipDisabled]}>
                  <Text style={[styles.optionTitle, selected && styles.optionTitleActive]}>{staff.name}</Text>
                  <Text style={styles.optionDescription}>{unavailable ? 'Ya tiene usuario' : `${staff.role}${staff.primaryVanId ? ' · van asignada' : ''}`}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.formGrid}>
            <Input style={styles.formField} label="Nombre completo" value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} placeholder="Nombre del empleado" />
            <Input style={styles.formField} label="Correo para iniciar sesión" value={draft.email} onChangeText={(email) => setDraft((current) => ({ ...current, email }))} autoCapitalize="none" keyboardType="email-address" placeholder="empleado@demac-aruba.com" />
            <Input style={styles.formField} label="Teléfono" value={draft.phone} onChangeText={(phone) => setDraft((current) => ({ ...current, phone }))} keyboardType="phone-pad" placeholder="+297 560 0000" />
          </View>

          <Text style={styles.formSection}>Rol de acceso</Text>
          <View style={styles.optionGrid}>
            {roleOptions.map((option) => {
              const selected = draft.role === option.value;
              const lockedSelfRole = editingUser?.uid === currentUser.id && option.value !== 'admin';
              return (
                <Pressable key={option.value} disabled={lockedSelfRole} onPress={() => setDraft((current) => ({ ...current, role: option.value }))} style={[styles.optionChip, selected && styles.optionChipActive, lockedSelfRole && styles.optionChipDisabled]}>
                  <Text style={[styles.optionTitle, selected && styles.optionTitleActive]}>{option.label}</Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.helpText}>Los ayudantes que deben completar reportes usan el acceso “Técnico / Ayudante”; su puesto laboral seguirá apareciendo como Ayudante en Equipo.</Text>

          <Text style={styles.formSection}>Van fija</Text>
          <View style={styles.optionGrid}>
            <Pressable onPress={() => setDraft((current) => ({ ...current, vanId: '' }))} style={[styles.optionChip, !draft.vanId && styles.optionChipActive]}>
              <Text style={[styles.optionTitle, !draft.vanId && styles.optionTitleActive]}>Sin van fija</Text>
            </Pressable>
            {vans.map((van) => {
              const selected = draft.vanId === van.id;
              return <Pressable key={van.id} onPress={() => setDraft((current) => ({ ...current, vanId: van.id }))} style={[styles.optionChip, selected && styles.optionChipActive]}><Text style={[styles.optionTitle, selected && styles.optionTitleActive]}>{van.name}</Text><Text style={styles.optionDescription}>{van.plate}</Text></Pressable>;
            })}
          </View>

          <Text style={styles.formSection}>Estado del acceso</Text>
          <Pressable
            disabled={editingUser?.uid === currentUser.id}
            onPress={() => setDraft((current) => ({ ...current, active: !current.active }))}
            style={[styles.activeToggle, draft.active ? styles.activeToggleOn : styles.activeToggleOff, editingUser?.uid === currentUser.id && styles.optionChipDisabled]}
          >
            <Text style={styles.activeToggleTitle}>{draft.active ? 'Cuenta activa' : 'Cuenta desactivada'}</Text>
            <Text style={styles.activeToggleText}>{draft.active ? 'El usuario podrá iniciar sesión cuando establezca su contraseña.' : 'La cuenta se crea o conserva, pero no podrá iniciar sesión.'}</Text>
          </Pressable>

          {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
          <View style={styles.modalActions}>
            <Button variant="secondary" label="Cancelar" disabled={busy} onPress={() => setShowModal(false)} />
            <Button label={busy ? 'Guardando…' : editingUser ? 'Guardar cambios' : 'Crear usuario y enviar acceso'} disabled={busy || !draft.name.trim() || !draft.email.trim()} onPress={() => void saveUser()} />
          </View>
        </ScrollView>
      </AppModal>
    </Card>
  );
}

const styles = StyleSheet.create({
  securityNote: { borderWidth: 1, borderColor: '#B8D2F5', backgroundColor: colors.infoLight, borderRadius: 10, padding: 12, marginBottom: 12 },
  securityTitle: { color: colors.info, fontWeight: '900', fontSize: 11 },
  securityText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 3 },
  successBanner: { backgroundColor: colors.successLight, borderRadius: 9, padding: 11, marginBottom: 10 },
  successText: { color: colors.success, fontSize: 10, fontWeight: '800', lineHeight: 16 },
  errorBanner: { backgroundColor: colors.dangerLight, borderRadius: 9, padding: 11, marginBottom: 10 },
  errorText: { color: colors.danger, fontSize: 10, fontWeight: '800', lineHeight: 16 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 },
  searchInput: { flex: 1, minWidth: 240, marginBottom: 0 },
  helpText: { color: colors.muted, fontSize: 10, lineHeight: 16, marginBottom: 9 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F6', flexWrap: 'wrap' },
  avatar: { width: 42, height: 42, borderRadius: 11, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '900', fontSize: 11 },
  userMain: { flex: 1, minWidth: 230 },
  userTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  userName: { color: colors.text, fontWeight: '900', fontSize: 12 },
  userEmail: { color: colors.text, fontSize: 10, marginTop: 4 },
  userMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  userWarning: { color: colors.danger, fontSize: 9, fontWeight: '800', marginTop: 4 },
  userActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  modalContent: { paddingBottom: 8 },
  formSection: { color: colors.text, fontWeight: '900', fontSize: 13, marginTop: 6, marginBottom: 8 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  formField: { flex: 1, minWidth: 210 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  optionChip: { minWidth: 155, flexGrow: 1, flexBasis: 180, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 10, backgroundColor: '#FFFFFF' },
  optionChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  optionChipDisabled: { opacity: 0.42 },
  optionTitle: { color: colors.text, fontWeight: '900', fontSize: 10 },
  optionTitleActive: { color: colors.primaryDark },
  optionDescription: { color: colors.muted, fontSize: 8, lineHeight: 13, marginTop: 3 },
  activeToggle: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  activeToggleOn: { backgroundColor: colors.successLight, borderColor: '#A8D9A2' },
  activeToggleOff: { backgroundColor: colors.dangerLight, borderColor: '#E8A9A7' },
  activeToggleTitle: { color: colors.text, fontWeight: '900', fontSize: 11 },
  activeToggleText: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 8 },
});
