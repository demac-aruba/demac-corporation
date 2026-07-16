const fs = require('fs');
const { execFileSync } = require('child_process');

const agendaPath = 'src/screens/AgendaScreen.tsx';
const statePath = 'src/state/VanHalfDayState.tsx';
const agendaOriginal = fs.readFileSync(agendaPath, 'utf8');
const stateOriginal = fs.readFileSync(statePath, 'utf8');

fs.mkdirSync('public', { recursive: true });

try {
  execFileSync(process.execPath, ['scripts/patch-agenda-half-days-aug1.cjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/fix-agenda-patch-output.cjs'], { stdio: 'pipe' });
  try {
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--noEmit'], { encoding: 'utf8', stdio: 'pipe' });
    fs.writeFileSync('public/halfday-diagnostics.txt', 'TYPECHECK_OK\n');
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    fs.writeFileSync('public/halfday-diagnostics.txt', output || String(error));
  }
} catch (error) {
  const output = `${error.stdout || ''}${error.stderr || ''}`;
  fs.writeFileSync('public/halfday-diagnostics.txt', `PATCH_FAILED\n${output || String(error)}`);
} finally {
  fs.writeFileSync(agendaPath, agendaOriginal);
  fs.writeFileSync(statePath, stateOriginal);
}
