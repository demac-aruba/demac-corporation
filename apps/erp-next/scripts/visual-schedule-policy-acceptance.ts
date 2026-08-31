import {
  halfDayAllowsSlot,
  halfDayStatusLabel,
  optionFitsHalfDay,
} from '../lib/visual-schedule-halfday-policy';

function expectEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

const halfDay = { workdayStart: '08:00', workdayEnd: '13:00' };

expectEqual(halfDayStatusLabel(halfDay), 'HALF-DAY TO 1:00 PM', 'half-day label');
expectEqual(halfDayAllowsSlot(halfDay, '10:30'), true, 'morning slot allowed');
expectEqual(halfDayAllowsSlot(halfDay, '13:30'), false, 'afternoon slot blocked');
expectEqual(optionFitsHalfDay(halfDay, '08:30', '12:30'), true, 'morning allocation allowed');
expectEqual(optionFitsHalfDay(halfDay, '10:30', '14:30'), false, 'allocation extending past half-day blocked');

expectEqual(halfDayAllowsSlot(undefined, '13:30'), true, 'full-day afternoon slot allowed');
expectEqual(optionFitsHalfDay(undefined, '13:30', '16:30'), true, 'full-day afternoon allocation allowed');

console.log('Visual schedule policy acceptance passed: half-day Vans stop showing false afternoon availability while full-day Vans remain available.');
