from pathlib import Path


def replace_once(path: str, old: str, new: str):
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    if new in content:
        return
    if old not in content:
        raise RuntimeError(f'No se encontró el bloque esperado en {path}: {old[:80]}')
    file_path.write_text(content.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/types.ts',
    "  | 'inventory'\n  | 'finance'",
    "  | 'inventory'\n  | 'employees'\n  | 'finance'",
)

replace_once(
    'src/components/AppShell.tsx',
    "import { FinanceScreen } from '../screens/FinanceScreen';\nimport { InventoryScreen } from '../screens/InventoryScreen';",
    "import { FinanceScreen } from '../screens/FinanceScreen';\nimport { EmployeesTimesheetScreen } from '../screens/EmployeesTimesheetScreen';\nimport { InventoryScreen } from '../screens/InventoryScreen';",
)

replace_once(
    'src/components/AppShell.tsx',
    "  { key: 'inventory', label: 'Inventario', icon: '◇', roles: ['admin', 'supervisor', 'inventory'] },\n  { key: 'finance', label: 'Cuentas', icon: '▤', roles: ['admin', 'accounting'] },",
    "  { key: 'inventory', label: 'Inventario', icon: '◇', roles: ['admin', 'supervisor', 'inventory'] },\n  { key: 'employees', label: 'Empleados', icon: '♙', roles: ['admin', 'accounting'] },\n  { key: 'finance', label: 'Cuentas', icon: '▤', roles: ['admin', 'accounting'] },",
)

replace_once(
    'src/components/AppShell.tsx',
    "    case 'inventory': content = <InventoryScreen />; break;\n    case 'finance': content = <FinanceScreen />; break;",
    "    case 'inventory': content = <InventoryScreen />; break;\n    case 'employees': content = <EmployeesTimesheetScreen />; break;\n    case 'finance': content = <FinanceScreen />; break;",
)

replace_once(
    'firestore.rules',
    "    function inventoryRole() {\n      return activeStaff() && userProfile().data.role in ['admin', 'office', 'supervisor', 'inventory'];\n    }\n\n    function technicianRole()",
    "    function inventoryRole() {\n      return activeStaff() && userProfile().data.role in ['admin', 'office', 'supervisor', 'inventory'];\n    }\n\n    function payrollRole() {\n      return activeStaff() && userProfile().data.role in ['admin', 'accounting'];\n    }\n\n    function technicianRole()",
)

replace_once(
    'firestore.rules',
    "    match /staffAbsences/{absenceId} {\n      allow read: if activeStaff();\n      allow create, update, delete: if operationsRole();\n    }\n\n    match /vanMaintenanceLogs/{logId}",
    "    match /staffAbsences/{absenceId} {\n      allow read: if activeStaff();\n      allow create, update, delete: if operationsRole();\n    }\n\n    match /employeePayrollSettings/{employeeId} {\n      allow read, create, update: if payrollRole();\n      allow delete: if adminRole();\n    }\n\n    match /employeeTimesheets/{entryId} {\n      allow read, create, update: if payrollRole();\n      allow delete: if adminRole();\n    }\n\n    match /vanMaintenanceLogs/{logId}",
)

print('Employee timesheet integration applied.')
