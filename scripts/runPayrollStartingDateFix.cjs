const fs = require('fs');

const typesPath = 'src/types.ts';
const payrollTypesPath = 'src/payroll/types.ts';
const alreadyApplied = fs.readFileSync(typesPath, 'utf8').includes('  startDate?: string;')
  && fs.readFileSync(payrollTypesPath, 'utf8').includes('  proratedBase: boolean;');

if (alreadyApplied) {
  console.log('Payroll starting-date patch already applied.');
  process.exit(0);
}

require('./applyPayrollStartingDateFix.cjs');
