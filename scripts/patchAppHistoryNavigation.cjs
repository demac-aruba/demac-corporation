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
// Module tabs: Back returns from a secondary tab to the module's primary tab
// before returning to the previous main module.
// ---------------------------------------------------------------------------
const agendaHubFile = 'src/screens/AgendaHubScreen.tsx';
insertAfter(
  agendaHubFile,
  "import { colors } from '../theme';",
  "\nimport { useWebBackLayer } from '../navigation/appHistory';",
  "useWebBackLayer } from '../navigation/appHistory'",
);
insertAfter(
  agendaHubFile,
  "  const [tab, setTab] = useState<AgendaTab>('complete');",
  "\n  useWebBackLayer(tab !== 'complete', () => setTab('complete'), 'agenda-secondary-tab');",
  "'agenda-secondary-tab'",
);

const teamHubFile = 'src/screens/TeamHubScreen.tsx';
insertAfter(
  teamHubFile,
  "import { colors } from '../theme';",
  "\nimport { useWebBackLayer } from '../navigation/appHistory';",
  "useWebBackLayer } from '../navigation/appHistory'",
);
insertAfter(
  teamHubFile,
  "  const [tab, setTab] = useState<TeamHubTab>('operations');",
  "\n  useWebBackLayer(tab !== 'operations', () => setTab('operations'), 'team-secondary-tab');",
  "'team-secondary-tab'",
);

const settingsHubFile = 'src/screens/SettingsHubScreen.tsx';
insertAfter(
  settingsHubFile,
  "import { colors } from '../theme';",
  "\nimport { useWebBackLayer } from '../navigation/appHistory';",
  "useWebBackLayer } from '../navigation/appHistory'",
);
insertAfter(
  settingsHubFile,
  "  const [tab, setTab] = useState<SettingsTab>('users');",
  "\n  useWebBackLayer(tab !== 'users', () => setTab('users'), 'settings-secondary-tab');",
  "'settings-secondary-tab'",
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
assertIncludes(agendaHubFile, ["'agenda-secondary-tab'"]);
assertIncludes(teamHubFile, ["'team-secondary-tab'"]);
assertIncludes(settingsHubFile, ["'settings-secondary-tab'"]);

console.log('patchAppHistoryNavigation.cjs applied.');
