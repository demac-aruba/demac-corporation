// Real HTTP + Firebase Auth emulator tokens + the repository's unmodified Rules.
const assert = require('node:assert/strict');
const em = require('./test-support/attendance-emulator.cjs');
em.configure();
const root='../.employee-attendance-test/apps/erp-next/lib/';
let user;
require(root+'firebase/session').requireFirebaseWebSession=async()=>({idToken:user.idToken});
const storage=require(root+'firebase/firestore-rest');
const attendance=require(root+'employee-attendance');
const realFetch=global.fetch;
let beforeCommit=null, loseResponse=false, operations=[];
global.fetch=async(url,init)=>{
  if(String(url).startsWith('http://127.0.0.1:')) return realFetch(url,init);
  const local=em.destination(url), action=new URL(url).pathname.split(':').at(-1);
  assert.ok(['batchGet','commit'].includes(action),'Web save must not request built-in transactions');
  operations.push(action);
  if(action==='commit'&&beforeCommit){const hook=beforeCommit;beforeCommit=null;await hook();}
  const response=await realFetch(local,init);
  if(action==='commit'&&loseResponse&&response.ok){loseResponse=false;throw new TypeError('Synthetic response loss after committed save');}
  return response;
};
const mutate=(fn)=>storage.mutateFirestoreDocumentWithReads('employeeTimesheets','target',['previous','next'],fn);
const doc=p=>em.get(storage,'employeeTimesheets/'+p);
const seed=(p,v)=>em.seed(storage,'employeeTimesheets/'+p,v);
async function main(){
  await em.reset();
  const admin=await em.account(storage,'admin','admin');
  const finance=await em.account(storage,'finance','accounting');
  const office=await em.account(storage,'office','office');
  const inactive=await em.account(storage,'inactive','admin',false);
  const technician=await em.account(storage,'tech','technician');
  const scenarios=[];
  for(const actor of [admin,finance]){
    user=actor;
    await seed('target',{notes:'Keep',unrelated:{historical:42},attendanceHistory:[{id:'old'}]});
    await seed('previous',{notes:'Adjacent unchanged'});
    const beforePrevious=await doc('previous');
    await mutate(current=>({overtimePayAllocations:[{rate:200,minutes:570}],attendanceHistory:[...current.attendanceHistory,{id:'new'}]}));
    const saved=await doc('target');
    assert.equal(saved.notes,'Keep');assert.deepEqual(saved.unrelated,{historical:42});assert.equal(saved.attendanceHistory.length,2);
    assert.deepEqual(await doc('previous'),beforePrevious);assert.equal(await doc('next'),null);
    scenarios.push(actor===admin?'admin with existing/missing neighbors':'accounting verifies missing days without delete permission');
  }
  const unprovisioned=await em.account(storage,'unprovisioned','admin');
  await em.remove('users/'+unprovisioned.uid);
  for(const actor of [office,inactive,technician,unprovisioned]){
    user=actor;const before=await doc('target');
    await assert.rejects(mutate(()=>({notes:'Forbidden'})),/PERMISSION_DENIED|UNAUTHENTICATED/);
    assert.deepEqual(await doc('target'),before);
  }
  const anonymous=await realFetch(em.FIRESTORE+em.DOCUMENTS+':batchGet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documents:['projects/'+em.PROJECT+'/databases/(default)/documents/employeeTimesheets/target']})});
  assert.equal(anonymous.status,403);
  scenarios.push('office/technician/inactive/unprovisioned/anonymous denied');
  user=admin;
  for(const race of ['target-change','target-delete','neighbor-change','neighbor-delete','neighbor-create','target-create']){
    await seed('target',{notes:'Original'});await seed('previous',{notes:'Neighbor'});await em.remove('employeeTimesheets/next');
    if(race==='target-create')await em.remove('employeeTimesheets/target');
    beforeCommit=async()=>{
      if(race==='target-change')await seed('target',{notes:'Concurrent'});
      if(race==='target-delete')await em.remove('employeeTimesheets/target');
      if(race==='target-create')await seed('target',{notes:'Concurrent created'});
      if(race==='neighbor-change')await seed('previous',{notes:'Concurrent neighbor'});
      if(race==='neighbor-delete')await em.remove('employeeTimesheets/previous');
      if(race==='neighbor-create')await seed('next',{notes:'New neighbor'});
    };
    await assert.rejects(mutate(()=>({notes:'Must not commit',overtimeMinutes:570})),/Refresh and review/);
    const final=await doc('target');assert.notEqual(final?.notes,'Must not commit');assert.equal(final?.overtimeMinutes,undefined);
    scenarios.push(race+' atomically rejected');
  }
  await seed('target',{notes:'Before revocation'});const before=await doc('target');
  beforeCommit=()=>em.seed(storage,'users/'+admin.uid,{role:'admin',active:false});
  await assert.rejects(mutate(()=>({notes:'Must not save'})),/Attendance could not be saved.*PERMISSION_DENIED/);
  assert.deepEqual(await doc('target'),before);await em.seed(storage,'users/'+admin.uid,{role:'admin',active:true});
  scenarios.push('role revocation between read and commit denied');
  // Full domain save from the screenshot, including canonical identity/history and retry.
  const employee={id:'synthetic-employee',name:'Synthetic Employee',active:true};
  const input={employee,date:'2026-10-20',schedule:{startTime:'08:00',endTime:'17:00',breakMinutes:60,scheduledMinutes:480,paidFreeMinutes:0},
    draft:{status:'Present',clockInTime:'08:00',clockOutTime:'17:00',breakMinutes:60,overtimeMinutes:0,notes:'Synthetic test',changeReason:'Synthetic emergency approval',workIntervals:[{startTime:'08:00',endTime:'17:00',startDayOffset:0,endDayOffset:0,breakMinutes:60},{startTime:'19:30',endTime:'05:00',startDayOffset:0,endDayOffset:1,breakMinutes:0}],overtimePayAllocations:[{rate:200,minutes:570}]},
    adjacentEntries:[],nextScheduledStartTime:'08:00',updatedByUserId:admin.uid,updatedByName:'Synthetic Admin'};
  // Domain input contract is exactly the one used by EmployeeWorkspace.
  loseResponse=true;
  await assert.rejects(attendance.saveAttendanceDay(input),/response|connection/i);
  const id='synthetic-employee_2026-10-20',once=await doc(id);
  assert.equal(once.regularHours,8);assert.equal(once.overtimeMinutes,570);assert.equal(once.workedMinutes,1050);
  assert.deepEqual(once.overtimePayAllocations,[{rate:200,minutes:570}]);assert.equal(once.attendanceHistory.length,1);
  await attendance.saveAttendanceDay(input);
  assert.deepEqual(await doc(id),once);
  assert.equal(await doc('synthetic-employee_2026-10-19'),null);assert.equal(await doc('synthetic-employee_2026-10-21'),null);
  scenarios.push('full split save 570m at 200%; lost-response retry preserves one audit entry');
  console.log(JSON.stringify({result:'PASS',productionRequests:0,authentication:'Firebase Auth emulator',rules:'firestore.rules unchanged',scenarios},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
