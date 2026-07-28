const fs = require('fs');

const officePath = 'src/screens/OfficeReportReviewScreen.tsx';
let officeText = fs.readFileSync(officePath, 'utf8');
const correctionMarker = "note: 'La oficina devolvió un reporte para corrección.'";
if (!officeText.includes(correctionMarker)) {
  throw new Error('The technician correction-reopen workflow was not found.');
}
officeText = officeText.replaceAll("completedAt: undefined,\n        updatedAt: now,", "completedAt: '',\n        updatedAt: now,");
fs.writeFileSync(officePath, officeText);

const reportPath = 'src/screens/TechnicianInterventionReportScreen.tsx';
let reportText = fs.readFileSync(reportPath, 'utf8');
const officePatchMarker = 'Regresando al perfil del aire…';
if (!reportText.includes(officePatchMarker)) {
  reportText = reportText.replace(
    "? 'Reporte enviado. Todos los aires de la visita están terminados y la orden quedó cerrada.'",
    "? 'Reporte enviado. Todos los aires de la visita están terminados y la orden quedó cerrada. Regresando al perfil del aire…'",
  );
  reportText = reportText.replace(
    ": 'Reporte enviado. Este aire quedó terminado; todavía faltan otros aires de la visita.');",
    ": 'Reporte enviado. Este aire quedó terminado; todavía faltan otros aires de la visita. Regresando al perfil del aire…');",
  );
  if (!reportText.includes(officePatchMarker)) {
    throw new Error('The technician report closure confirmation was not found.');
  }
  fs.writeFileSync(reportPath, reportText);
}

const profilePath = 'src/screens/TechnicianEquipmentProfileScreen.tsx';
let profileText = fs.readFileSync(profilePath, 'utf8');
const duplicateClosure = `      <View style={styles.messageBox}>      </Card>

      <View style={styles.messageBox}>`;
if (profileText.includes(duplicateClosure)) {
  profileText = profileText.replace(duplicateClosure, '      <View style={styles.messageBox}>');
  fs.writeFileSync(profilePath, profileText);
}

console.log('Technician closure values, markup and repeated-build markers normalized.');
