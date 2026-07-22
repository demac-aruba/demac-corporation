const fs = require('fs');

const path = 'src/hooks/usePayrollModule.ts';
let text = fs.readFileSync(path, 'utf8');
const oldText = ".filter((date) => date >= startDate)";
const newText = ".filter((date) => date >= (startDate ?? period.startDate))";

if (text.includes(oldText)) {
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
  console.log('Payroll Starting Date type narrowing fixed.');
} else if (text.includes(newText)) {
  console.log('Payroll Starting Date type narrowing already fixed.');
} else {
  throw new Error('Could not locate prorated Starting Date filter.');
}
