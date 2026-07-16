const fs = require('fs');

const path = 'src/screens/AgendaScreen.tsx';
let source = fs.readFileSync(path, 'utf8');
source = source.replace(
  'function ScheduleHeader(function ScheduleHeader(',
  'function ScheduleHeader(',
);
fs.writeFileSync(path, source);
