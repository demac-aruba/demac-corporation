export const integrationHealth = [
  { name: 'Firebase', category: 'Core Data', status: 'Pending', detail: 'Adapter contracts ready; production schema/rules intentionally not changed yet.', environment: 'Not connected' },
  { name: 'QuickBooks Online', category: 'Accounting', status: 'Pending', detail: 'Accounting remains system of record; sync adapter will post governed invoices/payments/expenses.', environment: 'Not connected' },
  { name: 'Meta WhatsApp', category: 'Communications', status: 'Pending', detail: 'Communication Center and AI Agent are ready for provider adapters and production permissions.', environment: 'Verification / API pending' },
  { name: 'OpenAI', category: 'AI', status: 'Pending', detail: 'Executive and customer-service tool contracts are defined; production tool calls remain disabled.', environment: 'Server key required' },
  { name: 'Aruba Bank Gateway', category: 'Banking', status: 'Design Ready', detail: 'Read-only transaction staging with CSV/Excel reconciliation and human-controlled allocation.', environment: 'No official API' },
  { name: 'Voice / PBX', category: 'Telephony', status: 'Design Ready', detail: 'Unified presence and queue architecture prepared for SIP/PBX/WhatsApp Calling integration.', environment: 'Carrier validation pending' },
];

export const automationRules = [
  { id: 'AUTO-001', name: 'Appointment reminder', trigger: '1 day before confirmed appointment', action: 'Queue approved WhatsApp reminder', owner: 'Operations', mode: 'Human approved', enabled: true },
  { id: 'AUTO-002', name: 'Maintenance renewal follow-up', trigger: 'Asset reaches configured maintenance window', action: 'Create follow-up task / communication queue item', owner: 'Operations', mode: 'Human approved', enabled: true },
  { id: 'AUTO-003', name: 'Van stock replenishment', trigger: 'Projected stock falls below location minimum', action: 'Create suggested warehouse transfer', owner: 'Warehouse', mode: 'Prepare only', enabled: true },
  { id: 'AUTO-004', name: 'Payment match suggestion', trigger: 'New bank transaction staged', action: 'Rank invoice allocation candidates', owner: 'Finance', mode: 'Prepare only', enabled: true },
  { id: 'AUTO-005', name: 'Commercial escalation', trigger: 'Complaint / payment dispute / low AI confidence', action: 'Route conversation to human queue with handoff summary', owner: 'Operations', mode: 'Automatic routing', enabled: true },
  { id: 'AUTO-006', name: 'Executive cash-risk alert', trigger: 'Forecasted reserve crosses management threshold', action: 'Create Critical management alert', owner: 'Owner', mode: 'Automatic alert', enabled: false },
];

export const auditEvents = [
  { time: '22:51', actor: 'System', area: 'Deployment', action: 'ERP Next promoted to live application', object: 'Production web', result: 'Success', severity: 'Info' },
  { time: '22:54', actor: 'System', area: 'PWA Cache', action: 'Legacy service worker cleanup deployed', object: 'Web clients', result: 'Success', severity: 'Info' },
  { time: '23:06', actor: 'Owner Preview', area: 'Executive AI', action: 'Read-only management intelligence enabled', object: 'EAI-001…010', result: 'Preview', severity: 'Info' },
  { time: '23:10', actor: 'System', area: 'Projects', action: 'Project management workspace enabled', object: 'PRJ module', result: 'Preview', severity: 'Info' },
  { time: '23:12', actor: 'System', area: 'Security', action: 'Production external writes remain disabled', object: 'Firebase / QBO / Meta / Bank', result: 'Protected', severity: 'Control' },
];
