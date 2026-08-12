import type { BookingRequest, BookingWorkLine, CandidateSlot, WorkPresetId } from '../scheduling';
import { customerFacingDescription, timeToMinutes } from '../scheduling';
import type { CalendarDispatchJob, OperationalDay, SupportReflowPlan } from '../scheduling-capacity';
import { buildOperationalWeek, findCandidateSlotsForDay, findSupportReflowPlansForDay, jobsForDate } from '../scheduling-capacity';
import { bookingRestrictionFromConstraints, describeBookingConstraints, inferBookingConstraintPatch, mergeBookingConstraints, type BookingConstraintState } from './constraints';
import { rankRouteAwareCandidates } from './route-ranking';

export type CopilotDateScope = 'this_week' | 'next_week' | 'next_14_days' | 'this_month';

export type BookingCopilotState = {
  sector?: string;
  workLines: BookingWorkLine[];
  constraints: BookingConstraintState;
  excludedWeekdays: number[];
  excludedDateKeys: string[];
  dateScope: CopilotDateScope;
  sourceMessages: string[];
};

export type BookingCopilotPlan = {
  id: string;
  dateKey: string;
  day: OperationalDay;
  slot: CandidateSlot;
  score: number;
  kind: 'direct' | 'capacity_recovery';
  recoveryPlan?: SupportReflowPlan;
  impact: string[];
};

export type BookingCopilotSimulation = {
  state: BookingCopilotState;
  request?: BookingRequest;
  plans: BookingCopilotPlan[];
  missing: Array<'sector' | 'work'>;
  summary: string;
};

export type BookingCopilotInterpretation = {
  state: BookingCopilotState;
  selectionRequested: boolean;
  resetRequested: boolean;
};

const sectorAliases: Array<[string, RegExp]> = [
  ['Palm Beach', /\b(palm\s*beach|hotel\s*area|hoteles)\b/i],
  ['Noord', /\b(noord|north|nord)\b/i],
  ['Oranjestad', /\b(oranjestad|orange\s*stad|oranjest[aá]d|playa)\b/i],
  ['Santa Cruz', /\b(santa\s*cruz)\b/i],
  ['Paradera', /\b(paradera)\b/i],
  ['San Nicolas', /\b(san\s*nicolas|san\s*nicolaas|san\s*nicol[aá]s)\b/i],
  ['Savaneta', /\b(savaneta)\b/i],
];

const weekdayAliases: Array<[number, RegExp]> = [
  [1, /\b(monday|lunes|dialuna)\b/i],
  [2, /\b(tuesday|martes|diamars)\b/i],
  [3, /\b(wednesday|miercoles|mi[eé]rcoles|diaranson)\b/i],
  [4, /\b(thursday|jueves|diahuebs)\b/i],
  [5, /\b(friday|viernes|diabierna)\b/i],
  [6, /\b(saturday|sabado|s[aá]bado|diasabra)\b/i],
  [0, /\b(sunday|domingo|diadomingo)\b/i],
];

const numberWords: Record<string, number> = {
  un: 1, uno: 1, una: 1, one: 1,
  dos: 2, two: 2,
  tres: 3, three: 3,
  cuatro: 4, four: 4,
  cinco: 5, five: 5,
  seis: 6, six: 6,
  siete: 7, seven: 7,
  ocho: 8, eight: 8,
  nueve: 9, nine: 9,
  diez: 10, ten: 10,
  once: 11, eleven: 11,
  doce: 12, twelve: 12,
  trece: 13, thirteen: 13,
  catorce: 14, fourteen: 14,
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekdayIndex(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function operationalDay(dateKey: string) {
  return buildOperationalWeek(dateKey).find((day) => day.dateKey === dateKey)!;
}

function currentArubaClock() {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Aruba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const timeParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Aruba', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const read = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    dateKey: `${read(dateParts, 'year')}-${read(dateParts, 'month')}-${read(dateParts, 'day')}`,
    minutes: Number(read(timeParts, 'hour')) * 60 + Number(read(timeParts, 'minute')),
  };
}

function parseCount(text: string) {
  const normalized = normalize(text);
  const quantityTarget = '(?:aires?(?: acondicionados?)?|aircos?|air conditioners?|a\\/?c|ac|units?|unidades?|services?|servicios?|installations?|instalaciones?)';
  const wordAlternatives = Object.keys(numberWords).sort((left, right) => right.length - left.length).join('|');
  const targeted = normalized.match(new RegExp(`\\b(1[0-4]|[1-9]|${wordAlternatives})\\s+${quantityTarget}\\b`, 'i'))?.[1];
  if (targeted) return /^\d+$/.test(targeted) ? Number(targeted) : numberWords[targeted];

  const digit = normalized.match(/\b(1[0-4]|[1-9])\b/)?.[1];
  if (digit) return Number(digit);
  for (const [word, value] of Object.entries(numberWords)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(normalized)) return value;
  }
  return undefined;
}

function inferPreset(text: string): WorkPresetId | undefined {
  const value = normalize(text);
  if (/\b(deep|deep cleaning|limpieza profunda|servicio profundo|deep service)\b/.test(value)) return 'deep_cleaning';
  if (/\b(check\s*up|checkup|diagnostic|diagnostico|revision tecnica)\b/.test(value)) return 'diagnostic';
  if (/\b(repair|reparacion|reparar|arreglo|fix)\b/.test(value)) return 'repair';
  if (/\b(rooftop|techo)\b/.test(value) && /\b(instal|install)\w*/.test(value)) return 'installation_rooftop';
  if (/\b(third floor|tercer piso|tercera planta)\b/.test(value) && /\b(instal|install)\w*/.test(value)) return 'installation_third_floor';
  if (/\b(second floor|segundo piso|segunda planta)\b/.test(value) && /\b(instal|install)\w*/.test(value)) return 'installation_second_floor';
  if (/\b(extended installation|instalacion extendida|instalacion larga)\b/.test(value)) return 'installation_extended';
  if (/\b(installation|instalacion|instalar|install)\b/.test(value)) return 'installation_standard';
  if (/\b(anti\s*-?corrosive|anticorrosivo|anti corrosion)\b/.test(value)) return 'anti_corrosive';
  if (/\b(service|servicio|mantenimiento|maintenance|airco service)\b/.test(value)) return 'standard_service';
  return undefined;
}

function inferWorkLines(text: string, previous: BookingWorkLine[]) {
  const count = parseCount(text);
  const preset = inferPreset(text);
  const mentionsAir = /\b(air\s*conditioners?|a\/?c|ac|aires?|aircos?|units?|unidades?)\b/i.test(normalize(text));
  if (!count && !preset) return previous;
  const existing = previous[0];
  const nextPreset = preset ?? existing?.presetId ?? (mentionsAir ? 'standard_service' : undefined);
  if (!nextPreset) return previous;
  const nextCount = count ?? existing?.quantity ?? 1;
  return [{ id: existing?.id ?? 'copilot-work-1', presetId: nextPreset, quantity: Math.max(1, Math.min(14, nextCount)) }];
}

function inferSector(text: string) {
  return sectorAliases.find(([, pattern]) => pattern.test(text))?.[0];
}

function excludedWeekdaysFromText(text: string) {
  const normalized = normalize(text);
  const hasExclusion = /\b(no puede|no puedo|cannot|can't|cant|excepto|menos|not on|no el|no los)\b/.test(normalized);
  if (!hasExclusion) return [] as number[];
  return weekdayAliases.filter(([, pattern]) => pattern.test(normalized)).map(([weekday]) => weekday);
}

function requestedDateFromRelativeText(text: string, referenceDateKey: string) {
  const value = normalize(text);
  if (/\b(hoy|today|awe)\b/.test(value)) return referenceDateKey;
  if (/\b(manana|tomorrow|mayan)\b/.test(value)) return addDays(referenceDateKey, 1);
  return undefined;
}

function inferDateScope(text: string, previous: CopilotDateScope): CopilotDateScope {
  const value = normalize(text);
  if (/\b(proxima semana|next week|siman benidero)\b/.test(value)) return 'next_week';
  if (/\b(dos semanas|2 semanas|next two weeks|proximas dos semanas)\b/.test(value)) return 'next_14_days';
  if (/\b(este mes|this month|fin de mes|end of the month)\b/.test(value)) return 'this_month';
  if (/\b(esta semana|this week|e siman aki)\b/.test(value)) return 'this_week';
  return previous;
}

function dateKeysForScope(state: BookingCopilotState, referenceDateKey: string) {
  if (state.constraints.requestedDate) return [state.constraints.requestedDate];
  if (state.dateScope === 'next_week') return buildOperationalWeek(addDays(referenceDateKey, 7)).map((day) => day.dateKey);
  if (state.dateScope === 'next_14_days') return Array.from({ length: 14 }, (_, index) => addDays(referenceDateKey, index));
  if (state.dateScope === 'this_month') {
    const date = new Date(`${referenceDateKey}T12:00:00Z`);
    const month = date.getUTCMonth();
    const keys: string[] = [];
    for (let index = 0; index < 35; index += 1) {
      const key = addDays(referenceDateKey, index);
      const probe = new Date(`${key}T12:00:00Z`);
      if (probe.getUTCMonth() !== month) break;
      keys.push(key);
    }
    return keys;
  }
  return buildOperationalWeek(referenceDateKey).map((day) => day.dateKey).filter((key) => key >= referenceDateKey);
}

function selectionCommand(text: string) {
  const value = normalize(text);
  return /\b(ponlo|ponla|book it|use it|agendalo|agendala|reserva|reservalo|perfecto.*(lunes|martes|miercoles|jueves|viernes|sabado)|use .*day)\b/.test(value);
}

export function defaultBookingCopilotState(): BookingCopilotState {
  return { workLines: [], constraints: {}, excludedWeekdays: [], excludedDateKeys: [], dateScope: 'this_week', sourceMessages: [] };
}

export function interpretBookingCopilotMessage(args: { text: string; previous?: BookingCopilotState; referenceDateKey: string }): BookingCopilotInterpretation {
  const previous = args.previous ?? defaultBookingCopilotState();
  const normalized = normalize(args.text);
  const resetRequested = /\b(reset|reiniciar|empezar de nuevo|nueva simulacion|new simulation)\b/.test(normalized);
  const base = resetRequested ? defaultBookingCopilotState() : previous;
  const exclusions = excludedWeekdaysFromText(args.text);
  const relativeDate = requestedDateFromRelativeText(args.text, args.referenceDateKey);
  const inferredConstraintPatch = inferBookingConstraintPatch(args.text);
  if (exclusions.length) inferredConstraintPatch.requestedWeekday = undefined;
  if (relativeDate) inferredConstraintPatch.requestedDate = relativeDate;

  const sector = inferSector(args.text) ?? base.sector;
  const workLines = inferWorkLines(args.text, base.workLines);
  const constraints = mergeBookingConstraints(base.constraints, inferredConstraintPatch);
  const excludedWeekdays = [...new Set([...base.excludedWeekdays, ...exclusions])];

  if (constraints.requestedWeekday !== undefined && excludedWeekdays.includes(constraints.requestedWeekday)) constraints.requestedWeekday = undefined;
  if (constraints.requestedDate && excludedWeekdays.includes(weekdayIndex(constraints.requestedDate))) constraints.requestedDate = undefined;

  for (const [weekday, pattern] of weekdayAliases) {
    if (pattern.test(normalized) && !exclusions.includes(weekday) && /\b(si puede|puede|available|disponible|mejor|prefer|prefiere)\b/.test(normalized)) {
      const index = excludedWeekdays.indexOf(weekday);
      if (index >= 0) excludedWeekdays.splice(index, 1);
    }
  }

  return {
    state: {
      ...base,
      sector,
      workLines,
      constraints,
      excludedWeekdays,
      dateScope: inferDateScope(args.text, base.dateScope),
      sourceMessages: [...base.sourceMessages, args.text.trim()].filter(Boolean).slice(-12),
    },
    selectionRequested: selectionCommand(args.text),
    resetRequested,
  };
}

export function buildCopilotRequest(state: BookingCopilotState): BookingRequest | undefined {
  if (!state.sector || !state.workLines.length) return undefined;
  const quantity = state.workLines.reduce((sum, line) => sum + Math.max(1, line.quantity), 0);
  const primary = state.workLines[0];
  return {
    customer: 'Booking simulation',
    site: 'Unassigned property',
    sector: state.sector,
    presetId: primary.presetId,
    quantity,
    workLines: state.workLines,
    restriction: bookingRestrictionFromConstraints(state.constraints),
  };
}

export function simulateBookingCopilot(args: { state: BookingCopilotState; referenceDateKey: string; jobs: CalendarDispatchJob[]; limit?: number }): BookingCopilotSimulation {
  const missing: Array<'sector' | 'work'> = [];
  if (!args.state.sector) missing.push('sector');
  if (!args.state.workLines.length) missing.push('work');
  const request = buildCopilotRequest(args.state);
  if (!request) {
    return {
      state: args.state,
      missing,
      plans: [],
      summary: missing.includes('sector') && missing.includes('work')
        ? 'Tell me the service or A/C quantity and the Aruba sector.'
        : missing.includes('sector')
          ? 'I have the work scope. Tell me the Aruba sector or property area.'
          : 'I have the area. Tell me what work is needed and how many A/C units.',
    };
  }

  let dateKeys = dateKeysForScope(args.state, args.referenceDateKey)
    .filter((key) => !args.state.excludedDateKeys.includes(key))
    .filter((key) => !args.state.excludedWeekdays.includes(weekdayIndex(key)));
  if (args.state.constraints.requestedWeekday !== undefined) dateKeys = dateKeys.filter((key) => weekdayIndex(key) === args.state.constraints.requestedWeekday);

  const clock = currentArubaClock();
  const directPlans: BookingCopilotPlan[] = [];
  const recoveryPlans: BookingCopilotPlan[] = [];
  for (const dateKey of dateKeys) {
    const day = operationalDay(dateKey);
    if (!day?.isOpen) continue;
    const dayJobs = jobsForDate(args.jobs, dateKey);
    let slots = rankRouteAwareCandidates({ slots: findCandidateSlotsForDay(day, request, dayJobs), request, jobs: dayJobs, officeSector: 'Santa Cruz' });
    if (dateKey === clock.dateKey && args.referenceDateKey === clock.dateKey) slots = slots.filter((slot) => timeToMinutes(slot.start) > clock.minutes);

    slots.slice(0, 2).forEach((slot, index) => directPlans.push({
      id: `direct-${dateKey}-${slot.vanId}-${slot.start}-${index}`,
      dateKey,
      day,
      slot,
      score: slot.score,
      kind: 'direct',
      impact: [
        'No existing appointment needs to move',
        'Booking Intelligence validated continuous duration and route compatibility',
        slot.supportVanId ? `Linked support: ${slot.supportVanId.replace('VAN-', 'Van ')}` : 'Single-van assignment',
      ],
    }));

    if (!slots.length && !(dateKey === clock.dateKey && args.referenceDateKey === clock.dateKey && clock.minutes >= 16 * 60)) {
      const reflows = findSupportReflowPlansForDay(day, request, dayJobs);
      reflows.slice(0, 2).forEach((plan) => recoveryPlans.push({
        id: `recovery-${dateKey}-${plan.id}`,
        dateKey,
        day,
        slot: plan.unlockedSlot,
        score: plan.score - 6,
        kind: 'capacity_recovery',
        recoveryPlan: plan,
        impact: [
          `Move support only: ${plan.vanId.replace('VAN-', 'Van ')} ${plan.fromStart} → ${plan.toStart}`,
          'Primary customer appointment remains unchanged',
          'No customer notification is required for the support-only move',
        ],
      }));
    }
  }

  const plans = [...directPlans, ...recoveryPlans]
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey) || Number(left.kind === 'capacity_recovery') - Number(right.kind === 'capacity_recovery') || right.score - left.score || left.slot.start.localeCompare(right.slot.start))
    .slice(0, args.limit ?? 5);

  const scope = customerFacingDescription(request);
  const restriction = describeBookingConstraints(args.state.constraints);
  const summary = plans.length
    ? `${plans.length} valid plan${plans.length === 1 ? '' : 's'} found for ${scope} in ${args.state.sector}. ${restriction}.`
    : `No valid plan found for ${scope} in ${args.state.sector} under the current date/time constraints.`;
  return { state: args.state, request, plans, missing, summary };
}
