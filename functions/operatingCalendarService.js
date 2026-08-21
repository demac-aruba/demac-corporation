const TIME_ZONE = "America/Aruba";
const DEFAULT_CLOSED_WEEKDAYS = Object.freeze([0]);
const DEFAULT_SEARCH_DAYS = 60;

function dateKeyInTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekdayForDate(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function normalizeClosedWeekdays(value) {
  return Array.isArray(value) ? value.map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6) : [...DEFAULT_CLOSED_WEEKDAYS];
}

function isOpenBusinessDate({ dateKey, closedWeekdays = DEFAULT_CLOSED_WEEKDAYS, closedDates = new Set() }) {
  const weekdays = new Set(normalizeClosedWeekdays(closedWeekdays));
  const dates = closedDates instanceof Set ? closedDates : new Set(closedDates || []);
  return !weekdays.has(weekdayForDate(dateKey)) && !dates.has(dateKey);
}

function nextOpenBusinessDate({ runDate, closedWeekdays = DEFAULT_CLOSED_WEEKDAYS, closedDates = new Set(), maxDays = DEFAULT_SEARCH_DAYS }) {
  for (let offset = 1; offset <= maxDays; offset += 1) {
    const candidate = addDays(runDate, offset);
    if (isOpenBusinessDate({ dateKey: candidate, closedWeekdays, closedDates })) return candidate;
  }
  return null;
}

function createOperatingCalendarService({ db } = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("A Firestore-compatible db is required for the operating calendar.");
  }

  async function loadRange(startDate, endDate = startDate) {
    const [calendarSettings, closuresSnapshot] = await Promise.all([
      db.collection("businessSettings").doc("business-calendar").get(),
      db.collection("calendarClosures")
        .where("date", ">=", startDate)
        .where("date", "<=", endDate)
        .get(),
    ]);
    return {
      closedWeekdays: normalizeClosedWeekdays(calendarSettings.data()?.closedWeekdays),
      closedDates: new Set(
        closuresSnapshot.docs
          .filter((document) => document.data().active !== false)
          .map((document) => document.data().date)
          .filter(Boolean),
      ),
    };
  }

  async function isOpenDate(dateKey) {
    const calendar = await loadRange(dateKey, dateKey);
    return isOpenBusinessDate({ dateKey, ...calendar });
  }

  async function nextOpenDate(runDate, maxDays = DEFAULT_SEARCH_DAYS) {
    const firstCandidate = addDays(runDate, 1);
    const lastCandidate = addDays(runDate, maxDays);
    const calendar = await loadRange(firstCandidate, lastCandidate);
    return nextOpenBusinessDate({ runDate, maxDays, ...calendar });
  }

  return {
    isOpenDate,
    loadRange,
    nextOpenDate,
  };
}

module.exports.DEFAULT_CLOSED_WEEKDAYS = DEFAULT_CLOSED_WEEKDAYS;
module.exports.DEFAULT_SEARCH_DAYS = DEFAULT_SEARCH_DAYS;
module.exports.TIME_ZONE = TIME_ZONE;
module.exports.addDays = addDays;
module.exports.createOperatingCalendarService = createOperatingCalendarService;
module.exports.dateKeyInTimeZone = dateKeyInTimeZone;
module.exports.isOpenBusinessDate = isOpenBusinessDate;
module.exports.nextOpenBusinessDate = nextOpenBusinessDate;
module.exports.normalizeClosedWeekdays = normalizeClosedWeekdays;
module.exports.weekdayForDate = weekdayForDate;
