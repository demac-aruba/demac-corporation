import { DailyVanAssignment, StaffAbsence, StaffProfile, Van, VanMaintenanceLog } from '../types';

export const demoStaffProfiles: StaffProfile[] = [
  { id: 'staff-miguel', name: 'Miguel Reyes', phone: '+297 560 1301', role: 'Técnico responsable', canDriveVan: true, primaryVanId: 'v1', skills: ['Servicio', 'Diagnóstico', 'Instalación'], availability: 'Disponible', active: true },
  { id: 'staff-mario', name: 'Mario Cornejo', phone: '+297 560 1302', role: 'Técnico responsable', canDriveVan: true, primaryVanId: 'v2', skills: ['Servicio', 'Instalación'], availability: 'Disponible', active: true },
  { id: 'staff-goyo', name: 'José Gregorio', phone: '+297 560 1303', role: 'Técnico responsable', canDriveVan: true, primaryVanId: 'v3', skills: ['Servicio', 'Diagnóstico', 'VRF'], availability: 'Disponible', active: true },
  { id: 'staff-edwin', name: 'Edwin Calvo', phone: '+297 560 1304', role: 'Técnico responsable', canDriveVan: true, primaryVanId: 'v4', skills: ['Servicio', 'Electricidad'], availability: 'Disponible', active: true },
  { id: 'staff-walter', name: 'Walter', phone: '+297 560 1311', role: 'Ayudante', canDriveVan: false, primaryVanId: 'v1', skills: ['Servicio', 'Instalación'], availability: 'Disponible', active: true },
  { id: 'staff-ronald', name: 'Ronald Mauri', phone: '+297 560 1312', role: 'Ayudante', canDriveVan: false, primaryVanId: 'v2', skills: ['Servicio'], availability: 'Disponible', active: true },
  { id: 'staff-aldrich', name: 'Aldrich', phone: '+297 560 1313', role: 'Ayudante', canDriveVan: false, primaryVanId: 'v3', skills: ['Servicio', 'Instalación'], availability: 'Disponible', active: true },
];

export const demoTeamVans: Van[] = [
  {
    id: 'v1', name: 'Van 1', plate: 'A-10101', technicianIds: ['staff-miguel', 'staff-walter'], status: 'Disponible', responsibleStaffId: 'staff-miguel', regularHelperId: 'staff-walter', odometerKm: 128450, nextServiceKm: 132000, nextServiceDate: '2026-09-01', insuranceExpiresAt: '2027-01-15', registrationExpiresAt: '2027-02-01', active: true, notes: 'Toyota Hiace 2016. Técnico responsable: Miguel Reyes.',
    inventory: [
      { id: 'tool-v1-1', name: 'Vacuum pump 7 CFM', category: 'Herramienta', quantity: 1, condition: 'Buena' },
      { id: 'tool-v1-2', name: 'Manifold digital', category: 'Herramienta', quantity: 1, condition: 'Buena' },
      { id: 'tool-v1-3', name: 'R410A', category: 'Refrigerante', quantity: 1, condition: 'Buena' },
    ],
  },
  {
    id: 'v2', name: 'Van 2', plate: 'A-20202', technicianIds: ['staff-mario', 'staff-ronald'], status: 'Disponible', responsibleStaffId: 'staff-mario', regularHelperId: 'staff-ronald', odometerKm: 116300, nextServiceKm: 120000, nextServiceDate: '2026-08-15', active: true,
    inventory: [{ id: 'tool-v2-1', name: 'Pressure washer', category: 'Herramienta', quantity: 1, condition: 'Buena' }],
  },
  {
    id: 'v3', name: 'Van 3', plate: 'A-30303', technicianIds: ['staff-goyo', 'staff-aldrich'], status: 'Disponible', responsibleStaffId: 'staff-goyo', regularHelperId: 'staff-aldrich', odometerKm: 140820, nextServiceKm: 144000, nextServiceDate: '2026-08-28', active: true,
    inventory: [{ id: 'tool-v3-1', name: 'Recovery machine', category: 'Herramienta', quantity: 1, condition: 'Buena' }],
  },
  {
    id: 'v4', name: 'Van 4', plate: 'A-40404', technicianIds: ['staff-edwin'], status: 'Mantenimiento', responsibleStaffId: 'staff-edwin', odometerKm: 151200, nextServiceKm: 151500, nextServiceDate: '2026-07-15', active: true, notes: 'Pendiente revisión mecánica.', inventory: [],
  },
];

export const demoDailyVanAssignments: DailyVanAssignment[] = [];
export const demoStaffAbsences: StaffAbsence[] = [];

export const demoVanMaintenanceLogs: VanMaintenanceLog[] = [
  { id: 'maint-v1-1', vanId: 'v1', date: '2026-05-10', odometerKm: 124800, type: 'Cambio de aceite', description: 'Aceite, filtro y revisión general.', cost: 300, nextDueKm: 132000, nextDueDate: '2026-09-01' },
  { id: 'maint-v2-1', vanId: 'v2', date: '2026-04-22', odometerKm: 112900, type: 'Mantenimiento preventivo', description: 'Cambio de aceite y revisión de frenos.', cost: 425, nextDueKm: 120000, nextDueDate: '2026-08-15' },
];
