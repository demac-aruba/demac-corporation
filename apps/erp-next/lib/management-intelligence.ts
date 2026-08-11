export type KpiTone = 'good' | 'warning' | 'danger' | 'neutral';

export type KpiMetric = {
  id: string;
  category: 'Company' | 'Finance' | 'Operations' | 'Sales & CRM' | 'Inventory' | 'Communications';
  label: string;
  value: string;
  target: string;
  progress: number;
  pace: number;
  paceLabel: string;
  forecast: string;
  tone: KpiTone;
  source: string;
  freshness: string;
};

export type ManagementAlert = {
  id: string;
  severity: 'Critical' | 'Warning' | 'Opportunity' | 'Information';
  title: string;
  detail: string;
  owner: string;
  nextAction: string;
  due: string;
};

export type EvidenceItem = {
  label: string;
  value: string;
  detail: string;
  freshness: string;
};

export type ExecutiveScenario = {
  id: string;
  question: string;
  answer: string;
  confidence: 'High' | 'Medium';
  recommendation: string;
  evidence: EvidenceItem[];
  risks: string[];
};

export const monthProgress = 35;

export const kpiMetrics: KpiMetric[] = [
  { id: 'sales', category: 'Company', label: 'Monthly Sales', value: 'Afl. 82,400', target: 'Afl. 115,000 target', progress: 72, pace: 35, paceLabel: '+37 pts ahead of time', forecast: 'Afl. 126K projected', tone: 'good', source: 'Invoices + accepted sales', freshness: '2 min ago' },
  { id: 'collections', category: 'Finance', label: 'Collections', value: 'Afl. 68,200', target: 'Afl. 98,000 target', progress: 70, pace: 35, paceLabel: '+35 pts ahead of time', forecast: 'Afl. 104K projected', tone: 'good', source: 'Payment ledger + bank staging', freshness: '4 min ago' },
  { id: 'expenses', category: 'Finance', label: 'Expense Budget', value: 'Afl. 40,500', target: 'Afl. 50,000 budget', progress: 81, pace: 35, paceLabel: '46 pts ahead of spend pace', forecast: 'Afl. 61K projected', tone: 'danger', source: 'Expenses + committed purchases', freshness: '6 min ago' },
  { id: 'jobs', category: 'Operations', label: 'Jobs Completed', value: '128', target: '160 monthly target', progress: 80, pace: 35, paceLabel: '+45 pts ahead of time', forecast: '184 projected', tone: 'good', source: 'Closed work orders', freshness: 'Live' },
  { id: 'utilization', category: 'Operations', label: 'Technician Utilization', value: '78%', target: '82% internal target', progress: 95, pace: 100, paceLabel: '4 pts below target', forecast: '80% month-end', tone: 'warning', source: 'Dispatch + labor time', freshness: 'Live' },
  { id: 'margin', category: 'Finance', label: 'Gross Margin', value: '42.8%', target: '40% minimum target', progress: 100, pace: 100, paceLabel: '+2.8 pts above target', forecast: '42.1% month-end', tone: 'good', source: 'Revenue − job/material cost', freshness: '8 min ago' },
  { id: 'ar', category: 'Finance', label: 'Accounts Receivable', value: 'Afl. 37,600', target: 'Afl. 12,100 overdue', progress: 68, pace: 100, paceLabel: '32% overdue exposure', forecast: 'Afl. 24K after expected collections', tone: 'warning', source: 'Invoice + allocation ledger', freshness: '4 min ago' },
  { id: 'equipment-sales', category: 'Sales & CRM', label: 'Equipment Sales', value: 'Afl. 34,700', target: 'Afl. 30,000 minimum', progress: 100, pace: 100, paceLabel: '+15.7% above minimum', forecast: 'Afl. 48K projected', tone: 'good', source: 'Accepted equipment estimates', freshness: '12 min ago' },
  { id: 'service-sales', category: 'Sales & CRM', label: 'Service Revenue', value: 'Afl. 41,800', target: 'Afl. 50,000 target', progress: 84, pace: 35, paceLabel: '+49 pts ahead of time', forecast: 'Afl. 59K projected', tone: 'good', source: 'Service work orders', freshness: '7 min ago' },
  { id: 'inventory-risk', category: 'Inventory', label: 'Inventory Readiness', value: '94%', target: '2 jobs at risk', progress: 94, pace: 100, paceLabel: '6% exception exposure', forecast: 'Replenishment needed within 3 days', tone: 'warning', source: 'Location ledger + booked demand', freshness: 'Live' },
  { id: 'response', category: 'Communications', label: 'First Response', value: '2m 18s', target: '< 3 min target', progress: 100, pace: 100, paceLabel: '42 sec inside SLA', forecast: '2m 25s rolling average', tone: 'good', source: 'Communication Center', freshness: 'Live' },
  { id: 'conversion', category: 'Communications', label: 'Conversation → Booking', value: '38%', target: '35% target', progress: 100, pace: 100, paceLabel: '+3 pts above target', forecast: '39% projected', tone: 'good', source: 'Conversations + appointments', freshness: '15 min ago' },
];

export const managementAlerts: ManagementAlert[] = [
  { id: 'expense-risk', severity: 'Critical', title: 'Expense budget is materially ahead of pace', detail: '81% of monthly budget is consumed while only 35% of the month has elapsed. Current run-rate projects approximately Afl. 61K.', owner: 'Finance', nextAction: 'Review open purchasing commitments and discretionary spend', due: 'Today' },
  { id: 'ar-balance', severity: 'Warning', title: 'Afl. 1,000 customer balance remains', detail: 'Afl. 13,000 was detected against Afl. 14,000 outstanding. Two invoices likely match; one balance remains open.', owner: 'Finance', nextAction: 'Confirm suggested allocation and follow up remaining balance', due: 'Today' },
  { id: 'van-stock', severity: 'Warning', title: 'Van 2 stock forecast below par', detail: '220V switches are projected below minimum before Wednesday bookings based on current reservations.', owner: 'Warehouse', nextAction: 'Transfer 6 switches from Main Warehouse to Van 2', due: 'Before tomorrow 16:00' },
  { id: 'sales-opportunity', severity: 'Opportunity', title: 'Sales are substantially ahead of elapsed-month pace', detail: 'Monthly sales are 72% achieved with 35% of the month elapsed. Collection pace is also strong.', owner: 'Management', nextAction: 'Protect service capacity and maintain collections', due: 'This week' },
  { id: 'maintenance', severity: 'Information', title: '23 maintenance follow-ups become due within 14 days', detail: 'Customers with prior service history are entering their normal maintenance window.', owner: 'Operations', nextAction: 'Stage approved maintenance follow-up queue', due: 'This week' },
];

export const executiveScenarios: ExecutiveScenario[] = [
  {
    id: 'cash-180',
    question: 'Can we safely pay Afl. 180,000 within the next 90 days?',
    answer: 'Not yet under the current base-case forecast. The projected 90-day available cash after payroll, supplier commitments and operating expenses does not provide enough safety margin for an Afl. 180,000 payment.',
    confidence: 'High',
    recommendation: 'Delay the payment, increase collections, or phase the obligation. Re-evaluate when expected receivables and the commercial pipeline convert into collected cash.',
    evidence: [
      { label: 'Cash position', value: 'Afl. 144,000', detail: 'Read-only bank evidence staged in ERP', freshness: '4 min ago' },
      { label: 'Open receivables', value: 'Afl. 37,600', detail: 'Includes Afl. 12,100 overdue', freshness: '4 min ago' },
      { label: 'Open payables', value: 'Afl. 22,800', detail: 'Supplier obligations already recognized', freshness: '8 min ago' },
      { label: '90-day payroll', value: 'Afl. 46,500', detail: 'Forecast from active workforce schedules', freshness: 'Today' },
      { label: 'Purchase commitments', value: 'Afl. 31,200', detail: 'Approved/open purchasing commitments', freshness: '6 min ago' },
      { label: 'Expected collections', value: 'Afl. 86,000', detail: 'Probability-weighted receivable and sales collection forecast', freshness: '12 min ago' },
    ],
    risks: ['Expense run-rate currently exceeds the desired monthly pace.', 'A portion of receivables is overdue and should not be treated as guaranteed cash.', 'Commercial pipeline is useful for forecasting but cannot be counted as bank cash until collected.'],
  },
  {
    id: 'sales-health',
    question: 'Are we on track to hit this month’s sales and service goals?',
    answer: 'Yes. Both total sales and service revenue are materially ahead of elapsed-month pace. Equipment sales have already exceeded the internal Afl. 30,000 minimum benchmark.',
    confidence: 'High',
    recommendation: 'Protect field capacity, avoid overspending to chase additional volume, and keep collections aligned with sales growth.',
    evidence: [
      { label: 'Monthly sales', value: '72%', detail: 'Against 35% elapsed month', freshness: '2 min ago' },
      { label: 'Service revenue', value: '84%', detail: 'Against monthly service target', freshness: '7 min ago' },
      { label: 'Equipment sales', value: 'Afl. 34,700', detail: 'Above Afl. 30,000 minimum benchmark', freshness: '12 min ago' },
      { label: 'Collections', value: '70%', detail: 'Collection target progress', freshness: '4 min ago' },
    ],
    risks: ['Expense budget is running faster than revenue should justify.', 'Inventory readiness has two upcoming jobs at risk.'],
  },
  {
    id: 'operations-risk',
    question: 'What needs my attention today?',
    answer: 'Three items deserve management attention: expense pace, the remaining Afl. 1,000 customer balance, and projected Van 2 stock shortage. Sales performance itself is strong and does not require intervention today.',
    confidence: 'High',
    recommendation: 'Prioritize the critical finance alert, confirm the payment allocation, then approve the warehouse-to-van replenishment before tomorrow afternoon.',
    evidence: [
      { label: 'Critical alerts', value: '1', detail: 'Expense budget pace', freshness: 'Live' },
      { label: 'Warnings', value: '2', detail: 'Customer balance + Van 2 stock', freshness: 'Live' },
      { label: 'Opportunities', value: '1', detail: 'Sales ahead of pace', freshness: 'Live' },
      { label: 'Jobs at risk', value: '2', detail: 'Material readiness exceptions', freshness: 'Live' },
    ],
    risks: ['Ignoring expense pace may create a month-end cash squeeze.', 'A stock exception can become a customer delay if replenishment is not completed before dispatch.'],
  },
];
