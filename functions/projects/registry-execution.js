'use strict';
const { loadProjectActivity } = require('./registry-activity');
const { isTimelineEvent, deriveVisitExecution } = require('./field-execution');
const { FIELD_OPERATION_EVENT_COLLECTION } = require('../fieldOperationsAudit');
const { orderedWorkVisitChain } = require('../fieldOperationsVisitRead');
const MAX_EVENTS = 2000;

/** On-demand read only. Booking availability does NOT invoke this event-history query. */
async function loadProjectExecution({ db, transaction, project, afterId }) {
  const activity = await loadProjectActivity({ db, transaction, project, afterId });
  const issues = activity.issues.map(issue => ({ ...issue }));
  const orderIds = [...new Set(activity.rows.map(row => row.workOrderId))];
  const sourceEvents = [];
  let eventReadComplete = true;
  // One bounded query per ten parents, not one query per visit or report. Single-field
  // equality uses the existing event collection index; no new production index is activated.
  for (let offset = 0; offset < orderIds.length; offset += 10) {
    const room = MAX_EVENTS - sourceEvents.length;
    const snapshot = await transaction.get(db.collection(FIELD_OPERATION_EVENT_COLLECTION)
      .where('workOrderId', 'in', orderIds.slice(offset, offset + 10)).limit(room + 1));
    sourceEvents.push(...snapshot.docs.slice(0, room).map(doc => ({ ...doc.data(), id: doc.id })));
    if (snapshot.docs.length > room) {
      eventReadComplete = false;
      issues.push({ code: 'field_event_read_truncated' });
      break;
    }
  }
  const visitsById = new Map();
  for (const row of activity.rows) for (const visit of row.visits) {
    if (visitsById.has(visit.id)) issues.push({ code: 'field_visit_duplicate', visitId: visit.id });
    visitsById.set(visit.id, visit);
  }
  const eventsByVisit = new Map();
  for (const event of sourceEvents) {
    if (!isTimelineEvent(event)) continue;
    if (!visitsById.has(event.visitId)) {
      issues.push({ code: 'field_event_visit_missing', eventId: event.id });
      continue;
    }
    const rows = eventsByVisit.get(event.visitId) || [];
    rows.push(event);
    eventsByVisit.set(event.visitId, rows);
  }
  const rows = activity.rows.map(row => {
    try {
      orderedWorkVisitChain(row.visits.map(visit => ({ ...visit, workOrderId: row.workOrderId })), row.workOrderId);
    } catch { issues.push({ code: 'field_visit_chain_unresolved', workOrderId: row.workOrderId }); }
    const visits = row.visits.map(visit => deriveVisitExecution({
      visit: { ...visit, workOrderId: row.workOrderId, appointmentId: row.appointmentId,
        customerId: project.customerId, propertyId: project.propertyId },
      events: eventsByVisit.get(visit.id) || [],
      sourceComplete: eventReadComplete,
    }));
    for (const visit of visits) for (const issue of visit.issues) {
      issues.push({ ...issue, workOrderId: row.workOrderId, visitId: visit.visitId });
    }
    // A historical completed order without a Field visit cannot certify zero worked time.
    if (!visits.length) issues.push({ code: 'field_visit_not_recorded', workOrderId: row.workOrderId });
    return {
      workOrderId: row.workOrderId, appointmentId: row.appointmentId, phaseId: row.phaseId,
      vanId: row.vanId, date: row.date, cancelled: row.cancelled, scheduledSlots: row.scheduledSlots,
      plannedVanMinutes: row.plannedVanMinutes,
      reviewStatus: row.review?.status || null, reviewSource: row.review?.source || null,
      visits,
    };
  });
  // Two overlapping visits for one Van are not two independent Van-time charges.
  const perVan = new Map();
  for (const row of rows) {
    if (!row.vanId && row.visits.some(visit => visit.intervals.length)) {
      issues.push({ code: 'execution_van_unresolved', workOrderId: row.workOrderId });
    }
    const intervals = perVan.get(row.vanId) || [];
    for (const visit of row.visits) for (const interval of visit.intervals) {
      intervals.push({ start: Date.parse(interval.startedAt), end: Date.parse(interval.stoppedAt) });
    }
    perVan.set(row.vanId, intervals);
  }
  for (const intervals of perVan.values()) {
    intervals.sort((a, b) => a.start - b.start);
    let end = -Infinity;
    for (const interval of intervals) {
      if (interval.start < end && interval.end > interval.start) {
        issues.push({ code: 'overlapping_van_execution' });
        break;
      }
      end = Math.max(end, interval.end);
    }
  }
  const visits = rows.flatMap(row => row.visits);
  const pageComplete = activity.coverage.pageIsValid && eventReadComplete && issues.length === 0;
  const closed = visits.reduce((sum, visit) => sum + (visit.closedRecordedMinutes || 0), 0);
  const openIntervals = visits.filter(visit => visit.hasOpenInterval).length;
  const allProjectLinksIncluded = activity.coverage.allProjectLinksIncluded && pageComplete;
  return {
    projectId: project.id, projectVersion: project.version, source: 'canonical_field_event_timeline',
    timeBasis: 'closed_in_progress_intervals_not_person_hours',
    rows, issues, nextCursor: activity.nextCursor,
    coverage: { pageComplete, eventReadComplete, allProjectLinksIncluded, eventsRead: sourceEvents.length },
    pageTotals: {
      closedRecordedMinutes: pageComplete ? closed : null,
      openIntervals,
      visits: visits.length,
      approvedReports: rows.filter(row => row.reviewStatus === 'approved').length,
    },
    // Closed interval totals are not a running clock, payroll, or a physical-completion %.
    projectRecordedMinutes: allProjectLinksIncluded && !openIntervals ? closed : null,
    actualPersonMinutes: null,
    physicalProgressPercent: null,
  };
}
module.exports = { MAX_EVENTS, loadProjectExecution };
