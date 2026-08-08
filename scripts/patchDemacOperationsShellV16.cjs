const fs = require('fs');
const path = require('path');

// DEMAC_OPERATIONS_SHELL_V16
// Transitional activation layer: all legacy patches run first, then the
// reviewed Operations OS shell becomes the runtime AppShell. This lets us
// preview the redesign without changing the anchors required by older patches.
const candidate = path.join(__dirname, '..', 'src', 'components', 'AppShellV2.tsx');
const target = path.join(__dirname, '..', 'src', 'components', 'AppShell.tsx');

if (!fs.existsSync(candidate)) throw new Error('DEMAC Operations OS shell candidate is missing.');
const next = fs.readFileSync(candidate, 'utf8');
if (!next.includes("export function AppShell()")) throw new Error('DEMAC Operations OS shell candidate is invalid.');
fs.writeFileSync(target, next);
console.log('patchDemacOperationsShellV16.cjs applied.');
