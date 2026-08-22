const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { canonicalizeVanCatalog } = require('../bookingVanIdentity');

initializeApp({ projectId: 'demac-corporation' });
const db = getFirestore();

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

async function main() {
  const [vansSnapshot, halfDaysSnapshot, staffSnapshot, assignmentsSnapshot] = await Promise.all([
    db.collection('vans').get(),
    db.collection('vanHalfDaySchedules').get(),
    db.collection('staffProfiles').get(),
    db.collection('dailyVanAssignments').get(),
  ]);
  const rawVans = vansSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const catalog = canonicalizeVanCatalog(rawVans);
  const staff = new Map(staffSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  const halfDays = halfDaysSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const activeHalfDays = halfDays.filter((item) => item.active !== false);
  const vans = catalog.vans.map((van) => {
    const rules = activeHalfDays.filter((rule) => {
      const raw = text(rule.vanId);
      return raw === van.id || catalog.aliases.get(raw) === van.id;
    });
    const driver = staff.get(van.responsibleStaffId);
    const helper = staff.get(van.regularHelperId);
    return {
      vanId: van.id,
      sourceVanId: van.sourceVanId,
      driver: driver?.name || van.responsibleStaffId || null,
      helper: helper?.name || van.regularHelperId || null,
      rules: rules.map((rule) => ({
        id: rule.id,
        vanId: rule.vanId,
        weekday: Number(rule.weekday),
        active: rule.active !== false,
        workdayStart: rule.workdayStart || null,
        workdayEnd: rule.workdayEnd || null,
        extraMorningSlot: rule.extraMorningSlot || null,
        updatedAt: rule.updatedAt?.toDate ? rule.updatedAt.toDate().toISOString() : rule.updatedAt || null,
      })),
    };
  });
  const deprecatedEmployeeDayOffs = staffSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((profile) => profile.weeklyDayOffWeekday != null || profile.weeklyDayOffEffectiveFrom)
    .map((profile) => ({ id: profile.id, name: profile.name || null, weeklyDayOffWeekday: profile.weeklyDayOffWeekday ?? null, weeklyDayOffEffectiveFrom: profile.weeklyDayOffEffectiveFrom || null }));

  console.log(JSON.stringify({
    vanCount: catalog.vans.length,
    halfDayDocumentCount: halfDays.length,
    activeHalfDayCount: activeHalfDays.length,
    vans,
    deprecatedEmployeeDayOffs,
    dailyAssignmentCount: assignmentsSnapshot.size,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
