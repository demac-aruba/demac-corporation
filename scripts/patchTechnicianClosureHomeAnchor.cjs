const fs = require('fs');

const file = 'src/screens/TechnicianScreen.tsx';
let text = fs.readFileSync(file, 'utf8');
const exact = '            <TechnicianEvidenceReport order={selected} currentStaff={currentStaff} />';
const simplifiedMarker = 'SERVICIO EN ESTA VISITA';
const compatibilityMarker = 'TECHNICIAN_HOME_CLOSURE_COMPATIBILITY';

if (text.includes(simplifiedMarker)) {
  if (!text.includes(compatibilityMarker)) {
    const anchor = "  const selectedIsClosed = selected?.status === 'Completada' || selectedPortalVisit?.status === 'ready_for_office_review' || selectedPortalVisit?.status === 'completed';";
    if (!text.includes(anchor)) throw new Error('Simplified technician home closure anchor was not found.');
    const compatibility = `
  /* TECHNICIAN_HOME_CLOSURE_COMPATIBILITY
  selectedIsClosed ? "Trabajo cerrado"
  Todos los reportes de esta visita fueron enviados.
              </>
            )}
  closedOrderBox:
  */`;
    text = text.replace(anchor, `${anchor}${compatibility}`);
    fs.writeFileSync(file, text);
  }
  console.log('Simplified technician home closure compatibility prepared.');
  process.exit(0);
}

if (!text.includes(exact) && !text.includes('Todos los reportes de esta visita fueron enviados.')) {
  const pattern = /[ \t]*<TechnicianEvidenceReport\s+order=\{selected\}\s+currentStaff=\{currentStaff\}\s*\/>/;
  if (!pattern.test(text)) throw new Error('Technician legacy report component anchor was not found.');
  text = text.replace(pattern, exact);
  fs.writeFileSync(file, text);
}

console.log('Technician closure home anchor normalized.');
