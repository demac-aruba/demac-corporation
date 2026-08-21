import type { BrowserCrmAssetIdentity, BrowserCrmCustomerIdentity, BrowserCrmSiteIdentity, BrowserCustomerMasterSnapshot } from './browser-crm';
import type { BrowserFieldExecutionRecord, BrowserOfficeReviewRecord, FieldEquipmentProgress } from './browser-field';
import { BROWSER_DISPATCH_RELEASES_KEY, deriveBrowserJobReadiness, readinessRiskSignature, type BrowserDispatchAtRiskRelease } from './browser-job-readiness';
import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from './browser-operational';
import { browserKeys } from './browser-store';
import { BROWSER_WORK_ORDER_SCOPE_KEY, type BrowserWorkOrderScopeRecord } from './browser-workorder-scope';
import { BROWSER_WORKFORCE_KEY, type BrowserWorkforceEmployee } from './browser-workforce';
import { BROWSER_TOOL_ASSETS_KEY, BROWSER_TOOL_REQUIREMENTS_KEY, type BrowserToolAsset, type BrowserToolRequirementPolicy } from './browser-tools';
import { BROWSER_SITE_ACCESS_PLANS_KEY, type BrowserSiteAccessPlan } from './browser-site-access';
import { BROWSER_COMMERCIAL_CLEARANCES_KEY, BROWSER_COMMERCIAL_POLICIES_KEY, type BrowserCommercialClearanceRecord, type BrowserCommercialPolicy } from './browser-commercial-clearance';
import type { BrowserDispatchAssignmentState } from './browser-dispatch-operations';
import type { BrowserDispatchEvent } from './browser-dispatch-history';
import { BROWSER_REPORT_DELIVERIES_KEY, type BrowserReportDeliveryRecord } from './browser-report-delivery';
import { BROWSER_BILLING_DRAFTS_KEY, buildBillingDraft, type BrowserBillingDraft } from './browser-billing';
import { BROWSER_BANK_PAYMENTS_KEY, BROWSER_PAYMENT_ALLOCATIONS_KEY, BROWSER_RECEIVABLES_KEY, applyAllocationSuggestion, derivePreviewReceivables, suggestPaymentAllocation, type BrowserBankPayment, type BrowserPaymentAllocation, type BrowserReceivableInvoice } from './browser-receivables';
import type { WorkPresetId } from './scheduling';

export const DEMO_DATA_DATE = '2026-08-11';
export const DEMO_DATASET_ID = 'full-day-2026-08-11-v1';
export const DEMO_CONTROL_KEY = 'demac.erp-next.demo-data.control.v1';
export const DEMO_PREFERENCE_KEY = 'demac.erp-next.demo-data.preference.v1';

export type DemoDataControl = {
  active: true;
  datasetId: typeof DEMO_DATASET_ID;
  installedAt: string;
  backups: Record<string, string | null>;
};

export type DemoDataState = {
  ready: boolean;
  active: boolean;
  datasetId?: string;
  date: string;
  workOrders: number;
  customers: number;
};

type DemoJobSeed = {
  vanId: 'VAN-1' | 'VAN-2' | 'VAN-3' | 'VAN-4';
  slotIndex: number;
  customer: string;
  site: string;
  sector: 'Noord' | 'Palm Beach' | 'Oranjestad' | 'Santa Cruz' | 'Paradera' | 'San Nicolas' | 'Savaneta';
  address: string;
  capacity: '12000 BTU' | '18000 BTU' | '24000 BTU';
  presetId: WorkPresetId;
  customerType: 'Residential' | 'Commercial';
};

const slotTimes = [
  ['08:30', '09:30'],
  ['09:30', '10:30'],
  ['10:30', '11:30'],
  ['13:30', '14:30'],
  ['14:30', '15:30'],
  ['15:30', '16:30'],
] as const;

const jobSeeds: DemoJobSeed[] = [
  { vanId: 'VAN-1', slotIndex: 0, customer: 'Ocean Palm Residence', site: 'Main Residence', sector: 'Noord', address: 'Demo Noord 11, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-1', slotIndex: 1, customer: 'Tierra Azul Home', site: 'Family House', sector: 'Noord', address: 'Demo Noord 18, Aruba', capacity: '18000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-1', slotIndex: 2, customer: 'Alto Vista Family House', site: 'Alto Vista Property', sector: 'Noord', address: 'Demo Alto Vista 23, Aruba', capacity: '12000 BTU', presetId: 'diagnostic', customerType: 'Residential' },
  { vanId: 'VAN-1', slotIndex: 3, customer: 'Palm Garden Villa', site: 'Villa 4', sector: 'Palm Beach', address: 'Demo Palm Beach 41, Aruba', capacity: '24000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-1', slotIndex: 4, customer: 'Sunset Cove Residence', site: 'Residence A', sector: 'Palm Beach', address: 'Demo Palm Beach 52, Aruba', capacity: '18000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-1', slotIndex: 5, customer: 'Malmok Breeze Home', site: 'Residence', sector: 'Palm Beach', address: 'Demo Palm Beach 63, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },

  { vanId: 'VAN-2', slotIndex: 0, customer: 'Harbor Office Suites', site: 'Suite 201', sector: 'Oranjestad', address: 'Demo Oranjestad 101, Aruba', capacity: '18000 BTU', presetId: 'standard_service', customerType: 'Commercial' },
  { vanId: 'VAN-2', slotIndex: 1, customer: 'Caya Central Residence', site: 'Residence', sector: 'Oranjestad', address: 'Demo Oranjestad 114, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-2', slotIndex: 2, customer: 'Plaza Norte Boutique', site: 'Retail Floor', sector: 'Oranjestad', address: 'Demo Oranjestad 128, Aruba', capacity: '24000 BTU', presetId: 'diagnostic', customerType: 'Commercial' },
  { vanId: 'VAN-2', slotIndex: 3, customer: 'Downtown Dental Studio', site: 'Treatment Wing', sector: 'Oranjestad', address: 'Demo Oranjestad 142, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Commercial' },
  { vanId: 'VAN-2', slotIndex: 4, customer: 'Oranjestad Legal Office', site: 'Office Level 2', sector: 'Oranjestad', address: 'Demo Oranjestad 156, Aruba', capacity: '18000 BTU', presetId: 'standard_service', customerType: 'Commercial' },
  { vanId: 'VAN-2', slotIndex: 5, customer: 'Marina View Apartment', site: 'Apartment 6B', sector: 'Oranjestad', address: 'Demo Oranjestad 169, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },

  { vanId: 'VAN-3', slotIndex: 0, customer: 'Santa Cruz Family Home', site: 'Main House', sector: 'Santa Cruz', address: 'Demo Santa Cruz 21, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-3', slotIndex: 1, customer: 'Hooiberg Garden Residence', site: 'Residence', sector: 'Santa Cruz', address: 'Demo Santa Cruz 34, Aruba', capacity: '18000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-3', slotIndex: 2, customer: 'Cas Ariba Mini Market', site: 'Sales Floor', sector: 'Santa Cruz', address: 'Demo Santa Cruz 48, Aruba', capacity: '24000 BTU', presetId: 'diagnostic', customerType: 'Commercial' },
  { vanId: 'VAN-3', slotIndex: 3, customer: 'Paradera Hills Home', site: 'Family Residence', sector: 'Paradera', address: 'Demo Paradera 17, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-3', slotIndex: 4, customer: 'Piedra Plat Residence', site: 'Residence', sector: 'Paradera', address: 'Demo Paradera 29, Aruba', capacity: '18000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-3', slotIndex: 5, customer: 'Hooiberg View Villa', site: 'Villa', sector: 'Paradera', address: 'Demo Paradera 43, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },

  { vanId: 'VAN-4', slotIndex: 0, customer: 'San Nicolas Grocery', site: 'Grocery Floor', sector: 'San Nicolas', address: 'Demo San Nicolas 12, Aruba', capacity: '18000 BTU', presetId: 'standard_service', customerType: 'Commercial' },
  { vanId: 'VAN-4', slotIndex: 1, customer: 'Lago Heights Residence', site: 'Residence', sector: 'San Nicolas', address: 'Demo San Nicolas 26, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-4', slotIndex: 2, customer: 'Seroe Colorado Home', site: 'Main House', sector: 'San Nicolas', address: 'Demo San Nicolas 39, Aruba', capacity: '24000 BTU', presetId: 'diagnostic', customerType: 'Residential' },
  { vanId: 'VAN-4', slotIndex: 3, customer: 'Savaneta Seaside House', site: 'Seaside Residence', sector: 'Savaneta', address: 'Demo Savaneta 15, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-4', slotIndex: 4, customer: 'Pos Chiquito Residence', site: 'Residence', sector: 'Savaneta', address: 'Demo Savaneta 28, Aruba', capacity: '18000 BTU', presetId: 'standard_service', customerType: 'Residential' },
  { vanId: 'VAN-4', slotIndex: 5, customer: 'Mangel Halto Guesthouse', site: 'Guesthouse', sector: 'Savaneta', address: 'Demo Savaneta 44, Aruba', capacity: '12000 BTU', presetId: 'standard_service', customerType: 'Commercial' },
];

const submittedIds = new Set([
  'DEMO-WO-V1-01', 'DEMO-WO-V1-02',
  'DEMO-WO-V2-01', 'DEMO-WO-V2-02', 'DEMO-WO-V2-03',
  'DEMO-WO-V3-01',
  'DEMO-WO-V4-01', 'DEMO-WO-V4-02',
]);

const inFieldIds = new Set(['DEMO-WO-V1-03', 'DEMO-WO-V3-02']);
const blockedAccessId = 'DEMO-WO-V3-03';
const openRiskId = 'DEMO-WO-V4-03';
const releasedRiskId = 'DEMO-WO-V2-04';

function json(value: unknown) {
  return JSON.stringify(value);
}

function readRaw(key: string) {
  return window.localStorage.getItem(key);
}

function writeRaw(key: string, value: unknown) {
  window.localStorage.setItem(key, json(value));
}

function isoAt(time: string, offsetMinutes = 0) {
  const [hourText, minuteText] = time.split(':');
  const base = new Date(`${DEMO_DATA_DATE}T${hourText}:${minuteText}:00-04:00`);
  base.setUTCMinutes(base.getUTCMinutes() + offsetMinutes);
  return base.toISOString();
}

function codeFor(seed: DemoJobSeed) {
  return `${seed.vanId.replace('VAN-', 'V')}-${String(seed.slotIndex + 1).padStart(2, '0')}`;
}

function customerId(seed: DemoJobSeed) {
  return `DEMO-CUS-${codeFor(seed)}`;
}

function siteId(seed: DemoJobSeed) {
  return `DEMO-SITE-${codeFor(seed)}`;
}

function assetId(seed: DemoJobSeed) {
  return `DEMO-AST-${codeFor(seed)}`;
}

function appointmentId(seed: DemoJobSeed) {
  return `DEMO-APT-${codeFor(seed)}`;
}

function workOrderId(seed: DemoJobSeed) {
  return `DEMO-WO-${codeFor(seed)}`;
}

function description(seed: DemoJobSeed) {
  return seed.presetId === 'diagnostic' ? 'A/C diagnostic / checkup' : 'Standard service — 1 A/C unit';
}

function intendedReadiness(id: string) {
  if (id === blockedAccessId) return 'blocked' as const;
  if (id === openRiskId || id === releasedRiskId) return 'at_risk' as const;
  return 'ready' as const;
}

function buildCrm() {
  const customers: BrowserCrmCustomerIdentity[] = [];
  const masters = new Map<string, BrowserCustomerMasterSnapshot>();
  for (const [index, seed] of jobSeeds.entries()) {
    const cId = customerId(seed);
    const sId = siteId(seed);
    const aId = assetId(seed);
    const site: BrowserCrmSiteIdentity = {
      id: sId,
      name: seed.site,
      address: seed.address,
      sector: seed.sector,
      gac: `DEMO-GAC-${String(index + 1).padStart(3, '0')}`,
      access: seed.customerType === 'Commercial' ? 'Report to front desk / on-site contact.' : 'Customer expected on site.',
    };
    const asset: BrowserCrmAssetIdentity = {
      id: aId,
      site: seed.site,
      type: 'Split',
      name: `Living/Work Area A/C ${index + 1}`,
      brand: 'DemoCool',
      capacity: seed.capacity,
      serial: `DEMO-SN-${String(index + 1).padStart(4, '0')}`,
      status: 'Active',
    };
    customers.push({
      id: cId,
      name: seed.customer,
      type: seed.customerType,
      location: seed.sector,
      phone: `+297 000${String(index + 1).padStart(4, '0')}`,
      email: `demo.customer.${String(index + 1).padStart(2, '0')}@example.com`,
    });
    masters.set(cId, { contacts: [], sites: [site], assets: [asset] });
  }
  return { customers, masters };
}

function buildAppointmentsAndOrders() {
  const appointments: BrowserAppointmentRecord[] = [];
  const workOrders: BrowserWorkOrderRecord[] = [];
  for (const seed of jobSeeds) {
    const [start, end] = slotTimes[seed.slotIndex];
    const woId = workOrderId(seed);
    const aptId = appointmentId(seed);
    const readiness = intendedReadiness(woId);
    const assignmentId = `DEMO-ASG-${codeFor(seed)}`;
    appointments.push({
      id: aptId,
      dateKey: DEMO_DATA_DATE,
      customerId: customerId(seed),
      siteId: siteId(seed),
      customer: seed.customer,
      site: seed.site,
      sector: seed.sector,
      presetId: seed.presetId,
      totalQuantity: 1,
      customerFacingDescription: description(seed),
      technicianInstructions: seed.customerType === 'Commercial' ? 'Check in with the on-site contact before beginning work.' : 'Protect the immediate work area and confirm the unit with the customer.',
      status: 'confirmed',
      assignments: [{
        dateKey: DEMO_DATA_DATE,
        id: assignmentId,
        customer: seed.customer,
        site: seed.site,
        sector: seed.sector,
        start,
        end,
        segment: seed.slotIndex < 3 ? 'am' : 'pm',
        vanId: seed.vanId,
        presetId: seed.presetId,
        quantity: 1,
        status: 'confirmed',
        readiness,
        isPrimaryAssignment: true,
        customerCommunicationOwner: true,
      }],
      primaryVanId: seed.vanId,
      createdAt: isoAt('17:30', -24 * 60),
      confirmedAt: isoAt('18:05', -24 * 60),
      workOrderId: woId,
    });
    workOrders.push({
      id: woId,
      appointmentId: aptId,
      customerId: customerId(seed),
      siteId: siteId(seed),
      customer: seed.customer,
      site: seed.site,
      sector: seed.sector,
      presetId: seed.presetId,
      totalQuantity: 1,
      customerFacingDescription: description(seed),
      technicianInstructions: seed.customerType === 'Commercial' ? 'Check in with the on-site contact before beginning work.' : 'Protect the immediate work area and confirm the unit with the customer.',
      scheduledDate: DEMO_DATA_DATE,
      scheduledStart: start,
      scheduledEnd: end,
      primaryVanId: seed.vanId,
      readiness,
      lifecycle: 'scheduled',
      assignments: [{ vanId: seed.vanId, role: 'primary', quantity: 1, customerCommunicationOwner: true }],
      createdAt: isoAt('18:06', -24 * 60),
    });
  }
  return { appointments, workOrders };
}

function buildScopes(): BrowserWorkOrderScopeRecord[] {
  return jobSeeds.map((seed) => ({
    workOrderId: workOrderId(seed),
    customerId: customerId(seed),
    siteId: siteId(seed),
    expectedQuantity: 1,
    items: [{
      assetId: assetId(seed),
      name: `Living/Work Area A/C ${jobSeeds.indexOf(seed) + 1}`,
      type: 'Split',
      capacity: seed.capacity,
      serial: `DEMO-SN-${String(jobSeeds.indexOf(seed) + 1).padStart(4, '0')}`,
      source: 'registered_asset',
    }],
    mode: 'registered_assets',
    status: 'complete',
    updatedAt: isoAt('18:15', -24 * 60),
  }));
}

function buildWorkforce(): BrowserWorkforceEmployee[] {
  const vanIds = ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4'] as const;
  return vanIds.flatMap((vanId, index) => [
    { id: `DEMO-EMP-${index + 1}A`, name: `Demo Technician ${index + 1}A`, role: 'HVAC Technician', vanId, active: true, skills: ['Service', 'Diagnostics', 'Deep Cleaning', 'Installation'], skillsVerified: true, source: 'operator', updatedAt: isoAt('07:30') },
    { id: `DEMO-EMP-${index + 1}B`, name: `Demo Technician ${index + 1}B`, role: 'HVAC Technician', vanId, active: true, skills: ['Service', 'Diagnostics'], skillsVerified: true, source: 'operator', updatedAt: isoAt('07:30') },
  ]);
}

function buildToolAssets(): BrowserToolAsset[] {
  const vanIds = ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4'] as const;
  return vanIds.flatMap((vanId, index) => [
    { id: `DEMO-TOOL-${index + 1}-SERVICE`, name: `Demo Service Toolkit ${index + 1}`, toolClass: 'Service Toolkit', locationId: vanId, status: 'available', verified: true, serialOrQr: `DEMO-QR-ST-${index + 1}`, updatedAt: isoAt('07:20') },
    { id: `DEMO-TOOL-${index + 1}-MANIFOLD`, name: `Demo Manifold Set ${index + 1}`, toolClass: 'Manifold / Gauge Set', locationId: vanId, status: 'available', verified: true, serialOrQr: `DEMO-QR-MF-${index + 1}`, calibrationDueAt: '2027-08-11T00:00:00.000Z', updatedAt: isoAt('07:20') },
  ]);
}

function buildToolPolicies(): BrowserToolRequirementPolicy[] {
  return [
    { presetId: 'standard_service', requiredClasses: ['Service Toolkit'], coverageMode: 'per_assigned_van', reviewed: true, updatedAt: isoAt('07:15'), updatedBy: 'Demo Operations' },
    { presetId: 'diagnostic', requiredClasses: ['Manifold / Gauge Set'], coverageMode: 'per_assigned_van', reviewed: true, updatedAt: isoAt('07:15'), updatedBy: 'Demo Operations' },
  ];
}

function buildAccessPlans(): BrowserSiteAccessPlan[] {
  return jobSeeds
    .filter((seed) => workOrderId(seed) !== openRiskId)
    .map((seed) => {
      const id = workOrderId(seed);
      if (id === blockedAccessId) {
        return { workOrderId: id, method: 'gate_or_credential', status: 'blocked', contactName: 'Demo Site Contact', instructions: 'Gate credential is missing for this test scenario.', sensitiveCredentialState: 'missing', updatedAt: isoAt('07:40'), updatedBy: 'Demo Operations' };
      }
      return { workOrderId: id, method: seed.customerType === 'Commercial' ? 'security_desk' : 'customer_present', status: 'confirmed', contactName: seed.customerType === 'Commercial' ? 'Demo Front Desk' : 'Demo Customer', contactPhone: '+297 0009999', instructions: seed.customerType === 'Commercial' ? 'Report to the front desk on arrival.' : 'Customer confirmed they will be present.', sensitiveCredentialState: 'not_required', updatedAt: isoAt('07:40'), updatedBy: 'Demo Operations' };
    });
}

function buildCommercialPolicies(): BrowserCommercialPolicy[] {
  return [
    { presetId: 'standard_service', mode: 'no_preclearance', reviewed: true, updatedAt: isoAt('07:10'), updatedBy: 'Demo Finance' },
    { presetId: 'diagnostic', mode: 'no_preclearance', reviewed: true, updatedAt: isoAt('07:10'), updatedBy: 'Demo Finance' },
  ];
}

function buildFieldEquipment(seed: DemoJobSeed, status: 'in_progress' | 'complete'): FieldEquipmentProgress[] {
  return [{
    assetId: assetId(seed),
    name: `Living/Work Area A/C ${jobSeeds.indexOf(seed) + 1}`,
    type: 'Split',
    capacity: seed.capacity,
    serial: `DEMO-SN-${String(jobSeeds.indexOf(seed) + 1).padStart(4, '0')}`,
    status,
    beforePhoto: true,
    afterPhoto: status === 'complete',
    gaugePhoto: true,
    refrigerantState: 'normal',
    measurement: status === 'complete' ? 'Demo pressure/temperature reading recorded' : 'Demo work in progress',
    note: 'Fictitious field evidence for visual system testing only.',
  }];
}

function buildFieldExecutions(): BrowserFieldExecutionRecord[] {
  return jobSeeds.flatMap((seed) => {
    const id = workOrderId(seed);
    if (!submittedIds.has(id) && !inFieldIds.has(id)) return [];
    const [start, end] = slotTimes[seed.slotIndex];
    const submitted = submittedIds.has(id);
    return [{
      workOrderId: id,
      appointmentId: appointmentId(seed),
      customerId: customerId(seed),
      siteId: siteId(seed),
      technicianStatus: submitted ? 'submitted' as const : 'in_progress' as const,
      startedAt: isoAt(start, 4),
      startAuthority: 'ready' as const,
      startAuthorityReason: 'All demo readiness dimensions were ready at technician start.',
      submittedAt: submitted ? isoAt(end, -5) : undefined,
      updatedAt: submitted ? isoAt(end, -5) : isoAt('12:20'),
      equipment: buildFieldEquipment(seed, submitted ? 'complete' : 'in_progress'),
      addons: { switches: submitted && seed.slotIndex % 2 === 0 ? 1 : 0, brackets: 0, armaflex: 0, refrigerantLb: 0 },
      voiceSeconds: submitted ? 34 : 12,
      voiceTranscriptionStatus: submitted ? 'transcribed' as const : 'queued' as const,
      technicianSummary: submitted ? 'Demo service completed; unit operating normally after service.' : 'Demo technician is still working on the unit.',
    }];
  });
}

function buildOfficeReviews(executions: BrowserFieldExecutionRecord[], workOrders: BrowserWorkOrderRecord[]): BrowserOfficeReviewRecord[] {
  const statusById = new Map<string, BrowserOfficeReviewRecord['status']>([
    ['DEMO-WO-V1-01', 'approved'], ['DEMO-WO-V1-02', 'pending'],
    ['DEMO-WO-V2-01', 'approved'], ['DEMO-WO-V2-02', 'pending'], ['DEMO-WO-V2-03', 'returned'],
    ['DEMO-WO-V3-01', 'approved'],
    ['DEMO-WO-V4-01', 'approved'], ['DEMO-WO-V4-02', 'returned'],
  ]);
  return executions.filter((execution) => execution.technicianStatus === 'submitted').flatMap((execution) => {
    const order = workOrders.find((candidate) => candidate.id === execution.workOrderId);
    if (!order) return [];
    const status = statusById.get(order.id) ?? 'pending';
    return [{
      id: `DEMO-REV-${order.id}`,
      workOrderId: order.id,
      appointmentId: order.appointmentId,
      customer: order.customer,
      site: order.site,
      submittedAt: execution.submittedAt ?? isoAt(order.scheduledEnd, -5),
      status,
      language: 'English' as const,
      technicianSummary: execution.technicianSummary,
      professionalSummary: `${order.customerFacingDescription} was completed at ${order.site}. This is a fictitious customer-facing report generated only to test the ERP visual workflow.`,
      reviewerNote: status === 'returned' ? 'Demo return: clarify the field note before customer delivery.' : status === 'approved' ? 'Demo office approval.' : undefined,
      reviewedAt: status === 'pending' ? undefined : isoAt(order.scheduledEnd, 8),
    }];
  });
}

function buildReportDeliveries(reviews: BrowserOfficeReviewRecord[]): BrowserReportDeliveryRecord[] {
  return reviews.filter((review) => review.status === 'approved').slice(0, 2).map((review, index) => ({
    id: `DEMO-DEL-${review.workOrderId}`,
    reviewId: review.id,
    workOrderId: review.workOrderId,
    appointmentId: review.appointmentId,
    customer: review.customer,
    site: review.site,
    language: review.language,
    channel: index === 0 ? 'whatsapp' as const : 'email' as const,
    status: 'sent' as const,
    recipient: index === 0 ? '+297 0000000' : 'demo.delivery@example.com',
    sentAt: isoAt('11:50', index * 7),
    sentBy: 'office' as const,
    note: 'Fictitious demo delivery record.',
  }));
}

function buildDispatchStates(): BrowserDispatchAssignmentState[] {
  const readyIds = new Set(['DEMO-WO-V1-04', releasedRiskId, 'DEMO-WO-V4-04']);
  return jobSeeds.filter((seed) => seed.slotIndex >= 3).map((seed) => ({
    id: `${workOrderId(seed)}:${seed.vanId}`,
    workOrderId: workOrderId(seed),
    vanId: seed.vanId,
    stage: readyIds.has(workOrderId(seed)) ? 'ready_to_depart' : 'not_ready',
    updatedAt: isoAt('12:12'),
    updatedBy: 'Demo Operations',
    note: 'Fictitious dispatch status for full-day visual testing.',
  }));
}

function buildDispatchEvents(executions: BrowserFieldExecutionRecord[], workOrders: BrowserWorkOrderRecord[]): BrowserDispatchEvent[] {
  const events: BrowserDispatchEvent[] = [];
  for (const execution of executions) {
    const order = workOrders.find((candidate) => candidate.id === execution.workOrderId);
    if (!order || !execution.startedAt) continue;
    const start = order.scheduledStart;
    const transitions = [
      { fromStage: 'not_ready' as const, toStage: 'ready_to_depart' as const, offset: -20 },
      { fromStage: 'ready_to_depart' as const, toStage: 'departed' as const, offset: -15 },
      { fromStage: 'departed' as const, toStage: 'in_transit' as const, offset: -11 },
      { fromStage: 'in_transit' as const, toStage: 'on_site' as const, offset: -3 },
    ];
    for (const [index, transition] of transitions.entries()) {
      events.push({
        id: `DEMO-DSP-${order.id}-${index + 1}`,
        workOrderId: order.id,
        vanId: order.primaryVanId,
        fromStage: transition.fromStage,
        toStage: transition.toStage,
        occurredAt: isoAt(start, transition.offset),
        actor: 'Demo Operations',
        note: 'Fictitious movement event for visual testing.',
      });
    }
  }
  for (const state of buildDispatchStates().filter((item) => item.stage === 'ready_to_depart')) {
    events.push({ id: `DEMO-DSP-${state.workOrderId}-PREP`, workOrderId: state.workOrderId, vanId: state.vanId, fromStage: 'not_ready', toStage: 'ready_to_depart', occurredAt: isoAt('12:12'), actor: 'Demo Operations', note: 'Afternoon van prepared in demo mode.' });
  }
  return events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function touchedKeys(crm: ReturnType<typeof buildCrm>) {
  return [
    browserKeys.customers,
    ...[...crm.masters.keys()].map((id) => browserKeys.customerMaster(id)),
    browserKeys.appointments,
    browserKeys.workOrders,
    browserKeys.fieldExecutions,
    browserKeys.officeReviews,
    browserKeys.dispatchAssignments,
    browserKeys.dispatchEvents,
    BROWSER_WORK_ORDER_SCOPE_KEY,
    BROWSER_WORKFORCE_KEY,
    BROWSER_TOOL_ASSETS_KEY,
    BROWSER_TOOL_REQUIREMENTS_KEY,
    BROWSER_SITE_ACCESS_PLANS_KEY,
    BROWSER_COMMERCIAL_POLICIES_KEY,
    BROWSER_COMMERCIAL_CLEARANCES_KEY,
    BROWSER_DISPATCH_RELEASES_KEY,
    BROWSER_REPORT_DELIVERIES_KEY,
    BROWSER_BILLING_DRAFTS_KEY,
    BROWSER_RECEIVABLES_KEY,
    BROWSER_BANK_PAYMENTS_KEY,
    BROWSER_PAYMENT_ALLOCATIONS_KEY,
  ];
}

function controlFromStorage(): DemoDataControl | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(DEMO_CONTROL_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as DemoDataControl;
    return parsed?.active ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function getDemoDataState(): DemoDataState {
  if (typeof window === 'undefined') return { ready: false, active: false, date: DEMO_DATA_DATE, workOrders: 0, customers: 0 };
  const control = controlFromStorage();
  return { ready: true, active: control?.datasetId === DEMO_DATASET_ID, datasetId: control?.datasetId, date: DEMO_DATA_DATE, workOrders: control?.datasetId === DEMO_DATASET_ID ? jobSeeds.length : 0, customers: control?.datasetId === DEMO_DATASET_ID ? jobSeeds.length : 0 };
}

function writeBaseDataset() {
  const crm = buildCrm();
  const { appointments, workOrders } = buildAppointmentsAndOrders();
  const scopes = buildScopes();
  const workforce = buildWorkforce();
  const toolAssets = buildToolAssets();
  const toolPolicies = buildToolPolicies();
  const accessPlans = buildAccessPlans();
  const commercialPolicies = buildCommercialPolicies();
  const commercialClearances: BrowserCommercialClearanceRecord[] = [];
  const executions = buildFieldExecutions();
  const reviews = buildOfficeReviews(executions, workOrders);
  const deliveries = buildReportDeliveries(reviews);

  writeRaw(browserKeys.customers, crm.customers);
  for (const [id, master] of crm.masters) writeRaw(browserKeys.customerMaster(id), master);
  writeRaw(browserKeys.appointments, appointments);
  writeRaw(browserKeys.workOrders, workOrders);
  writeRaw(BROWSER_WORK_ORDER_SCOPE_KEY, scopes);
  writeRaw(BROWSER_WORKFORCE_KEY, workforce);
  writeRaw(BROWSER_TOOL_ASSETS_KEY, toolAssets);
  writeRaw(BROWSER_TOOL_REQUIREMENTS_KEY, toolPolicies);
  writeRaw(BROWSER_SITE_ACCESS_PLANS_KEY, accessPlans);
  writeRaw(BROWSER_COMMERCIAL_POLICIES_KEY, commercialPolicies);
  writeRaw(BROWSER_COMMERCIAL_CLEARANCES_KEY, commercialClearances);
  writeRaw(browserKeys.fieldExecutions, executions);
  writeRaw(browserKeys.officeReviews, reviews);
  writeRaw(BROWSER_REPORT_DELIVERIES_KEY, deliveries);
  writeRaw(browserKeys.dispatchAssignments, buildDispatchStates());
  writeRaw(browserKeys.dispatchEvents, buildDispatchEvents(executions, workOrders));
  writeRaw(BROWSER_DISPATCH_RELEASES_KEY, []);

  const releasedOrder = workOrders.find((order) => order.id === releasedRiskId);
  if (releasedOrder) {
    const readiness = deriveBrowserJobReadiness(releasedOrder, { appointments, executions });
    if (readiness.status === 'at_risk') {
      const release: BrowserDispatchAtRiskRelease = {
        id: `DEMO-REL-${releasedOrder.id}`,
        workOrderId: releasedOrder.id,
        riskSignature: readinessRiskSignature(readiness),
        reason: 'Demo supervisor accepted a controlled material-plan verification risk for visual testing.',
        authorizedBy: 'Demo Operations Supervisor',
        authorizedAt: isoAt('12:05'),
      };
      writeRaw(BROWSER_DISPATCH_RELEASES_KEY, [release]);
    }
  }

  const approvedReviews = reviews.filter((review) => review.status === 'approved');
  let billing: BrowserBillingDraft[] = approvedReviews.flatMap((review) => {
    const order = workOrders.find((candidate) => candidate.id === review.workOrderId);
    if (!order) return [];
    return [buildBillingDraft(order, review, executions.find((execution) => execution.workOrderId === order.id))];
  });
  billing = billing.map((draft, index) => index < 2 && draft.pricingComplete ? { ...draft, status: 'ready_for_qbo' as const, updatedAt: isoAt('12:02', index * 2) } : { ...draft, updatedAt: isoAt('12:00', index * 2) });
  writeRaw(BROWSER_BILLING_DRAFTS_KEY, billing);

  let receivables: BrowserReceivableInvoice[] = derivePreviewReceivables(billing, []);
  let payments: BrowserBankPayment[] = [];
  let allocations: BrowserPaymentAllocation[] = [];
  const firstInvoice = receivables[0];
  if (firstInvoice) {
    const payment: BrowserBankPayment = { id: 'DEMO-PAY-001', customerId: firstInvoice.customerId, customer: firstInvoice.customer, sender: 'Demo Bank Sender', reference: firstInvoice.id, amount: firstInvoice.openBalance, allocatedAmount: 0, unappliedAmount: firstInvoice.openBalance, status: 'detected', receivedAt: isoAt('11:58') };
    const suggestion = suggestPaymentAllocation(payment, receivables);
    const applied = applyAllocationSuggestion(payment, receivables, allocations, suggestion);
    receivables = applied.invoices;
    payments = [applied.payment];
    allocations = applied.allocations;
  }
  const secondOpen = receivables.find((invoice) => invoice.openBalance > 0);
  if (secondOpen) {
    payments.push({ id: 'DEMO-PAY-002', customerId: secondOpen.customerId, customer: secondOpen.customer, sender: 'Demo Partial Sender', reference: 'Demo transfer without exact invoice allocation', amount: Math.max(25, Math.round(secondOpen.openBalance * 0.4)), allocatedAmount: 0, unappliedAmount: Math.max(25, Math.round(secondOpen.openBalance * 0.4)), status: 'detected', receivedAt: isoAt('12:08') });
  }
  writeRaw(BROWSER_RECEIVABLES_KEY, receivables);
  writeRaw(BROWSER_BANK_PAYMENTS_KEY, payments);
  writeRaw(BROWSER_PAYMENT_ALLOCATIONS_KEY, allocations);

  return { crm, appointments, workOrders, reviews, billing, receivables, payments };
}

export function installDemoData() {
  if (typeof window === 'undefined') return getDemoDataState();
  const existing = controlFromStorage();
  if (existing?.datasetId === DEMO_DATASET_ID) return getDemoDataState();

  const crm = buildCrm();
  const keys = touchedKeys(crm);
  const backups = Object.fromEntries(keys.map((key) => [key, readRaw(key)]));
  const control: DemoDataControl = { active: true, datasetId: DEMO_DATASET_ID, installedAt: new Date().toISOString(), backups };
  window.localStorage.setItem(DEMO_CONTROL_KEY, json(control));
  window.localStorage.setItem(DEMO_PREFERENCE_KEY, 'enabled');
  try {
    writeBaseDataset();
  } catch (error) {
    for (const [key, value] of Object.entries(backups)) {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    }
    window.localStorage.removeItem(DEMO_CONTROL_KEY);
    throw error;
  }
  return getDemoDataState();
}

export function clearDemoData(options?: { disableAutoLoad?: boolean }) {
  if (typeof window === 'undefined') return getDemoDataState();
  const control = controlFromStorage();
  if (control) {
    for (const [key, value] of Object.entries(control.backups)) {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    }
  }
  window.localStorage.removeItem(DEMO_CONTROL_KEY);
  if (options?.disableAutoLoad !== false) window.localStorage.setItem(DEMO_PREFERENCE_KEY, 'disabled');
  return getDemoDataState();
}

export function reloadDemoData() {
  if (typeof window === 'undefined') return getDemoDataState();
  clearDemoData({ disableAutoLoad: false });
  window.localStorage.setItem(DEMO_PREFERENCE_KEY, 'enabled');
  return installDemoData();
}

export function ensureDemoDataForLiveReview() {
  if (typeof window === 'undefined') return getDemoDataState();
  const preference = window.localStorage.getItem(DEMO_PREFERENCE_KEY);
  if (preference === 'disabled') return getDemoDataState();
  return installDemoData();
}
