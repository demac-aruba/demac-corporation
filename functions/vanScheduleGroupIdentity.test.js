const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canonicalVanScheduleGroupLabel,
  realignCanonicalVanScheduleGroups,
  targetVanIdForScheduleGroupName,
} = require("./vanScheduleGroupIdentity");

const JIDS = {
  miguel: "120000000000000001@g.us",
  gollo: "120000000000000002@g.us",
  mario: "120000000000000003@g.us",
  alejandro: "120000000000000004@g.us",
};

function van(id, groupName, groupJid) {
  return {
    id,
    name: id.replace("VAN-", "Van "),
    whatsappScheduleGroupName: groupName,
    whatsappScheduleGroupJid: groupJid,
    scheduleDeliveryEnabled: true,
  };
}

test("recognizes legacy group names and canonical crew labels", () => {
  assert.equal(targetVanIdForScheduleGroupName("TEC - Miguel"), "VAN-1");
  assert.equal(targetVanIdForScheduleGroupName("Mario Cornejo / Ronald Maury"), "VAN-2");
  assert.equal(targetVanIdForScheduleGroupName("TEC - Alejandro y Edwin"), "VAN-3");
  assert.equal(targetVanIdForScheduleGroupName("Gollo y Walter"), "VAN-4");
  assert.equal(canonicalVanScheduleGroupLabel("VAN-4"), "Jose Gregorio / Walter Rangel");
});

test("realigns the production shifted group JIDs in memory before any message can be sent", () => {
  const aligned = realignCanonicalVanScheduleGroups([
    van("VAN-1", "TEC - Miguel", JIDS.miguel),
    van("VAN-2", "Gollo y Walter", JIDS.gollo),
    van("VAN-3", "TEC - Mario y Ronald", JIDS.mario),
    van("VAN-4", "TEC - Alejandro y Edwin", JIDS.alejandro),
  ]);
  const byId = new Map(aligned.map((item) => [item.id, item]));

  assert.equal(byId.get("VAN-1").whatsappScheduleGroupName, "Miguel Reyes / Alan Baquero");
  assert.equal(byId.get("VAN-1").whatsappScheduleGroupJid, JIDS.miguel);
  assert.equal(byId.get("VAN-2").whatsappScheduleGroupName, "Mario Cornejo / Ronald Maury");
  assert.equal(byId.get("VAN-2").whatsappScheduleGroupJid, JIDS.mario);
  assert.equal(byId.get("VAN-3").whatsappScheduleGroupName, "Alejandro Marquez / Edwin Calvo");
  assert.equal(byId.get("VAN-3").whatsappScheduleGroupJid, JIDS.alejandro);
  assert.equal(byId.get("VAN-4").whatsappScheduleGroupName, "Jose Gregorio / Walter Rangel");
  assert.equal(byId.get("VAN-4").whatsappScheduleGroupJid, JIDS.gollo);
  assert.equal(byId.get("VAN-2").whatsappScheduleGroupAlignmentSourceVanId, "VAN-3");
  assert.equal(byId.get("VAN-3").whatsappScheduleGroupAlignmentSourceVanId, "VAN-4");
  assert.equal(byId.get("VAN-4").whatsappScheduleGroupAlignmentSourceVanId, "VAN-2");
});

test("fails closed instead of sending to a guessed group when the four identities are incomplete", () => {
  const aligned = realignCanonicalVanScheduleGroups([
    van("VAN-1", "TEC - Miguel", JIDS.miguel),
    van("VAN-2", "Unknown Team", JIDS.gollo),
    van("VAN-3", "TEC - Mario y Ronald", JIDS.mario),
    van("VAN-4", "TEC - Alejandro y Edwin", JIDS.alejandro),
  ]);
  assert.equal(aligned.every((item) => item.scheduleDeliveryEnabled === false), true);
  assert.equal(aligned.every((item) => item.whatsappScheduleGroupJid === ""), true);
  assert.equal(aligned.every((item) => item.whatsappScheduleGroupAlignment === "invalid"), true);
});

test("leaves a catalog with no WhatsApp configuration untouched", () => {
  const input = [{ id: "VAN-1", name: "Van 1" }];
  assert.deepEqual(realignCanonicalVanScheduleGroups(input), input);
});
