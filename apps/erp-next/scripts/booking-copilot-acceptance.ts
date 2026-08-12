import { defaultBookingCopilotState, interpretBookingCopilotMessage, simulateBookingCopilot } from '../lib/booking-intelligence/copilot';
import type { CalendarDispatchJob } from '../lib/scheduling-capacity';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Booking Copilot acceptance failed: ${message}`);
}

const referenceDateKey = '2030-08-12'; // Monday
let state = defaultBookingCopilotState();

state = interpretBookingCopilotMessage({
  text: 'Tengo un cliente que necesita tres aires acondicionados en North esta semana',
  previous: state,
  referenceDateKey,
}).state;
assert(state.sector === 'Noord', 'North should normalize to Noord');
assert(state.workLines.length === 1 && state.workLines[0].presetId === 'standard_service' && state.workLines[0].quantity === 3, 'three A/C units should become 3 standard services');
assert(state.dateScope === 'this_week', 'this week should remain the active scope');

state = interpretBookingCopilotMessage({
  text: 'El cliente no puede miércoles',
  previous: state,
  referenceDateKey,
}).state;
assert(state.excludedWeekdays.includes(3), 'Wednesday should be excluded');
assert(state.sector === 'Noord' && state.workLines[0].quantity === 3, 'follow-up exclusion must preserve area and work scope');

state = interpretBookingCopilotMessage({
  text: 'Solamente puede después de las 10',
  previous: state,
  referenceDateKey,
}).state;
assert(state.constraints.notBefore === '10:00', 'after 10 should merge into the existing conversation constraints');
assert(state.excludedWeekdays.includes(3), 'time refinement must not forget the Wednesday exclusion');
assert(state.workLines[0].quantity === 3, 'a time such as 10:00 must never be reinterpreted as the A/C quantity');

const selection = interpretBookingCopilotMessage({
  text: 'Perfecto, ponlo el jueves',
  previous: state,
  referenceDateKey,
});
state = selection.state;
assert(selection.selectionRequested, '"ponlo" should be recognized as a plan-selection command');
assert(state.constraints.requestedWeekday === 4, 'Thursday should become the requested weekday');
assert(state.excludedWeekdays.includes(3), 'selecting Thursday must preserve the Wednesday exclusion');
assert(state.workLines[0].quantity === 3, 'day selection must preserve the original work quantity');

const jobs: CalendarDispatchJob[] = [];
const jobsBefore = JSON.stringify(jobs);
const simulation = simulateBookingCopilot({ state, referenceDateKey, jobs, limit: 5 });
assert(simulation.missing.length === 0, 'the example request should contain all required facts');
assert(simulation.plans.length > 0, 'the simulator should find at least one Thursday plan on an empty schedule');
assert(simulation.plans.every((plan) => plan.dateKey === '2030-08-15'), 'requested Thursday should filter the simulation to Thursday');
assert(simulation.plans.every((plan) => plan.slot.start >= '10:00'), 'after-10 constraint should be enforced by the scheduler');
assert(JSON.stringify(jobs) === jobsBefore, 'simulation must never mutate the live scheduling jobs');

const missing = simulateBookingCopilot({ state: defaultBookingCopilotState(), referenceDateKey, jobs: [], limit: 5 });
assert(missing.missing.includes('sector') && missing.missing.includes('work'), 'empty conversation should ask for area and work facts');

const nextWeek = interpretBookingCopilotMessage({
  text: 'Tengo dos servicios en Palm Beach la próxima semana',
  previous: defaultBookingCopilotState(),
  referenceDateKey,
}).state;
assert(nextWeek.sector === 'Palm Beach', 'Palm Beach should be preserved as its own scheduling sector');
assert(nextWeek.dateScope === 'next_week', 'next week should switch the date search horizon');
assert(nextWeek.workLines[0].quantity === 2, 'spoken quantity should be retained for next-week searches');

console.log('Booking Copilot acceptance passed: conversational memory, area normalization, time/day refinement, simulation purity and date scope are valid.');
