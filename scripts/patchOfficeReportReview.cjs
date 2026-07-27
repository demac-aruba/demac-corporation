const fs = require('fs');

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Required office review patch block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required office review patch anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

replaceOnce(
  'src/types.ts',
  "  | 'workOrders'\n  | 'team'",
  "  | 'workOrders'\n  | 'reportReview'\n  | 'team'",
  "| 'reportReview'",
);

replaceOnce(
  'src/features/technicianPortal/contracts.ts',
  "  | 'ready_for_review'\n  | 'completed'",
  "  | 'ready_for_review'\n  | 'changes_requested'\n  | 'completed'",
  "| 'changes_requested'",
);

const shellFile = 'src/components/AppShell.tsx';
insertAfter(
  shellFile,
  "import { InventoryScreen } from '../screens/InventoryScreen';",
  "\nimport { OfficeReportReviewScreen } from '../screens/OfficeReportReviewScreen';",
  "OfficeReportReviewScreen } from '../screens/OfficeReportReviewScreen'",
);
insertAfter(
  shellFile,
  "  { key: 'workOrders', label: 'Trabajos', icon: '☷', roles: ['admin', 'office', 'supervisor'] },",
  "\n  { key: 'reportReview', label: 'Revisión', icon: '✓', roles: ['admin', 'office', 'supervisor'] },",
  "key: 'reportReview'",
);
insertAfter(
  shellFile,
  "    case 'workOrders': content = <WorkOrdersScreen />; break;",
  "\n    case 'reportReview': content = <OfficeReportReviewScreen />; break;",
  "case 'reportReview': content = <OfficeReportReviewScreen />",
);

const reportFile = 'src/screens/TechnicianInterventionReportScreen.tsx';
insertAfter(
  reportFile,
  "    ready_for_review: 'Listo para revisión',",
  "\n    changes_requested: 'Corrección solicitada',",
  "changes_requested: 'Corrección solicitada'",
);
replaceOnce(
  reportFile,
  "  if (status === 'in_progress') return 'info';\n  if (status === 'blocked') return 'warning';",
  "  if (status === 'in_progress') return 'info';\n  if (status === 'blocked' || status === 'changes_requested') return 'warning';",
  "status === 'blocked' || status === 'changes_requested'",
);
replaceOnce(
  reportFile,
  "    setWorking(false);\n    setMessage(result.ok ? 'Reporte enviado para revisión de la oficina.' : result.message ?? 'No se pudo enviar el reporte.');\n    scrollToTop();",
  "    setWorking(false);\n    if (!result.ok) {\n      setMessage(result.message ?? 'No se pudo enviar el reporte.');\n      scrollToTop();\n      return;\n    }\n    setMessage('Reporte enviado para revisión de la oficina. Regresando al perfil del aire…');\n    scrollToTop();\n    setTimeout(goBack, 1100);",
  "Regresando al perfil del aire…",
);
insertAfter(
  reportFile,
  "      </View>\n\n      {activeItem ? (",
  "\n      {intervention.status === 'changes_requested' && intervention.resultNotes ? (\n        <View style={styles.correctionBox}>\n          <Text style={styles.correctionTitle}>Corrección solicitada por la oficina</Text>\n          <Text style={styles.correctionText}>{intervention.resultNotes}</Text>\n        </View>\n      ) : null}\n",
  'Corrección solicitada por la oficina',
);
replaceOnce(
  reportFile,
  "              label={intervention.status === 'ready_for_review' ? 'Enviado para revisión' : 'Enviar reporte a revisión'}",
  "              label={intervention.status === 'ready_for_review' ? 'Enviado para revisión' : intervention.status === 'changes_requested' ? 'Reenviar reporte a revisión' : 'Enviar reporte a revisión'}",
  "intervention.status === 'changes_requested' ? 'Reenviar reporte a revisión'",
);
insertAfter(
  reportFile,
  "  templateDescription: { color: colors.muted, marginTop: 10, lineHeight: 18 },",
  "\n  correctionBox: { backgroundColor: '#FFF8EC', borderRadius: 13, padding: 14 },\n  correctionTitle: { color: '#8A5200', fontWeight: '900' },\n  correctionText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },",
  'correctionBox:',
);

const profileFile = 'src/screens/TechnicianEquipmentProfileScreen.tsx';
insertAfter(
  profileFile,
  "    ready_for_review: 'Listo para revisión',",
  "\n    changes_requested: 'Corrección solicitada',",
  "changes_requested: 'Corrección solicitada'",
);
replaceOnce(
  profileFile,
  "                    label={intervention.status === 'draft' ? 'Iniciar reporte' : 'Abrir reporte'}",
  "                    label={intervention.status === 'draft' ? 'Iniciar reporte' : intervention.status === 'changes_requested' ? 'Corregir reporte' : 'Abrir reporte'}",
  "intervention.status === 'changes_requested' ? 'Corregir reporte'",
);

console.log('Office report review workflow patch applied.');
