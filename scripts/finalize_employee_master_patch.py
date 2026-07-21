from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, content: str):
    Path(path).write_text(content, encoding='utf-8')


def replace_required(content: str, old: str, new: str, label: str) -> str:
    if new in content:
        return content
    if old not in content:
        raise RuntimeError(f'No se encontró {label}')
    return content.replace(old, new, 1)


# Remove payroll-only placeholder people and use schedules based on the master profile type.
path = 'src/hooks/usePayrollModule.ts'
content = read(path)
start = content.find('const OFFICE_FALLBACK: PayrollEmployee[] = [')
if start >= 0:
    end_marker = '\n\nfunction isoDate'
    end = content.find(end_marker, start)
    if end < 0:
        raise RuntimeError('No se encontró el final de OFFICE_FALLBACK')
    content = content[:start] + 'function isoDate' + content[end + len(end_marker):]

old_employee_from_staff = """function employeeFromStaff(profile: StaffProfile): PayrollEmployee {
  return {
    id: profile.id,
    sourceStaffId: profile.id,
    name: profile.name,
    role: profile.role,
    employeeType: employeeTypeFromStaff(profile),
    active: profile.active,
    weekdayHours: 8,
    saturdayHours: 4,
    halfDayEffectiveFrom: '2026-08-01',
    halfDayWorkedHours: 5,
    halfDayPaidFreeHours: 3,
  };
}"""
new_employee_from_staff = """function employeeFromStaff(profile: StaffProfile): PayrollEmployee {
  const employeeType = employeeTypeFromStaff(profile);
  const technical = employeeType === 'Técnico';
  const secretarial = employeeType === 'Secretaria';
  return {
    id: profile.id,
    sourceStaffId: profile.id,
    name: profile.name,
    role: profile.role,
    employeeType,
    active: profile.active,
    weekdayHours: 8,
    saturdayHours: technical ? 4 : 0,
    halfDayEffectiveFrom: technical ? '2026-08-01' : secretarial ? '2026-01-01' : undefined,
    halfDayWorkedHours: technical ? 5 : secretarial ? 4 : 8,
    halfDayPaidFreeHours: technical ? 3 : secretarial ? 4 : 0,
  };
}"""
content = replace_required(content, old_employee_from_staff, new_employee_from_staff, 'employeeFromStaff')
write(path, content)

# Finish the Employees UI as a master directory plus Timesheet.
path = 'src/screens/EmployeesTimesheetScreen.tsx'
content = read(path)
content = content.replace("  const [profileForm, setProfileForm] = useState<StaffProfile | null>(null);\n", "  const [profileForm, setProfileForm] = useState<StaffProfile | null>(null);\n  const [directoryVisible, setDirectoryVisible] = useState(false);\n  const [profileSaving, setProfileSaving] = useState(false);\n", 1)
content = content.replace("\n  const [newName, setNewName] = useState('');\n  const [newRole, setNewRole] = useState('');\n  const [newType, setNewType] = useState<PayrollEmployeeType>('Técnico');\n", "\n", 1)
content = content.replace("  function openNewEmployee() {\n    const now = new Date().toISOString();", "  function openNewEmployee() {\n    setDirectoryVisible(false);\n    const now = new Date().toISOString();", 1)
old_save_master = """  async function saveMasterProfile(profile: StaffProfile) {
    const name = profile.name.trim();
    const phone = profile.phone.trim();
    if (!name || !phone) {
      setMessage('Nombre y teléfono son obligatorios.');
      return;
    }
    const normalizedName = name.toLocaleLowerCase('es').replace(/\s+/g, ' ');
    const normalizedPhone = phone.replace(/\D/g, '');
    const duplicate = staffProfiles.find((candidate) => candidate.id !== profile.id && (
      candidate.name.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ') === normalizedName
      || (normalizedPhone && candidate.phone.replace(/\D/g, '') === normalizedPhone)
    ));
    if (duplicate) {
      setMessage(`Ya existe un perfil maestro para ${duplicate.name}. Revisa el nombre o teléfono antes de guardar.`);
      return;
    }
    const result = await saveStaffProfile({ ...profile, name, phone, updatedAt: new Date().toISOString() });
    if (!result.ok) {
      setMessage(result.message ?? 'No se pudo guardar el perfil maestro.');
      return;
    }
    setSelectedEmployeeId(profile.id);
    setProfileForm(null);
    setMessage(`${name} quedó guardado como registro maestro del empleado.`);
  }"""
new_save_master = """  async function saveMasterProfile(profile: StaffProfile) {
    const name = profile.name.trim();
    const phone = profile.phone.trim();
    if (!name || !phone) {
      setMessage('Nombre y teléfono son obligatorios.');
      return;
    }
    const normalizedName = name.toLocaleLowerCase('es').replace(/\s+/g, ' ');
    const normalizedPhone = phone.replace(/\D/g, '');
    const duplicate = staffProfiles.find((candidate) => candidate.id !== profile.id && (
      candidate.name.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ') === normalizedName
      || (normalizedPhone && candidate.phone.replace(/\D/g, '') === normalizedPhone)
    ));
    if (duplicate) {
      setMessage(`Ya existe un perfil maestro para ${duplicate.name}. Revisa el nombre o teléfono antes de guardar.`);
      return;
    }
    setProfileSaving(true);
    const result = await saveStaffProfile({ ...profile, name, phone, updatedAt: new Date().toISOString() });
    setProfileSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? 'No se pudo guardar el perfil maestro.');
      return;
    }
    setSelectedEmployeeId(profile.id);
    setProfileForm(null);
    setDirectoryVisible(false);
    setMessage(`${name} quedó guardado como registro maestro del empleado.`);
  }"""
content = replace_required(content, old_save_master, new_save_master, 'saveMasterProfile')
content = content.replace(
    "          {currentUser?.role === 'admin' ? <Button compact variant=\"secondary\" label=\"Agregar empleado\" onPress={openNewEmployee} /> : null}",
    "          {currentUser?.role === 'admin' ? <><Button compact variant=\"secondary\" label=\"Directorio de empleados\" onPress={() => setDirectoryVisible(true)} /><Button compact variant=\"secondary\" label=\"Agregar empleado\" onPress={openNewEmployee} /></> : null}",
    1,
)
content = content.replace(
    "onPress={() => setProfileForm({ ...selectedStaffProfile, skills: [...selectedStaffProfile.skills] })}",
    "onPress={() => { setDirectoryVisible(false); setProfileForm({ ...selectedStaffProfile, skills: [...selectedStaffProfile.skills] }); }}",
    1,
)
profile_modal = """      <AppModal visible={Boolean(profileForm)} title={profileForm && staffProfiles.some((profile) => profile.id === profileForm.id) ? 'Editar perfil maestro' : 'Agregar empleado'} onClose={() => setProfileForm(null)}>
        {profileForm ? <EmployeeProfileEditor profile={profileForm} vans={vans} busy={module.busy} onCancel={() => setProfileForm(null)} onSave={saveMasterProfile} /> : null}
      </AppModal>"""
replacement_modals = """      <AppModal visible={directoryVisible} title="Directorio maestro de empleados" onClose={() => setDirectoryVisible(false)}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <View style={styles.rulesCard}>
            <Text style={styles.rulesTitle}>Un solo perfil por persona</Text>
            <Text style={styles.rulesText}>Los empleados de esta lista son los mismos que se seleccionan en las vans y en Timesheet.</Text>
          </View>
          {staffProfiles.map((profile) => {
            const assignments = vans.filter((van) => van.responsibleStaffId === profile.id || van.regularHelperId === profile.id);
            return <Pressable key={profile.id} onPress={() => { setDirectoryVisible(false); setProfileForm({ ...profile, skills: [...profile.skills] }); }} style={styles.dayRow}>
              <View style={styles.dayRowDate}><Text style={styles.employeeName}>{profile.name}</Text><Text style={styles.employeeRole}>{profile.role} · {profile.phone}</Text></View>
              <Text style={styles.dayRowHours}>{assignments.length ? assignments.map((van) => van.name).join(' · ') : 'Sin van'}</Text>
              <Pill label={profile.active ? profile.availability : 'Inactivo'} tone={profile.active ? 'success' : 'neutral'} />
              <Text style={styles.openDetail}>Editar ›</Text>
            </Pressable>;
          })}
          <Button variant="success" label="Agregar empleado" onPress={openNewEmployee} />
        </ScrollView>
      </AppModal>

      <AppModal visible={Boolean(profileForm)} title={profileForm && staffProfiles.some((profile) => profile.id === profileForm.id) ? 'Editar perfil maestro' : 'Agregar empleado'} onClose={() => !profileSaving && setProfileForm(null)}>
        {profileForm ? <EmployeeProfileEditor profile={profileForm} vans={vans} busy={profileSaving} onCancel={() => setProfileForm(null)} onSave={saveMasterProfile} /> : null}
      </AppModal>"""
content = replace_required(content, profile_modal, replacement_modals, 'modales de directorio')
write(path, content)

# Daily van helper selection must only offer technical employees.
path = 'src/screens/TeamScreen.tsx'
content = read(path)
old_helper = "staffProfiles.filter((item) => item.active && item.id !== assignmentForm?.driverStaffId && !unavailable(item, selectedDate, staffAbsences)).map((item) => item.name)"
new_helper = "staffProfiles.filter((item) => item.active && item.id !== assignmentForm?.driverStaffId && !unavailable(item, selectedDate, staffAbsences) && (item.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(item.role))).map((item) => item.name)"
content = replace_required(content, old_helper, new_helper, 'filtro de ayudantes del despacho')
write(path, content)

print('Employee master integration finalized.')
