from pathlib import Path


def replace_once(path: str, old: str, new: str):
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    if new in content:
        return
    if old not in content:
        raise RuntimeError(f'No se encontró el bloque esperado en {path}: {old[:120]}')
    file_path.write_text(content.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/types.ts',
    "export type StaffRole = 'Técnico responsable' | 'Técnico' | 'Ayudante' | 'Supervisor';\nexport type StaffAvailability",
    "export type StaffEmployeeType = 'Técnico' | 'Secretaria' | 'Administración' | 'Otro';\nexport type StaffRole = 'Técnico responsable' | 'Técnico' | 'Ayudante' | 'Supervisor' | 'Secretaria' | 'Administración' | 'Contabilidad' | 'Almacén' | 'Otro';\nexport type StaffAvailability",
)
replace_once(
    'src/types.ts',
    "  role: StaffRole;\n  canDriveVan: boolean;",
    "  role: StaffRole;\n  employeeType?: StaffEmployeeType;\n  canDriveVan: boolean;",
)

# Payroll must derive people only from the master staffProfiles collection.
replace_once(
    'src/hooks/usePayrollModule.ts',
    "const OFFICE_FALLBACK: PayrollEmployee[] = [\n  {\n    id: 'payroll-yerika',\n    name: 'Yerika',\n    role: 'Secretaria',\n    employeeType: 'Secretaria',\n    active: true,\n    weekdayHours: 8,\n    saturdayHours: 0,\n    halfDayWorkedHours: 4,\n    halfDayPaidFreeHours: 4,\n  },\n  {\n    id: 'payroll-herlin',\n    name: 'Herlin',\n    role: 'Secretaria',\n    employeeType: 'Secretaria',\n    active: true,\n    weekdayHours: 8,\n    saturdayHours: 0,\n    halfDayWorkedHours: 4,\n    halfDayPaidFreeHours: 4,\n  },\n];\n\n",
    "",
)
replace_once(
    'src/hooks/usePayrollModule.ts',
    "function employeeTypeFromStaff(profile: StaffProfile): PayrollEmployeeType {\n  if (profile.role === 'Técnico responsable' || profile.role === 'Técnico' || profile.role === 'Ayudante') return 'Técnico';\n  return 'Otro';\n}",
    "function employeeTypeFromStaff(profile: StaffProfile): PayrollEmployeeType {\n  if (profile.employeeType) return profile.employeeType;\n  if (['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role)) return 'Técnico';\n  if (profile.role === 'Secretaria') return 'Secretaria';\n  if (['Administración', 'Contabilidad', 'Almacén'].includes(profile.role)) return 'Administración';\n  return 'Otro';\n}",
)
replace_once(
    'src/hooks/usePayrollModule.ts',
    "  const employees = useMemo(() => {\n    const staffDefaults = staffProfiles.map(employeeFromStaff);\n    const defaults = [...staffDefaults];\n    for (const officeEmployee of OFFICE_FALLBACK) {\n      if (!defaults.some((employee) => employee.name.toLowerCase() === officeEmployee.name.toLowerCase())) defaults.push(officeEmployee);\n    }\n    const merged = new Map<string, PayrollEmployee>();\n    defaults.forEach((employee) => merged.set(employee.id, employee));\n    savedEmployees.forEach((employee) => {\n      const fallback = merged.get(employee.id) ?? [...merged.values()].find((candidate) => candidate.sourceStaffId && candidate.sourceStaffId === employee.sourceStaffId);\n      merged.set(employee.id, { ...fallback, ...employee });\n    });\n    return sortEmployees([...merged.values()]);\n  }, [savedEmployees, staffProfiles]);",
    "  const employees = useMemo(() => {\n    const merged = new Map<string, PayrollEmployee>();\n    staffProfiles.map(employeeFromStaff).forEach((employee) => merged.set(employee.id, employee));\n    savedEmployees.forEach((employee) => {\n      const masterId = employee.sourceStaffId ?? employee.id;\n      const master = merged.get(masterId);\n      if (!master) return;\n      merged.set(masterId, {\n        ...master,\n        ...employee,\n        id: masterId,\n        sourceStaffId: masterId,\n        name: master.name,\n        role: master.role,\n        active: master.active,\n      });\n    });\n    return sortEmployees([...merged.values()]);\n  }, [savedEmployees, staffProfiles]);",
)
replace_once(
    'src/hooks/usePayrollModule.ts',
    "  async function saveEmployee(employee: PayrollEmployee) {\n    setBusy(true);",
    "  async function saveEmployee(employee: PayrollEmployee) {\n    if (!staffProfiles.some((profile) => profile.id === (employee.sourceStaffId ?? employee.id))) {\n      const message = 'Primero crea el perfil maestro del empleado en Empleados.';\n      setError(message);\n      return { ok: false, message };\n    }\n    setBusy(true);",
)

# Employees screen: create/edit staffProfiles, not payroll-only people.
replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "import { AppModal, Button, Card, EmptyState, Input, Pill, SectionTitle } from '../components/UI';",
    "import { EmployeeProfileEditor } from '../components/EmployeeProfileEditor';\nimport { AppModal, Button, Card, EmptyState, Input, Pill, SectionTitle } from '../components/UI';",
)
replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "import { colors } from '../theme';",
    "import { colors } from '../theme';\nimport { StaffProfile } from '../types';",
)
replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "  const { staffProfiles } = useTeamState();",
    "  const { staffProfiles, vans, saveStaffProfile } = useTeamState();",
)
replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "  const [newEmployeeVisible, setNewEmployeeVisible] = useState(false);\n\n  const [aoDraft, setAoDraft] = useState('0');",
    "  const [profileForm, setProfileForm] = useState<StaffProfile | null>(null);\n\n  const [aoDraft, setAoDraft] = useState('0');",
)
replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "\n  const [newName, setNewName] = useState('');\n  const [newRole, setNewRole] = useState('');\n  const [newType, setNewType] = useState<PayrollEmployeeType>('Técnico');\n",
    "\n",
)
replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "  const selectedEmployee = activeEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null;\n  const selectedSummary",
    "  const selectedEmployee = activeEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null;\n  const selectedStaffProfile = staffProfiles.find((profile) => profile.id === selectedEmployeeId) ?? null;\n  const selectedSummary",
)
old_add = """  async function addEmployee() {
    if (!newName.trim()) {
      setMessage('Escribe el nombre del empleado.');
      return;
    }
    const now = new Date().toISOString();
    const technical = newType === 'Técnico';
    const secretarial = newType === 'Secretaria';
    const employee: PayrollEmployee = {
      id: `payroll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: newName.trim(),
      role: newRole.trim() || newType,
      employeeType: newType,
      active: true,
      weekdayHours: 8,
      saturdayHours: technical ? 4 : 0,
      halfDayEffectiveFrom: technical ? '2026-08-01' : secretarial ? '2026-01-01' : undefined,
      halfDayWorkedHours: technical ? 5 : secretarial ? 4 : 8,
      halfDayPaidFreeHours: technical ? 3 : secretarial ? 4 : 0,
      createdAt: now,
      updatedAt: now,
      createdByUserId: currentUser?.id,
      createdByName: currentUser?.name,
    };
    const result = await module.saveEmployee(employee);
    if (result.ok) {
      setSelectedEmployeeId(employee.id);
      setNewName('');
      setNewRole('');
      setNewEmployeeVisible(false);
      setMessage(`${employee.name} agregado al módulo de empleados.`);
    } else {
      setMessage(result.message ?? 'No se pudo agregar el empleado.');
    }
  }
"""
new_add = """  function openNewEmployee() {
    const now = new Date().toISOString();
    setProfileForm({
      id: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: '',
      phone: '',
      email: '',
      role: 'Ayudante',
      employeeType: 'Técnico',
      canDriveVan: false,
      skills: [],
      availability: 'Disponible',
      active: true,
      notes: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  async function saveMasterProfile(profile: StaffProfile) {
    const name = profile.name.trim();
    const phone = profile.phone.trim();
    if (!name || !phone) {
      setMessage('Nombre y teléfono son obligatorios.');
      return;
    }
    const normalizedName = name.toLocaleLowerCase('es').replace(/\\s+/g, ' ');
    const normalizedPhone = phone.replace(/\\D/g, '');
    const duplicate = staffProfiles.find((candidate) => candidate.id !== profile.id && (
      candidate.name.trim().toLocaleLowerCase('es').replace(/\\s+/g, ' ') === normalizedName
      || (normalizedPhone && candidate.phone.replace(/\\D/g, '') === normalizedPhone)
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
  }
"""
replace_once('src/screens/EmployeesTimesheetScreen.tsx', old_add, new_add)
replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "          <Button compact variant=\"secondary\" label=\"Agregar empleado\" onPress={() => setNewEmployeeVisible(true)} />",
    "          {currentUser?.role === 'admin' ? <Button compact variant=\"secondary\" label=\"Agregar empleado\" onPress={openNewEmployee} /> : null}",
)
replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "                action={<Button compact variant=\"secondary\" label=\"Configurar horario\" onPress={() => setScheduleEmployee(selectedEmployee)} />}",
    "                action={<View style={styles.headerActions}>{currentUser?.role === 'admin' && selectedStaffProfile ? <Button compact variant=\"secondary\" label=\"Editar perfil\" onPress={() => setProfileForm({ ...selectedStaffProfile, skills: [...selectedStaffProfile.skills] })} /> : null}<Button compact variant=\"secondary\" label=\"Configurar horario\" onPress={() => setScheduleEmployee(selectedEmployee)} /></View>}",
)
old_modal = """      <AppModal visible={newEmployeeVisible} title="Agregar empleado al timesheet" onClose={() => setNewEmployeeVisible(false)}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Input label="Nombre completo" value={newName} onChangeText={setNewName} />
          <Input label="Cargo" value={newRole} onChangeText={setNewRole} placeholder="Ej. Técnico, Secretaria, Supervisor..." />
          <Text style={styles.filterLabel}>TIPO DE EMPLEADO</Text>
          <View style={styles.optionRow}>
            {EMPLOYEE_TYPES.filter((type): type is PayrollEmployeeType => type !== 'Todos').map((type) => <Button key={type} compact variant={newType === type ? 'primary' : 'secondary'} label={type} onPress={() => setNewType(type)} />)}
          </View>
          <Button variant="success" label={module.busy ? 'Guardando…' : 'Agregar empleado'} disabled={module.busy} onPress={() => void addEmployee()} />
        </ScrollView>
      </AppModal>"""
new_modal = """      <AppModal visible={Boolean(profileForm)} title={profileForm && staffProfiles.some((profile) => profile.id === profileForm.id) ? 'Editar perfil maestro' : 'Agregar empleado'} onClose={() => setProfileForm(null)}>
        {profileForm ? <EmployeeProfileEditor profile={profileForm} vans={vans} busy={module.busy} onCancel={() => setProfileForm(null)} onSave={saveMasterProfile} /> : null}
      </AppModal>"""
replace_once('src/screens/EmployeesTimesheetScreen.tsx', old_modal, new_modal)

# Team becomes operational assignment only; no second employee creator.
replace_once(
    'src/screens/TeamScreen.tsx',
    "  const headerAction = tab === 'staff'\n    ? <Button label=\"Nuevo trabajador\" icon=\"＋\" onPress={() => openStaff()} />\n    : tab === 'vans'",
    "  const headerAction = tab === 'vans'",
)
replace_once(
    'src/screens/TeamScreen.tsx',
    "      <SectionTitle title=\"Equipo y flota\" subtitle=\"Administra personal, responsables, ayudantes, ausencias, despacho diario, kilometraje, mantenimiento e inventario.\" action={headerAction} />",
    "      <SectionTitle title=\"Equipo y flota\" subtitle=\"Asigna empleados existentes a las vans, administra responsables, ayudantes, ausencias, despacho y flota. Los perfiles maestros se crean en Empleados.\" action={headerAction} />",
)
replace_once(
    'src/screens/TeamScreen.tsx',
    "        const van = vans.find((item) => item.id === profile.primaryVanId);",
    "        const assignedVans = vans.filter((item) => item.responsibleStaffId === profile.id || item.regularHelperId === profile.id);",
)
replace_once(
    'src/screens/TeamScreen.tsx',
    "          <InfoRow label=\"Van principal\" value={van?.name ?? 'Sin van'} /><InfoRow label=\"Puede manejar\" value={profile.canDriveVan ? 'Sí' : 'No'} /><InfoRow label=\"Teléfono\" value={profile.phone} />",
    "          <InfoRow label=\"Asignación de van\" value={assignedVans.length ? assignedVans.map((van) => `${van.name} (${van.responsibleStaffId === profile.id ? 'responsable' : 'ayudante'})`).join(' · ') : 'Sin van'} /><InfoRow label=\"Puede manejar\" value={profile.canDriveVan ? 'Sí' : 'No'} /><InfoRow label=\"Teléfono\" value={profile.phone} />",
)
replace_once(
    'src/screens/TeamScreen.tsx',
    "          <View style={styles.actions}><Button compact variant=\"secondary\" label=\"Editar\" onPress={() => openStaff(profile)} /><Button compact variant=\"secondary\" label=\"Registrar ausencia\" onPress={() => openAbsence(profile)} /></View>",
    "          <View style={styles.actions}><Button compact variant=\"secondary\" label=\"Registrar ausencia\" onPress={() => openAbsence(profile)} /></View>",
)
replace_once(
    'src/screens/TeamScreen.tsx',
    "    const result = await saveVanProfile({ ...vanForm, technicianIds, updatedAt: new Date().toISOString() });\n    setSaving(false);",
    "    const result = await saveVanProfile({ ...vanForm, technicianIds, updatedAt: new Date().toISOString() });\n    const responsible = staffProfiles.find((profile) => profile.id === vanForm.responsibleStaffId);\n    if (result.ok && responsible && !responsible.canDriveVan) {\n      await saveStaffProfile({ ...responsible, canDriveVan: true, updatedAt: new Date().toISOString() });\n    }\n    setSaving(false);",
)
replace_once(
    'src/screens/TeamScreen.tsx',
    "<FieldTitle text=\"Técnico responsable\" /><Choices options={['Sin responsable', ...staffProfiles.filter((item) => item.canDriveVan).map((item) => item.name)]}",
    "<FieldTitle text=\"Técnico responsable\" /><Choices options={['Sin responsable', ...staffProfiles.filter((item) => item.active && (item.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(item.role))).map((item) => item.name)]}",
)
replace_once(
    'src/screens/TeamScreen.tsx',
    "<FieldTitle text=\"Ayudante habitual\" /><Choices options={['Sin ayudante', ...staffProfiles.filter((item) => item.id !== vanForm?.responsibleStaffId).map((item) => item.name)]}",
    "<FieldTitle text=\"Ayudante habitual\" /><Choices options={['Sin ayudante', ...staffProfiles.filter((item) => item.active && item.id !== vanForm?.responsibleStaffId && (item.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(item.role))).map((item) => item.name)]}",
)

print('Employee master profile integration applied.')
