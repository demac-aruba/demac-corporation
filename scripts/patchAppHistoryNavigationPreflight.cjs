const fs = require('fs');

const officeReviewFile = 'src/screens/OfficeReportReviewScreen.tsx';
let text = fs.readFileSync(officeReviewFile, 'utf8');

const selectedStateOld = '  const [selectedInterventionId, setSelectedInterventionId] = useState(requestedInterventionId);';
const selectedStateNew = "  const [selectedInterventionId, setSelectedInterventionId] = useState('');";
if (text.includes(selectedStateOld)) text = text.replace(selectedStateOld, selectedStateNew);

function functionRange(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Office review function range was not found: ${startMarker}`);
  return { start, end, content: source.slice(start, end) };
}

const correctionHistoryLine = "    reviewHistory.replace(JSON.stringify({ filter: 'changes_requested', selectedInterventionId: '' }));";
if (!text.includes(correctionHistoryLine)) {
  const range = functionRange(text, '  async function returnForCorrection() {', '  if (!allowed) {');
  const closeAnchor = "    setSelectedInterventionId('');";
  const relativeAnchor = range.content.lastIndexOf(closeAnchor);
  if (relativeAnchor < 0) throw new Error('Office review correction close-state anchor was not found.');
  const absoluteAnchor = range.start + relativeAnchor;
  text = `${text.slice(0, absoluteAnchor)}${correctionHistoryLine}\n${text.slice(absoluteAnchor)}`;
}

const approvalHistoryLine = "    reviewHistory.replace(JSON.stringify({ filter: 'approved', selectedInterventionId: selected.id }));";
if (!text.includes(approvalHistoryLine)) {
  const range = functionRange(text, '  async function approveReport() {', '  async function returnForCorrection() {');
  const filterAnchor = "    setFilter('approved');";
  const relativeAnchor = range.content.lastIndexOf(filterAnchor);
  if (relativeAnchor < 0) throw new Error('Office review approval filter anchor was not found.');
  const absoluteAnchor = range.start + relativeAnchor;
  text = `${text.slice(0, absoluteAnchor)}${approvalHistoryLine}\n${text.slice(absoluteAnchor)}`;
}

fs.writeFileSync(officeReviewFile, text);
console.log('patchAppHistoryNavigationPreflight.cjs applied.');
