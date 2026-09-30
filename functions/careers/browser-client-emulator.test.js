'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const project='demo-demac-careers';
if(process.env.GCLOUD_PROJECT!==project||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local demo Firestore is required; production is forbidden.');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {createService}=require('./service');
const app=initializeApp({projectId:project}),db=getFirestore(app);
test.after(async()=>{await db.terminate();await deleteApp(app);});
test('isolated clients retain the real transaction-backed request limit under concurrency',async()=>{
  const key=`rate-${crypto.randomUUID()}`;let clock=180000;
  const limited=createService({db,files:{},infrastructure:{},now:()=>clock});
  for(let n=0;n<29;n++)await limited.rateLimit(key);
  const outcomes=await Promise.allSettled([limited.rateLimit(key),limited.rateLimit(key)]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(outcomes.find(result=>result.status==='rejected').reason.status,429);
  await assert.rejects(limited.rateLimit(key),{code:'rate-limited'});
  await limited.rateLimit(`${key}-other`);
  clock+=60000;await limited.rateLimit(key);
});
