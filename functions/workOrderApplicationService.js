const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { cleanText } = require("./bookingAuthorityCore");
const { compactObject } = require("./bookingAuthorityFirestore");
const { AFTER_HOURS_KIND } = require("./bookingAfterHours");
const { canonicalVanIdFromValue } = require("./bookingVanIdentity");
const { TIME_ZONE } = require("./operatingCalendarService");

const WORK_ORDER_APPLICATION_API_VERSION = 1;
const WORK_ORDER_ACTIONS = Object.freeze({
  COMPLETE_AFTER_HOURS: "complete_after_hours_work_order",
});
const FIELD_EXECUTE_ROLES = new Set([
  "technician",
  "admin",
  "super_admin",
  "super-admin",
  "superadmin",
  "owner",
  "operations",
  "office",
  "office_operator",
  "supervisor",
  "project_manager",
]);
const TECHNICIAN_ONLY_ROLE = "technician";

class WorkOrderApplicationError extends Error {
  constructor(code, message, details = {}, status = 409) {
    super(message);
    this.name = "WorkOrderApplicationError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function requiredText(value, field, label, limit = 240) {
  const result = cleanText(value, limit);
  if (!result) throw new WorkOrderApplicationError("invalid_request", `${label} is required.`, { field }, 400);
  return result;
}

function uniqueText(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value, 180)).filter(Boolean))];
}

function roundHours(minutes) {
  return Math.round((Math.max(0, Number(minutes) || 0) / 60) * 100) / 100;
}

function minutesOfDay(value) {
  const match = cleanText(value, 20).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number.NaN;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return Number.NaN;
  return hour * 60 + minute;
}

function timeFromMinutes(value) {
  const minutes = Math.max(0, Math.min((24 * 60) - 1, Math.round(Number(value) || 0)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function localParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new WorkOrderApplicationError("invalid_completion_time", "Completion time is invalid.", {}, 400);
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    iso: date.toISOString(),
  };
}

function wallClockValue(dateKey, time) {
  const match = cleanText(dateKey, 20).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const minutes = minutesOfDay(time);
  if (!match || !Number.isFinite(minutes)) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Math.floor(minutes / 60), minutes % 60);
}

function afterHoursWorkedMinutes(workDate, startTime, completion) {
  const start = wallClockValue(workDate, startTime);
  const end = wallClockValue(completion.date, completion.time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new WorkOrderApplicationError(
      "completion_before_start",
      "Actual completion must be later than the recorded after-hours start.",
      { workDate, startTime, completedDate: completion.date, completedTime: completion.time },
      409,
    );
  }
  return Math.max(1, Math.round((end - start) / 60_000));
}

function payrollPeriodForDate(date) {
  const reference = new Date(`${date}T12:00:00Z`);
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const endMonth = reference.getUTCDate() <= 26 ? month : month + 1;
  const end = new Date(Date.UTC(year, endMonth, 26, 12));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 27, 12));
  return `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`;
}

function sameVan(left, right) {
  const a = canonicalVanIdFromValue(left) || cleanText(left, 120).toUpperCase();
  const b = canonicalVanIdFromValue(right) || cleanText(right, 120).toUpperCase();
  return Boolean(a && b && a === b);
}

function resolvedTechnicalSchedule(date, vanId, halfDaySchedules = []) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0) {
    return { startTime: "", endTime: "", scheduledMinutes: 0, paidFreeMinutes: 0, expectedBreakMinutes: 0, source: "company_closed" };
  }

  const company = { startTime: "08:00", endTime: "17:00", scheduledMinutes: 480, paidFreeMinutes: 0, expectedBreakMinutes: 60, source: "company" };
  const rule = halfDaySchedules.find((item) => item?.active !== false && sameVan(item?.vanId, vanId) && Number(item?.weekday) === weekday);
  if (!rule) return company;

  const startMinutes = minutesOfDay(rule.workdayStart || company.startTime);
  const explicitEnd = minutesOfDay(rule.workdayEnd);
  const endMinutes = Number.isFinite(explicitEnd) && explicitEnd > startMinutes ? explicitEnd : startMinutes + 300;
  const scheduledMinutes = Math.max(0, endMinutes - startMinutes);
  return {
    startTime: timeFromMinutes(startMinutes),
    endTime: timeFromMinutes(endMinutes),
    scheduledMinutes,
    paidFreeMinutes: 0,
    expectedBreakMinutes: 0,
    source: "van_team_partial_day",
  };
}

function laterClockTime(current, candidate) {
  const currentMinutes = minutesOfDay(current);
  const candidateMinutes = minutesOfDay(candidate);
  if (!Number.isFinite(candidateMinutes)) return cleanText(current, 20) || undefined;
  if (!Number.isFinite(currentMinutes) || candidateMinutes > currentMinutes) return candidate;
  return current;
}

function buildTimesheet({ existing = {}, staff, workOrder, completion, overtimeMinutes, schedule, actor }) {
  const workDate = cleanText(workOrder.date, 20);
  const sources = Array.isArray(existing.workOrderOvertimeSources)
    ? existing.workOrderOvertimeSources.filter((source) => source && typeof source === "object")
    : [];
  const sourceExists = sources.some((source) => cleanText(source.workOrderId, 180) === workOrder.id);
  const nextSources = sourceExists ? sources : [...sources, {
    workOrderId: workOrder.id,
    appointmentId: cleanText(workOrder.appointmentId, 180),
    kind: AFTER_HOURS_KIND,
    date: workDate,
    startTime: cleanText(workOrder.afterHoursStartTime || workOrder.time, 20),
    completedAt: completion.iso,
    minutes: overtimeMinutes,
  }];
  const automatedMinutes = nextSources.reduce((sum, source) => sum + Math.max(0, Math.round(Number(source.minutes) || 0)), 0);
  const previousAutomated = Math.max(0, Math.round(Number(existing.automatedWorkOrderOvertimeMinutes) || 0));
  const existingOvertime = Math.max(0, Math.round(Number(existing.overtimeMinutes) || Math.round((Number(existing.overtimeHours) || 0) * 60)));
  const manualBaseline = Number.isFinite(Number(existing.manualOvertimeMinutes))
    ? Math.max(0, Math.round(Number(existing.manualOvertimeMinutes)))
    : Math.max(0, existingOvertime - previousAutomated);
  const totalOvertime = manualBaseline + automatedMinutes;
  const scheduledHours = roundHours(schedule.scheduledMinutes);
  const sameDayCompletion = completion.date === workDate;
  const nextClockOut = sameDayCompletion ? laterClockTime(existing.clockOutTime, completion.time) : existing.clockOutTime;
  const now = completion.iso;

  return compactObject({
    ...existing,
    id: `${staff.id}_${workDate}`,
    payrollPeriodId: payrollPeriodForDate(workDate),
    employeeId: staff.id,
    employeeName: cleanText(staff.name, 180) || staff.id,
    date: workDate,
    scheduledWorkHours: Number.isFinite(Number(existing.scheduledWorkHours)) ? Number(existing.scheduledWorkHours) : scheduledHours,
    paidFreeHours: Number.isFinite(Number(existing.paidFreeHours)) ? Number(existing.paidFreeHours) : roundHours(schedule.paidFreeMinutes),
    regularHours: Number.isFinite(Number(existing.regularHours)) ? Number(existing.regularHours) : scheduledHours,
    overtimeHours: roundHours(totalOvertime),
    overtimeMinutes: totalOvertime,
    aoHours: Number.isFinite(Number(existing.aoHours)) ? Number(existing.aoHours) : 0,
    vacationHours: Number.isFinite(Number(existing.vacationHours)) ? Number(existing.vacationHours) : 0,
    noWorkNoPayHours: Number.isFinite(Number(existing.noWorkNoPayHours)) ? Number(existing.noWorkNoPayHours) : 0,
    status: cleanText(existing.status, 120) || "Regular",
    attendanceStatus: existing.attendanceStatus || "Present",
    clockInTime: existing.clockInTime || undefined,
    clockOutTime: nextClockOut || undefined,
    breakMinutes: Number.isFinite(Number(existing.breakMinutes)) ? Number(existing.breakMinutes) : schedule.expectedBreakMinutes,
    lateMinutes: Number.isFinite(Number(existing.lateMinutes)) ? Number(existing.lateMinutes) : 0,
    scheduledStartTime: schedule.startTime || undefined,
    scheduledEndTime: schedule.endTime || undefined,
    scheduledBreakMinutes: schedule.expectedBreakMinutes,
    scheduledPaidFreeMinutes: schedule.paidFreeMinutes,
    scheduleSnapshotSource: schedule.source,
    manualOvertimeMinutes: manualBaseline,
    automatedWorkOrderOvertimeMinutes: automatedMinutes,
    workOrderOvertimeSources: nextSources,
    lastWorkOrderCompletedAt: completion.iso,
    overtimeReconciliationRequired: previousAutomated === 0 && existingOvertime > 0 && !sourceExists,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    updatedByUserId: cleanText(actor?.uid || actor?.id, 160) || "work-order-application",
    updatedByName: cleanText(actor?.name || actor?.email, 180) || "Work Order Application",
  });
}

function createWorkOrderApplicationService({ db, clock = () => new Date() } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db with transactions is required.");
  }

  async function completeAfterHours({ requestId, workOrderId, actor = {} } = {}) {
    const stableRequestId = requiredText(requestId, "requestId", "Request id", 240);
    if (stableRequestId.length < 8) throw new WorkOrderApplicationError("invalid_request", "Request id must contain at least 8 characters.", { field: "requestId" }, 400);
    const id = requiredText(workOrderId, "workOrderId", "Work Order id", 180);
    const completion = localParts(clock());
    const workOrderRef = db.collection("workOrders").doc(id);

    return db.runTransaction(async (transaction) => {
      const workOrderSnapshot = await transaction.get(workOrderRef);
      if (!workOrderSnapshot.exists) {
        throw new WorkOrderApplicationError("work_order_not_found", "The Work Order does not exist.", { workOrderId: id }, 404);
      }
      const workOrder = { id: workOrderSnapshot.id, ...workOrderSnapshot.data() };
      if (cleanText(workOrder.afterHoursKind, 80) !== AFTER_HOURS_KIND || workOrder.afterHoursOpenEnded !== true) {
        throw new WorkOrderApplicationError("not_after_hours", "Only an open-ended after-hours Work Order can use this completion action.", { workOrderId: id }, 409);
      }

      const technicianIds = uniqueText(workOrder.technicianIds);
      if (!technicianIds.length) {
        throw new WorkOrderApplicationError("assigned_crew_missing", "The Work Order has no canonical assigned crew snapshot.", { workOrderId: id }, 409);
      }
      const actorRole = cleanText(actor.role, 80).toLowerCase();
      if (actorRole === TECHNICIAN_ONLY_ROLE) {
        const actorStaffId = cleanText(actor.staffId, 180);
        if (!actorStaffId || !technicianIds.includes(actorStaffId)) {
          throw new WorkOrderApplicationError("permission_denied", "A technician can complete only a Work Order assigned to their staff profile.", { workOrderId: id }, 403);
        }
      }

      if (workOrder.actualCompletedAt) {
        return {
          success: true,
          replayed: true,
          version: WORK_ORDER_APPLICATION_API_VERSION,
          workOrderId: id,
          appointmentId: cleanText(workOrder.appointmentId, 180),
          completedAt: workOrder.actualCompletedAt,
          overtimeMinutes: Math.max(0, Math.round(Number(workOrder.afterHoursWorkedMinutes) || 0)),
          technicianIds,
        };
      }

      const workDate = requiredText(workOrder.date, "workOrder.date", "Work date", 20);
      const startTime = requiredText(workOrder.afterHoursStartTime || workOrder.time, "workOrder.afterHoursStartTime", "After-hours start time", 20);
      const overtimeMinutes = afterHoursWorkedMinutes(workDate, startTime, completion);
      const appointmentId = requiredText(workOrder.appointmentId, "workOrder.appointmentId", "Appointment id", 180);
      const appointmentRef = db.collection("appointments").doc(appointmentId);
      const appointmentSnapshot = await transaction.get(appointmentRef);
      if (!appointmentSnapshot.exists) {
        throw new WorkOrderApplicationError("appointment_not_found", "The linked Appointment does not exist.", { appointmentId, workOrderId: id }, 409);
      }

      const guardId = cleanText(workOrder.afterHoursGuardId, 180);
      const guardRef = guardId ? db.collection("bookingCapacityLocks").doc(guardId) : null;
      const guardSnapshot = guardRef ? await transaction.get(guardRef) : null;
      if (guardRef && (!guardSnapshot || !guardSnapshot.exists)) {
        throw new WorkOrderApplicationError("capacity_guard_missing", "The after-hours capacity guard is missing and must be reconciled before completion.", { guardId, workOrderId: id }, 409);
      }

      const halfDaySnapshot = await transaction.get(db.collection("vanHalfDaySchedules"));
      const halfDaySchedules = (halfDaySnapshot.docs || []).map((doc) => ({ id: doc.id, ...doc.data() }));
      const schedule = resolvedTechnicalSchedule(workDate, workOrder.vanId, halfDaySchedules);
      const staffRefs = technicianIds.map((staffId) => db.collection("staffProfiles").doc(staffId));
      const staffSnapshots = [];
      const timesheetSnapshots = [];
      for (let index = 0; index < staffRefs.length; index += 1) {
        const staffSnapshot = await transaction.get(staffRefs[index]);
        if (!staffSnapshot.exists) {
          throw new WorkOrderApplicationError("staff_profile_missing", "Assigned crew history references a missing staff profile.", { staffId: technicianIds[index], workOrderId: id }, 409);
        }
        staffSnapshots.push(staffSnapshot);
        timesheetSnapshots.push(await transaction.get(db.collection("employeeTimesheets").doc(`${technicianIds[index]}_${workDate}`)));
      }

      const attendanceEntries = [];
      for (let index = 0; index < technicianIds.length; index += 1) {
        const staff = { id: staffSnapshots[index].id, ...staffSnapshots[index].data() };
        const existing = timesheetSnapshots[index].exists ? timesheetSnapshots[index].data() || {} : {};
        const entry = buildTimesheet({ existing, staff, workOrder, completion, overtimeMinutes, schedule, actor });
        transaction.set(db.collection("employeeTimesheets").doc(entry.id), entry, { merge: false });
        attendanceEntries.push(entry);
      }

      const completionPatch = {
        actualCompletedAt: completion.iso,
        afterHoursWorkedMinutes: overtimeMinutes,
        lifecycle: "technician_complete",
        status: "Completada",
        completionRequestId: stableRequestId,
        completedById: cleanText(actor.uid || actor.id, 160),
        completedByName: cleanText(actor.name || actor.email, 180),
        updatedAt: completion.iso,
      };
      transaction.set(workOrderRef, completionPatch, { merge: true });
      transaction.set(appointmentRef, {
        actualCompletedAt: completion.iso,
        afterHoursWorkedMinutes: overtimeMinutes,
        lifecycleStatus: "technician_complete",
        completionRequestId: stableRequestId,
        completedById: cleanText(actor.uid || actor.id, 160),
        completedByName: cleanText(actor.name || actor.email, 180),
        updatedAtIso: completion.iso,
      }, { merge: true });
      if (guardRef) {
        transaction.set(guardRef, {
          active: false,
          releasedAt: completion.iso,
          releaseReason: "after-hours-work-order-completed",
          releasedByWorkOrderId: id,
          releasedById: cleanText(actor.uid || actor.id, 160),
        }, { merge: true });
      }

      return {
        success: true,
        replayed: false,
        version: WORK_ORDER_APPLICATION_API_VERSION,
        workOrderId: id,
        appointmentId,
        completedAt: completion.iso,
        overtimeMinutes,
        technicianIds,
        timesheetIds: attendanceEntries.map((entry) => entry.id),
      };
    });
  }

  return { completeAfterHours };
}

function bearerToken(request) {
  const header = String(request?.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return cleanText(match?.[1], 4_000);
}

function createWorkOrderApplicationApi({ db, verifyIdToken, service = null } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");
  const application = service || createWorkOrderApplicationService({ db });

  async function authenticate(request) {
    const token = bearerToken(request);
    if (!token) throw new WorkOrderApplicationError("unauthenticated", "Firebase authentication is required.", {}, 401);
    let decoded;
    try {
      decoded = await verifyIdToken(token);
    } catch (cause) {
      const error = new WorkOrderApplicationError("unauthenticated", "The Firebase session is invalid or expired.", {}, 401);
      error.cause = cause;
      throw error;
    }
    const uid = cleanText(decoded?.uid || decoded?.sub, 160);
    if (!uid) throw new WorkOrderApplicationError("unauthenticated", "The authenticated user has no uid.", {}, 401);
    const profileSnapshot = await db.collection("users").doc(uid).get();
    const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
    if (profile.active === false) throw new WorkOrderApplicationError("permission_denied", "This user is inactive.", {}, 403);
    const role = cleanText(profile.role || decoded.role, 80).toLowerCase();
    if (!FIELD_EXECUTE_ROLES.has(role)) throw new WorkOrderApplicationError("permission_denied", "This user is not allowed to complete Work Orders.", { role }, 403);
    return {
      uid,
      role,
      staffId: cleanText(profile.staffId, 180),
      email: cleanText(decoded.email || profile.email, 180),
      name: cleanText(profile.name || decoded.name || decoded.email, 180),
    };
  }

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    if (request.method !== "POST") return { status: 405, body: { success: false, error: { code: "method_not_allowed", message: "POST is required.", details: {} } } };
    try {
      const actor = await authenticate(request);
      const action = cleanText(request.body?.action, 120);
      const data = request.body?.data || {};
      if (action !== WORK_ORDER_ACTIONS.COMPLETE_AFTER_HOURS) {
        throw new WorkOrderApplicationError("unsupported_action", "Unsupported Work Order action.", { action }, 400);
      }
      const result = await application.completeAfterHours({ requestId: data.requestId, workOrderId: data.workOrderId, actor });
      return { status: 200, body: result };
    } catch (error) {
      const status = Number(error?.status) || (error?.code === "permission_denied" ? 403 : error?.code === "unauthenticated" ? 401 : 500);
      return {
        status,
        body: {
          success: false,
          error: {
            code: cleanText(error?.code || "internal_error", 120),
            message: cleanText(error?.message || error || "Unexpected Work Order application error.", 500),
            details: error?.details || {},
          },
        },
      };
    }
  }

  return { authenticate, handle, service: application };
}

let defaultApi;
function getDefaultApi() {
  if (!defaultApi) {
    defaultApi = createWorkOrderApplicationApi({
      db: getFirestore(),
      verifyIdToken: (token) => getAuth().verifyIdToken(token),
    });
  }
  return defaultApi;
}

exports.workOrderApplication = onRequest(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    const result = await getDefaultApi().handle(request);
    if (result.status === 204) {
      response.status(204).send("");
      return;
    }
    response.status(result.status).json(result.body);
  },
);

module.exports.FIELD_EXECUTE_ROLES = FIELD_EXECUTE_ROLES;
module.exports.WORK_ORDER_ACTIONS = WORK_ORDER_ACTIONS;
module.exports.WORK_ORDER_APPLICATION_API_VERSION = WORK_ORDER_APPLICATION_API_VERSION;
module.exports.WorkOrderApplicationError = WorkOrderApplicationError;
module.exports.afterHoursWorkedMinutes = afterHoursWorkedMinutes;
module.exports.buildTimesheet = buildTimesheet;
module.exports.createWorkOrderApplicationApi = createWorkOrderApplicationApi;
module.exports.createWorkOrderApplicationService = createWorkOrderApplicationService;
module.exports.payrollPeriodForDate = payrollPeriodForDate;
module.exports.resolvedTechnicalSchedule = resolvedTechnicalSchedule;
