const test = require("node:test");
const assert = require("node:assert/strict");
const { bookingRequestFromOffice } = require("./officeBookingAuthority");

test("office scheduling preserves multiple work lines and manual Other time", () => {
  const request = bookingRequestFromOffice({
    customerId: "client-1",
    propertyId: "property-1",
    workLines: [
      { id: "service", presetId: "standard_service", serviceId: "s1", quantity: 2 },
      { id: "install", presetId: "standard_installation", serviceId: "s2", quantity: 1 },
      { id: "other", presetId: "other", serviceId: "s3", quantity: 1, manualDurationMinutes: 90 },
    ],
    customerFacingDescription: "Mixed visit",
    technicianInstructions: "Confirm equipment on site",
  });
  assert.equal(request.workLines.length, 3);
  assert.equal(request.workLines[0].quantity, 2);
  assert.equal(request.workLines[2].manualDurationMinutes, 90);
  assert.equal(request.workLines[1].customerFacingDescription, "Mixed visit");
  assert.equal(request.workLines[1].technicianInstructions, "Confirm equipment on site");
});
