from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    if new in content:
        return
    if old not in content:
        raise RuntimeError(f'No se encontró el bloque esperado en {path}')
    file_path.write_text(content.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/hooks/usePayrollModule.ts',
    "  let scheduledWorkHours = weekday === 6 ? Number(employee.saturdayHours ?? 0) : Number(employee.weekdayHours ?? 8);",
    "  // El horario regular aplica de lunes a sábado. El medio día semanal se configura por separado.\n  let scheduledWorkHours = Number(employee.weekdayHours ?? 8);",
)

replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "      <View style={styles.formGrid}>\n        <Input style={styles.field} keyboardType=\"decimal-pad\" label=\"Horas lunes a viernes\" value={String(draft.weekdayHours)} onChangeText={(value) => setDraft((current) => ({ ...current, weekdayHours: Math.max(0, Number(value || 0)) }))} />\n        <Input style={styles.field} keyboardType=\"decimal-pad\" label=\"Horas sábado\" value={String(draft.saturdayHours)} onChangeText={(value) => setDraft((current) => ({ ...current, saturdayHours: Math.max(0, Number(value || 0)) }))} />\n      </View>",
    "      <Input keyboardType=\"decimal-pad\" label=\"Horario regular diario (lunes a sábado)\" value={String(draft.weekdayHours)} onChangeText={(value) => setDraft((current) => ({ ...current, weekdayHours: Math.max(0, Number(value || 0)), saturdayHours: Math.max(0, Number(value || 0)) }))} />\n      <Text style={styles.rulesText}>Este horario aplica a todos los días laborables de lunes a sábado. El día de medio día y sus horas especiales se configuran abajo.</Text>",
)

replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "<Button variant=\"success\" label={busy ? 'Guardando…' : 'Guardar horario'} disabled={busy} onPress={() => void onSave({ ...draft, updatedAt: new Date().toISOString() })} />",
    "<Button variant=\"success\" label={busy ? 'Guardando…' : 'Guardar horario'} disabled={busy} onPress={() => void onSave({ ...draft, saturdayHours: draft.weekdayHours, updatedAt: new Date().toISOString() })} />",
)

replace_once(
    'src/screens/EmployeesTimesheetScreen.tsx',
    "        <Text style={styles.rulesText}>• Las horas regulares se calculan como jornada programada menos AO y No Work No Pay.</Text>",
    "        <Text style={styles.rulesText}>• El horario regular diario aplica de lunes a sábado; domingo permanece sin jornada.</Text>\n        <Text style={styles.rulesText}>• Las horas regulares se calculan como jornada programada menos AO y No Work No Pay.</Text>",
)
