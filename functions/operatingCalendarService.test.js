const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isOpenBusinessDate,
  nextOpenBusinessDate,
} = require("./operatingCalendarService");

test("Sunday is closed by the default Aruba operating calendar", () => {
  assert.equal(isOpenBusinessDate({ dateKey: "2026-08-23" }), false);
  assert.equal(isOpenBusinessDate({ dateKey: "2026-08-24" }), true);
});

test("Saturday next-open lookup returns Monday when Sunday is closed", () => {
  assert.equal(nextOpenBusinessDate({
    runDate: "2026-08-22",
    closedWeekdays: [0],
    closedDates: new Set(),
  }), "2026-08-24");
});

test("calendar closure pushes the next open date forward", () => {
  assert.equal(nextOpenBusinessDate({
    runDate: "2026-08-22",
    closedWeekdays: [0],
    closedDates: new Set(["2026-08-24"]),
  }), "2026-08-25");
});
