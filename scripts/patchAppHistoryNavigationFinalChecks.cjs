const fs = require('fs');

const officeReviewFile = 'src/screens/OfficeReportReviewScreen.tsx';
let officeReview = fs.readFileSync(officeReviewFile, 'utf8');

const oldSelectedState = '  const [selectedInterventionId, setSelectedInterventionId] = useState(requestedInterventionId);';
const newSelectedState = "  const [selectedInterventionId, setSelectedInterventionId] = useState('');";

if (officeReview.includes(oldSelectedState)) {
  officeReview = officeReview.replace(oldSelectedState, newSelectedState);
  fs.writeFileSync(officeReviewFile, officeReview);
}

const requiredOfficeReviewMarkers = [
  newSelectedState,
  "useWebHistoryState('office-report-review'",
  'reviewHistory.back(closeReport)',
];
const finalOfficeReview = fs.readFileSync(officeReviewFile, 'utf8');
for (const marker of requiredOfficeReviewMarkers) {
  if (!finalOfficeReview.includes(marker)) {
    throw new Error(`Final navigation history validation failed in ${officeReviewFile}: ${marker}`);
  }
}

const inventoryFile = 'src/screens/InventoryScreenV4.tsx';
const inventory = fs.readFileSync(inventoryFile, 'utf8');
for (const marker of [
  "useWebHistoryState('inventory-flow'",
  'inventoryHistory.back(goBack)',
  "inventoryHistoryValue('checks-menu', '', '')",
]) {
  if (!inventory.includes(marker)) {
    throw new Error(`Final navigation history validation failed in ${inventoryFile}: ${marker}`);
  }
}

console.log('patchAppHistoryNavigationFinalChecks.cjs applied.');
