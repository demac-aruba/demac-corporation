const fs = require('fs');

const path = 'scripts/apply-half-days-clean.cjs';
let source = fs.readFileSync(path, 'utf8');
source = source.replaceAll(
  'key={`${van.id}-${slot}`}',
  'key={\\`\\${van.id}-\\${slot}\\`}',
);
fs.writeFileSync(path, source);
