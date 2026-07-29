const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(path, oldText, newText, marker) {
  const text = read(path);
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) {
    throw new Error(`Required navigation history patch block not found in ${path}: ${marker}`);
  }
  write(path, text.replace(oldText, newText));
}

function insertAfter(path, anchor, insertion, marker) {
  const text = read(path);
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) {
    throw new Error(`Required navigation history patch anchor not found in ${path}: ${marker}`);
  }
  write(path, text.replace(anchor, `${anchor}${insertion}`));
}

function assertIncludes(path, markers) {
  const text = read(path);
  for (const marker of markers) {
    if (!text.includes(marker)) throw new Error(`Navigation history validation failed in ${path}: ${marker}`);
  }
}

// ---------------------------------------------------------------------------
// Main application modules: every module change receives a browser-history
// entry, and popstate restores the previous module instead of leaving the app.
// ---------------------------------------------------------------------------
const shellFile = 'src/components/AppShell.tsx';
replaceOnce(
  shellFile,
  "import React, { ReactNode, useMemo, useState } from 'react';",
  "import React, { ReactNode, useEffect, useMemo, useState } from 'react';",
  'ReactNode, useEffect, useMemo, useState',
);
insertAfter(
  shellFile,
  "import { useAppState } from '../state/AppState';",
  "\nimport { pushHistoryScreen, readHistoryScreen, replaceHistoryScreen, subscribeToScreenHistory, useWebBackLayer } from '../navigation/appHistory';",
  "from '../navigation/appHistory'",
);
insertAfter(
  shellFile,
  "  const availableItems = useMemo(() => navItems.filter((item) => currentUser && item.roles.includes(currentUser.role)), [currentUser]);",
  "\n  const availableScreenKeys = useMemo(() => availableItems.map((item) => item.key), [availableItems]);",
  'const availableScreenKeys =',
);
replaceOnce(
  shellFile,
  '  const [activeScreen, setActiveScreen] = useState<ScreenKey>(requestedScreen ?? defaultScreen);',
  '  const [activeScreen, setActiveScreen] = useState<ScreenKey>(() => readHistoryScreen<ScreenKey>(availableScreenKeys) ?? requestedScreen ?? defaultScreen);',
  'readHistoryScreen<ScreenKey>(availableScreenKeys)',
);
insertAfter(
  shellFile,
  '  const [profileMenuVisible, setProfileMenuVisible] = useState(false);',
  "\n  useWebBackLayer(profileMenuVisible, () => setProfileMenuVisible(false), 'account-menu');",
  "'account-menu'",
);
replaceOnce(
  shellFile,
  `  const navigate = (screen: ScreenKey) => {
    if (availableItems.some((item) => item.key === screen)) setActiveScreen(screen);
  };`,
  `  useEffect(() => {
    const restoredScreen = readHistoryScreen<ScreenKey>(availableScreenKeys);
    const nextScreen = restoredScreen ?? requestedScreen ?? (availableScreenKeys.includes(activeScreen) ? activeScreen : defaultScreen);
    if (nextScreen !== activeScreen) setActiveScreen(nextScreen);
    replaceHistoryScreen(nextScreen);
  }, [currentUser?.id, defaultScreen, requestedScreen, availableScreenKeys]);

  useEffect(() => subscribeToScreenHistory((screen) => {
    if (screen && availableScreenKeys.includes(screen as ScreenKey)) {
      setActiveScreen(screen as ScreenKey);
      return;
    }
    setActiveScreen(defaultScreen);
    replaceHistoryScreen(defaultScreen);
  }), [availableScreenKeys, defaultScreen]);

  const navigate = (screen: ScreenKey) => {
    if (!availableScreenKeys.includes(screen) || screen === activeScreen) return;
    pushHistoryScreen(screen);
    setActiveScreen(screen);
  };`,
  'subscribeToScreenHistory((screen)',
);
replaceOnce(shellFile, "onPress={() => setActiveScreen('agenda')} style={styles.createItem}", "onPress={() => navigate('agenda')} style={styles.createItem}", "onPress={() => navigate('agenda')} style={styles.createItem}");
replaceOnce(shellFile, 'onPress={() => setActiveScreen(item.key)} />', 'onPress={() => navigate(item.key)} />', 'onPress={() => navigate(item.key)} />');
replaceOnce(shellFile, "onPress={() => setActiveScreen('agenda')} />", "onPress={() => navigate('agenda')} />", "onPress={() => navigate('agenda')} />");
replaceOnce(shellFile, 'onPress={() => setActiveScreen(item.key)} style={[styles.bottomItem', 'onPress={() => navigate(item.key)} style={[styles.bottomItem', 'onPress={() => navigate(item.key)} style={[styles.bottomItem');

// ---------------------------------------------------------------------------
// Shared modal: browser/mobile Back closes the visible modal before changing
// modules or leaving the application.
// ---------------------------------------------------------------------------
const uiFile = 'src/components/UI.tsx';
insertAfter(
  uiFile,
  "import { colors } from '../theme';",
  "\nimport { useWebBackLayer } from '../navigation/appHistory';",
  "useWebBackLayer } from '../navigation/appHistory'",
);
insertAfter(
  uiFile,
  '  children: ReactNode;\n}) {',
  "\n  useWebBackLayer(visible, onClose, `modal:${title}`);",
  'useWebBackLayer(visible, onClose, `modal:${title}`)',
);

// ---------------------------------------------------------------------------
// Technician report: Back closes the focused section editor and returns to
// the report section list before returning to the air profile.
// ---------------------------------------------------------------------------
const reportFile = 'src/screens/TechnicianInterventionReportScreen.tsx';
insertAfter(
  reportFile,
  "import { colors } from '../theme';",
  "\nimport { useWebBackLayer } from '../navigation/appHistory';",
  "useWebBackLayer } from '../navigation/appHistory'",
);
insertAfter(
  reportFile,
  "  const [message, setMessage] = useState('Preparando la plantilla técnica del trabajo seleccionado.');",
  "\n  useWebBackLayer(Boolean(activeSectionId), closeSectionEditor, 'technician-report-section');",
  "'technician-report-section'",
);

// ---------------------------------------------------------------------------
// Technician equipment flow: Back leaves Add/Search and returns to the air
// list instead of abandoning the entire technician portal route.
// ---------------------------------------------------------------------------
const equipmentFile = 'src/screens/TechnicianPortalEquipmentTestScreen.tsx';
insertAfter(
  equipmentFile,
  "import { colors } from '../theme';",
  "\nimport { useWebBackLayer } from '../navigation/appHistory';",
  "useWebBackLayer } from '../navigation/appHistory'",
);
insertAfter(
  equipmentFile,
  "  const [message, setMessage] = useState('Selecciona una visita preparada para registrar, buscar o escanear un aire acondicionado.');",
  `
  useWebBackLayer(mode !== 'list', () => {
    setMode('list');
    setSelectedEquipmentId('');
    setMessage('Selecciona una visita preparada para registrar, buscar o escanear un aire acondicionado.');
  }, 'technician-equipment-panel');`,
  "'technician-equipment-panel'",
);

// ---------------------------------------------------------------------------
// Air profile: confirmations and the Add another work panel behave as nested
// views and are dismissed first by Back.
// ---------------------------------------------------------------------------
const profileFile = 'src/screens/TechnicianEquipmentProfileScreen.tsx';
insertAfter(
  profileFile,
  "import { colors } from '../theme';",
  "\nimport { useWebBackLayer } from '../navigation/appHistory';",
  "useWebBackLayer } from '../navigation/appHistory'",
);
insertAfter(
  profileFile,
  '  const [addingAnother, setAddingAnother] = useState(false);',
  `
  useWebBackLayer(Boolean(pendingRemovalId), () => setPendingRemovalId(''), 'technician-remove-work');
  useWebBackLayer(addingAnother, () => setAddingAnother(false), 'technician-add-work');`,
  "'technician-remove-work'",
);

// ---------------------------------------------------------------------------
// Module tabs: every tab selection receives its own history entry, so Back
// restores the actual previous tab rather than always jumping to a default.
// ---------------------------------------------------------------------------
const agendaHubFile = 'src/screens/AgendaHubScreen.tsx';
insertAfter(
  agendaHubFile,
  "import { colors } from '../theme';",
  "\nimport { useWebHistoryState } from '../navigation/appHistory';",
  "useWebHistoryState } from '../navigation/appHistory'",
);
insertAfter(
  agendaHubFile,
  "  const [tab, setTab] = useState<AgendaTab>('complete');",
  "\n  useWebHistoryState('agenda-hub-tab', tab, (restored) => { if (restored === 'complete' || restored === 'halfDays') setTab(restored); });",
  "'agenda-hub-tab'",
);

const teamHubFile = 'src/screens/TeamHubScreen.tsx';
insertAfter(
  teamHubFile,
  "import { colors } from '../theme';",
  "\nimport { useWebHistoryState } from '../navigation/appHistory';",
  "useWebHistoryState } from '../navigation/appHistory'",
);
insertAfter(
  teamHubFile,
  "  const [tab, setTab] = useState<TeamHubTab>('operations');",
  "\n  useWebHistoryState('team-hub-tab', tab, (restored) => { if (restored === 'operations' || restored === 'halfDays') setTab(restored); });",
  "'team-hub-tab'",
);

const settingsHubFile = 'src/screens/SettingsHubScreen.tsx';
insertAfter(
  settingsHubFile,
  "import { colors } from '../theme';",
  "\nimport { useWebHistoryState } from '../navigation/appHistory';",
  "useWebHistoryState } from '../navigation/appHistory'",
);
insertAfter(
  settingsHubFile,
  "  const [tab, setTab] = useState<SettingsTab>('users');",
  "\n  useWebHistoryState('settings-hub-tab', tab, (restored) => { if (restored === 'users' || restored === 'calendar') setTab(restored); });",
  "'settings-hub-tab'",
);

// Team and fleet has another tab bar inside the Equipo y flota screen.
const teamScreenFile = 'src/screens/TeamScreen.tsx';
insertAfter(
  teamScreenFile,
  "import { colors } from '../theme';",
  "\nimport { useWebHistoryState } from '../navigation/appHistory';",
  "useWebHistoryState } from '../navigation/appHistory'",
);
insertAfter(
  teamScreenFile,
  "  const [tab, setTab] = useState<TabKey>('dispatch');",
  "\n  useWebHistoryState('team-operations-tab', tab, (restored) => { if (restored === 'dispatch' || restored === 'staff' || restored === 'vans') setTab(restored); });",
  "'team-operations-tab'",
);

// ---------------------------------------------------------------------------
// Inventory is a true multi-screen state machine: menu -> van selector -> van
// profile, plus controls and check preparation. Store the exact view and IDs.
// ---------------------------------------------------------------------------
const inventoryFile = 'src/screens/InventoryScreenV4.tsx';
insertAfter(
  inventoryFile,
  "import { colors } from '../theme';",
  "\nimport { useWebHistoryState } from '../navigation/appHistory';",
  "useWebHistoryState } from '../navigation/appHistory'",
);
insertAfter(
  inventoryFile,
  "type LifecycleAction = 'repair' | 'missing' | 'retire' | 'quantity-retire';",
  `

type InventoryHistorySnapshot = {
  view: InventoryView;
  selectedVanId: string;
  activeCheckId: string;
};

const INVENTORY_HISTORY_VIEWS: InventoryView[] = ['menu', 'warehouse', 'van-select', 'van-profile', 'checks-menu', 'check-van-select', 'check-van-ready', 'warehouse-check-ready', 'check-active', 'check-history'];

function inventoryHistoryValue(view: InventoryView, selectedVanId: string, activeCheckId: string) {
  return JSON.stringify({ view, selectedVanId, activeCheckId } satisfies InventoryHistorySnapshot);
}

function parseInventoryHistoryValue(value: string): InventoryHistorySnapshot | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<InventoryHistorySnapshot>;
    if (!parsed.view || !INVENTORY_HISTORY_VIEWS.includes(parsed.view)) return undefined;
    return {
      view: parsed.view,
      selectedVanId: typeof parsed.selectedVanId === 'string' ? parsed.selectedVanId : '',
      activeCheckId: typeof parsed.activeCheckId === 'string' ? parsed.activeCheckId : '',
    };
  } catch {
    return undefined;
  }
}`,
  'type InventoryHistorySnapshot =',
);
insertAfter(
  inventoryFile,
  "  const [backgroundUploads, setBackgroundUploads] = useState(0);",
  `

  const inventoryHistoryKey = inventoryHistoryValue(view, selectedVanId, activeCheckId);
  const inventoryHistory = useWebHistoryState('inventory-flow', inventoryHistoryKey, (restoredValue) => {
    const restored = parseInventoryHistoryValue(restoredValue);
    if (!restored) return;
    setView(restored.view);
    setSelectedVanId(restored.selectedVanId);
    setActiveCheckId(restored.activeCheckId);
    setMessage('');
  });`,
  "'inventory-flow'",
);
replaceOnce(
  inventoryFile,
  'action={view !== \'menu\' ? <Button compact variant="secondary" label={backLabel} onPress={goBack} /> : undefined}',
  'action={view !== \'menu\' ? <Button compact variant="secondary" label={backLabel} onPress={() => inventoryHistory.back(goBack)} /> : undefined}',
  'inventoryHistory.back(goBack)',
);
replaceOnce(
  inventoryFile,
  `    if (result.ok) {
      setActiveCheckId('');
      setSelectedVanId('');
      setView('checks-menu');
    }`,
  `    if (result.ok) {
      inventoryHistory.replace(inventoryHistoryValue('checks-menu', '', ''));
      setActiveCheckId('');
      setSelectedVanId('');
      setView('checks-menu');
    }`,
  "inventoryHistory.replace(inventoryHistoryValue('checks-menu'",
);

// ---------------------------------------------------------------------------
// Office report review replaces the entire list with a report detail. Keep the
// inbox/filter and selected report in history, and make Volver use browser Back.
// ---------------------------------------------------------------------------
const officeReviewFile = 'src/screens/OfficeReportReviewScreen.tsx';
replaceOnce(
  officeReviewFile,
  "import React, { useMemo, useState } from 'react';",
  "import React, { useEffect, useMemo, useState } from 'react';",
  'useEffect, useMemo, useState',
);
insertAfter(
  officeReviewFile,
  "import { colors } from '../theme';",
  "\nimport { useWebHistoryState } from '../navigation/appHistory';",
  "useWebHistoryState } from '../navigation/appHistory'",
);
replaceOnce(
  officeReviewFile,
  '  const [selectedInterventionId, setSelectedInterventionId] = useState(requestedInterventionId);',
  "  const [selectedInterventionId, setSelectedInterventionId] = useState('');",
  "useState('');",
);
insertAfter(
  officeReviewFile,
  "  const [message, setMessage] = useState('Selecciona un reporte pendiente para revisar sus secciones, mediciones y fotografías.');",
  `

  useEffect(() => {
    if (requestedInterventionId) setSelectedInterventionId(requestedInterventionId);
  }, [requestedInterventionId]);

  const reviewHistoryKey = JSON.stringify({ filter, selectedInterventionId });
  const reviewHistory = useWebHistoryState('office-report-review', reviewHistoryKey, (restoredValue) => {
    try {
      const restored = JSON.parse(restoredValue) as { filter?: ReviewFilter; selectedInterventionId?: string };
      if (restored.filter === 'pending' || restored.filter === 'changes_requested' || restored.filter === 'approved') setFilter(restored.filter);
      setSelectedInterventionId(typeof restored.selectedInterventionId === 'string' ? restored.selectedInterventionId : '');
      setCorrectionNote('');
    } catch {
      setSelectedInterventionId('');
    }
  });`,
  "'office-report-review'",
);
replaceOnce(
  officeReviewFile,
  'action={<Button compact variant="ghost" label="Volver a bandeja" onPress={closeReport} />}',
  'action={<Button compact variant="ghost" label="Volver a bandeja" onPress={() => reviewHistory.back(closeReport)} />}',
  'reviewHistory.back(closeReport)',
);
replaceOnce(
  officeReviewFile,
  `    setMessage('Reporte devuelto al técnico con la corrección solicitada.');
    setSelectedInterventionId('');
    setCorrectionNote('');
    setFilter('changes_requested');`,
  `    setMessage('Reporte devuelto al técnico con la corrección solicitada.');
    reviewHistory.replace(JSON.stringify({ filter: 'changes_requested', selectedInterventionId: '' }));
    setSelectedInterventionId('');
    setCorrectionNote('');
    setFilter('changes_requested');`,
  "reviewHistory.replace(JSON.stringify({ filter: 'changes_requested'",
);
replaceOnce(
  officeReviewFile,
  `    setWorking(false);
    setCorrectionNote('');
    setFilter('approved');`,
  `    setWorking(false);
    setCorrectionNote('');
    reviewHistory.replace(JSON.stringify({ filter: 'approved', selectedInterventionId: selected.id }));
    setFilter('approved');`,
  "reviewHistory.replace(JSON.stringify({ filter: 'approved'",
);

assertIncludes(shellFile, [
  'pushHistoryScreen(screen)',
  'subscribeToScreenHistory((screen)',
  "useWebBackLayer(profileMenuVisible, () => setProfileMenuVisible(false), 'account-menu')",
]);
assertIncludes(uiFile, ['useWebBackLayer(visible, onClose, `modal:${title}`)']);
assertIncludes(reportFile, ["'technician-report-section'"]);
assertIncludes(equipmentFile, ["'technician-equipment-panel'"]);
assertIncludes(profileFile, ["'technician-remove-work'", "'technician-add-work'"]);
assertIncludes(agendaHubFile, ["'agenda-hub-tab'"]);
assertIncludes(teamHubFile, ["'team-hub-tab'"]);
assertIncludes(settingsHubFile, ["'settings-hub-tab'"]);
assertIncludes(teamScreenFile, ["'team-operations-tab'"]);
assertIncludes(inventoryFile, ["'inventory-flow'", 'inventoryHistory.back(goBack)']);
assertIncludes(officeReviewFile, ["'office-report-review'", 'reviewHistory.back(closeReport)']);

console.log('patchAppHistoryNavigation.cjs applied.');
