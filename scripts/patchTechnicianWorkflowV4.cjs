const fs = require('fs');
const path = require('path');

const marker = 'TECHNICIAN_WORKFLOW_V4';
const patchPath = path.join(__dirname, 'technicianWorkflowV4.patch');
const targetFiles = [
  'src/screens/TechnicianPortalEquipmentTestScreen.tsx',
  'src/screens/TechnicianInterventionReportScreen.tsx',
  'src/screens/TechnicianEquipmentProfileScreen.tsx',
  'src/features/technicianPortal/templates.ts',
  'src/features/technicianPortal/contracts.ts',
  'src/state/TechnicianPortalState.tsx',
  'src/types.ts',
];

const marked = targetFiles.filter((file) => fs.readFileSync(file, 'utf8').includes(marker));
if (marked.length === targetFiles.length) {
  const profileFile = 'src/screens/TechnicianEquipmentProfileScreen.tsx';
  let profile = fs.readFileSync(profileFile, 'utf8');
  profile = profile
    .replace("import { TechnicianAddOnsPanel } from '../components/TechnicianAddOnsPanel';\n", '')
    .replace('      <TechnicianAddOnsPanel visit={visit} unit={unit} interventions={interventions} disabled={newWorkLocked} />\n\n', '');
  fs.writeFileSync(profileFile, profile);
  const stateFile = 'src/state/TechnicianPortalState.tsx';
  let state = fs.readFileSync(stateFile, 'utf8');
  state = state.replace("import { getTechnicianReportTemplate } from '../features/technicianPortal/templates';\n", '');
  fs.writeFileSync(stateFile, state);
  console.log('patchTechnicianWorkflowV4.cjs already applied and normalized.');
  process.exit(0);
}
if (marked.length) {
  throw new Error(`Technician workflow V4 is only partially applied: ${marked.join(', ')}`);
}

function parseRange(header, sign) {
  const match = header.match(new RegExp(`\\${sign}(\\d+)(?:,(\\d+))?`));
  if (!match) throw new Error(`Invalid unified diff range: ${header}`);
  return { start: Number(match[1]), count: match[2] === undefined ? 1 : Number(match[2]) };
}

function applyFilePatch(file, hunks) {
  const originalText = fs.readFileSync(file, 'utf8');
  const hadTrailingNewline = originalText.endsWith('\n');
  const original = originalText.replace(/\r\n/g, '\n').split('\n');
  if (hadTrailingNewline) original.pop();
  const output = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const oldRange = parseRange(hunk.header, '-');
    const newRange = parseRange(hunk.header, '+');
    const startIndex = Math.max(0, oldRange.start - 1);
    if (startIndex < cursor) throw new Error(`Overlapping patch hunks in ${file}.`);
    output.push(...original.slice(cursor, startIndex));
    cursor = startIndex;
    let consumed = 0;
    let produced = 0;

    for (const line of hunk.lines) {
      if (line === '') continue;
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === ' ') {
        if (original[cursor] !== content) throw new Error(`Patch context mismatch in ${file}: expected "${content}".`);
        output.push(content);
        cursor += 1;
        consumed += 1;
        produced += 1;
      } else if (prefix === '-') {
        if (original[cursor] !== content) throw new Error(`Patch removal mismatch in ${file}: expected "${content}".`);
        cursor += 1;
        consumed += 1;
      } else if (prefix === '+') {
        output.push(content);
        produced += 1;
      } else if (prefix !== '\\') {
        throw new Error(`Unsupported patch line in ${file}: ${line}`);
      }
    }

    if (consumed !== oldRange.count || produced !== newRange.count) {
      throw new Error(`Patch range count mismatch in ${file}: ${hunk.header}`);
    }
  }

  output.push(...original.slice(cursor));
  return `${output.join('\n')}${hadTrailingNewline ? '\n' : ''}`;
}

function parsePatch(unifiedDiff) {
  const lines = unifiedDiff.replace(/\r\n/g, '\n').split('\n');
  const files = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith('--- ')) {
      index += 1;
      continue;
    }
    index += 1;
    if (!lines[index]?.startsWith('+++ b/')) throw new Error('Invalid unified diff file header.');
    const file = lines[index].slice('+++ b/'.length);
    index += 1;
    const hunks = [];
    while (index < lines.length && !lines[index].startsWith('--- ')) {
      if (!lines[index].startsWith('@@ ')) {
        index += 1;
        continue;
      }
      const header = lines[index];
      index += 1;
      const hunkLines = [];
      while (index < lines.length && !lines[index].startsWith('@@ ') && !lines[index].startsWith('--- ')) {
        if (lines[index] === '' && index === lines.length - 1) break;
        hunkLines.push(lines[index]);
        index += 1;
      }
      hunks.push({ header, lines: hunkLines });
    }
    files.push({ file, hunks });
  }
  return files;
}

const parsed = parsePatch(fs.readFileSync(patchPath, 'utf8'));
const expected = new Set(targetFiles);
const outputs = new Map();
for (const { file, hunks } of parsed) {
  if (!expected.has(file)) throw new Error(`Unexpected file in technician workflow V4 patch: ${file}`);
  outputs.set(file, applyFilePatch(file, hunks));
}
if (outputs.size !== targetFiles.length) throw new Error('Technician workflow V4 patch is missing one or more target files.');
for (const [file, content] of outputs) fs.writeFileSync(file, content);

console.log('patchTechnicianWorkflowV4.cjs applied.');
