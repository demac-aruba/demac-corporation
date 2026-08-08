const fs = require('fs');
const path = require('path');

// DEMAC_OPERATIONS_SHELL_V16
// Transitional activation layer: all legacy patches run first, then the
// reviewed Operations OS shell becomes the runtime AppShell. The compatibility
// transforms below preserve capabilities that older patches inject into the
// legacy shell during the same pipeline.
const candidate = path.join(__dirname, '..', 'src', 'components', 'AppShellV2.tsx');
const target = path.join(__dirname, '..', 'src', 'components', 'AppShell.tsx');

if (!fs.existsSync(candidate)) throw new Error('DEMAC Operations OS shell candidate is missing.');
let next = fs.readFileSync(candidate, 'utf8');
if (!next.includes('export function AppShell()')) throw new Error('DEMAC Operations OS shell candidate is invalid.');

function insertAfter(anchor, insertion, marker) {
  if (next.includes(marker)) return;
  if (!next.includes(anchor)) throw new Error(`DEMAC shell compatibility anchor not found: ${marker}`);
  next = next.replace(anchor, `${anchor}${insertion}`);
}

function replaceOnce(oldText, newText, marker) {
  if (next.includes(marker)) return;
  if (!next.includes(oldText)) throw new Error(`DEMAC shell compatibility block not found: ${marker}`);
  next = next.replace(oldText, newText);
}

// Office review is a first-class operational module added by the existing
// office-review patch.
insertAfter(
  "import { InventoryScreen } from '../screens/InventoryScreen';",
  "\nimport { OfficeReportReviewScreen } from '../screens/OfficeReportReviewScreen';",
  "OfficeReportReviewScreen } from '../screens/OfficeReportReviewScreen'",
);
insertAfter(
  "  { key: 'workOrders', label: 'Órdenes de trabajo', short: 'OT', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },",
  "\n  { key: 'reportReview', label: 'Revisión de reportes', short: 'RR', group: 'Operaciones', roles: ['admin', 'office', 'supervisor'] },",
  "key: 'reportReview'",
);
insertAfter(
  "    case 'workOrders': content = <WorkOrdersScreen />; break;",
  "\n    case 'reportReview': content = <OfficeReportReviewScreen />; break;",
  "case 'reportReview': content = <OfficeReportReviewScreen />",
);

// Preserve deep links such as ?screen=reportReview created by report output.
insertAfter(
  "  const defaultScreen: ScreenKey = currentUser?.role === 'technician' ? 'technician' : currentUser?.role === 'inventory' ? 'inventory' : currentUser?.role === 'accounting' ? 'finance' : 'dashboard';",
  "\n  const requestedScreen = useMemo(() => {\n    if (typeof window === 'undefined') return undefined;\n    const value = new URLSearchParams(window.location.search).get('screen') as ScreenKey | null;\n    return value && availableItems.some((item) => item.key === value) ? value : undefined;\n  }, [availableItems]);",
  'const requestedScreen = useMemo',
);
replaceOnce(
  "  const [activeScreen, setActiveScreen] = useState<ScreenKey>(() => readHistoryScreen<ScreenKey>(availableScreenKeys) ?? defaultScreen);",
  "  const [activeScreen, setActiveScreen] = useState<ScreenKey>(() => readHistoryScreen<ScreenKey>(availableScreenKeys) ?? requestedScreen ?? defaultScreen);",
  '?? requestedScreen ?? defaultScreen',
);
replaceOnce(
  "    const nextScreen = restoredScreen ?? (availableScreenKeys.includes(activeScreen) ? activeScreen : defaultScreen);",
  "    const nextScreen = restoredScreen ?? requestedScreen ?? (availableScreenKeys.includes(activeScreen) ? activeScreen : defaultScreen);",
  'restoredScreen ?? requestedScreen ??',
);
replaceOnce(
  "  }, [currentUser?.id, defaultScreen, availableScreenKeys]);",
  "  }, [currentUser?.id, defaultScreen, requestedScreen, availableScreenKeys]);",
  'defaultScreen, requestedScreen, availableScreenKeys',
);

fs.writeFileSync(target, next);
console.log('patchDemacOperationsShellV16.cjs applied with runtime compatibility.');
