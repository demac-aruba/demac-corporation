import { Client, Equipment, Invoice, InventoryItem, ServiceType, User, Van, WorkOrder } from '../types';

export const demoUsers: User[] = [
  { id: 'u1', name: 'Christian Alexander Márquez Márquez', email: 'admin@demac.demo', role: 'admin', phone: '+297 564 2625', active: true, authProvider: 'demo' },
  { id: 'u2', name: 'Laura Croes', email: 'laura@demac.demo', role: 'office', phone: '+297 560 1101', active: true, authProvider: 'demo' },
  { id: 'u3', name: 'María Tromp', email: 'maria@demac.demo', role: 'office', phone: '+297 560 1102', active: true, authProvider: 'demo' },
  { id: 'u4', name: 'Daniel Kelly', email: 'daniel@demac.demo', role: 'supervisor', phone: '+297 560 1201', active: true, authProvider: 'demo' },
  { id: 'u5', name: 'Carlos Rodríguez', email: 'carlos@demac.demo', role: 'technician', phone: '+297 560 1301', vanId: 'v1', active: true, authProvider: 'demo' },
  { id: 'u6', name: 'Miguel Herrera', email: 'miguel@demac.demo', role: 'technician', phone: '+297 560 1302', vanId: 'v1', active: true, authProvider: 'demo' },
  { id: 'u7', name: 'Andrea Maduro', email: 'andrea@demac.demo', role: 'accounting', phone: '+297 560 1401', active: true, authProvider: 'demo' },
  { id: 'u8', name: 'Roberto Ruiz', email: 'roberto@demac.demo', role: 'inventory', phone: '+297 560 1501', active: true, authProvider: 'demo' },
];

export const demoServices: ServiceType[] = [
  { id: 's1', name: 'Servicio estándar', durationMinutes: 75, basePrice: 125, category: 'Servicio' },
  { id: 's2', name: 'Servicio profundo', durationMinutes: 120, basePrice: 225, category: 'Servicio' },
  { id: 's3', name: 'Diagnóstico', durationMinutes: 60, basePrice: 95, category: 'Diagnóstico' },
  { id: 's4', name: 'Reparación', durationMinutes: 120, basePrice: 150, category: 'Servicio' },
  { id: 's5', name: 'Instalación', durationMinutes: 240, basePrice: 450, category: 'Instalación' },
  { id: 's6', name: 'Garantía', durationMinutes: 90, basePrice: 0, category: 'Garantía' },
  { id: 's7', name: 'Visita previa', durationMinutes: 45, basePrice: 75, category: 'Diagnóstico' },
  { id: 's8', name: 'Venta de equipo', durationMinutes: 30, basePrice: 699, category: 'Venta' },
  { id: 's9', name: 'Mantenimiento mensual', durationMinutes: 90, basePrice: 175, category: 'Comercial' },
  { id: 's10', name: 'Tratamiento anticorrosivo', durationMinutes: 90, basePrice: 217.5, category: 'Servicio' },
  { id: 's11', name: 'Emergencia comercial', durationMinutes: 120, basePrice: 250, category: 'Comercial' },
  { id: 's12', name: 'Evaluación VRF', durationMinutes: 180, basePrice: 350, category: 'Comercial' },
];

export const demoClients: Client[] = [
  { id: 'c1', name: 'Sofía de Cuba', phone: '+297 742 1101', whatsapp: '+297 742 1101', email: 'sofia@example.com', address: 'Morgenster 22, Oranjestad', zone: 'Oranjestad', balance: 0, equipmentCount: 2, lastService: '2026-07-02' },
  { id: 'c2', name: 'On The Rocks Restaurant', company: 'On The Rocks N.V.', phone: '+297 585 2200', whatsapp: '+297 740 2200', email: 'manager@ontherocks.demo', address: 'L.G. Smith Boulevard 88, Oranjestad', zone: 'Oranjestad', balance: 1250, equipmentCount: 6, lastService: '2026-07-08' },
  { id: 'c3', name: 'Michael Maduro', phone: '+297 743 3303', whatsapp: '+297 743 3303', address: 'Kamay 17, Noord', zone: 'Noord', balance: 145, equipmentCount: 1, lastService: '2026-06-20' },
  { id: 'c4', name: 'La Salle College', company: 'La Salle College Aruba', phone: '+297 582 4400', whatsapp: '+297 741 4400', email: 'facilities@lasalle.demo', address: 'Seroe Blanco 15, Oranjestad', zone: 'Oranjestad', balance: 2200, equipmentCount: 19, lastService: '2026-06-29' },
  { id: 'c5', name: 'Elena Croes', phone: '+297 744 5505', whatsapp: '+297 744 5505', address: 'Savaneta 181-A', zone: 'Savaneta', balance: 0, equipmentCount: 3, lastService: '2026-05-18' },
  { id: 'c6', name: 'Palm Beach Offices', company: 'Palm Beach Offices VBA', phone: '+297 586 6600', whatsapp: '+297 745 6600', email: 'office@pbo.demo', address: 'J.E. Irausquin Boulevard 210, Noord', zone: 'Noord', balance: 875, equipmentCount: 8, lastService: '2026-07-01' },
  { id: 'c7', name: 'Ricardo Kelly', phone: '+297 746 7707', whatsapp: '+297 746 7707', address: 'Santa Cruz 82-B', zone: 'Santa Cruz', balance: 0, equipmentCount: 1, lastService: '2026-06-11' },
  { id: 'c8', name: 'Pelican Pier', company: 'Pelican Pier Aruba', phone: '+297 586 8800', whatsapp: '+297 747 8800', email: 'operations@pelican.demo', address: 'Palm Beach Pier, Noord', zone: 'Noord', balance: 3400, equipmentCount: 4, lastService: '2026-06-15' },
];

export const demoEquipment: Equipment[] = [
  { id: 'e1', clientId: 'c1', location: 'Sala', brand: 'Adina', model: 'Optima 18K', serial: 'AD18-260031', btu: 18000, type: 'Split Unit', refrigerant: 'R32', voltage: '220V', installedAt: '2025-08-12', warrantyUntil: '2027-08-12', condition: 'Buena' },
  { id: 'e2', clientId: 'c1', location: 'Habitación principal', brand: 'Adina', model: 'Optima 12K', serial: 'AD12-260044', btu: 12000, type: 'Split Unit', refrigerant: 'R32', voltage: '220V', installedAt: '2025-08-12', warrantyUntil: '2027-08-12', condition: 'Excelente' },
  { id: 'e3', clientId: 'c2', location: 'Salón principal 1', brand: 'Innovair', model: 'Cassette 60K', serial: 'INV60-220913', btu: 60000, type: 'Cassette', refrigerant: 'R410A', voltage: '220V', installedAt: '2023-02-10', warrantyUntil: '2025-02-10', condition: 'Requiere atención' },
  { id: 'e4', clientId: 'c2', location: 'Salón principal 2', brand: 'Innovair', model: 'Cassette 60K', serial: 'INV60-220914', btu: 60000, type: 'Cassette', refrigerant: 'R410A', voltage: '220V', installedAt: '2023-02-10', warrantyUntil: '2025-02-10', condition: 'Buena' },
  { id: 'e5', clientId: 'c3', location: 'Sala', brand: 'Adina', model: 'Optima 24K', serial: 'AD24-250118', btu: 24000, type: 'Split Unit', refrigerant: 'R32', voltage: '220V', installedAt: '2025-01-20', warrantyUntil: '2027-01-20', condition: 'Buena' },
  { id: 'e6', clientId: 'c4', location: 'Cafetería', brand: 'Carrier', model: '42QHC036', serial: 'CAR36-190871', btu: 36000, type: 'Split Unit', refrigerant: 'R410A', voltage: '220V', installedAt: '2019-08-14', warrantyUntil: '2021-08-14', condition: 'Fuera de servicio' },
];

export const demoVans: Van[] = [
  { id: 'v1', name: 'Van 1', plate: 'A-10101', technicianIds: ['u5', 'u6'], status: 'En ruta' },
  { id: 'v2', name: 'Van 2', plate: 'A-20202', technicianIds: [], status: 'Disponible' },
  { id: 'v3', name: 'Van 3', plate: 'A-30303', technicianIds: [], status: 'Disponible' },
  { id: 'v4', name: 'Van 4', plate: 'A-40404', technicianIds: [], status: 'Mantenimiento' },
];

export const demoWorkOrders: WorkOrder[] = [
  { id: 'WO-260708-001', clientId: 'c1', serviceId: 's1', date: '2026-07-08', time: '08:00', status: 'Completada', technicianIds: ['u5', 'u6'], vanId: 'v1', address: 'Morgenster 22, Oranjestad', problem: 'Servicio preventivo de dos unidades.', amount: 250, paid: 250, equipmentId: 'e1', diagnosis: 'Unidades con acumulación moderada de polvo.', workPerformed: 'Limpieza de filtros, evaporadores y drenajes. Verificación general.', recommendation: 'Repetir mantenimiento en 4 meses.', materials: ['Jabón líquido', 'Spray de fragancia'], reportGenerated: true },
  { id: 'WO-260708-002', clientId: 'c2', serviceId: 's4', date: '2026-07-08', time: '09:30', status: 'En proceso', technicianIds: ['u5', 'u6'], vanId: 'v1', address: 'L.G. Smith Boulevard 88, Oranjestad', problem: 'Breaker se dispara y la unidad entra en bloqueo.', officeNotes: 'Verificar cableado y flujo de aire de condensadoras.', amount: 1250, paid: 625, equipmentId: 'e3', measurements: { voltage: '221 V', amperage: '28.6 A', lowPressure: '124 PSI', highPressure: '417 PSI' } },
  { id: 'WO-260708-003', clientId: 'c6', serviceId: 's9', date: '2026-07-08', time: '13:00', status: 'Asignada', technicianIds: ['u5', 'u6'], vanId: 'v1', address: 'J.E. Irausquin Boulevard 210, Noord', problem: 'Mantenimiento mensual de 8 unidades.', amount: 875, paid: 0 },
  { id: 'WO-260708-004', clientId: 'c7', serviceId: 's3', date: '2026-07-08', time: '15:30', status: 'Confirmada', technicianIds: [], vanId: 'v2', address: 'Santa Cruz 82-B', problem: 'Unidad enciende pero no enfría.', amount: 95, paid: 0 },
  { id: 'WO-260709-001', clientId: 'c8', serviceId: 's7', date: '2026-07-09', time: '08:30', status: 'Confirmada', technicianIds: [], vanId: 'v3', address: 'Palm Beach Pier, Noord', problem: 'Evaluación para reemplazo de cuatro equipos de 36,000 BTU.', amount: 75, paid: 0 },
  { id: 'WO-260709-002', clientId: 'c4', serviceId: 's2', date: '2026-07-09', time: '10:00', status: 'Solicitud recibida', technicianIds: [], vanId: 'v2', address: 'Seroe Blanco 15, Oranjestad', problem: 'Servicio profundo de unidades en oficinas administrativas.', amount: 675, paid: 0 },
];

export const demoInventory: InventoryItem[] = [
  { id: 'i1', name: 'Adina Optima 12,000 BTU', category: 'Equipos', unit: 'unidad', quantity: 12, minimum: 4, cost: 470, location: 'Almacén principal' },
  { id: 'i2', name: 'Adina Optima 18,000 BTU', category: 'Equipos', unit: 'unidad', quantity: 7, minimum: 4, cost: 790, location: 'Almacén principal' },
  { id: 'i3', name: 'Adina Optima 24,000 BTU', category: 'Equipos', unit: 'unidad', quantity: 3, minimum: 4, cost: 980, location: 'Almacén principal' },
  { id: 'i4', name: 'R410A 25 lb', category: 'Refrigerantes', unit: 'cilindro', quantity: 4, minimum: 3, cost: 300, location: 'Jaula de refrigerantes' },
  { id: 'i5', name: 'R32 20 lb', category: 'Refrigerantes', unit: 'cilindro', quantity: 2, minimum: 3, cost: 350, location: 'Jaula de refrigerantes' },
  { id: 'i6', name: 'Cable corriente 3x2.5', category: 'Cableado', unit: 'rollo', quantity: 6, minimum: 3, cost: 165, location: 'Rack B' },
  { id: 'i7', name: 'Cable señal 4x2.5', category: 'Cableado', unit: 'rollo', quantity: 5, minimum: 3, cost: 210, location: 'Rack B' },
  { id: 'i8', name: 'Foam Tape', category: 'Consumibles', unit: 'rollo', quantity: 18, minimum: 10, cost: 30, location: 'Rack C' },
  { id: 'i9', name: 'MAP Gas', category: 'Soldadura', unit: 'botella', quantity: 7, minimum: 5, cost: 28, location: 'Gabinete seguro' },
  { id: 'i10', name: 'Switch 220V', category: 'Eléctrico', unit: 'unidad', quantity: 28, minimum: 15, cost: 22, location: 'Rack A' },
  { id: 'i11', name: 'BLACK-MAX', category: 'Químicos', unit: 'galón', quantity: 5, minimum: 6, cost: 65, location: 'Área de químicos' },
];

export const demoInvoices: Invoice[] = [
  { id: 'INV-260701', clientId: 'c2', workOrderId: 'WO-260708-002', date: '2026-07-08', dueDate: '2026-07-15', total: 1250, paid: 625, status: 'Parcial', channel: 'Servicio técnico' },
  { id: 'INV-260702', clientId: 'c4', date: '2026-06-29', dueDate: '2026-07-13', total: 2200, paid: 0, status: 'Enviada', channel: 'WhatsApp' },
  { id: 'INV-260703', clientId: 'c3', date: '2026-06-20', dueDate: '2026-07-04', total: 145, paid: 0, status: 'Vencida', channel: 'Servicio técnico' },
  { id: 'INV-260704', clientId: 'c1', workOrderId: 'WO-260708-001', date: '2026-07-08', dueDate: '2026-07-08', total: 250, paid: 250, status: 'Pagada', channel: 'Servicio técnico' },
  { id: 'INV-260705', clientId: 'c8', date: '2026-06-15', dueDate: '2026-06-30', total: 3400, paid: 0, status: 'Vencida', channel: 'Teléfono' },
];
