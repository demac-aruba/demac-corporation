import { liveWorkOrderBlocksCapacity, projectLiveSchedulingAppointments, resolveCanonicalVanId } from '../lib/live-scheduling';
import { jobOwnsCapacityStart } from '../lib/scheduling-capacity';

// Compiled with the canonical backend primitives by test:scheduling-capacity-parity.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  candidateAvailability,
  capacityLockSlots,
} = require('../../../functions/bookingCapacityAvailability.js') as {
  candidateAvailability: (input: Record<string, unknown>) => null | {
    vanId: string;
    endTime: string;
    capacityEndTime: string;
    ownedSlots?: string[];
    capacitySlotStarts?: string[];
  };
  capacityLockSlots: (input: Record<string, unknown>) => string[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { workOrderStatusBlocksCapacity } = require('../../../functions/bookingSchedulingPrimitives.js') as {
  workOrderStatusBlocksCapacity: (status: unknown) => boolean;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateCanonicalOptions } = require('../../../functions/bookingAuthoritySchedulingEngine.js') as {
  generateCanonicalOptions: (input: Record<string, unknown>) => {
    options: Array<{ assignments: Array<{ vanId: string }> }>;
  };
};

function requireCondition(condition: unknown, message: string) {
  if (!condition) throw new Error(`Scheduling capacity parity acceptance failed: ${message}`);
}

const date = '2098-12-22';
const futureVanId = 'VAN-FUTURE-TEST-947';
const canonicalStarts = ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30'];
const van = { id: futureVanId, name: 'Future Test Van', active: true };
const assignment = {
  driverStaffId: 'driver-future',
  helperStaffId: 'helper-future',
  technicianIds: ['driver-future', 'helper-future'],
  status: 'Disponible',
};
const routeConfig = { routePolicy: 'advisory', zones: [] };
const clients = [{ id: 'client-1', name: 'Parity Customer' }];
const properties = [{ id: 'property-1', clientId: 'client-1', address: 'Parity Site' }];

function availability(vanId: string, workOrders: Array<Record<string, unknown>>, start = '08:30', durationMinutes = 180) {
  return candidateAvailability({
    date,
    time: start,
    allocation: {
      quantity: 1,
      durationMinutes,
      slots: Math.ceil(durationMinutes / 60),
      fullDay: false,
    },
    van: { ...van, id: vanId, name: `Fleet ${vanId}` },
    assignment,
    data: {
      workOrders,
      properties,
      vanHalfDaySchedules: [],
    },
    routeConfig,
    candidateZone: null,
  });
}

const futureCatalog = [{ ...van, responsibleStaffId: 'driver-future', regularHelperId: 'helper-future' }];
requireCondition(
  resolveCanonicalVanId(futureVanId, futureCatalog) === futureVanId,
  'an opaque canonical Van ID must survive the LIVE identity projection',
);

const openFuture = availability(futureVanId, []);
requireCondition(Boolean(openFuture), 'the future Van must accept an empty 08:30 / 180-minute allocation');
requireCondition(openFuture?.endTime === '11:30', 'the future Van work interval must end at 11:30');
const futureOwnedSlots = openFuture?.ownedSlots ?? openFuture?.capacitySlotStarts
  ?? capacityLockSlots({ time: '08:30', durationMinutes: 180, slots: 3, halfDay: false, fullDay: false });
requireCondition(
  futureOwnedSlots.join(',') === '08:30,09:30,10:30',
  'the future Van must own exactly the three complete morning capacity starts',
);

const blocker = {
  id: 'WO-FUTURE-CONFLICT',
  appointmentId: 'APT-FUTURE-CONFLICT',
  clientId: 'client-1',
  propertyId: 'property-1',
  date,
  time: '09:30',
  status: 'Confirmada',
  vanId: futureVanId,
  appointmentDurationMinutes: 60,
  scheduledSlots: 1,
  appointmentWorkLabel: 'Parity blocker',
  airConditionerCount: 1,
};
requireCondition(
  availability(futureVanId, [blocker]) === null,
  'a canonical 09:30 Work Order must reject the future Van 08:30 / 180-minute request',
);
for (const releasedStatus of ['Cancelada', 'cancelada', 'Cancelled', 'cancelled', 'Canceled', 'canceled', 'Reprogramada', 'reprogramada', 'Rescheduled', 'rescheduled']) {
  requireCondition(
    liveWorkOrderBlocksCapacity(releasedStatus) === workOrderStatusBlocksCapacity(releasedStatus),
    `${releasedStatus} must have identical authority and LIVE blocking semantics`,
  );
  requireCondition(
    Boolean(availability(futureVanId, [{ ...blocker, status: releasedStatus }])),
    `${releasedStatus} must release the same future-Van capacity`,
  );
}
for (const blockingStatus of ['Confirmada', 'Reserva temporal', 'En proceso', 'Completada', '', 'unknown legacy status']) {
  requireCondition(
    liveWorkOrderBlocksCapacity(blockingStatus) === workOrderStatusBlocksCapacity(blockingStatus),
    `${blockingStatus || '<blank>'} must have identical fail-closed authority and LIVE semantics`,
  );
}

const projectionOrders = [
  {
    ...blocker,
    id: 'WO-PARITY-ACTIVE',
    appointmentId: 'APT-PARITY-ACTIVE',
    time: '08:30',
    appointmentDurationMinutes: 180,
    scheduledSlots: 3,
  },
  {
    ...blocker,
    id: 'WO-PARITY-CANCELLED',
    appointmentId: 'APT-PARITY-CANCELLED',
    time: '13:30',
    status: 'cancelled',
  },
  {
    ...blocker,
    id: 'WO-PARITY-RESCHEDULED',
    appointmentId: 'APT-PARITY-RESCHEDULED',
    time: '14:30',
    status: 'Reprogramada',
  },
];
const projected = projectLiveSchedulingAppointments(
  projectionOrders,
  clients,
  properties,
  futureCatalog,
);
const projectedCapacity = projected.filter((appointment) => appointment.status !== 'cancelled');
requireCondition(projectedCapacity.length === 1, 'LIVE must classify cancelled and rescheduled records as non-capacity appointments');
const projectedAssignment = projectedCapacity[0]?.assignments[0];
requireCondition(Boolean(projectedAssignment), 'the active future-Van assignment must remain visible');
const boardBlocked = new Set(canonicalStarts.filter((start) => jobOwnsCapacityStart(projectedAssignment!, start)));
const authorityBlocked = new Set(capacityLockSlots({
  time: '08:30',
  durationMinutes: 180,
  slots: 3,
  halfDay: false,
  fullDay: false,
}));
requireCondition(
  [...boardBlocked].sort().join(',') === [...authorityBlocked].sort().join(','),
  'the board and authority must block the same canonical owned slots for one snapshot',
);
const boardOpen = canonicalStarts.filter((start) => !boardBlocked.has(start));
const authorityOpen = canonicalStarts.filter((start) => !authorityBlocked.has(start));
requireCondition(
  boardOpen.join(',') === authorityOpen.join(','),
  'the board and authority must expose the same open starts for the parity snapshot',
);

type ParityWorkOrder = Record<string, unknown> & { id: string };

function fullAuthorityAllows(workOrders: ParityWorkOrder[], start: string) {
  const result = generateCanonicalOptions({
    request: {
      customerId: 'client-1',
      propertyId: 'property-1',
      workLines: [{
        id: 'parity-work',
        presetId: 'other',
        serviceId: 'service-other',
        quantity: 1,
        manualDurationMinutes: 60,
      }],
      constraints: { requestedDate: date, requestedTime: start },
    },
    property: properties[0],
    data: {
      workOrders,
      services: [{
        id: 'service-other',
        name: 'Other',
        itemType: 'Servicio',
        active: true,
        durationMinutes: 60,
        serviceDefinition: { version: 1, bookingCode: 'other', duration: { minutes: 60 } },
      }],
      properties,
      clients,
      vans: futureCatalog,
      staffProfiles: [
        { id: 'driver-future', active: true, availability: 'Disponible', canDriveVan: true },
        { id: 'helper-future', active: true, availability: 'Disponible' },
      ],
      staffAbsences: [],
      dailyVanAssignments: [],
      calendarClosures: [],
      vanHalfDaySchedules: [],
      businessSettings: [{ id: 'business-calendar', closedWeekdays: [0] }],
    },
    routeConfig,
    today: '2098-12-21',
    currentTime: '07:00',
    requiredPrimaryVanId: futureVanId,
    requireRequestedTarget: true,
  });
  return result.options.length > 0;
}

function assertFullAuthorityBoardParity(workOrders: ParityWorkOrder[], label: string) {
  const appointments = projectLiveSchedulingAppointments(workOrders, clients, properties, futureCatalog)
    .filter((appointment) => appointment.status !== 'cancelled');
  for (const start of canonicalStarts) {
    const boardSaysOpen = !appointments.some((appointment) => appointment.assignments
      .some((assignment) => assignment.vanId === futureVanId && jobOwnsCapacityStart(assignment, start)));
    requireCondition(
      boardSaysOpen === fullAuthorityAllows(workOrders, start),
      `${label}: full Authority and LIVE projection must agree at ${start}`,
    );
  }
}

assertFullAuthorityBoardParity([{
  ...blocker,
  id: 'WO-FULL-PARITY-LINKED',
  appointmentId: 'APT-FULL-PARITY-LINKED',
  time: '09:30',
}], 'linked active Work Order');
assertFullAuthorityBoardParity([{
  ...blocker,
  id: 'WO-FULL-PARITY-UNLINKED',
  appointmentId: '',
  time: '09:30',
}], 'unlinked active Work Order');
assertFullAuthorityBoardParity([{
  ...blocker,
  id: 'WO-FULL-PARITY-CANCELLED',
  appointmentId: '',
  time: '09:30',
  status: 'Cancelada',
}], 'cancelled unlinked Work Order');

function comparable(result: ReturnType<typeof availability>) {
  if (!result) return null;
  return {
    endTime: result.endTime,
    capacityEndTime: result.capacityEndTime,
    ownedSlots: result.ownedSlots ?? result.capacitySlotStarts,
  };
}

const identityPairs = [
  ['VAN-4', 'VAN-RANDOM-82917'],
  ['VAN-1', 'fleet:aruba:alpha'],
  ['VAN-15', 'new-van-without-numeric-suffix'],
  ['VAN-5', futureVanId],
];
for (const [knownId, arbitraryId] of identityPairs) {
  for (const start of canonicalStarts) {
    for (const durationMinutes of [60, 120, 180, 210, 360]) {
      requireCondition(
        JSON.stringify(comparable(availability(knownId, [], start, durationMinutes)))
          === JSON.stringify(comparable(availability(arbitraryId, [], start, durationMinutes))),
        `capacity must be invariant when only Van identity changes (${knownId} -> ${arbitraryId}, ${start}, ${durationMinutes}m)`,
      );
    }
  }
}

// Deterministic generated coverage: fleet size and arbitrary ID shape must not
// alter the generic interval answer. This intentionally avoids introducing a
// test-only special case for VAN-FUTURE-TEST-947.
for (const fleetSize of [1, 5, 8, 15]) {
  for (let index = 0; index < fleetSize; index += 1) {
    const generatedId = `fleet/${fleetSize}/unit/${index}/opaque-${(index * 7919 + fleetSize * 101) % 104729}`;
    const baselineId = `VAN-${index + 1}`;
    const start = canonicalStarts[(index + fleetSize) % canonicalStarts.length];
    const durationMinutes = [60, 120, 180, 210, 360][(index * 3 + fleetSize) % 5];
    requireCondition(
      JSON.stringify(comparable(availability(generatedId, [], start, durationMinutes)))
        === JSON.stringify(comparable(availability(baselineId, [], start, durationMinutes))),
      `generated fleet ${fleetSize} unit ${index} must remain Van-ID invariant`,
    );
  }
}

console.log('Scheduling capacity parity acceptance passed.');
