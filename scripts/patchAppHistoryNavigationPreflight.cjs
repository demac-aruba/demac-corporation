const fs = require('fs');

const officeReviewFile = 'src/screens/OfficeReportReviewScreen.tsx';
let text = fs.readFileSync(officeReviewFile, 'utf8');

const selectedStateOld = '  const [selectedInterventionId, setSelectedInterventionId] = useState(requestedInterventionId);';
const selectedStateNew = "  const [selectedInterventionId, setSelectedInterventionId] = useState('');";
if (text.includes(selectedStateOld)) text = text.replace(selectedStateOld, selectedStateNew);

const correctionHistoryLine = "    reviewHistory.replace(JSON.stringify({ filter: 'changes_requested', selectedInterventionId: '' }));";
if (!text.includes(correctionHistoryLine)) {
  const correctionAnchor = "    setMessage('Reporte devuelto al técnico con la corrección solicitada.');";
  if (!text.includes(correctionAnchor)) throw new Error('Office review correction history anchor was not found.');
  text = text.replace(correctionAnchor, `${correctionAnchor}\n${correctionHistoryLine}`);
}

const approvalHistoryLine = "    reviewHistory.replace(JSON.stringify({ filter: 'approved', selectedInterventionId: selected.id }));";
if (!text.includes(approvalHistoryLine)) {
  const approvalAnchor = "    setCorrectionNote('');\n    setFilter('approved');";
  if (!text.includes(approvalAnchor)) throw new Error('Office review approval history anchor was not found.');
  text = text.replace(approvalAnchor, `    setCorrectionNote('');\n${approvalHistoryLine}\n    setFilter('approved');`);
}

fs.writeFileSync(officeReviewFile, text);
console.log('patchAppHistoryNavigationPreflight.cjs applied.');
