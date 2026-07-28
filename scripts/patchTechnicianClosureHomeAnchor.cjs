const fs = require('fs');

const file = 'src/screens/TechnicianScreen.tsx';
let text = fs.readFileSync(file, 'utf8');
const exact = '            <TechnicianEvidenceReport order={selected} currentStaff={currentStaff} />';

if (!text.includes(exact) && !text.includes('Todos los reportes de esta visita fueron enviados.')) {
  const pattern = /[ \t]*<TechnicianEvidenceReport\s+order=\{selected\}\s+currentStaff=\{currentStaff\}\s*\/>/;
  if (!pattern.test(text)) throw new Error('Technician legacy report component anchor was not found.');
  text = text.replace(pattern, exact);
  fs.writeFileSync(file, text);
}

console.log('Technician closure home anchor normalized.');
