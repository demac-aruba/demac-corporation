const fs = require('fs');
const path = require('path');

// DEMAC_OPERATIONS_SHELL_V16
// Transitional activation layer: legacy patches rebuild the canonical source
// first; this final step swaps in the reviewed premium shell. AppShellV3 already
// contains the compatibility behavior that older patches inject into AppShell:
// report review, deep links and browser/mobile back history.
const candidate = path.join(__dirname, '..', 'src', 'components', 'AppShellV3.tsx');
const target = path.join(__dirname, '..', 'src', 'components', 'AppShell.tsx');

if (!fs.existsSync(candidate)) throw new Error('DEMAC premium shell candidate is missing.');
const next = fs.readFileSync(candidate, 'utf8');
for (const marker of [
  'export function AppShell()',
  "DashboardScreenV2 } from '../screens/DashboardScreenV2'",
  "OfficeReportReviewScreen } from '../screens/OfficeReportReviewScreen'",
  'const requestedScreen = useMemo',
  'subscribeToScreenHistory((screen)',
]) {
  if (!next.includes(marker)) throw new Error(`DEMAC premium shell candidate is missing required capability: ${marker}`);
}

fs.writeFileSync(target, next);
console.log('patchDemacOperationsShellV16.cjs activated premium V3 shell.');
