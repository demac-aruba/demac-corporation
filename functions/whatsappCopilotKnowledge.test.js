const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectQuestionKind,
  isSchedulingTurn,
  looksLikeQuestion,
  ruleScore,
} = require('./whatsappCopilotKnowledge');

test('detects duration even when the customer also repeats a time restriction', () => {
  const text = 'Yo puedo después de las 10, pero ¿cuánto tiempo durará el servicio?';
  assert.equal(detectQuestionKind(text), 'duration');
  assert.equal(isSchedulingTurn(text), false);
  assert.equal(looksLikeQuestion(text), true);
});

test('keeps appointment selection in the scheduling flow', () => {
  assert.equal(detectQuestionKind('Perfecto, la primera opción está bien'), '');
  assert.equal(isSchedulingTurn('Perfecto, la primera opción está bien'), true);
});

test('availability questions stay in scheduling instead of inheriting an old knowledge question', () => {
  assert.equal(isSchedulingTurn('¿Tienes cupo para el martes?'), true);
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