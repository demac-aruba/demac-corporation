export const leads = [
  { name: 'Maria Rodriguez', source: 'WhatsApp', request: 'Service · 2 AC units', area: 'Palm Beach', stage: 'Qualified', owner: 'Operations', next: 'Offer valid slots after 10:00', age: '18m' },
  { name: 'ABC Offices', source: 'Phone', request: 'Commercial maintenance plan', area: 'Oranjestad', stage: 'Estimate Needed', owner: 'Sales', next: 'Site survey', age: '1h' },
  { name: 'Private Residence', source: 'Referral', request: 'VRF consultation', area: 'Noord', stage: 'Contacted', owner: 'Sales', next: 'Qualify project scope', age: '3h' },
  { name: 'Island Retail N.V.', source: 'Website', request: 'Replace 3 split systems', area: 'Santa Cruz', stage: 'New', owner: 'Unassigned', next: 'Initial contact', age: '26m' },
];

export const opportunities = [
  { name: 'Ocean Breeze anti-corrosive coating', customer: 'Ocean Breeze Residence', stage: 'Qualified', value: 'Afl. 1,450', probability: 70, close: 'Aug 15', next: 'Follow up technician recommendation', owner: 'Operations' },
  { name: 'ABC Offices maintenance agreement', customer: 'ABC Offices', stage: 'Estimate Needed', value: 'Afl. 18,000', probability: 45, close: 'Aug 28', next: 'Complete asset survey', owner: 'Sales' },
  { name: 'Residential VRF package', customer: 'Private Residence', stage: 'Proposal', value: 'Afl. 118,000', probability: 60, close: 'Sep 05', next: 'Review proposal options', owner: 'Sales' },
  { name: '3-unit replacement', customer: 'Island Retail N.V.', stage: 'Qualified', value: 'Afl. 8,900', probability: 50, close: 'Aug 22', next: 'Confirm electrical/site conditions', owner: 'Sales' },
];

export const estimates = [
  { number: 'EST-2041', customer: 'Private Residence', scope: 'VRF installation package', version: 'v3', total: 'Afl. 118,000', margin: '31%', status: 'Sent', next: 'Client review', age: '1d' },
  { number: 'EST-2047', customer: 'ABC Offices', scope: 'Annual maintenance agreement', version: 'v1', total: 'Afl. 18,000', margin: '44%', status: 'Draft', next: 'Complete equipment count', age: '3h' },
  { number: 'EST-2050', customer: 'Island Retail N.V.', scope: '3 split replacements', version: 'v2', total: 'Afl. 8,900', margin: '38%', status: 'Internal Review', next: 'Approve pricing', age: '5h' },
  { number: 'EST-2038', customer: 'Ocean Breeze Residence', scope: 'Anti-corrosive coating', version: 'v1', total: 'Afl. 1,450', margin: '52%', status: 'Accepted', next: 'Schedule work', age: '2d' },
];

export const maintenance = [
  { customer: 'Ocean Breeze Residence', asset: 'Living Room · 24K Split', due: 'Aug 18', interval: '6 months', status: 'Due Soon', value: 'Afl. 145', last: 'Feb 18' },
  { customer: 'La Salle College', asset: 'Monthly filter program', due: 'Aug 14', interval: 'Monthly', status: 'Due Soon', value: 'Afl. 1,200', last: 'Jul 14' },
  { customer: 'ABC Offices', asset: 'Commercial site · 8 assets', due: 'Sep 01', interval: 'Quarterly', status: 'Contract Pending', value: 'Afl. 4,500', last: '—' },
  { customer: 'Palm Beach Residence', asset: 'Bedroom · 18K Split', due: 'Aug 10', interval: '6 months', status: 'Overdue', value: 'Afl. 135', last: 'Feb 10' },
];

export const invoices = [
  { number: 'INV-1902', customer: 'OCA Aruba', issued: 'Aug 04', due: 'Aug 18', total: 'Afl. 5,240', paid: 'Afl. 5,240', balance: 'Afl. 0', status: 'Paid' },
  { number: 'INV-1881', customer: 'Ocean Breeze Residence', issued: 'Jul 28', due: 'Aug 11', total: 'Afl. 5,000', paid: 'Afl. 5,000', balance: 'Afl. 0', status: 'Paid' },
  { number: 'INV-1884', customer: 'Ocean Breeze Residence', issued: 'Jul 28', due: 'Aug 11', total: 'Afl. 8,000', paid: 'Afl. 8,000', balance: 'Afl. 0', status: 'Paid' },
  { number: 'INV-1888', customer: 'Ocean Breeze Residence', issued: 'Jul 28', due: 'Aug 11', total: 'Afl. 1,000', paid: 'Afl. 0', balance: 'Afl. 1,000', status: 'Open' },
  { number: 'INV-1911', customer: 'On The Rocks', issued: 'Aug 08', due: 'Aug 22', total: 'Afl. 7,600', paid: 'Afl. 3,800', balance: 'Afl. 3,800', status: 'Partial' },
];

export const expenseItems = [
  { vendor: 'HVAC Supply Aruba', description: 'Inventory replenishment', category: 'Inventory Purchase', total: 'Afl. 8,720', evidence: 'Invoice + bank debit', status: 'Matched' },
  { vendor: 'Local Hardware', description: 'Screws, tape and wiring', category: 'Consumables', total: 'Afl. 250', evidence: 'Receipt photo', status: 'Classified' },
  { vendor: 'Tool Supplier', description: 'Makita battery', category: 'Company Tool', total: 'Afl. 100', evidence: 'Voice + receipt', status: 'Review' },
  { vendor: 'Fuel Station', description: 'Fleet fuel', category: 'Vehicle Expense', total: 'Afl. 600', evidence: 'Monthly summary', status: 'Posted' },
];
