const assert = require("node:assert/strict");
const test = require("node:test");
const { deriveVanGroupRealignment, targetForGroupName, verifyAlignedVanGroups } = require("./realignVanScheduleGroups");

const GROUPS = {
  miguel: "120000000000000001@g.us",
  gollo: "120000000000000002@g.us",
  mario: "120000000000000003@g.us",
  alejandro: "120000000000000004@g.us",
};

function van(id, name, jid) {
  return {
    id,
    active: true,
    whatsappScheduleGroupName: name,
    whatsappScheduleGroupJid: jid,
    scheduleDeliveryEnabled: true,
  };
}

test("recognizes legacy and canonical DEMAC van WhatsApp group identities", () => {
  assert.equal(targetForGroupName("TEC - Miguel"), "VAN-1");
  assert.equal(targetForGroupName("Miguel Reyes / Alan Baquero"), "VAN-1");
  assert.equal(targetForGroupName("TEC - Mario y Ronald"), "VAN-2");
  assert.equal(targetForGroupName("Mario Cornejo / Ronald Maury"), "VAN-2");
  assert.equal(targetForGroupName("TEC - Alejandro y Edwin"), "VAN-3");
  assert.equal(targetForGroupName("Alejandro Marquez / Edwin Calvo"), "VAN-3");
  assert.equal(targetForGroupName("Gollo y Walter"), "VAN-4");
  assert.equal(targetForGroupName("Goyo y Walter"), "VAN-4");
  assert.equal(targetForGroupName("Jose Gregorio / Walter Rangel"), "VAN-4");
});

test("realigns the shifted production-style group configuration without changing group JIDs", () => {
  const updates = deriveVanGroupRealignment([
    van("VAN-1", "TEC - Miguel", GROUPS.miguel),
    van("VAN-2", "Gollo y Walter", GROUPS.gollo),
    van("VAN-3", "TEC - Mario y Ronald", GROUPS.mario),
    van("VAN-4", "TEC - Alejandro y Edwin", GROUPS.alejandro),
  ]);
  const byVan = new Map(updates.map((item) => [item.vanId, item]));
  assert.equal(byVan.get("VAN-1").groupJid, GROUPS.miguel);
  assert.equal(byVan.get("VAN-2").groupJid, GROUPS.mario);
  assert.equal(byVan.get("VAN-3").groupJid, GROUPS.alejandro);
  assert.equal(byVan.get("VAN-4").groupJid, GROUPS.gollo);
  assert.equal(byVan.get("VAN-1").groupName, "Miguel Reyes / Alan Baquero");
  assert.equal(byVan.get("VAN-2").groupName, "Mario Cornejo / Ronald Maury");
  assert.equal(byVan.get("VAN-3").groupName, "Alejandro Marquez / Edwin Calvo");
  assert.equal(byVan.get("VAN-4").groupName, "Jose Gregorio / Walter Rangel");
  assert.equal(byVan.get("VAN-2").movedFromVanId, "VAN-3");
  assert.equal(byVan.get("VAN-3").movedFromVanId, "VAN-4");
  assert.equal(byVan.get("VAN-4").movedFromVanId, "VAN-2");
});

test("already aligned canonical group configuration remains stable and verifies", () => {
  const aligned = [
    van("VAN-1", "Miguel Reyes / Alan Baquero", GROUPS.miguel),
    van("VAN-2", "Mario Cornejo / Ronald Maury", GROUPS.mario),
    van("VAN-3", "Alejandro Marquez / Edwin Calvo", GROUPS.alejandro),
    van("VAN-4", "Jose Gregorio / Walter Rangel", GROUPS.gollo),
  ];
  const updates = deriveVanGroupRealignment(aligned);
  assert.deepEqual(updates.map((item) => item.movedFromVanId), ["VAN-1", "VAN-2", "VAN-3", "VAN-4"]);
  assert.deepEqual(verifyAlignedVanGroups(aligned), [
    { vanId: "VAN-1", groupName: "Miguel Reyes / Alan Baquero" },
    { vanId: "VAN-2", groupName: "Mario Cornejo / Ronald Maury" },
    { vanId: "VAN-3", groupName: "Alejandro Marquez / Edwin Calvo" },
    { vanId: "VAN-4", groupName: "Jose Gregorio / Walter Rangel" },
  ]);
});

test("verification fails if the persisted van/group relationship is still shifted", () => {
  assert.throws(() => verifyAlignedVanGroups([
    van("VAN-1", "Miguel Reyes / Alan Baquero", GROUPS.miguel),
    van("VAN-2", "Jose Gregorio / Walter Rangel", GROUPS.gollo),
    van("VAN-3", "Mario Cornejo / Ronald Maury", GROUPS.mario),
    van("VAN-4", "Alejandro Marquez / Edwin Calvo", GROUPS.alejandro),
  ]), /Verification failed/);
});

test("realignment fails closed rather than guessing if a group cannot be identified", () => {
  assert.throws(() => deriveVanGroupRealignment([
    van("VAN-1", "TEC - Miguel", GROUPS.miguel),
    van("VAN-2", "Unknown Team", GROUPS.gollo),
    van("VAN-3", "TEC - Mario y Ronald", GROUPS.mario),
    van("VAN-4", "TEC - Alejandro y Edwin", GROUPS.alejandro),
  ]), /Cannot safely realign/);
});
