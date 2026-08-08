const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectQuestionKind,
  isSchedulingTurn,
  looksLikeQuestion,
  ruleScore,
} = require('./whatsappCopilotKnowledge');

test('detects duration when the current turn actually asks duration', () => {
  const text = 'Yo puedo después de las 10, pero ¿cuánto tiempo durará el servicio?';
  assert.equal(detectQuestionKind(text), 'duration');
  assert.equal(isSchedulingTurn(text), false);
  assert.equal(looksLikeQuestion(text), true);
});

test('detects BTU price comparison follow-up as price knowledge', () => {
  const text = '¿todos los aires variando de sus BTU tienen el mismo precio?';
  assert.equal(detectQuestionKind(text), 'price');
  assert.equal(isSchedulingTurn(text), false);
  assert.equal(looksLikeQuestion(text), true);
});

test('detects natural price-variation wording without requiring a numeric BTU', () => {
  for (const text of ['¿varía el precio según los BTU?', '¿todos los precios son iguales?', 'Do all BTU sizes have the same price?']) {
    assert.equal(detectQuestionKind(text), 'price');
    assert.equal(looksLikeQuestion(text), true);
  }
});

test('keeps appointment selection in the scheduling flow', () => {
  assert.equal(detectQuestionKind('Perfecto, la primera opción está bien'), '');
  assert.equal(isSchedulingTurn('Perfecto, la primera opción está bien'), true);
});

test('availability questions stay in scheduling instead of inheriting an old knowledge question', () => {
  assert.equal(isSchedulingTurn('¿Tienes cupo para el martes?'), true);
  assert.equal(isSchedulingTurn('¿Tienes para el lunes?'), true);
  assert.equal(isSchedulingTurn('¿Y tienes cupo en la tarde?'), true);
  assert.equal(detectQuestionKind('¿Y tienes cupo en la tarde?'), '');
});

test('customer rejection mentioning duration does not become a duration question', () => {
  const text = 'no te pregunté nada de la duración ni el ERP';
  assert.equal(detectQuestionKind(text), '');
  assert.equal(isSchedulingTurn(text), true);
  assert.equal(looksLikeQuestion(text), false);
});

test('scores an approved rule from example phrases', () => {
  const score = ruleScore({
    id: 'duration',
    intent: 'duration',
    active: true,
    priority: 100,
    triggerPhrases: ['cuánto tiempo dura el servicio'],
  }, '¿Cuánto tiempo dura el servicio?', 'duration');
  assert.ok(score > 300);
});

test('priority is only a tie-breaker and cannot make an irrelevant rule match', () => {
  const score = ruleScore({
    id: 'payment-methods',
    intent: 'payment',
    active: true,
    priority: 100,
    triggerPhrases: ['cómo puedo pagar', 'aceptan transferencia'],
  }, 'Buenos días', '');
  assert.equal(score, -1);
});

test('a bare historical duration word in a correction is ignored while a direct duration keyword still works', () => {
  assert.equal(detectQuestionKind('duración'), 'duration');
  assert.equal(detectQuestionKind('no necesito saber la duración'), '');
});
