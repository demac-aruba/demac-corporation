import { strict as assert } from 'node:assert';
import { createBookingOffer, validateBookingOffer } from '../lib/booking-intelligence/booking-offer';
import { mergeBookingConstraints, inferBookingConstraintPatch } from '../lib/booking-intelligence/constraints';
import { resolveCustomerIdentity } from '../lib/booking-intelligence/identity';
import { selectCommunicationRecipients } from '../lib/booking-intelligence/communication-policy';
import { rankRouteAwareCandidates } from '../lib/booking-intelligence/route-ranking';
import { summarizeAppointmentScope } from '../lib/booking-intelligence/appointment-scope';
import { navigationUrlForAddress, parseArubaAddressParts, parseLocationInput, resolveArubaAddressSuggestion, suggestArubaServiceAddresses } from '../lib/booking-intelligence/address';
import type { BookingRequest, CandidateSlot, DispatchJob } from '../lib/scheduling';

const identity = resolveCustomerIdentity(
  { name: 'Christian Marquez', phone: '5606772', email: '' },
  [{ id: 'C-1', name: 'Christian Márquez', phone: '+297 560 6772' }],
)[0];
assert(identity, 'Normalized Aruba phone must resolve an existing CRM identity.');
assert.equal(identity.strength, 'high');
assert.equal(identity.recommendedAction, 'reuse');

const similarName = resolveCustomerIdentity(
  { name: 'Maria Rodriguez' },
  [{ id: 'C-2', name: 'Maria Rodrigues' }],
)[0];
assert(similarName, 'Very similar names should be surfaced for review.');
assert.notEqual(similarName.recommendedAction, 'reuse', 'Name similarity alone must never silently reuse a CRM identity.');

const fonteinSuggestions = suggestArubaServiceAddresses('Weg Fontein 117', 4);
assert(fonteinSuggestions.length > 0, 'Weg Fontein must resolve from the Aruba address directory.');
assert.equal(fonteinSuggestions[0].canonical, 'Weg Fontein', 'The curated canonical address must outrank duplicate legacy aliases.');
assert.equal(fonteinSuggestions[0].demacSector, 'San Nicolas', 'Weg Fontein must derive the San Nicolas DEMAC sector.');
const fonteinResolved = resolveArubaAddressSuggestion('Weg Fontein 117', fonteinSuggestions[0]);
assert.equal(fonteinResolved.address, 'Weg Fontein 117', 'Selecting a street must preserve the house number.');
assert.equal(fonteinResolved.houseNumber, '117');
assert.equal(fonteinResolved.sector, 'San Nicolas');

const legacyFontein = suggestArubaServiceAddresses('Otaheitistraat', 4);
assert.equal(legacyFontein[0]?.canonical, 'Weg Fontein', 'Legacy Otaheitistraat wording should resolve to the curated Weg Fontein record instead of creating a duplicate suggestion.');
assert.equal(legacyFontein[0]?.demacSector, 'San Nicolas');

const parsedHouse = parseArubaAddressParts('Wayaca 217');
assert.equal(parsedHouse.street, 'Wayaca');
assert.equal(parsedHouse.houseNumber, '217');
const mapsMeLocation = parseLocationInput('mapsme://map?v=1&ll=12.450000,-69.950000');
assert.equal(mapsMeLocation?.latitude, 12.45, 'MAPS.ME-style ll coordinates should be captured.');
assert.equal(mapsMeLocation?.longitude, -69.95);
assert(navigationUrlForAddress('Weg Fontein 117', mapsMeLocation).includes('12.45%2C-69.95'), 'Navigation should prefer verified coordinates when available.');

const monday = mergeBookingConstraints({}, inferBookingConstraintPatch('El lunes puedo.'));
const mondayAfterTen = mergeBookingConstraints(monday, inferBookingConstraintPatch('Después de las 10 am.'));
assert.equal(mondayAfterTen.requestedWeekday, 1, 'A later time restriction must not erase the previously confirmed weekday.');
assert.equal(mondayAfterTen.notBefore, '10:00');

const scope = summarizeAppointmentScope([
  { id: 'W-1', presetId: 'standard_service', quantity: 1 },
  { id: 'W-2', presetId: 'diagnostic', quantity: 1 },
]);
assert.equal(scope.totalMinutes, 105, 'Mixed appointment scope should sum deterministic service durations.');
assert(scope.description.includes('Standard service') && scope.description.includes('diagnostic'), 'Customer description should preserve all work lines.');

const request: BookingRequest = {
  customer: 'Route Customer',
  site: 'Home',
  sector: 'Noord',
  presetId: 'standard_service',
  quantity: 1,
  workLines: [{ id: 'W-1', presetId: 'standard_service', quantity: 1 }],
};
const jobs: DispatchJob[] = [{
  id: 'JOB-1', customer: 'Existing', site: 'Noord Home', sector: 'Noord', start: '08:30', end: '09:30', segment: 'am', vanId: 'VAN-1', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true,
}];
const candidateSameSector: CandidateSlot = { vanId: 'VAN-1', start: '09:30', end: '10:30', segment: 'am', sector: 'Noord', score: 100, reasons: [], requiresSupportVan: false };
const candidateOtherVan: CandidateSlot = { vanId: 'VAN-2', start: '09:30', end: '10:30', segment: 'am', sector: 'Noord', score: 100, reasons: [], requiresSupportVan: false };
const ranked = rankRouteAwareCandidates({ slots: [candidateOtherVan, candidateSameSector], request, jobs });
assert.equal(ranked[0].vanId, 'VAN-1', 'A valid same-sector continuation should outrank an otherwise equivalent disconnected route.');
assert(ranked[0].reasons.some((reason) => reason.includes('same sector')), 'Route ranking should explain why the option is preferred.');

const offer = createBookingOffer({ dayKey: '2026-08-12', request, slot: candidateSameSector, jobs });
const changedJobs = [...jobs, { ...jobs[0], id: 'JOB-2', vanId: 'VAN-4', start: '13:30', end: '14:30', segment: 'pm' as const }];
const stillValid = validateBookingOffer({ offer, request, currentJobs: changedJobs, currentCandidates: [candidateSameSector] });
assert.equal(stillValid.valid, true);
assert.equal(stillValid.reason, 'schedule_changed', 'A changed schedule must trigger revalidation even if the exact offered slot remains valid.');
const gone = validateBookingOffer({ offer, request, currentJobs: changedJobs, currentCandidates: [] });
assert.equal(gone.valid, false);
assert.equal(gone.reason, 'slot_no_longer_available');

const arrival = selectCommunicationRecipients([
  { id: 'OWNER', name: 'Owner', phone: '5600001', primary: true },
  { id: 'TENANT', name: 'Tenant', phone: '5600002', arrivalContact: true },
], 'arrival');
assert.equal(arrival[0].contactId, 'TENANT', 'Arrival communication should go to the configured property access contact rather than always to the owner.');

console.log('Booking Intelligence acceptance checks passed.');
