const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// DEMAC_OPERATIONS_SHELL_RESET_V16
// patch:all may run more than once in the same checkout (for example typecheck
// followed by web export). V16 replaces AppShell only at the very end, so a
// subsequent pass must first restore the committed canonical AppShell that the
// legacy patches expect.
const repoRoot = path.join(__dirname, '..');
const target = path.join(repoRoot, 'src', 'components', 'AppShell.tsx');

function normalizeLegacyShell(source) {
  return source
    .replace("import { MarketingScreen } from '../screens/MarketingScreen';\n", '')
    .replace("\ntype ShellScreenKey = ScreenKey | 'marketing';\n", '\n')
    .replace('const navItems: { key: ShellScreenKey; label: string; icon: string; roles: UserRole[] }[] = [', 'const navItems: { key: ScreenKey; label: string; icon: string; roles: UserRole[] }[] = [')
    .replace("  { key: 'marketing', label: 'Marketing', icon: '✦', roles: ['admin', 'office'] },\n", '')
    .replaceAll('onPress={() => setActiveScreen(item.key as ScreenKey)}', 'onPress={() => setActiveScreen(item.key)}');
}

try {
  let committed = execFileSync('git', ['show', 'HEAD:src/components/AppShell.tsx'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  committed = normalizeLegacyShell(committed);
  if (!committed.includes('export function AppShell()')) throw new Error('Committed AppShell is invalid.');
  fs.writeFileSync(target, committed);
  console.log('patchDemacOperationsShellResetV16.cjs restored committed AppShell.');
} catch (error) {
  // Git metadata can be unavailable in some packaged environments. In that
  // case normalize the checked-in shell before deciding whether a hard reset
  // is still required.
  const current = normalizeLegacyShell(fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(target, current);
  if (current.includes('DEMAC Operations OS') || current.includes("label: 'Centro de control'")) {
    throw new Error(`Could not restore canonical AppShell before patching: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log('patchDemacOperationsShellResetV16.cjs normalized canonical AppShell; no reset required.');
}
