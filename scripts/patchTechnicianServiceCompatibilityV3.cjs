const fs = require('fs');

const stateFile = 'src/state/TechnicianPortalState.tsx';
let state = fs.readFileSync(stateFile, 'utf8');
const marker = 'TECHNICIAN_REPORT_SECTIONS_V3_SECOND_PASS_COMPATIBILITY';
if (!state.includes(marker)) {
  const anchor = '/* TECHNICIAN_REPORT_SECTIONS_V3_COMPATIBILITY';
  if (!state.includes(anchor)) throw new Error('Technician report v3 compatibility anchor was not found.');
  state = state.replace(anchor, `/* ${marker}\n    workReportSections,\n    equipmentSystems,\n${anchor.slice(3)}`);
  fs.writeFileSync(stateFile, state);
}

console.log('patchTechnicianServiceCompatibilityV3.cjs applied.');
