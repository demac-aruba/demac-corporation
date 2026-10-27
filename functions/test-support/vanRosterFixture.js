'use strict';
function seed() {
  const data = {
    'users/operator': { active: true, role: 'office', name: 'Synthetic operator' },
    'vans/legacy-101': { name: 'Van 1', active: true, status: 'Disponible', responsibleStaffId: 'tech-a', regularHelperId: 'helper-a', technicianIds: ['tech-a', 'helper-a'], plate: 'SYNTHETIC-1', unknownField: 'retain' },
    'vans/VAN-2': { name: 'Van 2', active: true, status: 'Disponible', responsibleStaffId: 'tech-b', regularHelperId: 'helper-b', technicianIds: ['tech-b', 'helper-b'] },
    'vans/VAN-5': { name: 'Van 5', active: true, status: 'Fuera de servicio' },
    'vanHalfDaySchedules/a': { vanId: 'legacy-101', weekday: 1, workdayStart: '08:00', workdayEnd: '13:00' },
    'vanHalfDaySchedules/b': { vanId: 'VAN-2', weekday: 2, workdayStart: '08:00', workdayEnd: '13:00' },
    'workOrders/pending': { date: '2026-10-26', time: '14:00', status: 'Confirmada', vanId: 'legacy-101', technicianIds: ['tech-a', 'helper-a'], appointmentId: 'appointment', projectId: 'project', serviceId: 'synthetic-service' },
    'appointments/appointment': { status: 'confirmed', date: '2026-10-26', projectId: 'project', assignments: [{ vanId: 'VAN-1', technicianIds: ['tech-a', 'helper-a'], slots: 1 }], chargeVersion: 7 },
    'projectRecords/project': { serverVersion: 2, assignments: [{ id: 'link', workOrderId: 'pending', appointmentId: 'appointment', vanId: 'VAN-1', technicianIds: ['tech-a', 'helper-a'], status: 'Scheduled', actualHours: 0, unitsCompleted: 0 }] },
    'workOrders/completed': { date: '2026-10-26', status: 'Completada', vanId: 'VAN-1', technicianIds: ['tech-a', 'helper-a'] },
    'workOrders/historical': { date: '2026-10-19', status: 'Confirmada', vanId: 'VAN-1', technicianIds: ['tech-a', 'helper-a'] },
    'employeeTimesheets/helper-a_2026-10-19': { date: '2026-10-19', regularHours: 5, overtimeMinutes: 60 },
    'employeePayrollSettings/helper-a': { monthlySalary: 2500 },
    'whatsappMessagesQueue/old': { status: 'cancelled', text: 'Synthetic old message' },
  };
  for (const name of ['tech-a', 'tech-b', 'helper-a', 'helper-b', 'spare']) {
    data['staffProfiles/' + name] = { name, employeeType: 'Técnico', canDriveVan: name.startsWith('tech'), active: true, primaryVanId: name.endsWith('a') ? 'VAN-1' : 'VAN-2' };
    data['users/login-' + name] = { active: true, role: 'technician', staffId: name, vanId: name.endsWith('a') ? 'VAN-1' : 'VAN-2' };
  }
  return data;
}
module.exports = { seed };
