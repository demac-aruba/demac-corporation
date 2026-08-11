export const employees = [
  { name: 'Miguel Reyes', role: 'Senior Technician', team: 'Van 1', status: 'Working', utilization: 82, skills: ['Service', 'Diagnostics', 'Installation'], overtime: '1h 20m', next: 'Noord · 13:30' },
  { name: 'Ronald Mauri', role: 'HVAC Technician', team: 'Van 2', status: 'Working', utilization: 78, skills: ['Service', 'Installation'], overtime: '0h 40m', next: 'Palm Beach · 13:30' },
  { name: 'Edwin Calvo', role: 'HVAC Technician', team: 'Van 2', status: 'Working', utilization: 76, skills: ['Service', 'Installation'], overtime: '0h 40m', next: 'Palm Beach · 13:30' },
  { name: 'Walter', role: 'HVAC Technician', team: 'Van 3', status: 'Support', utilization: 71, skills: ['Service', 'Deep Cleaning'], overtime: '0h 00m', next: 'Support WO-2051' },
  { name: 'Mario Cornejo', role: 'HVAC Technician', team: 'Van 3', status: 'Support', utilization: 74, skills: ['Service', 'Installation'], overtime: '0h 15m', next: 'Support WO-2051' },
  { name: 'José Gregorio', role: 'HVAC Technician', team: 'Van 4', status: 'Working', utilization: 80, skills: ['Service', 'Commercial'], overtime: '1h 05m', next: 'Oranjestad · 14:30' },
  { name: 'Aldrich', role: 'HVAC Technician', team: 'Van 4', status: 'Working', utilization: 79, skills: ['Service', 'Commercial'], overtime: '1h 05m', next: 'Oranjestad · 14:30' },
];

export const projects = [
  { code: 'PRJ-2608-01', name: 'Renaissance Curaçao HVAC Assessment', client: 'Renaissance Wind Creek Curaçao', type: 'Commercial Assessment', stage: 'Planning', progress: 34, budget: 'Afl. 42K', committed: 'Afl. 12.8K', forecast: 'Afl. 39K', margin: '38%', nextMilestone: 'Travel / field assessment', health: 'On Track' },
  { code: 'PRJ-2608-02', name: 'Residential VRF Installation', client: 'Private Residence', type: 'VRF Installation', stage: 'Procurement', progress: 48, budget: 'Afl. 118K', committed: 'Afl. 61K', forecast: 'Afl. 114K', margin: '31%', nextMilestone: 'Equipment receiving', health: 'On Track' },
  { code: 'PRJ-2607-06', name: 'On The Rocks Corrective HVAC', client: 'On The Rocks', type: 'Commercial Repair', stage: 'Execution', progress: 76, budget: 'Afl. 16.5K', committed: 'Afl. 13.9K', forecast: 'Afl. 17.2K', margin: '24%', nextMilestone: 'Outdoor unit reorganization', health: 'At Risk' },
];

export const reportCatalog = [
  { group: 'Executive', name: 'Monthly Management Pack', description: 'Sales, cash, AR/AP, expenses, margin, jobs, utilization, inventory and alert summary.', cadence: 'Monthly', owner: 'Owner' },
  { group: 'Operations', name: 'Dispatch & Capacity', description: 'Van utilization, jobs completed, travel pressure, readiness and callback exceptions.', cadence: 'Daily', owner: 'Operations' },
  { group: 'Finance', name: 'Collections & Receivables', description: 'Customer balances, aging, detected payments, allocation review and overdue risk.', cadence: 'Daily', owner: 'Finance' },
  { group: 'Inventory', name: 'Warehouse & Van Variance', description: 'Par shortages, transfers, cycle-count variance, job reservations and forecast demand.', cadence: 'Weekly', owner: 'Warehouse' },
  { group: 'Customer Service', name: 'Communication Performance', description: 'Response time, booking conversion, queue aging, escalations and AI-assist rate.', cadence: 'Weekly', owner: 'Operations' },
  { group: 'Projects', name: 'Project Margin & Commitments', description: 'Budget, committed cost, actual cost, forecast-at-completion and milestone health.', cadence: 'Weekly', owner: 'Project Manager' },
];
