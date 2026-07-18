const fs = require('fs');
const path = 'src/state/AppState.tsx';
let text = fs.readFileSync(path, 'utf8');
function replace(oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`${label} not found`);
  text = text.replace(oldText, newText);
}
replace(
  "  saveFirestoreDocument,\n  signInWithFirebaseEmail,\n",
  "  saveFirestoreDocument,\n  signInWithFirebaseEmail,\n  updateFirestoreDocument,\n",
  'firebase import',
);
replace(
  "  const updateWorkOrder = async (id: string, changes: Partial<WorkOrder>): Promise<OperationResult> => {\n    const existing = workOrders.find((order) => order.id === id);\n    if (!existing) return { ok: false, message: 'La orden ya no existe.' };\n    const updated = { ...existing, ...changes, updatedAt: changes.updatedAt ?? new Date().toISOString() };\n    if (currentUser?.authProvider !== 'firebase') {\n      setWorkOrders((previous) => previous.map((order) => order.id === id ? updated : order));\n      return { ok: true };\n    }\n    try {\n      await saveFirestoreDocument('workOrders', updated);\n      setWorkOrders((previous) => previous.map((order) => order.id === id ? updated : order));\n      setDataError(null);\n      setLastSyncedAt(new Date().toISOString());\n      return { ok: true };\n    } catch (error) {\n      const message = friendlyDataError(error);\n      setDataError(message);\n      return { ok: false, message };\n    }\n  };\n",
  "  const updateWorkOrder = async (id: string, changes: Partial<WorkOrder>): Promise<OperationResult> => {\n    const existing = workOrders.find((order) => order.id === id);\n    if (!existing) return { ok: false, message: 'La orden ya no existe.' };\n    const patch = { ...changes, updatedAt: changes.updatedAt ?? new Date().toISOString() };\n    const updated = { ...existing, ...patch };\n    if (currentUser?.authProvider !== 'firebase') {\n      setWorkOrders((previous) => previous.map((order) => order.id === id ? updated : order));\n      return { ok: true };\n    }\n    try {\n      await updateFirestoreDocument('workOrders', id, patch as Record<string, unknown>);\n      setWorkOrders((previous) => previous.map((order) => order.id === id ? updated : order));\n      setDataError(null);\n      setLastSyncedAt(new Date().toISOString());\n      return { ok: true };\n    } catch (error) {\n      const genericMessage = friendlyDataError(error);\n      const message = currentUser?.role === 'technician' && genericMessage.startsWith('Firebase rechazó')\n        ? 'Firebase rechazó este cambio. Confirma que tu cuenta esté vinculada al empleado correcto y que la orden esté asignada a ese técnico o a su van.'\n        : genericMessage;\n      setDataError(message);\n      return { ok: false, message };\n    }\n  };\n",
  'updateWorkOrder block',
);
fs.writeFileSync(path, text);
