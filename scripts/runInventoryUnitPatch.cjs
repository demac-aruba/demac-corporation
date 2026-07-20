const fs = require('fs');
const { spawnSync } = require('child_process');

const screenPath = 'src/screens/InventoryScreenV4.tsx';
const screen = fs.readFileSync(screenPath, 'utf8');

if (screen.includes("const [toolTrackingMode, setToolTrackingMode]")) {
  console.log('Inventory per-unit patch already applied.');
  process.exit(0);
}

const commands = process.platform === 'win32'
  ? [['py', ['-3', 'scripts/apply_inventory_unit_patch.py']], ['python', ['scripts/apply_inventory_unit_patch.py']]]
  : [['python3', ['scripts/apply_inventory_unit_patch.py']], ['python', ['scripts/apply_inventory_unit_patch.py']]];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (!result.error && result.status === 0) process.exit(0);
  if (result.status && result.status !== 0) process.exit(result.status);
}

console.error('No se encontró Python para aplicar la actualización del inventario.');
process.exit(1);
