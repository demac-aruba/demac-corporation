const test = require('node:test');
const assert = require('node:assert/strict');
const presentation = require('./whatsappCopilotPresentation');

const result = {
  quantity: 2,
  requestedDateUnavailable: false,
  requestedDate: '',
  options: [
    { date: '2026-08-07', time: '13:30', endTime: '15:30', address: 'Wayaca 217', quantity: 2 },
    { date: '2026-08-07', time: '14:30', endTime: '16:30', address: 'Wayaca 217', quantity: 2 },
    { date: '2026-08-08', time: '13:30', endTime: '15:30', address: 'Wayaca 217', quantity: 2 },
  ],
};

test('ofrece solamente dos opciones y prioriza fechas distintas', () => {
  const selected = presentation.selectClientOptions(result.options);
  assert.deepEqual(selected.map((option) => `${option.date} ${option.time}`), [
    '2026-08-07 13:30',
    '2026-08-08 13:30',
  ]);

  const reply = presentation.formatAvailabilityReply('es', result);
  assert.match(reply, /\*1\. Viernes 7 de agosto — 1:30 p\. m\.\*/);
  assert.match(reply, /\*2\. Sábado 8 de agosto — 1:30 p\. m\.\*/);
  assert.doesNotMatch(reply, /2:30 p\. m\./);
});

test('usa saltos de línea y formato de WhatsApp', () => {
  const reply = presentation.formatAvailabilityReply('es', result);
  assert.match(reply, /opciones:\n\n\*1\./);
  assert.match(reply, /\*1\.[\s\S]*\n\n\*2\./);
  assert.match(reply, /\n\n¿Cuál opción le resulta mejor\?$/);
});

test('no repite la dirección en el mensaje de opciones', () => {
  const reply = presentation.formatAvailabilityReply('es', result);
  assert.doesNotMatch(reply, /Wayaca 217/);
  assert.equal((reply.match(/2 aires/g) || []).length, 1);
});

test('estructura la confirmación final con fecha y dirección', () => {
  const reply = presentation.formatConfirmationReply('es', result.options[0]);
  assert.match(reply, /^Perfecto, su cita quedó confirmada:\n\n\*Viernes 7 de agosto — 1:30 p\. m\.\*/);
  assert.match(reply, /\nWayaca 217\n\n/);
});
