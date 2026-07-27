const fs = require('fs');

const contractsFile = 'src/features/technicianPortal/contracts.ts';
let contracts = fs.readFileSync(contractsFile, 'utf8');
if (!contracts.includes('customerReportNote?: string;')) {
  const anchor = '  resultCode?: string;\n  resultNotes?: string;';
  if (!contracts.includes(anchor)) throw new Error('WorkIntervention result fields were not found.');
  contracts = contracts.replace(anchor, `${anchor}\n  customerReportNote?: string;\n  reviewedAt?: string;`);
  fs.writeFileSync(contractsFile, contracts);
}

console.log('Customer report experience patch applied.');
