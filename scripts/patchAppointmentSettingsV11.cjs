/* Apply the governed appointment settings V11 UI while validating source-owned rules. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const patchPath = path.join(__dirname, 'appointmentSettingsV11.patch');
const marker = 'APPOINTMENT_SETTINGS_V11';
const targetFiles = [
  'src/constants/appointmentWorkTypes.ts',
  'src/state/CalendarState.tsx',
  'src/screens/NewAppointmentModal.tsx',
  'src/screens/HomeScreen.tsx',
  'src/screens/ScheduleScreen.tsx',
];
// These files now own their governed behavior in source. Do not reapply an old
// context hunk over newer rules; validate the preserved V11 authority explicitly.
const materializedFiles = new Set(['src/screens/SettingsHubScreen.tsx', 'firestore.rules']);
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
if (!rules.includes(marker) || !rules.includes("settingId == 'appointment-work-presets' ? adminRole() : operationsRole()")) {
  throw new Error('Appointment settings V11 source-owned Firestore admin gate is missing.');
}

function applyPatchText(text) {
  const lines = text.split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.startsWith('--- a/')) { index += 1; continue; }
    const file = line.slice('--- a/'.length).trim();
    index += 2;
    const hunks = [];
    while (index < lines.length && !lines[index].startsWith('--- a/')) {
      if (!lines[index].startsWith('@@')) { index += 1; continue; }
      index += 1;
      const oldLines = [];
      const newLines = [];
      while (index < lines.length && !lines[index].startsWith('@@') && !lines[index].startsWith('--- a/')) {
        const hunkLine = lines[index];
        if (hunkLine.startsWith(' ')) { oldLines.push(hunkLine.slice(1)); newLines.push(hunkLine.slice(1)); }
        else if (hunkLine.startsWith('-')) oldLines.push(hunkLine.slice(1));
        else if (hunkLine.startsWith('+')) newLines.push(hunkLine.slice(1));
        else if (hunkLine === '' && index === lines.length - 1) { /* final diff newline */ }
        else if (hunkLine.startsWith('\\')) { /* no newline marker */ }
        else { throw new Error(`Unexpected patch line in ${file}: ${hunkLine}`); }
        index += 1;
      }
      hunks.push({ oldText: oldLines.join('\n'), newText: newLines.join('\n') });
    }
    if (materializedFiles.has(file)) continue;
    if (!targetFiles.includes(file)) throw new Error(`Unexpected target file in Appointment Settings V11 patch: ${file}`);
    const fullPath = path.join(root, file);
    let source = fs.readFileSync(fullPath, 'utf8');
    for (const hunk of hunks) {
      if (!source.includes(hunk.oldText)) throw new Error(`Patch context not found in ${file}.`);
      source = source.replace(hunk.oldText, hunk.newText);
    }
    fs.writeFileSync(fullPath, source);
  }
}

const marked = targetFiles.filter((file) => fs.readFileSync(path.join(root, file), 'utf8').includes(marker));
if (marked.length === targetFiles.length) {
  console.log('Appointment settings V11 already patched.');
  process.exit(0);
}
if (marked.length > 0) {
  throw new Error(`Appointment settings V11 partially applied (${marked.length}/${targetFiles.length}); refusing to continue.`);
}

if (fs.existsSync(path.join(root, '.git'))) {
  // The authoritative Firestore block is materialized and separately validated.
  // The remaining UI hunks retain their original dry-run and post-apply checks.
  try {
    execFileSync('git', ['apply', '--exclude=src/screens/SettingsHubScreen.tsx', '--exclude=firestore.rules', '--check', patchPath], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['apply', '--exclude=src/screens/SettingsHubScreen.tsx', '--exclude=firestore.rules', patchPath], { cwd: root, stdio: 'pipe' });
  } catch {
    applyPatchText(fs.readFileSync(patchPath, 'utf8'));
  }
} else {
  applyPatchText(fs.readFileSync(patchPath, 'utf8'));
}

for (const file of targetFiles) {
  if (!fs.readFileSync(path.join(root, file), 'utf8').includes(marker)) throw new Error(`Appointment settings V11 marker missing after patch in ${file}`);
}
console.log('Appointment settings V11 patch applied; source-owned admin gate verified.');
