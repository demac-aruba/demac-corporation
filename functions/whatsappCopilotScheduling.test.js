const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ROUTE_CONFIG,
  addressSimilarity,
  identifyZone,
  normalizeRequestedDate,
  normalizeRouteConfig,
  routeCompatibility,
} = require('./whatsappCopilotSchedulingCore');
const {
  distributeUnits,
  generateOptions,
  normalizeOrderTime,
} = require('./whatsappCopilotAvailability');

test('separa la planificación de diez servicios entre dos vans', () => {
  assert.deepEqual(distributeUnits(10, 60, 4), [
    { quantity: 6, slots: 6, fullDay: false },
    { quantity: 4, slots: 4, fullDay: false },
  ]);
});

test('reserva el caso especial de siete servicios como jornada completa', () => {
  assert.deepEqual(distributeUnits(7, 60, 4), [
    { quantity: 7, slots: 6, fullDay: true },
  ]);
});

test('normaliza sábado relativo desde Aruba', () => {
  assert.equal(normalizeRequestedDate('', 'Prefiero el sábado', '2026-08-06'), '2026-08-08');
});

test('identifica sectores operativos de Aruba', () => {
  const route = normalizeRouteConfig(DEFAULT_ROUTE_CONFIG);
  assert.equal(identifyZone('Wayaca 217, Aruba', route).id, 'oranjestad');
  assert.equal(identifyZone('Savaneta 181-A', route).id, 'savaneta');
  assert.equal(identifyZone('Palm Beach, Noord', route).id, 'noord');
});

test('conserva el cupo especial de las 11:30', () => {
  assert.equal(normalizeOrderTime('11:30'), '11:30');
});

test('favorece rutas posteriores que regresan hacia Santa Cruz', () => {
  const result = routeCompatibility({
    candidateZone: { id: 'savaneta', label: 'Savaneta', position: 28 },
    existingOrders: [
      { time: '13:30', zoneInfo: { id: 'san-nicolas', label: 'San Nicolas', position: 10 } },
    ],
    candidateTime: '14:30',
    officePosition: 50,
    maximumAnchorDistance: 40,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'toward-office');
  assert.ok(result.score > 0);
});

test('no confunde la cantidad con la dirección', () => {
  assert.ok(addressSimilarity('Wayaca 217', 'Wayaca 217, Oranjestad') >= 0.8);
  assert.ok(addressSimilarity('2 aires', 'Wayaca 217') < 0.3);
});

test('devuelve como máximo tres opciones reales y consecutivas', () => {
  const analysis = {
    intent: 'service_request',
    summary: 'Servicio estándar',
    language: 'es',
    collectedInformation: {
      serviceType: 'service',
      quantity: '2',
      address: 'Wayaca 217',
      requestedDate: '',
      requestedTime: '',
      preferredDate: '',
      preferredTime: '',
      extraDetails: '',
    },
  };
  const staffProfiles = Array.from({ length: 4 }, (_, index) => ({
    id: `driver-${index + 1}`,
    name: `Driver ${index + 1}`,
    active: true,
    availability: 'Disponible',
    canDriveVan: true,
  }));
  const vans = staffProfiles.map((driver, index) => ({
    id: `van-${index + 1}`,
    name: `Van ${index + 1}`,
    active: true,
    status: 'Disponible',
    responsibleStaffId: driver.id,
  }));
  const data = {
    workOrders: [],
    services: [{ id: 'service-standard', name: 'Servicio estándar', durationMinutes: 60, category: 'Servicio' }],
    properties: [],
    clients: [],
    vans,
    staffProfiles,
    dailyVanAssignments: [],
    staffAbsences: [],
    calendarClosures: [],
    businessSettings: [{ id: 'business-calendar', closedWeekdays: [0] }],
    vanHalfDaySchedules: [],
  };
  const result = generateOptions({
    analysis,
    request: { contactPhone: '2975600000', chatTitle: 'Prueba', latestCustomerTurn: '2 aires en Wayaca 217' },
    data,
    routeConfig: normalizeRouteConfig(DEFAULT_ROUTE_CONFIG),
    today: '2026-08-06',
    currentTime: '07:00',
  });
  assert.equal(result.options.length, 3);
  assert.ok(result.options.every((option) => option.assignments.length === 1));
  assert.ok(result.options.every((option) => option.address === 'Wayaca 217'));
});
