import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  captureBookingOfferForCommit,
  createBookingCommitGate,
  createLatestAvailabilityGate,
  liveBookingTargetKey,
  officeOfferIsExpired,
} from '../lib/live-booking-ui-state';
import {
  liveSchedulingClockSnapshot,
  liveSlotStartHasPassed,
  millisecondsUntilNextClockMinute,
} from '../lib/live-scheduling-clock';
import {
  officeBookingDiagnosticMessage,
  officeBookingErrorMessage,
  officeBookingResolvedWorkload,
} from '../lib/office-booking-diagnostics';

function requireCondition(condition: unknown, message: string) {
  if (!condition) throw new Error(`Live booking frontend acceptance failed: ${message}`);
}

const liveOverviewSource = readFileSync(
  resolve(process.cwd(), 'components/scheduling/live-scheduling-overview.tsx'),
  'utf8',
);
const remainingWorkPickerSource = readFileSync(
  resolve(process.cwd(), 'components/scheduling/remaining-work-schedule-picker.tsx'),
  'utf8',
);
const remainingWorkPickerStyles = readFileSync(
  resolve(process.cwd(), 'components/scheduling/remaining-work-schedule-picker.module.css'),
  'utf8',
);
const createDrawerSource = readFileSync(
  resolve(process.cwd(), 'components/scheduling/live-appointment-create-drawer.tsx'),
  'utf8',
);
const detailsDrawerSource = readFileSync(
  resolve(process.cwd(), 'components/scheduling/live-appointment-details-drawer.tsx'),
  'utf8',
);
const supportDrawerSource = readFileSync(
  resolve(process.cwd(), 'components/scheduling/adhoc-support-drawer.tsx'),
  'utf8',
);
requireCondition(
  liveOverviewSource.includes("type RefreshMode = 'normal' | 'force_capacity' | 'after_write';")
    && liveOverviewSource.includes("const mustStartAfterCurrent = mode === 'after_write';")
    && /const running = refreshRunningRef\.current;[\s\S]*?if \(running\s*&& !mustStartAfterCurrent\s*&& !forceCapacity/.test(liveOverviewSource),
  'Post-write refreshes must bypass the running-request join and enqueue a read that starts after the write.',
);
requireCondition(
  liveOverviewSource.includes("const refreshAfterWrite = useCallback(() => refresh('after_write'), [refresh]);")
    && (liveOverviewSource.match(/(?:void|await) refreshAfterWrite\(\);/g)?.length ?? 0) >= 4
    && liveOverviewSource.includes('onChanged={refreshAfterWrite}'),
  'Create, after-hours, support, move reconciliation and appointment lifecycle callbacks must use the post-write refresh path.',
);
requireCondition(
  remainingWorkPickerSource.includes('const [availabilityRevision, setAvailabilityRevision] = useState(0);')
    && remainingWorkPickerSource.includes('officeOfferIsExpired(availability.offer.expiresAt, Date.now())')
    && remainingWorkPickerSource.includes('disabled={!selectedOption || !offerCurrent || availabilityLoading || !canConfirm || scheduling}')
    && (remainingWorkPickerSource.match(/setAvailabilityRevision\(\(current\) => current \+ 1\)/g)?.length ?? 0) >= 2,
  'Remaining-work and reschedule offers must disable confirmation at expiry and trigger a fresh Authority check.',
);
requireCondition(
  remainingWorkPickerSource.includes('className={styles.rescheduleControls}')
    && remainingWorkPickerStyles.includes('.rescheduleControls{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(320px,1.3fr)')
    && remainingWorkPickerStyles.includes('@media(max-width:720px){.rescheduleControls{grid-template-columns:1fr}}'),
  'Reschedule controls must collapse to one column on a phone viewport.',
);
requireCondition(
  supportDrawerSource.includes('aria-label="Close support drawer"')
    && detailsDrawerSource.includes('aria-label="Close appointment details"')
    && remainingWorkPickerSource.includes('aria-label="Close reschedule appointment"')
    && createDrawerSource.includes('aria-label="Close customer editor"')
    && createDrawerSource.includes('aria-label="Close property editor"')
    && supportDrawerSource.includes('className={styles.descriptionPreview} role="alert"')
    && detailsDrawerSource.includes('className={styles.descriptionPreview} role="alert"')
    && remainingWorkPickerSource.includes('className={styles.error} role="alert"')
    && createDrawerSource.includes('className={styles.errorBox} role="alert"'),
  'Scheduling drawers must expose meaningful close names and announce asynchronous errors.',
);

const incidentClock = new Date('2026-09-01T13:05:15.000Z');
const snapshot = liveSchedulingClockSnapshot(incidentClock);
requireCondition(snapshot.dateKey === '2026-09-01' && snapshot.time === '09:05', 'The injected clock must resolve the incident in America/Aruba time.');
requireCondition(liveSlotStartHasPassed('2026-09-01', '08:30', snapshot), 'A same-day 08:30 start must be past at 09:05 and may not render as OPEN/BOOK.');
requireCondition(liveSlotStartHasPassed('2026-09-01', '09:05', snapshot), 'A start equal to the current minute must match Authority and be unavailable.');
requireCondition(!liveSlotStartHasPassed('2026-09-01', '09:30', snapshot), 'A later same-day start must remain eligible for visual booking.');
requireCondition(liveSlotStartHasPassed('2026-08-31', '15:30', snapshot), 'Previous-day starts must never reappear as open booking targets.');
requireCondition(!liveSlotStartHasPassed('2026-09-02', '08:30', snapshot), 'Future-day starts must not be rejected by the current-time guard.');
requireCondition(millisecondsUntilNextClockMinute(incidentClock) === 45_000, 'The reactive clock must align its refresh with the next minute boundary without an intentional stale interval.');

const targetA = { dateKey: '2026-09-01', vanId: 'VAN-4', start: '08:30' };
const targetB = { dateKey: '2026-09-01', vanId: 'VAN-4', start: '09:30' };
const targetC = { dateKey: '2026-09-01', vanId: 'VAN-3', start: '08:30' };
requireCondition(liveBookingTargetKey(targetA) !== liveBookingTargetKey(targetB), 'A new start must remount/reset the create drawer instead of retaining a mixed target.');
requireCondition(liveBookingTargetKey(targetA) !== liveBookingTargetKey(targetC), 'A new primary Van must remount/reset the create drawer.');

const availability = createLatestAvailabilityGate();
const sixtyMinute = availability.begin('other:1:60');
const oneHundredEightyMinute = availability.begin('other:1:180');
requireCondition(sixtyMinute.signal.aborted, 'Starting the 180-minute check must abort the superseded 60-minute request.');
requireCondition(!availability.isCurrent(sixtyMinute, 'other:1:180'), 'A late 60-minute response must never become the active offer.');
requireCondition(availability.isCurrent(oneHundredEightyMinute, 'other:1:180'), 'The newest 180-minute request must remain eligible to publish its offer.');
availability.invalidate();
requireCondition(oneHundredEightyMinute.signal.aborted, 'Draft mutation or unmount must abort the active availability request.');

const commit = createBookingCommitGate();
requireCondition(commit.tryAcquire(), 'The first confirm must acquire the synchronous commit guard.');
requireCondition(commit.isActive(), 'Request-affecting controls must observe an in-flight commit immediately.');
requireCondition(!commit.tryAcquire(), 'A rapid second Confirm/Hold dispatch must be rejected before React rerenders.');
commit.release();
requireCondition(commit.tryAcquire(), 'The guard must reopen after the prior commit settles.');
commit.release();

requireCondition(!officeOfferIsExpired('2026-09-01T13:06:00.000Z', incidentClock.getTime()), 'A future Authority expiry must keep the offer active.');
requireCondition(officeOfferIsExpired('2026-09-01T13:05:15.000Z', incidentClock.getTime()), 'An offer expires at the exact Authority expiry instant.');
requireCondition(officeOfferIsExpired('not-an-authority-timestamp', incidentClock.getTime()), 'A malformed Authority expiry must fail closed instead of leaving an approval active.');
requireCondition(officeOfferIsExpired(undefined, incidentClock.getTime()), 'An Authority offer without an expiry must fail closed instead of remaining approved indefinitely.');

const unavailable = officeBookingDiagnosticMessage({
  reason: 'required-primary-target-unavailable',
  metadata: {
    requestedTimeUnavailable: true,
    routeZone: 'internal-zone',
    diagnostic: {
      version: 1,
      code: 'requested-start-not-future',
      resolvedWorkload: { quantity: 1, durationMinutes: 180, slots: 3, ownedSlots: ['08:30', '09:30', '10:30'], capacityEndTime: '11:30' },
    },
  },
}, 'Fallback');
requireCondition(unavailable.includes('already passed') && unavailable.includes('(required-primary-target-unavailable)'), 'Structured diagnostic codes must produce an exact safe explanation while preserving the legacy reason.');
requireCondition(!unavailable.includes('internal-zone'), 'Diagnostic UI must not dump raw Authority metadata.');
const resolvedWorkload = officeBookingResolvedWorkload({
  diagnostic: { resolvedWorkload: { quantity: 1, durationMinutes: 180, slots: 3, ownedSlots: ['08:30', '09:30', '10:30'], capacityEndTime: '11:30' } },
});
requireCondition(resolvedWorkload?.durationMinutes === 180 && resolvedWorkload.ownedSlots?.join(',') === '08:30,09:30,10:30', 'The Authority resolved workload must drive the visual workload summary without frontend recomputation.');
const expired = officeBookingErrorMessage({ reason: 'offer_expired', details: { reason: 'offer_expired' } }, 'Fallback');
requireCondition(expired.includes('expired') && expired.includes('(offer_expired)'), 'Structured commit failures must preserve a safe expiry diagnostic.');

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function verifyBehavioralRequestAndCommitRaces() {
  const raceGate = createLatestAvailabilityGate();
  const oneHour = deferred<string>();
  const twoHours = deferred<string>();
  const threeHours = deferred<string>();
  const requestSignals: AbortSignal[] = [];
  const published: string[] = [];
  const rejected: string[] = [];
  const settled: string[] = [];
  let currentSignature = 'other:1:60';

  const run = (signature: string, pending: Deferred<string>) => {
    currentSignature = signature;
    return raceGate.runLatest({
      signature,
      request: (signal) => {
        requestSignals.push(signal);
        return pending.promise;
      },
      currentSignature: () => currentSignature,
      publish: (value) => published.push(value),
      reject: () => rejected.push(signature),
      settle: () => settled.push(signature),
    });
  };

  const oneHourRun = run('other:1:60', oneHour);
  const twoHourRun = run('other:1:120', twoHours);
  const threeHourRun = run('other:1:180', threeHours);
  requireCondition(requestSignals.length === 3, 'All three deferred Authority checks must start.');
  requireCondition(requestSignals[0].aborted && requestSignals[1].aborted && !requestSignals[2].aborted, 'Rapid 1h→2h→3h edits must abort both superseded requests while retaining the latest request.');

  twoHours.resolve('offer-2h-late');
  oneHour.resolve('offer-1h-latest-to-arrive');
  threeHours.resolve('offer-3h-current');
  const raceResults = await Promise.all([oneHourRun, twoHourRun, threeHourRun]);
  requireCondition(raceResults.join(',') === 'stale,stale,published', 'Out-of-order deferred responses must classify both superseded requests as stale.');
  requireCondition(published.join(',') === 'offer-3h-current', 'Only the current 3-hour Authority response may publish visible UI state.');
  requireCondition(rejected.length === 0, 'Superseded requests must not surface stale error UI.');
  requireCondition(settled.join(',') === 'other:1:180', 'Only the latest request may clear the visible checking state.');

  const unmountGate = createLatestAvailabilityGate();
  const requestAfterUnmount = deferred<string>();
  const unmountPublished: string[] = [];
  let mountedSignature = 'other:1:180';
  const unmountRun = unmountGate.runLatest({
    signature: mountedSignature,
    request: () => requestAfterUnmount.promise,
    currentSignature: () => mountedSignature,
    publish: (value) => unmountPublished.push(value),
    reject: () => unmountPublished.push('error'),
    settle: () => unmountPublished.push('settled'),
  });
  mountedSignature = 'other:1:240';
  unmountGate.invalidate();
  requestAfterUnmount.resolve('late-after-cleanup');
  requireCondition(await unmountRun === 'stale', 'Draft mutation or drawer cleanup must stale an unresolved request even if transport ignores AbortSignal.');
  requireCondition(unmountPublished.length === 0, 'A response after mutation/unmount must not publish data, errors or checking-state updates into the old drawer.');

  const commitGate = createBookingCommitGate();
  const futureOffer = {
    signature: 'other:1:180',
    offerId: 'offer-current',
    offerExpiresAt: '2026-09-01T13:10:00.000Z',
  };
  const firstCapture = captureBookingOfferForCommit(commitGate, futureOffer, futureOffer.signature, incidentClock.getTime());
  requireCondition(firstCapture.status === 'captured', 'A current, unexpired offer must be captured for commit.');
  requireCondition(commitGate.isActive(), 'Capturing the offer must freeze request-affecting controls synchronously, before any React rerender.');

  let draftDurationMinutes = 180;
  const mutateDraft = (minutes: number) => {
    if (commitGate.isActive()) return false;
    draftDurationMinutes = minutes;
    return true;
  };
  requireCondition(!mutateDraft(60) && draftDurationMinutes === 180, 'A captured commit must retain its 3-hour request while controls reject attempted mutations.');
  const secondCapture = captureBookingOfferForCommit(commitGate, futureOffer, futureOffer.signature, incidentClock.getTime());
  requireCondition(secondCapture.status === 'busy', 'A rapid second click must not capture or dispatch the same offer twice.');
  if (firstCapture.status === 'captured') firstCapture.release();
  requireCondition(!commitGate.isActive(), 'Controls may unlock only after the captured commit settles.');

  const expiredCapture = captureBookingOfferForCommit(
    commitGate,
    { ...futureOffer, offerExpiresAt: incidentClock.toISOString() },
    futureOffer.signature,
    incidentClock.getTime(),
  );
  requireCondition(expiredCapture.status === 'expired' && !commitGate.isActive(), 'An expired offer must fail closed without acquiring the commit gate.');

  const singleFlightGate = createBookingCommitGate();
  const commitResponse = deferred<void>();
  let commitDispatches = 0;
  const dispatchCommit = async () => {
    const capture = captureBookingOfferForCommit(singleFlightGate, futureOffer, futureOffer.signature, incidentClock.getTime());
    if (capture.status !== 'captured') return capture.status;
    commitDispatches += 1;
    try {
      await commitResponse.promise;
      return 'committed';
    } finally {
      capture.release();
    }
  };
  const firstDispatch = dispatchCommit();
  const duplicateDispatch = dispatchCommit();
  requireCondition(await duplicateDispatch === 'busy', 'The second async Confirm dispatch must exit before calling the commit API.');
  requireCondition(commitDispatches === 1, 'Only one commit API call may be dispatched for rapid double-clicks.');
  commitResponse.resolve();
  requireCondition(await firstDispatch === 'committed' && !singleFlightGate.isActive(), 'The single captured commit must release its UI lock after settlement.');
}

void verifyBehavioralRequestAndCommitRaces()
  .then(() => {
    console.log('Live booking frontend acceptance passed: reactive past-start guard, mounted deferred-response orchestration, frozen single-flight commit, offer expiry and safe diagnostics verified.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
