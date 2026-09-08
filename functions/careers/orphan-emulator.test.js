'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
if(process.env.GCLOUD_PROJECT!=='demo-demac-careers'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST||''))throw Error('Local demo emulators required; production is forbidden.');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getStorage}=require('firebase-admin/storage');
const {createService,COLLECTIONS:N}=require('./service'),{createFiles}=require('./files'),{createWorkers}=require('./workers'),sharp=require('sharp');
const {removePrivateObject}=require('./object-deletion');
test('storage acknowledgement loss retains cleanup intent and never deletes adopted application bytes',async()=>{
  const app=initializeApp({projectId:'demo-demac-careers',storageBucket:'demo-demac-careers.appspot.com'},'orphan-review'),db=getFirestore(app),bucket=getStorage(app).bucket();let time=Date.now();
  const files=createFiles({bucket,sharp,scanner:async()=>{}}),infrastructure={blockers:()=>[],signature:()=> 'qa-test'};
  const service=createService({db,files,infrastructure,now:()=>time}),workers=createWorkers({db,files,infrastructure,now:()=>time});
  const token='a'.repeat(64),C=require('./core'),id=crypto.randomUUID();
  try{
    await db.collection(N.sessions).doc(id).set({id,files:{},status:'draft',secretHash:C.digest(token),expiresAt:time+86400000});
    const photo=await sharp({create:{width:64,height:64,channels:3,background:'#eee'}}).png().toBuffer();
    const failing=createService({db,files:{...files,store:async(...params)=>{await files.store(...params);throw Error('Simulated lost storage acknowledgement');}},infrastructure,now:()=>time});
    await assert.rejects(failing.upload({sessionId:id,token,kind:'photo',name:'qa.png',base64:photo.toString('base64')}),/lost storage/);
    let [objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,1);
    await workers.cleanup();[objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,1,'delay protects an in-flight writer');
    const clean=await service.upload({sessionId:id,token,kind:'photo',name:'qa.png',base64:photo.toString('base64')});assert.equal(clean.status,'clean');
    time+=300001;await workers.cleanup();[objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,1,'only the failed lease object is deleted');
    assert.equal((await service.sessionStatus({sessionId:id,token})).files[0].status,'clean');
    const current=(await db.collection(N.sessions).doc(id).get()).data().files[clean.id];assert.equal((await files.read(current)).mime,'image/jpeg');
    await assert.rejects(removePrivateObject(bucket,{path:'appointments/not-careers'}));
    time+=86400000;await workers.cleanup();[objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,0,'expired draft removes its own remaining object');
  }finally{await db.terminate();await deleteApp(app);}
});
