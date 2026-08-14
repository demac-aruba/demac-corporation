const fs = require('fs');

// MARKETING_AGENT_FOUNDATION_V18
// The repository rebuilds AppShell from AppShellV2 at the end of patch:all.
// This patch deliberately runs after DEMAC_OPERATIONS_SHELL_V16 so Marketing
// survives every typecheck/build pass without weakening legacy patch anchors.

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Marketing foundation block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Marketing foundation anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

replaceOnce(
  'src/types.ts',
  "  | 'inventory'\n  | 'employees'",
  "  | 'inventory'\n  | 'marketing'\n  | 'employees'",
  "  | 'marketing'",
);

const shellFile = 'src/components/AppShell.tsx';
insertAfter(
  shellFile,
  "import { InventoryScreen } from '../screens/InventoryScreen';",
  "\nimport { MarketingScreen } from '../screens/MarketingScreen';",
  "MarketingScreen } from '../screens/MarketingScreen'",
);
insertAfter(
  shellFile,
  "  { key: 'inventory', label: 'Inventario', short: 'IN', group: 'Negocio', roles: ['admin', 'supervisor', 'inventory'] },",
  "\n  { key: 'marketing', label: 'Marketing', short: 'MK', group: 'Negocio', roles: ['admin', 'office'] },",
  "key: 'marketing'",
);
insertAfter(
  shellFile,
  "    case 'inventory': content = <InventoryScreen />; break;",
  "\n    case 'marketing': content = <MarketingScreen />; break;",
  "case 'marketing': content = <MarketingScreen />",
);

console.log('Marketing Agent foundation V18 applied.');
require('./patchMarketingV1cRepeatBuildPreflight.cjs');
require('./patchMarketingImageAnalysisV19.cjs');
require('./patchMarketingCallableV20.cjs');
require('./patchMarketingCampaignStrategyV21Preflight.cjs');
require('./patchMarketingCampaignStrategyV21.cjs');
require('./patchMarketingCampaignStrategyV22.cjs');
require('./patchMarketingCampaignStrategyV23.cjs');
require('./patchMarketingBrandCenterV24Preflight.cjs');
require('./patchMarketingBrandCenterV24.cjs');