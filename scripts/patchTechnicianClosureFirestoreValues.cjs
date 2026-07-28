const fs = require('fs');

const path = 'src/screens/OfficeReportReviewScreen.tsx';
let text = fs.readFileSync(path, 'utf8');
const marker = "note: 'La oficina devolvió un reporte para corrección.'";
if (!text.includes(marker)) {
  throw new Error('The technician correction-reopen workflow was not found.');
}
text = text.replaceAll("completedAt: undefined,\n        updatedAt: now,", "completedAt: '',\n        updatedAt: now,");
fs.writeFileSync(path, text);

console.log('Technician closure Firestore values normalized.');
