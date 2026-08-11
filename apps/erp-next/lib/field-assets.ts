export const technicianPerformance = [
  { name: 'Miguel Reyes', van: 'Van 1', status: 'Working', sector: 'Noord', jobs: '4 / 6', utilization: 82, firstTimeFix: 94, callback: '2.1%', skills: ['Service', 'Diagnostics', 'Installation'] },
  { name: 'Ronald Mauri', van: 'Van 2', status: 'Working', sector: 'Palm Beach', jobs: '5 / 6', utilization: 78, firstTimeFix: 91, callback: '2.8%', skills: ['Service', 'Installation'] },
  { name: 'Edwin Calvo', van: 'Van 2', status: 'Working', sector: 'Palm Beach', jobs: '5 / 6', utilization: 76, firstTimeFix: 92, callback: '2.4%', skills: ['Service', 'Installation'] },
  { name: 'Walter / Mario', van: 'Van 3', status: 'Support', sector: 'Santa Cruz', jobs: 'Support WO-2051', utilization: 73, firstTimeFix: 90, callback: '3.0%', skills: ['Service', 'Deep Cleaning', 'Installation'] },
  { name: 'José Gregorio / Aldrich', van: 'Van 4', status: 'Working', sector: 'Oranjestad', jobs: '5 / 6', utilization: 80, firstTimeFix: 95, callback: '1.9%', skills: ['Service', 'Commercial'] },
];

export const vans = [
  { name: 'Van 1', crew: 'Miguel Reyes', template: 'Service / Diagnostics', sector: 'Noord', jobs: '4 / 6', readiness: 'READY', stock: 96, fuel: 72, alerts: '0 critical' },
  { name: 'Van 2', crew: 'Ronald + Edwin', template: 'Service / Installation', sector: 'Palm Beach', jobs: '5 / 6', readiness: 'AT RISK', stock: 78, fuel: 64, alerts: 'Switches below par soon' },
  { name: 'Van 3', crew: 'Walter + Mario', template: 'Support / Installation', sector: 'Santa Cruz', jobs: 'Support WO-2051', readiness: 'READY', stock: 91, fuel: 81, alerts: 'Support assignment' },
  { name: 'Van 4', crew: 'Goyo + Aldrich', template: 'Commercial', sector: 'Oranjestad', jobs: '5 / 6', readiness: 'READY', stock: 94, fuel: 58, alerts: '0 critical' },
];

export const tools = [
  { id: 'TLS-001', name: 'Vacuum Pump 7 CFM', type: 'Vacuum', custody: 'Van 1', condition: 'Good', calibration: 'N/A', value: 'Afl. 1,250', next: 'Inspection Sep 01' },
  { id: 'TLS-004', name: 'Fieldpiece Micron Gauge', type: 'Measurement', custody: 'Van 4', condition: 'Good', calibration: 'Current', value: 'Afl. 480', next: 'Calibration Nov 15' },
  { id: 'TLS-007', name: 'Recovery Machine', type: 'Recovery', custody: 'Main Warehouse', condition: 'Good', calibration: 'N/A', value: 'Afl. 2,100', next: 'Available' },
  { id: 'TLS-011', name: 'Makita Drill Set', type: 'Power Tool', custody: 'Van 2', condition: 'Serviceable', calibration: 'N/A', value: 'Afl. 850', next: 'Battery review' },
  { id: 'TLS-015', name: 'Digital Manifold', type: 'Measurement', custody: 'Van 3', condition: 'Good', calibration: 'Due Soon', value: 'Afl. 950', next: 'Calibration Aug 28' },
];
