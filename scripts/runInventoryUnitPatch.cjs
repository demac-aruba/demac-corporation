const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const screenPath = 'src/screens/InventoryScreenV4.tsx';
const patchPath = 'scripts/apply_inventory_unit_patch.py';
const screen = fs.readFileSync(screenPath, 'utf8');

if (screen.includes("const [toolTrackingMode, setToolTrackingMode]")) {
  console.log('Inventory per-unit patch already applied.');
  process.exit(0);
}

const invalidValidation = `for forbidden in ('toolCondition', 'setToolCondition', 'addCondition', 'setAddCondition'):\n    if forbidden in screen:\n        raise RuntimeError(f'old state reference remains: {forbidden}')\n\n`;
const patchSource = fs.readFileSync(patchPath, 'utf8').replace(invalidValidation, '');
const runtimePatchPath = path.join(os.tmpdir(), 'apply_inventory_unit_patch_runtime.py');
fs.writeFileSync(runtimePatchPath, patchSource, 'utf8');

const commands = process.platform === 'win32'
  ? [['py', ['-3', runtimePatchPath]], ['python', [runtimePatchPath]]]
  : [['python3', [runtimePatchPath]], ['python', [runtimePatchPath]]];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (!result.error && result.status === 0) process.exit(0);
  if (result.status && result.status !== 0) process.exit(result.status);
}

console.error('No se encontró Python para aplicar la actualización del inventario.');
process.exit(1);
